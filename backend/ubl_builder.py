import os
import re
from datetime import datetime
from xml.sax.saxutils import escape
from backend.models import InvoiceData

def clean_ubl_date(d_str: str) -> str:
    """Format date string as ISO YYYY-MM-DD for UBL 2.1."""
    if not d_str:
        return ""
    digits = re.sub(r"[^\d]", "", str(d_str))
    if len(digits) == 8:
        if "." in str(d_str):
            parts = [p.strip() for p in str(d_str).split(".") if p.strip()]
            if len(parts) == 3 and len(parts[2]) == 4:
                return f"{parts[2]}-{int(parts[1]):02d}-{int(parts[0]):02d}"
        # yyyymmdd
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:]}"
    elif len(digits) >= 8 and "-" in str(d_str):
        parts = [p.strip() for p in str(d_str).split("-") if p.strip()]
        if len(parts) == 3 and len(parts[0]) == 4:
            return f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
    return str(d_str)

def generate_ubl_xml(inv: InvoiceData, profile: str = "PEPPOL") -> str:
    """
    Generate compliant OASIS UBL 2.1 Invoice XML.
    Compliant with EN 16931-1 and Peppol BIS Billing 3.0 / Slovenian UJP UBL 2.1.
    """
    # Profile & Customization IDs according to EN 16931 / Peppol BIS 3.0
    if profile.upper() in ["PEPPOL", "PEPPOL_UBL", "UBL"]:
        customization_id = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0"
        profile_id = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
    elif profile.upper() == "XRECHNUNG_UBL":
        customization_id = "urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0"
        profile_id = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
    else:
        # Default EN 16931 pure UBL
        customization_id = "urn:cen.eu:en16931:2017"
        profile_id = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"

    inv_number = escape(inv.invoice_number or "")
    issue_date = clean_ubl_date(inv.issue_date)
    due_date = clean_ubl_date(inv.due_date) if inv.due_date else ""
    currency = inv.currency or "EUR"
    inv_type_code = inv.invoice_type_code or "380"
    buyer_ref = escape(inv.buyer_reference or "")

    # Clean party data
    s_vat = inv.seller.vat_id.replace(" ", "").upper() if inv.seller.vat_id else ""
    b_vat = inv.buyer.vat_id.replace(" ", "").upper() if inv.buyer.vat_id else ""
    s_tax_number = (getattr(inv.seller, "tax_number", None) or inv.seller.tax_registration_id or "").strip()
    s_iban = inv.payment.iban.replace(" ", "").upper() if inv.payment.iban else ""
    s_bic = inv.payment.bic.replace(" ", "").upper() if inv.payment.bic else ""

    # Notes (BT-22)
    notes_xml = ""
    effective_notes = inv.invoice_notes if (getattr(inv, "invoice_notes", None) and len(inv.invoice_notes) > 0) else (inv.notes or [])
    for note in effective_notes:
        if note and str(note).strip() and "ZUGFeRD PDF/A-3 Generator" not in str(note):
            notes_xml += f"  <cbc:Note>{escape(str(note).strip())}</cbc:Note>\n"

    # Due Date (BT-9)
    due_date_xml = f"  <cbc:DueDate>{due_date}</cbc:DueDate>\n" if due_date else ""

    # Invoicing Period (BG-3 / BT-73, BT-74)
    period_xml = ""
    if inv.service_period_start or inv.service_period_end:
        start_d = clean_ubl_date(inv.service_period_start) if inv.service_period_start else ""
        end_d = clean_ubl_date(inv.service_period_end) if inv.service_period_end else ""
        period_xml = "  <cac:InvoicePeriod>\n"
        if start_d:
            period_xml += f"    <cbc:StartDate>{start_d}</cbc:StartDate>\n"
        if end_d:
            period_xml += f"    <cbc:EndDate>{end_d}</cbc:EndDate>\n"
        period_xml += "  </cac:InvoicePeriod>\n"

    # Purchase Order Reference (BT-13)
    order_ref_xml = ""
    po_num = (inv.purchase_order_number or "").strip()
    if po_num:
        order_ref_xml = f"""  <cac:OrderReference>
    <cbc:ID>{escape(po_num)}</cbc:ID>
  </cac:OrderReference>\n"""

    # Contract Document Reference (BT-12)
    contract_ref_xml = ""
    if getattr(inv, "contract_reference", None):
        contract_ref_xml = f"""  <cac:ContractDocumentReference>
    <cbc:ID>{escape(inv.contract_reference)}</cbc:ID>
  </cac:ContractDocumentReference>\n"""

    # Additional Document Reference: Sales Order (BT-14)
    sales_order_ref_xml = ""
    if getattr(inv, "sales_order_number", None):
        sales_order_ref_xml = f"""  <cac:AdditionalDocumentReference>
    <cbc:ID>{escape(inv.sales_order_number)}</cbc:ID>
    <cbc:DocumentTypeCode>130</cbc:DocumentTypeCode>
  </cac:AdditionalDocumentReference>\n"""

    # Accounting Cost / Cost Center (BT-19)
    accounting_cost_xml = ""
    if getattr(inv, "cost_center", None):
        accounting_cost_xml = f"  <cbc:AccountingCost>{escape(inv.cost_center)}</cbc:AccountingCost>\n"

    # Preceding invoice for credit note / correction (BT-25, BT-26)
    billing_ref_xml = ""
    if inv.preceding_invoice_number:
        p_date_xml = ""
        if inv.preceding_invoice_date:
            p_date_clean = clean_ubl_date(inv.preceding_invoice_date)
            p_date_xml = f"      <cbc:IssueDate>{p_date_clean}</cbc:IssueDate>\n"
        billing_ref_xml = f"""  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>{escape(inv.preceding_invoice_number)}</cbc:ID>
{p_date_xml}    </cac:InvoiceDocumentReference>
  </cac:BillingReference>\n"""

    # Despatch Advice (BT-16)
    despatch_xml = ""
    if inv.delivery and (inv.delivery.despatch_advice_id or inv.delivery.despatch_advice_reference):
        dsp_id = (inv.delivery.despatch_advice_id or inv.delivery.despatch_advice_reference).strip()
        if dsp_id:
            despatch_xml = f"""  <cac:DespatchDocumentReference>
    <cbc:ID>{escape(dsp_id)}</cbc:ID>
  </cac:DespatchDocumentReference>\n"""

    # Seller Contact (BG-6 / BT-41..43)
    s_contact_xml = ""
    if inv.seller.contact_name or inv.seller.contact_phone or inv.seller.contact_email:
        s_contact_xml = "      <cac:Contact>\n"
        if inv.seller.contact_name:
            s_contact_xml += f"        <cbc:Name>{escape(inv.seller.contact_name)}</cbc:Name>\n"
        if inv.seller.contact_phone:
            s_contact_xml += f"        <cbc:Telephone>{escape(inv.seller.contact_phone)}</cbc:Telephone>\n"
        if inv.seller.contact_email:
            s_contact_xml += f"        <cbc:ElectronicMail>{escape(inv.seller.contact_email)}</cbc:ElectronicMail>\n"
        s_contact_xml += "      </cac:Contact>\n"

    # Seller Tax Scheme (BT-31 / BT-32)
    s_tax_scheme_xml = ""
    if s_vat:
        s_tax_scheme_xml += f"""      <cac:PartyTaxScheme>
        <cbc:CompanyID>{escape(s_vat)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>\n"""
    elif s_tax_number:
        s_tax_scheme_xml += f"""      <cac:PartyTaxScheme>
        <cbc:CompanyID>{escape(s_tax_number)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>\n"""

    # Seller EndpointID (BT-34)
    s_endpoint_xml = ""
    s_endpoint = (getattr(inv.seller, "endpoint_id", None) or s_vat or "").strip()
    if s_endpoint:
        scheme = getattr(inv.seller, "endpoint_scheme", None)
        if not scheme:
            scheme = "9957" if s_endpoint.startswith("FR") else ("9930" if s_endpoint.startswith("DE") else "9948")
        s_endpoint_xml = f"      <cbc:EndpointID schemeID=\"{escape(scheme)}\">{escape(s_endpoint)}</cbc:EndpointID>\n"

    # Seller Legal Entity (BT-27, BT-30, BT-33)
    s_legal_id_attr = ""
    s_reg_id = (getattr(inv.seller, "company_legal_form", None) or inv.seller.company_id or inv.seller.court_registry or "").strip()
    if s_reg_id:
        s_legal_id_attr = f'\n        <cbc:CompanyID schemeID="0002">{escape(s_reg_id)}</cbc:CompanyID>'
    s_legal_info = (getattr(inv.seller, "legal_info", None) or "").strip()
    s_legal_info_tag = f"\n        <cbc:CompanyLegalForm>{escape(s_legal_info)}</cbc:CompanyLegalForm>" if s_legal_info else ""
    seller_legal_entity_xml = f"""      <cac:PartyLegalEntity>
        <cbc:RegistrationName>{escape(inv.seller.name)}</cbc:RegistrationName>{s_legal_id_attr}{s_legal_info_tag}
      </cac:PartyLegalEntity>\n"""

    # Buyer Contact (BG-9 / BT-56..58)
    b_contact_xml = ""
    if inv.buyer.contact_name or inv.buyer.contact_phone or inv.buyer.contact_email:
        b_contact_xml = "      <cac:Contact>\n"
        if inv.buyer.contact_name:
            b_contact_xml += f"        <cbc:Name>{escape(inv.buyer.contact_name)}</cbc:Name>\n"
        if inv.buyer.contact_phone:
            b_contact_xml += f"        <cbc:Telephone>{escape(inv.buyer.contact_phone)}</cbc:Telephone>\n"
        if inv.buyer.contact_email:
            b_contact_xml += f"        <cbc:ElectronicMail>{escape(inv.buyer.contact_email)}</cbc:ElectronicMail>\n"
        b_contact_xml += "      </cac:Contact>\n"

    # Buyer Tax Scheme (BT-48)
    b_tax_scheme_xml = ""
    if b_vat:
        b_tax_scheme_xml += f"""      <cac:PartyTaxScheme>
        <cbc:CompanyID>{escape(b_vat)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>\n"""

    # Buyer EndpointID (BT-49)
    b_endpoint_xml = ""
    b_endpoint = (getattr(inv.buyer, "endpoint_id", None) or b_vat or "").strip()
    if b_endpoint:
        b_scheme = getattr(inv.buyer, "endpoint_scheme", None)
        if not b_scheme:
            b_scheme = "9957" if b_endpoint.startswith("FR") else ("9930" if b_endpoint.startswith("DE") else "9948")
        b_endpoint_xml = f"      <cbc:EndpointID schemeID=\"{escape(b_scheme)}\">{escape(b_endpoint)}</cbc:EndpointID>\n"

    # Buyer Legal Entity (BT-44, BT-47)
    b_legal_id_attr = ""
    b_reg_id = (getattr(inv.buyer, "company_legal_form", None) or inv.buyer.company_id or "").strip()
    if b_reg_id:
        b_legal_id_attr = f'\n        <cbc:CompanyID schemeID="0002">{escape(b_reg_id)}</cbc:CompanyID>'
    buyer_legal_entity_xml = f"""      <cac:PartyLegalEntity>
        <cbc:RegistrationName>{escape(inv.buyer.name)}</cbc:RegistrationName>{b_legal_id_attr}
      </cac:PartyLegalEntity>\n"""

    # Payee Party (BG-10 Factoring / Third Party Payee)
    payee_party_ubl = ""
    factoring = getattr(inv, "factoring_payee", None) or getattr(inv.payment, "factoring_payee", None)
    if factoring and (factoring.name or factoring.payee_id or factoring.vat_id):
        p_name_tag = f"    <cac:PartyName><cbc:Name>{escape(factoring.name)}</cbc:Name></cac:PartyName>\n" if factoring.name else ""
        p_id_tag = f"    <cac:PartyIdentification><cbc:ID>{escape(factoring.payee_id)}</cbc:ID></cac:PartyIdentification>\n" if factoring.payee_id else ""
        p_legal_tag = f"""    <cac:PartyLegalEntity>
      <cbc:RegistrationName>{escape(factoring.name)}</cbc:RegistrationName>
    </cac:PartyLegalEntity>\n""" if factoring.name else ""
        payee_party_ubl = f"""  <cac:PayeeParty>
{p_id_tag}{p_name_tag}{p_legal_tag}  </cac:PayeeParty>\n"""

    # Delivery (BG-13 / BT-70..BT-80, BT-71 Location GLN)
    delivery_xml = ""
    if inv.delivery and (inv.delivery.recipient_name or inv.delivery.street or inv.delivery.delivery_date or inv.delivery.location_id):
        deliv_date_elem = ""
        if inv.delivery.delivery_date:
            d_clean = clean_ubl_date(inv.delivery.delivery_date)
            deliv_date_elem = f"    <cbc:ActualDeliveryDate>{d_clean}</cbc:ActualDeliveryDate>\n"

        deliv_loc_elem = ""
        clean_loc = (inv.delivery.location_id or "").strip()
        if clean_loc:
            loc_scheme = escape(inv.delivery.location_scheme or "0088")
            deliv_loc_elem = f"""    <cac:DeliveryLocation>
      <cbc:ID schemeID="{loc_scheme}">{escape(clean_loc)}</cbc:ID>
    </cac:DeliveryLocation>\n"""

        deliv_party_elem = ""
        if inv.delivery.recipient_name or inv.delivery.street:
            deliv_party_elem = f"""    <cac:DeliveryParty>
      <cac:PartyName>
        <cbc:Name>{escape(inv.delivery.recipient_name or "")}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>{escape(inv.delivery.street or "")}</cbc:StreetName>
        <cbc:CityName>{escape(inv.delivery.city or "")}</cbc:CityName>
        <cbc:PostalZone>{escape(inv.delivery.postcode or "")}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>{escape(inv.delivery.country_code or "SI")}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
    </cac:DeliveryParty>\n"""

        delivery_xml = f"""  <cac:Delivery>
{deliv_date_elem}{deliv_loc_elem}{deliv_party_elem}  </cac:Delivery>\n"""

    # Payment Means (BG-16, BG-17 / BT-81..BT-86)
    payment_means_xml = ""
    p_code = inv.payment.payment_means_code or "58"
    sklic_ref = escape(inv.payment.payment_reference or inv.invoice_number or "")
    
    accounts_to_render = []
    if getattr(inv.payment, "bank_accounts", None) and len(inv.payment.bank_accounts) > 0:
        accounts_to_render = inv.payment.bank_accounts
    elif s_iban:
        accounts_to_render = [{"iban": s_iban, "bic": s_bic, "bank_name": inv.payment.bank_name}]

    for acc in accounts_to_render:
        acc_iban = (getattr(acc, "iban", None) or (acc.get("iban") if isinstance(acc, dict) else "") or "").replace(" ", "").upper()
        if not acc_iban:
            continue
        acc_bic = (getattr(acc, "bic", None) or (acc.get("bic") if isinstance(acc, dict) else "") or "").replace(" ", "").upper()
        acc_name = getattr(acc, "bank_name", None) or (acc.get("bank_name") if isinstance(acc, dict) else "") or ""
        fin_inst_xml = ""
        if acc_bic or acc_name:
            bic_tag = f"        <cbc:ID>{escape(acc_bic)}</cbc:ID>\n" if acc_bic else ""
            name_tag = f"        <cbc:Name>{escape(acc_name)}</cbc:Name>\n" if acc_name else ""
            fin_inst_xml = f"""      <cac:FinancialInstitutionBranch>
{bic_tag}{name_tag}      </cac:FinancialInstitutionBranch>\n"""

        payment_means_xml += f"""  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>{p_code}</cbc:PaymentMeansCode>
    <cbc:PaymentID>{sklic_ref}</cbc:PaymentID>
    <cac:PayeeFinancialAccount>
      <cbc:ID>{acc_iban}</cbc:ID>
{fin_inst_xml}    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>\n"""

    # Payment Terms (BT-20 / BT-83)
    payment_terms_xml = ""
    if inv.payment.payment_terms:
        payment_terms_xml = f"""  <cac:PaymentTerms>
    <cbc:Note>{escape(inv.payment.payment_terms)}</cbc:Note>
  </cac:PaymentTerms>\n"""

    # Document Level Allowances / Charges (BG-20 / BG-21)
    allowance_charges_xml = ""
    total_allowance_amt = 0.0
    total_charge_amt = 0.0
    if inv.discounts:
        dom_tax_cat = "S"
        dom_tax_pct = 22.0 if (inv.seller.country_code == "SI" or inv.buyer.country_code == "SI") else 19.0
        if inv.items and len(inv.items) > 0:
            dom_tax_cat = inv.items[0].tax_category_code or "S"
            dom_tax_pct = inv.items[0].tax_percent if inv.items[0].tax_percent is not None else dom_tax_pct

        for disc in inv.discounts:
            amt = float(disc.amount or 0.0)
            if amt <= 0:
                continue
            is_charge = bool(getattr(disc, "charge_indicator", False))
            if is_charge:
                total_charge_amt += amt
            else:
                total_allowance_amt += amt

            indicator_txt = "true" if is_charge else "false"
            reason_txt = escape(disc.reason or ("Charge" if is_charge else "Discount"))
            
            # Critical UBL rule: MultiplierFactorNumeric is decimal factor (e.g. 0.1 for 10%), NOT percentage
            pct_tag = ""
            base_amt_tag = ""
            if disc.percentage is not None:
                dec_factor = float(disc.percentage) / 100.0
                pct_tag = f"    <cbc:MultiplierFactorNumeric>{dec_factor:.4f}</cbc:MultiplierFactorNumeric>\n"
                doc_base = getattr(disc, "base_amount", None) or inv.line_net_total
                base_amt_tag = f"    <cbc:BaseAmount currencyID=\"{currency}\">{doc_base:.2f}</cbc:BaseAmount>\n"
            elif getattr(disc, "base_amount", None) is not None:
                base_amt_tag = f"    <cbc:BaseAmount currencyID=\"{currency}\">{disc.base_amount:.2f}</cbc:BaseAmount>\n"

            disc_tax_cat = getattr(disc, "tax_category_code", None) or dom_tax_cat
            disc_tax_pct = getattr(disc, "tax_percent", None) if getattr(disc, "tax_percent", None) is not None else dom_tax_pct

            allowance_charges_xml += f"""  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>{indicator_txt}</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>{reason_txt}</cbc:AllowanceChargeReason>
{pct_tag}{base_amt_tag}    <cbc:Amount currencyID="{currency}">{amt:.2f}</cbc:Amount>
    <cac:TaxCategory>
      <cbc:ID>{disc_tax_cat}</cbc:ID>
      <cbc:Percent>{disc_tax_pct:.2f}</cbc:Percent>
      <cac:TaxScheme>
        <cbc:ID>VAT</cbc:ID>
      </cac:TaxScheme>
    </cac:TaxCategory>
  </cac:AllowanceCharge>\n"""

    # Tax Total & Subtotals (BG-22 & BG-23 / BT-120, BT-121)
    tax_subtotals_xml = ""
    effective_tax_breakdown = inv.tax_breakdown
    if not effective_tax_breakdown:
        # Generate default tax summary
        default_cat = "S" if inv.tax_total > 0 else (inv.items[0].tax_category_code if inv.items else "AE")
        default_pct = round((inv.tax_total / inv.line_net_total * 100), 2) if inv.line_net_total > 0 and inv.tax_total > 0 else (inv.items[0].tax_percent if inv.items else 0.0)
        from backend.models import TaxSummaryItem
        effective_tax_breakdown = [TaxSummaryItem(
            tax_category_code=default_cat,
            tax_percent=default_pct,
            basis_amount=inv.line_net_total,
            tax_amount=inv.tax_total,
            exemption_reason=inv.vat_exemption_reason,
            exemption_reason_code=inv.vat_exemption_reason_code
        )]

    for t_item in effective_tax_breakdown:
        cat_id = t_item.tax_category_code or "S"
        exemp_reason_tag = ""
        ex_reason_txt = t_item.exemption_reason or (inv.vat_exemption_reason if cat_id in ["E", "AE", "K", "G"] else None)
        ex_code_txt = getattr(t_item, "exemption_reason_code", None) or (inv.vat_exemption_reason_code if cat_id in ["E", "AE", "K", "G"] else None)
        if cat_id in ["E", "AE", "K", "G"]:
            if ex_reason_txt:
                exemp_reason_tag += f"        <cbc:TaxExemptionReason>{escape(ex_reason_txt)}</cbc:TaxExemptionReason>\n"
            if ex_code_txt:
                exemp_reason_tag += f"        <cbc:TaxExemptionReasonCode>{escape(ex_code_txt)}</cbc:TaxExemptionReasonCode>\n"

        tax_subtotals_xml += f"""    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="{currency}">{t_item.basis_amount:.2f}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="{currency}">{t_item.tax_amount:.2f}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>{cat_id}</cbc:ID>
        <cbc:Percent>{t_item.tax_percent:.2f}</cbc:Percent>
{exemp_reason_tag}        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>\n"""

    tax_total_xml = f"""  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="{currency}">{inv.tax_total:.2f}</cbc:TaxAmount>
{tax_subtotals_xml}  </cac:TaxTotal>\n"""

    # Legal Monetary Total (BG-22)
    tax_exclusive_amount = inv.line_net_total - total_allowance_amt + total_charge_amt
    prepaid_xml = f"    <cbc:PrepaidAmount currencyID=\"{currency}\">{inv.prepaid_amount:.2f}</cbc:PrepaidAmount>\n" if inv.prepaid_amount > 0 else ""
    allowance_total_elem = f"    <cbc:AllowanceTotalAmount currencyID=\"{currency}\">{total_allowance_amt:.2f}</cbc:AllowanceTotalAmount>\n" if total_allowance_amt > 0 else ""
    charge_total_elem = f"    <cbc:ChargeTotalAmount currencyID=\"{currency}\">{total_charge_amt:.2f}</cbc:ChargeTotalAmount>\n" if total_charge_amt > 0 else ""

    monetary_total_xml = f"""  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="{currency}">{inv.line_net_total:.2f}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="{currency}">{tax_exclusive_amount:.2f}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="{currency}">{inv.grand_total:.2f}</cbc:TaxInclusiveAmount>
{allowance_total_elem}{charge_total_elem}{prepaid_xml}    <cbc:PayableAmount currencyID="{currency}">{inv.due_payable_amount:.2f}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>\n"""

    # Line Items (BG-25, BG-27, BG-28, BT-153..BT-157, BT-132, BT-149/BT-150)
    lines_xml = ""
    for idx, item in enumerate(inv.items, start=1):
        line_num = item.line_id or str(idx)
        u_code = item.unit_code or "C62"
        cat_id = item.tax_category_code or "S"
        item_tax_pct = item.tax_percent if item.tax_percent is not None else 22.0

        # PO line reference (BT-132)
        order_line_xml = ""
        if item.order_line_reference:
            order_line_xml = f"""    <cac:OrderLineReference>
      <cbc:LineID>{escape(str(item.order_line_reference))}</cbc:LineID>
    </cac:OrderLineReference>\n"""

        # Line allowances and charges (BG-27, BG-28)
        line_allowance_xml = ""
        effective_allowances = getattr(item, "allowances_charges", [])
        base_item_price_qty = (item.quantity * item.unit_price) / (item.price_base_quantity if (item.price_base_quantity and item.price_base_quantity > 0) else 1.0)
        
        if not effective_allowances and (item.discount_amount and item.discount_amount > 0):
            pct_tag = ""
            base_amt_tag = ""
            if item.discount_percent:
                dec_factor = float(item.discount_percent) / 100.0
                pct_tag = f"    <cbc:MultiplierFactorNumeric>{dec_factor:.4f}</cbc:MultiplierFactorNumeric>\n"
                base_amt_tag = f"    <cbc:BaseAmount currencyID=\"{currency}\">{base_item_price_qty:.2f}</cbc:BaseAmount>\n"
            line_allowance_xml = f"""  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>
{pct_tag}{base_amt_tag}    <cbc:Amount currencyID="{currency}">{item.discount_amount:.2f}</cbc:Amount>
  </cac:AllowanceCharge>\n"""
        elif effective_allowances:
            for ac in effective_allowances:
                amt = float(ac.amount or 0.0)
                if amt <= 0:
                    continue
                is_chg = bool(ac.charge_indicator)
                chg_str = "true" if is_chg else "false"
                reason_str = escape(ac.reason or ("Charge" if is_chg else "Discount"))
                
                pct_tag = ""
                base_amt_tag = ""
                ac_base = getattr(ac, "base_amount", None) or base_item_price_qty
                if ac.percentage is not None:
                    # Critical UBL rule: decimal rate, e.g. 0.0333 instead of 3.33
                    dec_factor = float(ac.percentage) / 100.0
                    pct_tag = f"    <cbc:MultiplierFactorNumeric>{dec_factor:.4f}</cbc:MultiplierFactorNumeric>\n"
                    base_amt_tag = f"    <cbc:BaseAmount currencyID=\"{currency}\">{float(ac_base):.2f}</cbc:BaseAmount>\n"
                elif getattr(ac, "base_amount", None) is not None:
                    base_amt_tag = f"    <cbc:BaseAmount currencyID=\"{currency}\">{float(ac.base_amount):.2f}</cbc:BaseAmount>\n"

                line_allowance_xml += f"""  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>{chg_str}</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>{reason_str}</cbc:AllowanceChargeReason>
{pct_tag}{base_amt_tag}    <cbc:Amount currencyID="{currency}">{amt:.2f}</cbc:Amount>
  </cac:AllowanceCharge>\n"""

        # Item identifiers (BT-154 description, BT-155 seller ID, BT-156 buyer ID, BT-157 standard GTIN)
        desc_elem = f"      <cbc:Description>{escape(item.description)}</cbc:Description>\n" if item.description else ""
        seller_id_elem = f"""      <cac:SellersItemIdentification>
        <cbc:ID>{escape(item.seller_item_id)}</cbc:ID>
      </cac:SellersItemIdentification>\n""" if item.seller_item_id else ""
        buyer_id_elem = f"""      <cac:BuyersItemIdentification>
        <cbc:ID>{escape(item.buyer_item_id)}</cbc:ID>
      </cac:BuyersItemIdentification>\n""" if item.buyer_item_id else ""
        std_id_elem = ""
        if item.standard_item_id:
            scheme = escape(item.standard_item_id_scheme or "0160")
            std_id_elem = f"""      <cac:StandardItemIdentification>
        <cbc:ID schemeID="{scheme}">{escape(item.standard_item_id)}</cbc:ID>
      </cac:StandardItemIdentification>\n"""

        # Price base quantity (BT-149, BT-150)
        base_qty_elem = ""
        if item.price_base_quantity and item.price_base_quantity != 1.0:
            b_unit = escape(item.price_base_unit or u_code)
            base_qty_elem = f"      <cbc:BaseQuantity unitCode=\"{b_unit}\">{item.price_base_quantity:.4f}</cbc:BaseQuantity>\n"

        lines_xml += f"""  <cac:InvoiceLine>
    <cbc:ID>{line_num}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="{escape(u_code)}">{item.quantity:.4f}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="{currency}">{item.line_total_amount:.2f}</cbc:LineExtensionAmount>
{order_line_xml}{line_allowance_xml}    <cac:Item>
{desc_elem}      <cbc:Name>{escape(item.name)}</cbc:Name>
{buyer_id_elem}{seller_id_elem}{std_id_elem}      <cac:ClassifiedTaxCategory>
        <cbc:ID>{cat_id}</cbc:ID>
        <cbc:Percent>{item_tax_pct:.2f}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="{currency}">{item.unit_price:.4f}</cbc:PriceAmount>
{base_qty_elem}    </cac:Price>
  </cac:InvoiceLine>\n"""

    # Complete OASIS UBL 2.1 XML Document
    ubl_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>{customization_id}</cbc:CustomizationID>
  <cbc:ProfileID>{profile_id}</cbc:ProfileID>
  <cbc:ID>{inv_number}</cbc:ID>
  <cbc:IssueDate>{issue_date}</cbc:IssueDate>
{due_date_xml}  <cbc:InvoiceTypeCode>{inv_type_code}</cbc:InvoiceTypeCode>
{notes_xml}  <cbc:DocumentCurrencyCode>{currency}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>{buyer_ref}</cbc:BuyerReference>
{accounting_cost_xml}{period_xml}{order_ref_xml}{contract_ref_xml}{sales_order_ref_xml}{billing_ref_xml}{despatch_xml}  <cac:AccountingSupplierParty>
    <cac:Party>
{s_endpoint_xml}      <cac:PartyName>
        <cbc:Name>{escape(inv.seller.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>{escape(inv.seller.street or "")}</cbc:StreetName>
        <cbc:CityName>{escape(inv.seller.city or "")}</cbc:CityName>
        <cbc:PostalZone>{escape(inv.seller.postcode or "")}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>{escape(inv.seller.country_code or "SI")}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
{s_tax_scheme_xml}{seller_legal_entity_xml}{s_contact_xml}    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
{b_endpoint_xml}      <cac:PartyName>
        <cbc:Name>{escape(inv.buyer.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>{escape(inv.buyer.street or "")}</cbc:StreetName>
        <cbc:CityName>{escape(inv.buyer.city or "")}</cbc:CityName>
        <cbc:PostalZone>{escape(inv.buyer.postcode or "")}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>{escape(inv.buyer.country_code or "SI")}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
{b_tax_scheme_xml}{buyer_legal_entity_xml}{b_contact_xml}    </cac:Party>
  </cac:AccountingCustomerParty>
{payee_party_ubl}{delivery_xml}{payment_means_xml}{payment_terms_xml}{allowance_charges_xml}{tax_total_xml}{monetary_total_xml}{lines_xml}</Invoice>
"""
    return ubl_xml
