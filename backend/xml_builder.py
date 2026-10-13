import os
import re
from datetime import datetime
from xml.sax.saxutils import escape
from backend.models import InvoiceData

def clean_date(d_str: str) -> str:
    """Format any date string as YYYYMMDD for CII DateTimeString format 102."""
    if not d_str:
        return ""
    digits = re.sub(r"[^\d]", "", str(d_str))
    if len(digits) == 8:
        # Check if dd.mm.yyyy or yyyymmdd
        if "." in str(d_str):
            parts = [p.strip() for p in str(d_str).split(".") if p.strip()]
            if len(parts) == 3 and len(parts[2]) == 4:
                return f"{parts[2]}{int(parts[1]):02d}{int(parts[0]):02d}"
        return digits
    elif len(digits) >= 8 and "-" in str(d_str):
        parts = [p.strip() for p in str(d_str).split("-") if p.strip()]
        if len(parts) == 3 and len(parts[0]) == 4:
            return f"{parts[0]}{int(parts[1]):02d}{int(parts[2]):02d}"
    return digits if len(digits) == 8 else ""

def generate_facturx_xml(inv: InvoiceData, profile: str = "EN16931") -> str:
    """
    Generate compliant factur-x.xml (ZUGFeRD 2.x / UN/CEFACT CII 16B).
    EN16931 guideline: urn:cen.eu:en16931:2017
    e-SLOG 2.0 guideline: urn:cen.eu:en16931:2017#compliant#urn:eslog.si:2.0
    """
    if profile.upper() in ["ESLOG2", "ESLOG_2_0", "ESLOG"]:
        guideline_id = "urn:cen.eu:en16931:2017#compliant#urn:eslog.si:2.0"
    elif profile == "EN16931":
        guideline_id = "urn:cen.eu:en16931:2017"
    elif profile == "COMFORT":
        guideline_id = "urn:cen.eu:en16931:2017"
    elif profile == "EXTENDED":
        guideline_id = "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended"
    else:
        guideline_id = "urn:factur-x.eu:1p0:basic"
    issue_date_formatted = clean_date(inv.issue_date)
    due_date_formatted = clean_date(inv.due_date) if inv.due_date else None

    
    # Seller cleanups
    s_vat = inv.seller.vat_id.replace(" ", "").upper() if inv.seller.vat_id else ""
    b_vat = inv.buyer.vat_id.replace(" ", "").upper() if inv.buyer.vat_id else ""
    s_iban = inv.payment.iban.replace(" ", "").upper() if inv.payment.iban else ""
    s_bic = inv.payment.bic.replace(" ", "").upper() if inv.payment.bic else ""

    # Buyer Reference & Order Date parsing
    raw_buyer_ref = (inv.buyer_reference or "").strip()
    extracted_order_date = getattr(inv, "purchase_order_date", None)
    
    # Strip date suffixes from buyer_reference (e.g., '12345 v. 17.04.2026' or 'PO-999 vom 2026-04-17')
    match_v_date = re.search(r"\s+(?:v\.|vom)\s+([0-9\.\-\/]+)", raw_buyer_ref, flags=re.IGNORECASE)
    if match_v_date:
        if not extracted_order_date:
            extracted_order_date = match_v_date.group(1).strip()
        cleaned_buyer_ref = raw_buyer_ref[:match_v_date.start()].strip()
    else:
        cleaned_buyer_ref = raw_buyer_ref

    buyer_ref = cleaned_buyer_ref or ""

    # Clean seller address to prevent postcode concatenating into CityName
    s_postcode = (inv.seller.postcode or "").strip()
    s_city = (inv.seller.city or "").strip()
    if not s_postcode and s_city:
        m_s_pc = re.match(r"^(\d{4,5})\s+(.*)$", s_city)
        if m_s_pc:
            s_postcode = m_s_pc.group(1).strip()
            s_city = m_s_pc.group(2).strip()
    elif s_city and re.match(r"^\d{4,5}\s+", s_city):
        s_city = re.sub(r"^\d{4,5}\s+", "", s_city).strip()

    # Clean buyer address similarly
    b_postcode = (inv.buyer.postcode or "").strip()
    b_city = (inv.buyer.city or "").strip()
    if not b_postcode and b_city:
        m_b_pc = re.match(r"^(\d{4,5})\s+(.*)$", b_city)
        if m_b_pc:
            b_postcode = m_b_pc.group(1).strip()
            b_city = m_b_pc.group(2).strip()
    elif b_city and re.match(r"^\d{4,5}\s+", b_city):
        b_city = re.sub(r"^\d{4,5}\s+", "", b_city).strip()

    
    # Notes XML (BT-22: IncludedNote)
    notes_xml = ""
    effective_notes = inv.invoice_notes if (getattr(inv, "invoice_notes", None) and len(inv.invoice_notes) > 0) else (inv.notes or [])
    for note in effective_notes:
        if note and str(note).strip():
            # Filter out any synthetic generator watermarks if previously stored
            if "ZUGFeRD PDF/A-3 Generator" in str(note):
                continue
            notes_xml += f"""    <ram:IncludedNote>
      <ram:Content>{escape(str(note).strip())}</ram:Content>
    </ram:IncludedNote>\n"""


    # Line Items XML (BG-25)
    line_items_xml = ""
    for idx, item in enumerate(inv.items, start=1):
        line_num = item.line_id or str(idx)
        
        # SpecifiedTradeProduct (BT-153..BT-157)
        desc_xml = f"\n        <ram:Description>{escape(item.description)}</ram:Description>" if item.description else ""
        seller_id_xml = f"\n        <ram:SellerAssignedID>{escape(item.seller_item_id)}</ram:SellerAssignedID>" if item.seller_item_id else ""
        buyer_id_xml = f"\n        <ram:BuyerAssignedID>{escape(item.buyer_item_id)}</ram:BuyerAssignedID>" if item.buyer_item_id else ""
        std_id_xml = ""
        if item.standard_item_id:
            scheme = escape(item.standard_item_id_scheme or "0160")
            std_id_xml = f'\n        <ram:GlobalID schemeID="{scheme}">{escape(item.standard_item_id)}</ram:GlobalID>'

        # Net Price & Price Base (BT-146, BT-149, BT-150)
        base_qty_attr = ""
        if item.price_base_quantity and item.price_base_quantity != 1.0:
            b_unit = escape(item.price_base_unit or item.unit_code)
            base_qty_attr = f'\n          <ram:BasisQuantity unitCode="{b_unit}">{item.price_base_quantity:.4f}</ram:BasisQuantity>'

        # Referenced Purchase Order Line (BT-132)
        po_line_xml = ""
        if item.order_line_reference:
            po_line_xml = f"""\n        <ram:BuyerOrderReferencedDocument>
          <ram:LineID>{escape(str(item.order_line_reference))}</ram:LineID>
        </ram:BuyerOrderReferencedDocument>"""

        # Line Allowances & Charges (BG-27 & BG-28)
        line_allowance_charges_xml = ""
        effective_allowances = getattr(item, "allowances_charges", [])
        base_item_price_qty = (item.quantity * item.unit_price) / (item.price_base_quantity if (item.price_base_quantity and item.price_base_quantity > 0) else 1.0)
        if not effective_allowances and (item.discount_amount and item.discount_amount > 0):
            # Fallback to discount_amount if allowances_charges list not populated
            pct_tag = ""
            basis_tag = ""
            if item.discount_percent:
                pct_tag = f"\n          <ram:CalculationPercent>{item.discount_percent:.2f}</ram:CalculationPercent>"
                basis_tag = f"\n          <ram:BasisAmount>{base_item_price_qty:.2f}</ram:BasisAmount>"
            line_allowance_charges_xml += f"""\n        <ram:SpecifiedTradeAllowanceCharge>
          <ram:ChargeIndicator>
            <udt:Indicator>false</udt:Indicator>
          </ram:ChargeIndicator>{pct_tag}{basis_tag}
          <ram:ActualAmount>{item.discount_amount:.2f}</ram:ActualAmount>
          <ram:Reason>Discount</ram:Reason>
        </ram:SpecifiedTradeAllowanceCharge>"""
        elif effective_allowances:
            for ac in effective_allowances:
                amt = float(ac.amount or 0.0)
                if amt <= 0:
                    continue
                is_chg = bool(ac.charge_indicator)
                chg_ind_str = "true" if is_chg else "false"
                reason_str = escape(ac.reason or ("Charge" if is_chg else "Discount"))
                pct_tag = ""
                basis_tag = ""
                ac_base = getattr(ac, "base_amount", None) or base_item_price_qty
                if ac.percentage is not None:
                    pct_tag = f"\n          <ram:CalculationPercent>{float(ac.percentage):.2f}</ram:CalculationPercent>"
                    # BR-DEC-15: If BT-138/143 is present, BT-137/142 (BasisAmount) is mandatory
                    basis_tag = f"\n          <ram:BasisAmount>{float(ac_base):.2f}</ram:BasisAmount>"
                line_allowance_charges_xml += f"""\n        <ram:SpecifiedTradeAllowanceCharge>
          <ram:ChargeIndicator>
            <udt:Indicator>{chg_ind_str}</udt:Indicator>
          </ram:ChargeIndicator>{pct_tag}{basis_tag}
          <ram:ActualAmount>{amt:.2f}</ram:ActualAmount>
          <ram:Reason>{reason_str}</ram:Reason>
        </ram:SpecifiedTradeAllowanceCharge>"""

        line_items_xml += f"""    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>{line_num}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>{std_id_xml}{seller_id_xml}{buyer_id_xml}
        <ram:Name>{escape(item.name)}</ram:Name>{desc_xml}
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>{po_line_xml}
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>{item.unit_price:.4f}</ram:ChargeAmount>{base_qty_attr}
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="{item.unit_code}">{item.quantity:.4f}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>{item.tax_category_code}</ram:CategoryCode>
          <ram:RateApplicablePercent>{item.tax_percent:.2f}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>{line_allowance_charges_xml}
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>{item.line_total_amount:.2f}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>\n"""

    # Compute allowances and charges per tax category to satisfy BR-AE-08, BR-S-08 etc.
    cat_adjustments = {}
    total_allowance_amt = 0.0
    total_charge_amt = 0.0
    for disc in (inv.discounts or []):
        amt = float(disc.amount or 0.0)
        if amt <= 0:
            continue
        c_code = (getattr(disc, "tax_category_code", None) or "S").upper()
        if c_code not in cat_adjustments:
            cat_adjustments[c_code] = 0.0
        if getattr(disc, "charge_indicator", False):
            total_charge_amt += amt
            cat_adjustments[c_code] += amt
        else:
            total_allowance_amt += amt
            cat_adjustments[c_code] -= amt

    # Tax breakdown XML (BG-23)
    tax_breakdown_xml = ""
    if not inv.tax_breakdown:
        # Default single breakdown from totals
        tax_category = "S" if inv.tax_total > 0 else "AE"
        tax_pct = round((inv.tax_total / inv.line_net_total * 100), 2) if inv.line_net_total > 0 and inv.tax_total > 0 else 0.0
        cat_adj = cat_adjustments.get(tax_category, 0.0)
        effective_basis = max(0.0, inv.line_net_total + cat_adj)

        ex_reason_txt = escape(inv.vat_exemption_reason or "") if tax_category in ["E", "AE", "K", "G"] and inv.vat_exemption_reason else ""
        ex_code_txt = escape(inv.vat_exemption_reason_code or "") if tax_category in ["E", "AE", "K", "G"] and inv.vat_exemption_reason_code else ""
        ex_reason_xml = f"<ram:ExemptionReason>{ex_reason_txt}</ram:ExemptionReason>\n        " if ex_reason_txt else ""
        ex_code_xml = f"\n        <ram:ExemptionReasonCode>{ex_code_txt}</ram:ExemptionReasonCode>" if ex_code_txt else ""
        tax_breakdown_xml = f"""      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>{inv.tax_total:.2f}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        {ex_reason_xml}<ram:BasisAmount>{effective_basis:.2f}</ram:BasisAmount>
        <ram:CategoryCode>{tax_category}</ram:CategoryCode>{ex_code_xml}
        <ram:RateApplicablePercent>{tax_pct:.2f}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>\n"""
    else:
        for tax in inv.tax_breakdown:
            cat_code = (tax.tax_category_code or "S").upper()
            reason_str = tax.exemption_reason or (inv.vat_exemption_reason if cat_code in ["E", "AE", "K", "G"] else None)
            code_str = getattr(tax, "exemption_reason_code", None) or (inv.vat_exemption_reason_code if cat_code in ["E", "AE", "K", "G"] else None)
            exemption_xml = f"<ram:ExemptionReason>{escape(reason_str)}</ram:ExemptionReason>\n        " if reason_str else ""
            exemption_code_xml = f"\n        <ram:ExemptionReasonCode>{escape(code_str)}</ram:ExemptionReasonCode>" if code_str else ""
            tax_breakdown_xml += f"""      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>{tax.tax_amount:.2f}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        {exemption_xml}<ram:BasisAmount>{tax.basis_amount:.2f}</ram:BasisAmount>
        <ram:CategoryCode>{cat_code}</ram:CategoryCode>{exemption_code_xml}
        <ram:RateApplicablePercent>{tax.tax_percent:.2f}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>\n"""

    # Payment Means XML (BG-16, BG-17) - support multiple bank accounts
    payment_means_xml = ""
    accounts_to_render = []
    if getattr(inv.payment, "bank_accounts", None) and len(inv.payment.bank_accounts) > 0:
        accounts_to_render = inv.payment.bank_accounts
    elif s_iban:
        accounts_to_render = [{"iban": s_iban, "bic": s_bic, "bank_name": inv.payment.bank_name}]

    p_code = inv.payment.payment_means_code or "58"
    for acc in accounts_to_render:
        acc_iban = (getattr(acc, "iban", None) or (acc.get("iban") if isinstance(acc, dict) else "") or "").replace(" ", "").upper()
        if not acc_iban:
            continue
        acc_bic = (getattr(acc, "bic", None) or (acc.get("bic") if isinstance(acc, dict) else "") or "").replace(" ", "").upper()
        acc_name = getattr(acc, "bank_name", None) or (acc.get("bank_name") if isinstance(acc, dict) else "") or ""
        inst_block = f"""\n        <ram:PayeeSpecifiedCreditorFinancialInstitution>
          <ram:BICID>{escape(acc_bic)}</ram:BICID>
        </ram:PayeeSpecifiedCreditorFinancialInstitution>""" if acc_bic else ""

        payment_means_xml += f"""      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>{p_code}</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>{acc_iban}</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>{inst_block}
      </ram:SpecifiedTradeSettlementPaymentMeans>\n"""

    # Payment terms XML (BT-20 & BT-83)
    payment_terms_xml = ""
    pmt_desc = inv.payment.payment_terms or ""
    pmt_ref = (inv.payment.payment_reference or "").strip()
    if pmt_desc or due_date_formatted or pmt_ref:
        full_desc = f"{pmt_desc} [Ref: {pmt_ref}]" if (pmt_desc and pmt_ref) else (pmt_desc or f"Payment Reference: {pmt_ref}")
        desc_xml = f"<ram:Description>{escape(full_desc)}</ram:Description>\n        " if full_desc else ""
        due_xml = f"""<ram:DueDateDateTime>
          <udt:DateTimeString format="102">{due_date_formatted}</udt:DateTimeString>
        </ram:DueDateDateTime>\n        """ if due_date_formatted else ""
        payment_terms_xml = f"""      <ram:SpecifiedTradePaymentTerms>
        {desc_xml}{due_xml}
      </ram:SpecifiedTradePaymentTerms>\n"""

    # Seller tax IDs & Legal disclosures (BT-30, BT-33, BT-34)
    seller_tax_xml = ""
    if s_vat:
        seller_tax_xml += f"""        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">{s_vat}</ram:ID>
        </ram:SpecifiedTaxRegistration>\n"""
    
    # Local Tax Number / Steuernummer (FC)
    s_tax_number = (getattr(inv.seller, "tax_number", None) or inv.seller.tax_registration_id or "").strip()
    if not s_tax_number:
        try:
            from backend.app import UPLOAD_DIR
            import json
            cfg_path = os.path.join(UPLOAD_DIR, "system_settings.json")
            if os.path.exists(cfg_path):
                with open(cfg_path, "r", encoding="utf-8") as f:
                    cfg_data = json.load(f)
                    s_tax_number = (cfg_data.get("seller_tax_number") or "").strip()
        except Exception:
            pass

    if s_tax_number:
        seller_tax_xml += f"""        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="FC">{escape(s_tax_number)}</ram:ID>
        </ram:SpecifiedTaxRegistration>\n"""

    # Seller Legal Organization (BT-30: Legal Registration & BT-33: Additional Legal Information)
    seller_legal_org_xml = ""
    s_reg_id = (getattr(inv.seller, "company_legal_form", None) or inv.seller.company_id or inv.seller.court_registry or "").strip()
    s_legal_info = (getattr(inv.seller, "legal_info", None) or "").strip()
    if s_reg_id or s_legal_info:
        reg_id_elem = f'\n          <ram:ID schemeID="0002">{escape(s_reg_id)}</ram:ID>' if s_reg_id else ""
        legal_info_elem = f'\n          <ram:TradingBusinessName>{escape(s_legal_info)}</ram:TradingBusinessName>' if s_legal_info else ""
        seller_legal_org_xml = f"""        <ram:SpecifiedLegalOrganization>{reg_id_elem}{legal_info_elem}
        </ram:SpecifiedLegalOrganization>\n"""

    # Seller Electronic Address (BT-34)
    seller_endpoint_xml = ""
    s_endpoint = (getattr(inv.seller, "endpoint_id", None) or "").strip()
    if s_endpoint:
        s_scheme = escape(getattr(inv.seller, "endpoint_scheme", None) or "0088")
        seller_endpoint_xml = f"""        <ram:URIUniversalCommunication>
          <ram:URIID schemeID="{s_scheme}">{escape(s_endpoint)}</ram:URIID>
        </ram:URIUniversalCommunication>\n"""

    # Buyer Electronic Address (BT-49)
    buyer_endpoint_xml = ""
    b_endpoint = (getattr(inv.buyer, "endpoint_id", None) or "").strip()
    if b_endpoint:
        b_scheme = escape(getattr(inv.buyer, "endpoint_scheme", None) or "0088")
        buyer_endpoint_xml = f"""        <ram:URIUniversalCommunication>
          <ram:URIID schemeID="{b_scheme}">{escape(b_endpoint)}</ram:URIID>
        </ram:URIUniversalCommunication>\n"""

    # Buyer Legal Organization (BT-47)
    buyer_legal_org_xml = ""
    b_reg_id = (getattr(inv.buyer, "company_legal_form", None) or inv.buyer.company_id or "").strip()
    if b_reg_id:
        buyer_legal_org_xml = f"""        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">{escape(b_reg_id)}</ram:ID>
        </ram:SpecifiedLegalOrganization>\n"""

    # Factoring / Third-Party Payee (BG-10 / BT-59..BT-61)
    payee_party_xml = ""
    factoring = getattr(inv, "factoring_payee", None) or getattr(inv.payment, "factoring_payee", None)
    if factoring and (factoring.name or factoring.payee_id or factoring.vat_id):
        p_name = f"<ram:Name>{escape(factoring.name)}</ram:Name>\n        " if factoring.name else ""
        p_id = f'<ram:ID>{escape(factoring.payee_id)}</ram:ID>\n        ' if factoring.payee_id else ""
        p_vat = f"""<ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">{escape(factoring.vat_id)}</ram:ID>
        </ram:SpecifiedTaxRegistration>\n        """ if factoring.vat_id else ""
        payee_party_xml = f"""      <ram:PayeeTradeParty>
        {p_id}{p_name}{p_vat}</ram:PayeeTradeParty>\n"""

    # Buyer tax IDs
    buyer_tax_xml = ""
    if b_vat:
        buyer_tax_xml += f"""        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">{b_vat}</ram:ID>
        </ram:SpecifiedTaxRegistration>\n"""

    # Seller contact (BG-6 / BT-41, BT-42, BT-43)
    seller_contact_xml = ""
    if inv.seller.contact_name or inv.seller.contact_phone or inv.seller.contact_email:
        name_x = f"<ram:PersonName>{escape(inv.seller.contact_name)}</ram:PersonName>\n          " if inv.seller.contact_name else ""
        phone_x = f"""<ram:TelephoneUniversalCommunication>
            <ram:CompleteNumber>{escape(inv.seller.contact_phone)}</ram:CompleteNumber>
          </ram:TelephoneUniversalCommunication>\n          """ if inv.seller.contact_phone else ""
        email_x = f"""<ram:EmailURIUniversalCommunication>
            <ram:URIID>{escape(inv.seller.contact_email)}</ram:URIID>
          </ram:EmailURIUniversalCommunication>\n          """ if inv.seller.contact_email else ""
        seller_contact_xml = f"""        <ram:DefinedTradeContact>
          {name_x}{phone_x}{email_x}
        </ram:DefinedTradeContact>\n"""

    # Buyer contact (BG-9 / BT-56, BT-57, BT-58)
    buyer_contact_xml = ""
    if inv.buyer.contact_name or inv.buyer.contact_phone or inv.buyer.contact_email:
        b_name_x = f"<ram:PersonName>{escape(inv.buyer.contact_name)}</ram:PersonName>\n          " if inv.buyer.contact_name else ""
        b_phone_x = f"""<ram:TelephoneUniversalCommunication>
            <ram:CompleteNumber>{escape(inv.buyer.contact_phone)}</ram:CompleteNumber>
          </ram:TelephoneUniversalCommunication>\n          """ if inv.buyer.contact_phone else ""
        b_email_x = f"""<ram:EmailURIUniversalCommunication>
            <ram:URIID>{escape(inv.buyer.contact_email)}</ram:URIID>
          </ram:EmailURIUniversalCommunication>\n          """ if inv.buyer.contact_email else ""
        buyer_contact_xml = f"""        <ram:DefinedTradeContact>
          {b_name_x}{b_phone_x}{b_email_x}
        </ram:DefinedTradeContact>\n"""

    # Header references: Contract (BT-12), Sales Order (BT-14), Buyer Accounting / Cost Center (BT-19)
    contract_doc_xml = ""
    if getattr(inv, "contract_reference", None):
        contract_doc_xml = f"""      <ram:ContractReferencedDocument>
        <ram:IssuerAssignedID>{escape(inv.contract_reference)}</ram:IssuerAssignedID>
      </ram:ContractReferencedDocument>\n"""

    sales_order_doc_xml = ""
    if getattr(inv, "sales_order_number", None):
        sales_order_doc_xml = f"""      <ram:SellerOrderReferencedDocument>
        <ram:IssuerAssignedID>{escape(inv.sales_order_number)}</ram:IssuerAssignedID>
      </ram:SellerOrderReferencedDocument>\n"""

    accounting_cost_xml = ""
    if getattr(inv, "cost_center", None):
        accounting_cost_xml = f"""      <ram:ReceivableSpecifiedTradeAccountingAccount>
        <ram:ID>{escape(inv.cost_center)}</ram:ID>
      </ram:ReceivableSpecifiedTradeAccountingAccount>\n"""

    # Buyer order / Purchase Order reference (BT-13 & BT-14)
    buyer_order_xml = ""
    po_number = inv.purchase_order_number or (cleaned_buyer_ref if cleaned_buyer_ref != "N/A" and extracted_order_date else "")
    if po_number:
        po_date_xml = ""
        if extracted_order_date:
            formatted_po_date = clean_date(extracted_order_date)
            po_date_xml = f"""\n        <ram:FormattedIssueDateTime>
          <qdt:DateTimeString format="102">{formatted_po_date}</qdt:DateTimeString>
        </ram:FormattedIssueDateTime>"""
        buyer_order_xml = f"""      <ram:BuyerOrderReferencedDocument>
        <ram:IssuerAssignedID>{escape(po_number)}</ram:IssuerAssignedID>{po_date_xml}
      </ram:BuyerOrderReferencedDocument>\n"""

    # Preceding invoice reference (Required for Credit Notes 381 and Corrected Invoices 384)
    preceding_doc_xml = ""
    if inv.preceding_invoice_number:
        prec_date_xml = ""
        if inv.preceding_invoice_date:
            clean_prec_date = clean_date(inv.preceding_invoice_date)
            prec_date_xml = f"""        <ram:FormattedIssueDateTime>
          <qdt:DateTimeString format="102">{clean_prec_date}</qdt:DateTimeString>
        </ram:FormattedIssueDateTime>\n"""
        preceding_doc_xml = f"""      <ram:InvoiceReferencedDocument>
        <ram:IssuerAssignedID>{escape(inv.preceding_invoice_number)}</ram:IssuerAssignedID>
{prec_date_xml}      </ram:InvoiceReferencedDocument>\n"""

    # Delivery Party XML (BG-13)
    delivery_xml = "<ram:ApplicableHeaderTradeDelivery />"
    if inv.delivery:
        # BT-16: Despatch Advice Reference (Lieferschein-Nr.)
        despatch_id = (inv.delivery.despatch_advice_id or inv.delivery.despatch_advice_reference or "").strip()
        cleaned_despatch = despatch_id.lstrip("-").lstrip(":").strip()
        banned_despatch_labels = [
            "lieferdatum", "lieferschein", "lieferschein-nr", "nr", "-nr", "bestell-nr", 
            "kundennummer", "kontakt", "lieferanten-nr", "datum", "none", "null"
        ]
        despatch_advice_xml = ""
        if (
            cleaned_despatch 
            and cleaned_despatch.lower() not in banned_despatch_labels 
            and any(c.isdigit() for c in cleaned_despatch) 
            and len(cleaned_despatch) >= 3
        ):
            despatch_advice_xml = f"""        <ram:DespatchAdviceReferencedDocument>
          <ram:IssuerAssignedID>{escape(cleaned_despatch)}</ram:IssuerAssignedID>
        </ram:DespatchAdviceReferencedDocument>\n"""



        # BT-70..BT-80: Ship-To Trade Party
        deliv_party_xml = ""
        clean_loc_id = (inv.delivery.location_id or "").strip()
        if clean_loc_id:
            # Strip verbal prefix if present (e.g. 'Abladestelle Nr. 960' -> '960')
            clean_loc_id = re.sub(r"^.*?(?:Abladestelle|Tor|Gate|Dock)(?:\s+Nr\.?)?\s*", "", clean_loc_id, flags=re.IGNORECASE).strip()

        if inv.delivery.recipient_name or inv.delivery.street or inv.delivery.city or clean_loc_id:
            # BT-71: Only emit schemeID="0088" if strictly a 13-digit GLN number
            is_valid_gln = bool(re.fullmatch(r"\d{13}", clean_loc_id))
            if clean_loc_id:
                if is_valid_gln or (inv.delivery.location_scheme == "0088" and is_valid_gln):
                    deliv_id_xml = f"<ram:ID schemeID=\"0088\">{escape(clean_loc_id)}</ram:ID>\n          "
                elif inv.delivery.location_scheme and inv.delivery.location_scheme != "0088":
                    deliv_id_xml = f"<ram:ID schemeID=\"{escape(inv.delivery.location_scheme)}\">{escape(clean_loc_id)}</ram:ID>\n          "
                else:
                    deliv_id_xml = f"<ram:ID>{escape(clean_loc_id)}</ram:ID>\n          "
            else:
                deliv_id_xml = ""

            deliv_name = f"<ram:Name>{escape(inv.delivery.recipient_name)}</ram:Name>\n          " if inv.delivery.recipient_name else ""
            deliv_country = (inv.delivery.country_code or "DE").strip().upper()[:2]
            addr_elements = ""
            if inv.delivery.postcode:
                addr_elements += f"\n            <ram:PostcodeCode>{escape(inv.delivery.postcode)}</ram:PostcodeCode>"
            if inv.delivery.street:
                addr_elements += f"\n            <ram:LineOne>{escape(inv.delivery.street)}</ram:LineOne>"
            if inv.delivery.city:
                addr_elements += f"\n            <ram:CityName>{escape(inv.delivery.city)}</ram:CityName>"
            addr_elements += f"\n            <ram:CountryID>{escape(deliv_country)}</ram:CountryID>"

            deliv_party_xml = f"""        <ram:ShipToTradeParty>
          {deliv_id_xml}{deliv_name}<ram:PostalTradeAddress>{addr_elements}
          </ram:PostalTradeAddress>
        </ram:ShipToTradeParty>\n"""


        # BT-72: Actual Delivery Date Event (format 102: YYYYMMDD)
        deliv_date_xml = ""
        if inv.delivery.delivery_date:
            deliv_d_clean = clean_date(inv.delivery.delivery_date)
            if deliv_d_clean:
                deliv_date_xml = f"""        <ram:ActualDeliverySupplyChainEvent>
          <ram:OccurrenceDateTime>
            <udt:DateTimeString format="102">{deliv_d_clean}</udt:DateTimeString>
          </ram:OccurrenceDateTime>
        </ram:ActualDeliverySupplyChainEvent>\n"""

        delivery_xml = f"""    <ram:ApplicableHeaderTradeDelivery>
{deliv_party_xml}{deliv_date_xml}{despatch_advice_xml}    </ram:ApplicableHeaderTradeDelivery>"""

    # Billing period XML
    billing_period_xml = ""
    if inv.service_period_start or inv.service_period_end:
        start_xml = f"""        <ram:StartDateTime>
          <udt:DateTimeString format="102">{clean_date(inv.service_period_start)}</udt:DateTimeString>
        </ram:StartDateTime>\n""" if inv.service_period_start else ""
        end_xml = f"""        <ram:EndDateTime>
          <udt:DateTimeString format="102">{clean_date(inv.service_period_end)}</udt:DateTimeString>
        </ram:EndDateTime>\n""" if inv.service_period_end else ""
        billing_period_xml = f"""      <ram:BillingSpecifiedPeriod>
{start_xml}{end_xml}      </ram:BillingSpecifiedPeriod>\n"""

    # Monetary summation (includes Prepaid amount if provided)
    prepaid_xml = ""
    if inv.prepaid_amount and inv.prepaid_amount > 0:
        prepaid_xml = f"        <ram:TotalPrepaidAmount>{inv.prepaid_amount:.2f}</ram:TotalPrepaidAmount>\n"

    # Document Allowances and Charges (SpecifiedTradeAllowanceCharge)
    allowance_charges_xml = ""
    total_allowance_amt = 0.0
    total_charge_amt = 0.0
    if inv.discounts:
        # Determine fallback tax category & percent from items or default to 19% S
        dom_tax_cat = "S"
        dom_tax_pct = 19.0
        if inv.items and len(inv.items) > 0:
            dom_tax_cat = inv.items[0].tax_category_code or "S"
            dom_tax_pct = inv.items[0].tax_percent if inv.items[0].tax_percent is not None else 19.0

        for disc in inv.discounts:
            amt = float(disc.amount or 0.0)
            if amt <= 0.0:
                continue
            is_charge = bool(getattr(disc, "charge_indicator", False))
            if is_charge:
                total_charge_amt += amt
            else:
                total_allowance_amt += amt

            reason_txt = escape(disc.reason or ("Charge" if is_charge else "Discount / Rebate"))
            indicator_val = "true" if is_charge else "false"
            pct_xml = ""
            basis_xml = ""
            if disc.percentage is not None and disc.percentage > 0:
                pct_xml = f"        <ram:CalculationPercent>{disc.percentage:.2f}</ram:CalculationPercent>\n"
                doc_base = getattr(disc, "base_amount", None) or inv.line_net_total
                basis_xml = f"        <ram:BasisAmount>{doc_base:.2f}</ram:BasisAmount>\n"
            elif getattr(disc, "base_amount", None) is not None:
                basis_xml = f"        <ram:BasisAmount>{disc.base_amount:.2f}</ram:BasisAmount>\n"

            tax_cat = getattr(disc, "tax_category_code", None) or dom_tax_cat
            tax_rate = getattr(disc, "tax_percent", None) if getattr(disc, "tax_percent", None) is not None else dom_tax_pct

            allowance_charges_xml += f"""      <ram:SpecifiedTradeAllowanceCharge>
        <ram:ChargeIndicator>
          <udt:Indicator>{indicator_val}</udt:Indicator>
        </ram:ChargeIndicator>
{pct_xml}{basis_xml}        <ram:ActualAmount>{amt:.2f}</ram:ActualAmount>
        <ram:Reason>{reason_txt}</ram:Reason>
        <ram:CategoryTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>{tax_cat}</ram:CategoryCode>
          <ram:RateApplicablePercent>{tax_rate:.2f}</ram:RateApplicablePercent>
        </ram:CategoryTradeTax>
      </ram:SpecifiedTradeAllowanceCharge>\n"""

    allowance_total_xml = ""
    if total_allowance_amt > 0:
        allowance_total_xml = f"        <ram:AllowanceTotalAmount>{total_allowance_amt:.2f}</ram:AllowanceTotalAmount>\n"
    charge_total_xml = ""
    if total_charge_amt > 0:
        charge_total_xml = f"        <ram:ChargeTotalAmount>{total_charge_amt:.2f}</ram:ChargeTotalAmount>\n"

    seller_id_xml = f"\n        <ram:ID>{escape(inv.seller.seller_identifier.strip())}</ram:ID>" if getattr(inv.seller, "seller_identifier", None) and inv.seller.seller_identifier.strip() else ""

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:a="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:10" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>{guideline_id}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>{escape(inv.invoice_number)}</ram:ID>
    <ram:TypeCode>{inv.invoice_type_code or "380"}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">{issue_date_formatted}</udt:DateTimeString>
    </ram:IssueDateTime>
{notes_xml}  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
{line_items_xml}    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>{escape(buyer_ref)}</ram:BuyerReference>
      <ram:SellerTradeParty>{seller_id_xml}
        <ram:Name>{escape(inv.seller.name)}</ram:Name>{seller_legal_org_xml}{seller_contact_xml}        <ram:PostalTradeAddress>
          <ram:PostcodeCode>{escape(s_postcode)}</ram:PostcodeCode>
          <ram:LineOne>{escape(inv.seller.street or "")}</ram:LineOne>
          <ram:CityName>{escape(s_city)}</ram:CityName>
          <ram:CountryID>{inv.seller.country_code or "DE"}</ram:CountryID>
        </ram:PostalTradeAddress>{seller_endpoint_xml}{seller_tax_xml}      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>{escape(inv.buyer.name)}</ram:Name>{buyer_legal_org_xml}{buyer_contact_xml}        <ram:PostalTradeAddress>
          <ram:PostcodeCode>{escape(b_postcode)}</ram:PostcodeCode>
          <ram:LineOne>{escape(inv.buyer.street or "")}</ram:LineOne>
          <ram:CityName>{escape(b_city)}</ram:CityName>
          <ram:CountryID>{inv.buyer.country_code or "DE"}</ram:CountryID>
        </ram:PostalTradeAddress>{buyer_endpoint_xml}{buyer_tax_xml}      </ram:BuyerTradeParty>
{sales_order_doc_xml}{buyer_order_xml}{contract_doc_xml}    </ram:ApplicableHeaderTradeAgreement>
{delivery_xml}
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>{inv.currency or "EUR"}</ram:InvoiceCurrencyCode>
{payee_party_xml}{payment_means_xml}{tax_breakdown_xml}{billing_period_xml}{allowance_charges_xml}{payment_terms_xml}      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>{inv.line_net_total:.2f}</ram:LineTotalAmount>
{charge_total_xml}{allowance_total_xml}        <ram:TaxBasisTotalAmount>{(inv.line_net_total - total_allowance_amt + total_charge_amt):.2f}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="{inv.currency or "EUR"}">{inv.tax_total:.2f}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>{inv.grand_total:.2f}</ram:GrandTotalAmount>
{prepaid_xml}        <ram:DuePayableAmount>{inv.due_payable_amount:.2f}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
{preceding_doc_xml}{accounting_cost_xml}    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
"""
    return xml

def generate_orderx_xml(inv: InvoiceData, profile: str = "BASIC") -> str:
    """
    Generate Order-X XML (SCRDM / order-x.xml) for Purchase Orders.
    Guideline: urn:order-x.eu:1p0:basic
    """
    issue_date_formatted = clean_date(inv.issue_date)
    guideline_id = "urn:order-x.eu:1p0:basic" if profile == "BASIC" else "urn:order-x.eu:1p0:comfort"
    order_id = inv.invoice_number or inv.purchase_order_number or "ORDER-001"
    
    # Seller cleanups
    s_vat = inv.seller.vat_id.replace(" ", "").upper() if inv.seller.vat_id else ""
    b_vat = inv.buyer.vat_id.replace(" ", "").upper() if inv.buyer.vat_id else ""
    buyer_ref = inv.buyer_reference or "N/A"

    line_items_xml = ""
    for idx, item in enumerate(inv.items, start=1):
        line_num = item.line_id or str(idx)
        line_items_xml += f"""    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>{line_num}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>{escape(item.name)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>{item.unit_price:.2f}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:RequestedQuantity unitCode="{item.unit_code}">{item.quantity:.4f}</ram:RequestedQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>{item.tax_category_code}</ram:CategoryCode>
          <ram:RateApplicablePercent>{item.tax_percent:.2f}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>{item.line_total_amount:.2f}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>\n"""

    seller_tax_xml = ""
    if s_vat:
        seller_tax_xml = f"""        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">{s_vat}</ram:ID>
        </ram:SpecifiedTaxRegistration>\n"""
    
    s_tax_number = (getattr(inv.seller, "tax_number", None) or inv.seller.tax_registration_id or "").strip()
    if s_tax_number:
        seller_tax_xml += f"""        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="FC">{escape(s_tax_number)}</ram:ID>
        </ram:SpecifiedTaxRegistration>\n"""
    
    buyer_tax_xml = ""
    if b_vat:
        buyer_tax_xml = f"""        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">{b_vat}</ram:ID>
        </ram:SpecifiedTaxRegistration>\n"""

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rsm:SCRDMCCBDACIOMessageStructure xmlns:a="urn:un:unece:uncefact:data:standard:QualifiedDataType:128" xmlns:rsm="urn:un:unece:uncefact:data:SCRDMCCBDACIOMessageStructure:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:10" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:128" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:128">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>{guideline_id}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>{escape(order_id)}</ram:ID>
    <ram:TypeCode>220</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">{issue_date_formatted}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
{line_items_xml}    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>{escape(buyer_ref)}</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>{escape(inv.seller.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>{escape(inv.seller.postcode or "")}</ram:PostcodeCode>
          <ram:LineOne>{escape(inv.seller.street or "")}</ram:LineOne>
          <ram:CityName>{escape(inv.seller.city or "")}</ram:CityName>
          <ram:CountryID>{inv.seller.country_code or "DE"}</ram:CountryID>
        </ram:PostalTradeAddress>
{seller_tax_xml}      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>{escape(inv.buyer.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>{escape(inv.buyer.postcode or "")}</ram:PostcodeCode>
          <ram:LineOne>{escape(inv.buyer.street or "")}</ram:LineOne>
          <ram:CityName>{escape(inv.buyer.city or "")}</ram:CityName>
          <ram:CountryID>{inv.buyer.country_code or "DE"}</ram:CountryID>
        </ram:PostalTradeAddress>
{buyer_tax_xml}      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery />
    <ram:ApplicableHeaderTradeSettlement>
      <ram:OrderCurrencyCode>{inv.currency or "EUR"}</ram:OrderCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>{inv.line_net_total:.2f}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>{inv.line_net_total:.2f}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="{inv.currency or "EUR"}">{inv.tax_total:.2f}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>{inv.grand_total:.2f}</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:SCRDMCCBDACIOMessageStructure>
"""
    return xml
