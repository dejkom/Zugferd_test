import os
import re
import xml.etree.ElementTree as ET
from typing import Optional, List, Dict, Any

from backend.models import (
    InvoiceData, TradeParty, DeliveryDetails, PaymentDetails,
    InvoiceLineItem, TaxSummaryItem, DocumentDiscount, LineAllowanceCharge,
    FactoringPayee, BankAccount, FieldConfidenceScores
)
from backend.eslog_parser import parse_eslog2_xml


def _strip_xml_namespaces(xml_content: str) -> str:
    """Strip XML namespaces and prefixed attributes (e.g. xsi:...) for simplified XPath/tag querying."""
    # Remove xmlns and prefix definitions
    clean = re.sub(r'\sxmlns(?::\w+)?="[^"]+"', '', xml_content, count=0)
    # Remove prefixed attributes like xsi:noNamespaceSchemaLocation or xsi:schemaLocation
    clean = re.sub(r'\s\w+:\w+="[^"]+"', '', clean, count=0)
    # Remove namespace prefixes from tag names e.g. <cbc:ID> -> <ID>, </cbc:ID> -> </ID>
    clean = re.sub(r'<(/?)[\w\-]+:([\w\-]+)', r'<\1\2', clean)
    return clean


def _get_text(parent, xpath: str) -> Optional[str]:
    """Helper to extract stripped text from child element."""
    if parent is None:
        return None
    el = parent.find(xpath)
    if el is not None and el.text:
        txt = el.text.strip()
        return txt if txt else None
    return None


def _clean_date_to_iso(d_str: Optional[str]) -> Optional[str]:
    """Convert various date formats (YYYYMMDD, DD.MM.YYYY, YYYY-MM-DD) into ISO YYYY-MM-DD."""
    if not d_str:
        return None
    s = str(d_str).strip()
    # Check if format 102: YYYYMMDD
    digits = re.sub(r"[^\d]", "", s)
    if len(digits) == 8:
        if "." in s:
            parts = [p.strip() for p in s.split(".") if p.strip()]
            if len(parts) == 3 and len(parts[2]) == 4:
                return f"{parts[2]}-{int(parts[1]):02d}-{int(parts[0]):02d}"
        if "-" in s:
            parts = [p.strip() for p in s.split("-") if p.strip()]
            if len(parts) == 3 and len(parts[0]) == 4:
                return f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
        # Pure YYYYMMDD
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:]}"
    elif "-" in s:
        # e.g. 2026-10-15T00:00:00 or 2026-10-15
        parts = s.split("T")[0].split("-")
        if len(parts) == 3 and len(parts[0]) == 4:
            return f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
    return s


def _parse_float(val: Optional[str], default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        cleaned = str(val).replace(",", ".").replace(" ", "")
        return float(cleaned)
    except (ValueError, TypeError):
        return default


def parse_ubl_xml(xml_content: str) -> InvoiceData:
    """
    Parse OASIS UBL 2.1 / Peppol BIS Billing 3.0 / XRechnung UBL XML
    into structured InvoiceData model.
    """
    clean_xml = _strip_xml_namespaces(xml_content)
    root = ET.fromstring(clean_xml)

    # Root can be Invoice or CreditNote
    is_credit_note = root.tag.endswith("CreditNote")

    # Document info
    invoice_number = _get_text(root, "ID") or "INVOICE"
    issue_date = _clean_date_to_iso(_get_text(root, "IssueDate")) or "2026-01-01"
    due_date = _clean_date_to_iso(_get_text(root, "DueDate"))
    currency = _get_text(root, "DocumentCurrencyCode") or "EUR"
    default_type_code = "381" if is_credit_note else "380"
    invoice_type_code = _get_text(root, "InvoiceTypeCode") or _get_text(root, "CreditNoteTypeCode") or default_type_code
    buyer_reference = _get_text(root, "BuyerReference")

    # Document references
    purchase_order_number = _get_text(root, "OrderReference/ID")
    contract_reference = _get_text(root, "ContractDocumentReference/ID")
    preceding_invoice_number = _get_text(root, "BillingReference/InvoiceDocumentReference/ID")
    preceding_invoice_date = _clean_date_to_iso(_get_text(root, "BillingReference/InvoiceDocumentReference/IssueDate"))
    despatch_advice_reference = _get_text(root, "DespatchDocumentReference/ID")
    sales_order_number = _get_text(root, "OriginatorDocumentReference/ID")
    cost_center = _get_text(root, "AccountingCost")

    # Notes
    notes: List[str] = []
    for note_el in root.findall("Note"):
        if note_el.text and note_el.text.strip():
            notes.append(note_el.text.strip())

    # Period
    service_period_start = _clean_date_to_iso(_get_text(root, "InvoicePeriod/StartDate"))
    service_period_end = _clean_date_to_iso(_get_text(root, "InvoicePeriod/EndDate"))

    # Seller (AccountingSupplierParty/Party)
    seller_node = root.find("AccountingSupplierParty/Party")
    seller_name = "Seller Company"
    seller_vat = None
    seller_tax_number = None
    seller_street = None
    seller_city = None
    seller_postcode = None
    seller_country = "DE"
    seller_identifier = None
    company_legal_form = None
    legal_info = None
    seller_endpoint_id = None
    seller_endpoint_scheme = None
    contact_name = None
    contact_phone = None
    contact_email = None

    if seller_node is not None:
        seller_name = (
            _get_text(seller_node, "PartyName/Name")
            or _get_text(seller_node, "PartyLegalEntity/RegistrationName")
            or "Seller Company"
        )
        seller_endpoint_id = _get_text(seller_node, "EndpointID")
        ep_el = seller_node.find("EndpointID")
        if ep_el is not None and "schemeID" in ep_el.attrib:
            seller_endpoint_scheme = ep_el.attrib["schemeID"]

        seller_identifier = _get_text(seller_node, "PartyIdentification/ID")
        seller_street = _get_text(seller_node, "PostalAddress/StreetName")
        seller_street2 = _get_text(seller_node, "PostalAddress/AdditionalStreetName")
        seller_city = _get_text(seller_node, "PostalAddress/CityName")
        seller_postcode = _get_text(seller_node, "PostalAddress/PostalZone")
        seller_country = _get_text(seller_node, "PostalAddress/Country/IdentificationCode") or "DE"

        # PartyTaxScheme
        for pts in seller_node.findall("PartyTaxScheme"):
            cid = _get_text(pts, "CompanyID")
            scheme = _get_text(pts, "TaxScheme/ID")
            if cid:
                if scheme == "VAT" or re.match(r"^[A-Z]{2}", cid):
                    seller_vat = cid
                else:
                    seller_tax_number = cid

        company_legal_form = _get_text(seller_node, "PartyLegalEntity/CompanyID")
        legal_info = _get_text(seller_node, "PartyLegalEntity/CompanyLegalForm")

        contact_node = seller_node.find("Contact")
        if contact_node is not None:
            contact_name = _get_text(contact_node, "Name")
            contact_phone = _get_text(contact_node, "Telephone")
            contact_email = _get_text(contact_node, "ElectronicMail")

    seller = TradeParty(
        name=seller_name,
        vat_id=seller_vat,
        tax_number=seller_tax_number,
        tax_registration_id=seller_tax_number,
        seller_identifier=seller_identifier,
        street=seller_street,
        address_line_2=seller_street2,
        city=seller_city,
        postcode=seller_postcode,
        country_code=seller_country,
        company_legal_form=company_legal_form,
        legal_info=legal_info,
        endpoint_id=seller_endpoint_id,
        endpoint_scheme=seller_endpoint_scheme,
        contact_name=contact_name,
        contact_phone=contact_phone,
        contact_email=contact_email
    )

    # Buyer (AccountingCustomerParty/Party)
    buyer_node = root.find("AccountingCustomerParty/Party")
    buyer_name = "Buyer Company"
    buyer_vat = None
    buyer_tax_number = None
    buyer_street = None
    buyer_street2 = None
    buyer_city = None
    buyer_postcode = None
    buyer_country = "DE"
    buyer_endpoint_id = None
    buyer_endpoint_scheme = None
    b_contact_name = None
    b_contact_phone = None
    b_contact_email = None

    if buyer_node is not None:
        buyer_name = (
            _get_text(buyer_node, "PartyName/Name")
            or _get_text(buyer_node, "PartyLegalEntity/RegistrationName")
            or "Buyer Company"
        )
        buyer_endpoint_id = _get_text(buyer_node, "EndpointID")
        b_ep_el = buyer_node.find("EndpointID")
        if b_ep_el is not None and "schemeID" in b_ep_el.attrib:
            buyer_endpoint_scheme = b_ep_el.attrib["schemeID"]

        buyer_street = _get_text(buyer_node, "PostalAddress/StreetName")
        buyer_street2 = _get_text(buyer_node, "PostalAddress/AdditionalStreetName")
        buyer_city = _get_text(buyer_node, "PostalAddress/CityName")
        buyer_postcode = _get_text(buyer_node, "PostalAddress/PostalZone")
        buyer_country = _get_text(buyer_node, "PostalAddress/Country/IdentificationCode") or "DE"

        for pts in buyer_node.findall("PartyTaxScheme"):
            cid = _get_text(pts, "CompanyID")
            scheme = _get_text(pts, "TaxScheme/ID")
            if cid:
                if scheme == "VAT" or re.match(r"^[A-Z]{2}", cid):
                    buyer_vat = cid
                else:
                    buyer_tax_number = cid

        b_contact = buyer_node.find("Contact")
        if b_contact is not None:
            b_contact_name = _get_text(b_contact, "Name")
            b_contact_phone = _get_text(b_contact, "Telephone")
            b_contact_email = _get_text(b_contact, "ElectronicMail")

    buyer = TradeParty(
        name=buyer_name,
        vat_id=buyer_vat,
        tax_number=buyer_tax_number,
        tax_registration_id=buyer_tax_number,
        street=buyer_street,
        address_line_2=buyer_street2,
        city=buyer_city,
        postcode=buyer_postcode,
        country_code=buyer_country,
        endpoint_id=buyer_endpoint_id,
        endpoint_scheme=buyer_endpoint_scheme,
        contact_name=b_contact_name,
        contact_phone=b_contact_phone,
        contact_email=b_contact_email
    )

    # Payee / Factoring (PayeeParty)
    factoring_payee = None
    payee_node = root.find("PayeeParty")
    if payee_node is not None:
        payee_name = _get_text(payee_node, "PartyName/Name") or _get_text(payee_node, "PartyLegalEntity/RegistrationName")
        payee_id = _get_text(payee_node, "PartyIdentification/ID")
        payee_vat = _get_text(payee_node, "PartyTaxScheme/CompanyID")
        if payee_name or payee_id or payee_vat:
            factoring_payee = FactoringPayee(
                name=payee_name,
                payee_id=payee_id,
                vat_id=payee_vat
            )

    # Payment Means
    bank_accounts: List[BankAccount] = []
    payment_means_code = "58"
    payment_reference = None
    iban_primary = None
    bic_primary = None
    bank_primary = None

    for pm in root.findall("PaymentMeans"):
        pm_code = _get_text(pm, "PaymentMeansCode")
        if pm_code:
            payment_means_code = pm_code
        ref = _get_text(pm, "PaymentID")
        if ref and not payment_reference:
            payment_reference = ref

        iban = _get_text(pm, "PayeeFinancialAccount/ID")
        bic = _get_text(pm, "PayeeFinancialAccount/FinancialInstitutionBranch/ID")
        b_name = _get_text(pm, "PayeeFinancialAccount/FinancialInstitutionBranch/Name")

        if iban:
            clean_iban = iban.replace(" ", "").upper()
            bank_accounts.append(BankAccount(
                iban=clean_iban,
                bic=bic.replace(" ", "").upper() if bic else None,
                bank_name=b_name
            ))
            if not iban_primary:
                iban_primary = clean_iban
                bic_primary = bic.replace(" ", "").upper() if bic else None
                bank_primary = b_name

    payment_terms_note = _get_text(root, "PaymentTerms/Note")
    payment = PaymentDetails(
        iban=iban_primary,
        bic=bic_primary,
        bank_name=bank_primary,
        bank_accounts=bank_accounts,
        payment_terms=payment_terms_note,
        payment_reference=payment_reference,
        payment_means_code=payment_means_code,
        factoring_payee=factoring_payee
    )

    # Delivery (Delivery)
    delivery_obj = None
    deliv_node = root.find("Delivery")
    actual_delivery_date = _clean_date_to_iso(_get_text(deliv_node, "ActualDeliveryDate")) if deliv_node is not None else None
    loc_id = None
    loc_scheme = "0088"
    deliv_recipient = None
    deliv_street = None
    deliv_city = None
    deliv_postcode = None
    deliv_country = "DE"

    if deliv_node is not None:
        loc_el = deliv_node.find("DeliveryLocation/ID")
        if loc_el is not None:
            loc_id = loc_el.text.strip() if loc_el.text else None
            loc_scheme = loc_el.attrib.get("schemeID", "0088")

        deliv_recipient = _get_text(deliv_node, "DeliveryParty/PartyName/Name")
        deliv_street = _get_text(deliv_node, "DeliveryParty/PostalAddress/StreetName")
        deliv_city = _get_text(deliv_node, "DeliveryParty/PostalAddress/CityName")
        deliv_postcode = _get_text(deliv_node, "DeliveryParty/PostalAddress/PostalZone")
        deliv_country = _get_text(deliv_node, "DeliveryParty/PostalAddress/Country/IdentificationCode") or "DE"

    if actual_delivery_date or loc_id or deliv_recipient or deliv_street or despatch_advice_reference:
        delivery_obj = DeliveryDetails(
            recipient_name=deliv_recipient,
            location_id=loc_id,
            location_scheme=loc_scheme,
            street=deliv_street,
            city=deliv_city,
            postcode=deliv_postcode,
            country_code=deliv_country,
            delivery_date=actual_delivery_date,
            despatch_advice_id=despatch_advice_reference,
            despatch_advice_reference=despatch_advice_reference
        )

    # Document Level Allowances / Charges (AllowanceCharge)
    discounts: List[DocumentDiscount] = []
    for ac in root.findall("AllowanceCharge"):
        charge_ind_str = _get_text(ac, "ChargeIndicator")
        is_charge = (charge_ind_str or "").lower() == "true"
        amt = _parse_float(_get_text(ac, "Amount"))
        reason = _get_text(ac, "AllowanceChargeReason") or _get_text(ac, "AllowanceChargeReasonCode") or ""
        pct = None
        mult_str = _get_text(ac, "MultiplierFactorNumeric")
        if mult_str is not None:
            pct = _parse_float(mult_str) * 100.0  # UBL decimal factor to percentage
        base_amt = _parse_float(_get_text(ac, "BaseAmount")) if _get_text(ac, "BaseAmount") is not None else None
        tax_cat = _get_text(ac, "TaxCategory/ID") or "S"
        tax_pct = _parse_float(_get_text(ac, "TaxCategory/Percent"), default=0.0)

        discounts.append(DocumentDiscount(
            reason=reason,
            percentage=pct,
            amount=amt,
            charge_indicator=is_charge,
            tax_category_code=tax_cat,
            tax_percent=tax_pct,
            base_amount=base_amt
        ))

    # Line Items (InvoiceLine or CreditNoteLine)
    line_elements = root.findall("InvoiceLine")
    if not line_elements:
        line_elements = root.findall("CreditNoteLine")

    items: List[InvoiceLineItem] = []
    calculated_line_net = 0.0

    for idx, l_el in enumerate(line_elements, start=1):
        line_id = _get_text(l_el, "ID") or str(idx)
        # Quantity
        qty_el = l_el.find("InvoicedQuantity") if l_el.find("InvoicedQuantity") is not None else l_el.find("CreditedQuantity")
        quantity = 1.0
        unit_code = "C62"
        if qty_el is not None:
            quantity = _parse_float(qty_el.text, default=1.0)
            unit_code = qty_el.attrib.get("unitCode", "C62")

        unit_price = _parse_float(_get_text(l_el, "Price/PriceAmount"))
        line_total_amount = _parse_float(_get_text(l_el, "LineExtensionAmount"))
        calculated_line_net += line_total_amount

        # Item info
        item_el = l_el.find("Item")
        item_name = "Item"
        description = None
        seller_item_id = None
        buyer_item_id = None
        standard_item_id = None
        standard_item_id_scheme = "0160"
        tax_cat = "S"
        tax_pct = 0.0

        if item_el is not None:
            item_name = _get_text(item_el, "Name") or "Item"
            description = _get_text(item_el, "Description")
            seller_item_id = _get_text(item_el, "SellersItemIdentification/ID")
            buyer_item_id = _get_text(item_el, "BuyersItemIdentification/ID")
            std_el = item_el.find("StandardItemIdentification/ID")
            if std_el is not None:
                standard_item_id = std_el.text.strip() if std_el.text else None
                standard_item_id_scheme = std_el.attrib.get("schemeID", "0160")

            tax_cat = _get_text(item_el, "ClassifiedTaxCategory/ID") or "S"
            tax_pct = _parse_float(_get_text(item_el, "ClassifiedTaxCategory/Percent"), default=0.0)

        # Price base
        price_base_qty = 1.0
        price_base_unit = None
        base_qty_el = l_el.find("Price/BaseQuantity")
        if base_qty_el is not None:
            price_base_qty = _parse_float(base_qty_el.text, default=1.0)
            price_base_unit = base_qty_el.attrib.get("unitCode")

        order_line_ref = _get_text(l_el, "OrderLineReference/LineID")

        # Line allowances and charges
        line_allowances: List[LineAllowanceCharge] = []
        discount_amount = 0.0
        discount_percent = None

        for lac in l_el.findall("AllowanceCharge"):
            is_chg = (_get_text(lac, "ChargeIndicator") or "").lower() == "true"
            lac_amt = _parse_float(_get_text(lac, "Amount"))
            lac_reason = _get_text(lac, "AllowanceChargeReason")
            lac_mult = _get_text(lac, "MultiplierFactorNumeric")
            lac_pct = (_parse_float(lac_mult) * 100.0) if lac_mult is not None else None
            lac_base = _parse_float(_get_text(lac, "BaseAmount")) if _get_text(lac, "BaseAmount") is not None else None

            if not is_chg and discount_amount == 0.0:
                discount_amount = lac_amt
                discount_percent = lac_pct

            line_allowances.append(LineAllowanceCharge(
                charge_indicator=is_chg,
                amount=lac_amt,
                percentage=lac_pct,
                base_amount=lac_base,
                reason=lac_reason
            ))

        items.append(InvoiceLineItem(
            line_id=line_id,
            name=item_name,
            description=description,
            quantity=quantity,
            unit_code=unit_code,
            unit_price=unit_price,
            line_total_amount=line_total_amount,
            tax_category_code=tax_cat,
            tax_percent=tax_pct,
            discount_amount=discount_amount,
            discount_percent=discount_percent,
            seller_item_id=seller_item_id,
            buyer_item_id=buyer_item_id,
            standard_item_id=standard_item_id,
            standard_item_id_scheme=standard_item_id_scheme,
            order_line_reference=order_line_ref,
            price_base_quantity=price_base_qty,
            price_base_unit=price_base_unit,
            allowances_charges=line_allowances
        ))

    # Tax Breakdown (TaxTotal/TaxSubtotal)
    tax_breakdown: List[TaxSummaryItem] = []
    vat_exemption_reason = None
    vat_exemption_reason_code = None
    extracted_tax_total = _parse_float(_get_text(root, "TaxTotal/TaxAmount"))

    for sub in root.findall("TaxTotal/TaxSubtotal"):
        basis = _parse_float(_get_text(sub, "TaxableAmount"))
        amt = _parse_float(_get_text(sub, "TaxAmount"))
        t_cat = _get_text(sub, "TaxCategory/ID") or "S"
        t_pct = _parse_float(_get_text(sub, "TaxCategory/Percent"), default=0.0)
        ex_reason = _get_text(sub, "TaxCategory/TaxExemptionReason")
        ex_code = _get_text(sub, "TaxCategory/TaxExemptionReasonCode")

        if ex_reason and not vat_exemption_reason:
            vat_exemption_reason = ex_reason
        if ex_code and not vat_exemption_reason_code:
            vat_exemption_reason_code = ex_code

        tax_breakdown.append(TaxSummaryItem(
            tax_category_code=t_cat,
            tax_percent=t_pct,
            basis_amount=basis,
            tax_amount=amt,
            exemption_reason=ex_reason,
            exemption_reason_code=ex_code
        ))

    # Totals (LegalMonetaryTotal)
    lmt = root.find("LegalMonetaryTotal")
    line_net_total = _parse_float(_get_text(lmt, "LineExtensionAmount"), default=calculated_line_net)
    tax_exclusive_amount = _parse_float(_get_text(lmt, "TaxExclusiveAmount"), default=line_net_total)
    grand_total = _parse_float(_get_text(lmt, "TaxInclusiveAmount"), default=(tax_exclusive_amount + extracted_tax_total))
    due_payable_amount = _parse_float(_get_text(lmt, "PayableAmount"), default=grand_total)
    prepaid_amount = _parse_float(_get_text(lmt, "PrepaidAmount"), default=0.0)

    return InvoiceData(
        invoice_number=invoice_number,
        issue_date=issue_date,
        due_date=due_date,
        currency=currency,
        invoice_type_code=invoice_type_code,
        document_format="ubl",
        buyer_reference=buyer_reference,
        purchase_order_number=purchase_order_number,
        sales_order_number=sales_order_number,
        cost_center=cost_center,
        contract_reference=contract_reference,
        despatch_advice_reference=despatch_advice_reference,
        delivery_date=actual_delivery_date,
        notes=notes,
        invoice_notes=notes,
        preceding_invoice_number=preceding_invoice_number,
        preceding_invoice_date=preceding_invoice_date,
        service_period_start=service_period_start,
        service_period_end=service_period_end,
        prepaid_amount=prepaid_amount,
        discounts=discounts,
        vat_exemption_reason=vat_exemption_reason,
        vat_exemption_reason_code=vat_exemption_reason_code,
        seller=seller,
        buyer=buyer,
        delivery=delivery_obj,
        payment=payment,
        factoring_payee=factoring_payee,
        items=items,
        tax_breakdown=tax_breakdown,
        line_net_total=line_net_total,
        tax_total=extracted_tax_total,
        grand_total=grand_total,
        due_payable_amount=due_payable_amount,
        confidence_scores=FieldConfidenceScores()
    )


def parse_cii_xml(xml_content: str) -> InvoiceData:
    """
    Parse UN/CEFACT CrossIndustryInvoice (Factur-X / ZUGFeRD 2.x / XRechnung CII)
    into structured InvoiceData model.
    """
    clean_xml = _strip_xml_namespaces(xml_content)
    root = ET.fromstring(clean_xml)

    # ExchangedDocument
    ex_doc = root.find("ExchangedDocument")
    invoice_number = _get_text(ex_doc, "ID") or "INVOICE"
    invoice_type_code = _get_text(ex_doc, "TypeCode") or "380"
    issue_date = _clean_date_to_iso(_get_text(ex_doc, "IssueDateTime/DateTimeString")) or "2026-01-01"

    notes: List[str] = []
    if ex_doc is not None:
        for n_el in ex_doc.findall("IncludedNote"):
            txt = _get_text(n_el, "Content")
            if txt:
                notes.append(txt)

    # SupplyChainTradeTransaction
    tx = root.find("SupplyChainTradeTransaction") or root

    # ApplicableHeaderTradeAgreement
    agr = tx.find("ApplicableHeaderTradeAgreement")
    buyer_reference = _get_text(agr, "BuyerReference")
    po_number = _get_text(agr, "BuyerOrderReferencedDocument/IssuerAssignedID")
    po_date = _clean_date_to_iso(_get_text(agr, "BuyerOrderReferencedDocument/FormattedIssueDateTime/DateTimeString"))
    contract_ref = _get_text(agr, "ContractReferencedDocument/IssuerAssignedID")
    sales_order_num = _get_text(agr, "SellerOrderReferencedDocument/IssuerAssignedID")
    preceding_num = _get_text(agr, "InvoiceReferencedDocument/IssuerAssignedID")
    preceding_date = _clean_date_to_iso(_get_text(agr, "InvoiceReferencedDocument/FormattedIssueDateTime/DateTimeString"))

    # SellerTradeParty
    seller_node = agr.find("SellerTradeParty") if agr is not None else None
    seller_name = "Seller Company"
    seller_vat = None
    seller_tax_number = None
    seller_street = None
    seller_city = None
    seller_postcode = None
    seller_country = "DE"
    seller_identifier = None
    company_legal_form = None
    legal_info = None
    seller_endpoint_id = None
    seller_endpoint_scheme = None
    s_contact_name = None
    s_contact_phone = None
    s_contact_email = None

    if seller_node is not None:
        seller_name = _get_text(seller_node, "Name") or "Seller Company"
        seller_identifier = _get_text(seller_node, "ID")
        seller_street = _get_text(seller_node, "PostalTradeAddress/LineOne")
        seller_street2 = _get_text(seller_node, "PostalTradeAddress/LineTwo")
        seller_street3 = _get_text(seller_node, "PostalTradeAddress/LineThree")
        seller_city = _get_text(seller_node, "PostalTradeAddress/CityName")
        seller_postcode = _get_text(seller_node, "PostalTradeAddress/PostcodeCode")
        seller_country = _get_text(seller_node, "PostalTradeAddress/CountryID") or "DE"

        for tr in seller_node.findall("SpecifiedTaxRegistration"):
            sid = _get_text(tr, "ID")
            scheme = tr.find("ID").attrib.get("schemeID") if tr.find("ID") is not None else ""
            if sid:
                if scheme == "VA" or sid.startswith("DE") or sid.startswith("SI"):
                    seller_vat = sid
                elif scheme == "FC" or not seller_tax_number:
                    seller_tax_number = sid

        company_legal_form = _get_text(seller_node, "SpecifiedLegalOrganization/ID")
        legal_info = _get_text(seller_node, "SpecifiedLegalOrganization/TradingBusinessName")

        uri_el = seller_node.find("URIUniversalCommunication/URIID")
        if uri_el is not None:
            seller_endpoint_id = uri_el.text.strip() if uri_el.text else None
            seller_endpoint_scheme = uri_el.attrib.get("schemeID")

        s_contact = seller_node.find("DefinedTradeContact")
        if s_contact is not None:
            s_contact_name = _get_text(s_contact, "PersonName")
            s_contact_phone = _get_text(s_contact, "TelephoneUniversalCommunication/CompleteNumber")
            s_contact_email = _get_text(s_contact, "EmailURIUniversalCommunication/URIID")

    seller = TradeParty(
        name=seller_name,
        vat_id=seller_vat,
        tax_number=seller_tax_number,
        tax_registration_id=seller_tax_number,
        seller_identifier=seller_identifier,
        street=seller_street,
        address_line_2=seller_street2,
        address_line_3=seller_street3,
        city=seller_city,
        postcode=seller_postcode,
        country_code=seller_country,
        company_legal_form=company_legal_form,
        legal_info=legal_info,
        endpoint_id=seller_endpoint_id,
        endpoint_scheme=seller_endpoint_scheme,
        contact_name=s_contact_name,
        contact_phone=s_contact_phone,
        contact_email=s_contact_email
    )

    # BuyerTradeParty
    buyer_node = agr.find("BuyerTradeParty") if agr is not None else None
    buyer_name = "Buyer Company"
    buyer_vat = None
    buyer_tax_number = None
    buyer_street = None
    buyer_street2 = None
    buyer_street3 = None
    buyer_city = None
    buyer_postcode = None
    buyer_country = "DE"
    buyer_endpoint_id = None
    buyer_endpoint_scheme = None
    b_contact_name = None
    b_contact_phone = None
    b_contact_email = None

    if buyer_node is not None:
        buyer_name = _get_text(buyer_node, "Name") or "Buyer Company"
        buyer_street = _get_text(buyer_node, "PostalTradeAddress/LineOne")
        buyer_street2 = _get_text(buyer_node, "PostalTradeAddress/LineTwo")
        buyer_street3 = _get_text(buyer_node, "PostalTradeAddress/LineThree")
        buyer_city = _get_text(buyer_node, "PostalTradeAddress/CityName")
        buyer_postcode = _get_text(buyer_node, "PostalTradeAddress/PostcodeCode")
        buyer_country = _get_text(buyer_node, "PostalTradeAddress/CountryID") or "DE"

        for tr in buyer_node.findall("SpecifiedTaxRegistration"):
            sid = _get_text(tr, "ID")
            scheme = tr.find("ID").attrib.get("schemeID") if tr.find("ID") is not None else ""
            if sid:
                if scheme == "VA" or sid.startswith("DE") or sid.startswith("SI"):
                    buyer_vat = sid
                else:
                    buyer_tax_number = sid

        b_uri_el = buyer_node.find("URIUniversalCommunication/URIID")
        if b_uri_el is not None:
            buyer_endpoint_id = b_uri_el.text.strip() if b_uri_el.text else None
            buyer_endpoint_scheme = b_uri_el.attrib.get("schemeID")

        b_contact = buyer_node.find("DefinedTradeContact")
        if b_contact is not None:
            b_contact_name = _get_text(b_contact, "PersonName")
            b_contact_phone = _get_text(b_contact, "TelephoneUniversalCommunication/CompleteNumber")
            b_contact_email = _get_text(b_contact, "EmailURIUniversalCommunication/URIID")

    buyer = TradeParty(
        name=buyer_name,
        vat_id=buyer_vat,
        tax_number=buyer_tax_number,
        tax_registration_id=buyer_tax_number,
        street=buyer_street,
        address_line_2=buyer_street2,
        address_line_3=buyer_street3,
        city=buyer_city,
        postcode=buyer_postcode,
        country_code=buyer_country,
        endpoint_id=buyer_endpoint_id,
        endpoint_scheme=buyer_endpoint_scheme,
        contact_name=b_contact_name,
        contact_phone=b_contact_phone,
        contact_email=b_contact_email
    )

    # ApplicableHeaderTradeDelivery
    deliv_node = tx.find("ApplicableHeaderTradeDelivery")
    deliv_date = None
    despatch_id = None
    deliv_recipient = None
    deliv_loc_id = None
    deliv_loc_scheme = "0088"
    deliv_street = None
    deliv_city = None
    deliv_postcode = None
    deliv_country = "DE"

    if deliv_node is not None:
        deliv_date = _clean_date_to_iso(_get_text(deliv_node, "ActualDeliverySupplyChainEvent/OccurrenceDateTime/DateTimeString"))
        despatch_id = _get_text(deliv_node, "DespatchAdviceReferencedDocument/IssuerAssignedID")

        ship_to = deliv_node.find("ShipToTradeParty")
        if ship_to is not None:
            deliv_recipient = _get_text(ship_to, "Name")
            loc_el = ship_to.find("ID")
            if loc_el is not None:
                deliv_loc_id = loc_el.text.strip() if loc_el.text else None
                deliv_loc_scheme = loc_el.attrib.get("schemeID", "0088")
            deliv_street = _get_text(ship_to, "PostalTradeAddress/LineOne")
            deliv_city = _get_text(ship_to, "PostalTradeAddress/CityName")
            deliv_postcode = _get_text(ship_to, "PostalTradeAddress/PostcodeCode")
            deliv_country = _get_text(ship_to, "PostalTradeAddress/CountryID") or "DE"

    delivery_obj = None
    if deliv_date or despatch_id or deliv_recipient or deliv_loc_id or deliv_street:
        delivery_obj = DeliveryDetails(
            recipient_name=deliv_recipient,
            location_id=deliv_loc_id,
            location_scheme=deliv_loc_scheme,
            street=deliv_street,
            city=deliv_city,
            postcode=deliv_postcode,
            country_code=deliv_country,
            delivery_date=deliv_date,
            despatch_advice_id=despatch_id,
            despatch_advice_reference=despatch_id
        )

    # ApplicableHeaderTradeSettlement
    stl = tx.find("ApplicableHeaderTradeSettlement")
    currency = _get_text(stl, "InvoiceCurrencyCode") or _get_text(stl, "TaxCurrencyCode") or "EUR"
    cost_center = _get_text(stl, "ReceivableSpecifiedTradeAccountingAccount/ID")

    # Service Period
    service_period_start = _clean_date_to_iso(_get_text(stl, "BillingSpecifiedPeriod/StartDateTime/DateTimeString"))
    service_period_end = _clean_date_to_iso(_get_text(stl, "BillingSpecifiedPeriod/EndDateTime/DateTimeString"))

    # Payee / Factoring
    factoring_payee = None
    payee_party_node = stl.find("PayeeTradeParty") if stl is not None else None
    if payee_party_node is not None:
        p_name = _get_text(payee_party_node, "Name")
        p_id = _get_text(payee_party_node, "ID")
        p_vat = _get_text(payee_party_node, "SpecifiedTaxRegistration/ID")
        if p_name or p_id or p_vat:
            factoring_payee = FactoringPayee(
                name=p_name,
                payee_id=p_id,
                vat_id=p_vat
            )

    # Payment Means & Bank Accounts
    bank_accounts: List[BankAccount] = []
    payment_means_code = "58"
    iban_primary = None
    bic_primary = None
    payment_terms_desc = None
    due_date = None
    payment_reference = None

    if stl is not None:
        for pm in stl.findall("SpecifiedTradeSettlementPaymentMeans"):
            pm_code = _get_text(pm, "TypeCode")
            if pm_code:
                payment_means_code = pm_code

            iban = _get_text(pm, "PayeePartyCreditorFinancialAccount/IBANID")
            bic = _get_text(pm, "PayeeSpecifiedCreditorFinancialInstitution/BICID")
            b_name = _get_text(pm, "PayeePartyCreditorFinancialAccount/AccountName")

            if iban:
                clean_iban = iban.replace(" ", "").upper()
                clean_bic = bic.replace(" ", "").upper() if bic else None
                bank_accounts.append(BankAccount(
                    iban=clean_iban,
                    bic=clean_bic,
                    bank_name=b_name
                ))
                if not iban_primary:
                    iban_primary = clean_iban
                    bic_primary = clean_bic

        # Payment Terms
        terms_node = stl.find("SpecifiedTradePaymentTerms")
        if terms_node is not None:
            payment_terms_desc = _get_text(terms_node, "Description")
            due_date = _clean_date_to_iso(_get_text(terms_node, "DueDateDateTime/DateTimeString"))
            # Extract payment reference / Sklic if embedded in Description
            if payment_terms_desc:
                m_ref = re.search(r"(?:\[Ref:\s*([^\]]+)\]|Payment Reference:\s*([^\s,]+)|Sklic:\s*([^\s,\)]+))", payment_terms_desc, re.IGNORECASE)
                if m_ref:
                    payment_reference = m_ref.group(1) or m_ref.group(2) or m_ref.group(3)

    payment = PaymentDetails(
        iban=iban_primary,
        bic=bic_primary,
        bank_accounts=bank_accounts,
        payment_terms=payment_terms_desc,
        payment_reference=payment_reference,
        payment_means_code=payment_means_code,
        factoring_payee=factoring_payee
    )

    # Document Level Allowances and Charges
    discounts: List[DocumentDiscount] = []
    if stl is not None:
        for ac in stl.findall("SpecifiedTradeAllowanceCharge"):
            is_chg = (_get_text(ac, "ChargeIndicator/Indicator") or "").lower() == "true"
            amt = _parse_float(_get_text(ac, "ActualAmount"))
            reason = _get_text(ac, "Reason") or ""
            pct = _parse_float(_get_text(ac, "CalculationPercent")) if _get_text(ac, "CalculationPercent") else None
            base_amt = _parse_float(_get_text(ac, "BasisAmount")) if _get_text(ac, "BasisAmount") else None
            tax_cat = _get_text(ac, "CategoryTradeTax/CategoryCode") or "S"
            tax_pct = _parse_float(_get_text(ac, "CategoryTradeTax/RateApplicablePercent"), default=0.0)

            discounts.append(DocumentDiscount(
                reason=reason,
                percentage=pct,
                amount=amt,
                charge_indicator=is_chg,
                tax_category_code=tax_cat,
                tax_percent=tax_pct,
                base_amount=base_amt
            ))

    # Tax Breakdown (ApplicableTradeTax)
    tax_breakdown: List[TaxSummaryItem] = []
    vat_exemption_reason = None
    vat_exemption_reason_code = None

    if stl is not None:
        for att in stl.findall("ApplicableTradeTax"):
            basis = _parse_float(_get_text(att, "BasisAmount"))
            amt = _parse_float(_get_text(att, "CalculatedAmount"))
            t_cat = _get_text(att, "CategoryCode") or "S"
            t_pct = _parse_float(_get_text(att, "RateApplicablePercent"), default=0.0)
            ex_reason = _get_text(att, "ExemptionReason")
            ex_code = _get_text(att, "ExemptionReasonCode")

            if ex_reason and not vat_exemption_reason:
                vat_exemption_reason = ex_reason
            if ex_code and not vat_exemption_reason_code:
                vat_exemption_reason_code = ex_code

            tax_breakdown.append(TaxSummaryItem(
                tax_category_code=t_cat,
                tax_percent=t_pct,
                basis_amount=basis,
                tax_amount=amt,
                exemption_reason=ex_reason,
                exemption_reason_code=ex_code
            ))

    # Monetary Summation (SpecifiedTradeSettlementHeaderMonetarySummation)
    mon = stl.find("SpecifiedTradeSettlementHeaderMonetarySummation") if stl is not None else None
    line_net_total = _parse_float(_get_text(mon, "LineTotalAmount"))
    extracted_tax_total = _parse_float(_get_text(mon, "TaxTotalAmount"))
    grand_total = _parse_float(_get_text(mon, "GrandTotalAmount"))
    due_payable_amount = _parse_float(_get_text(mon, "DuePayableAmount"), default=grand_total)
    prepaid_amount = _parse_float(_get_text(mon, "TotalPrepaidAmount"), default=0.0)

    # Line Items (IncludedSupplyChainTradeLineItem)
    items: List[InvoiceLineItem] = []
    line_elements = tx.findall("IncludedSupplyChainTradeLineItem")
    calculated_line_net = 0.0

    for idx, l_el in enumerate(line_elements, start=1):
        line_id = _get_text(l_el, "AssociatedDocumentLineDocument/LineID") or str(idx)

        # Product
        prod = l_el.find("SpecifiedTradeProduct")
        item_name = "Item"
        description = None
        seller_item_id = None
        buyer_item_id = None
        standard_item_id = None
        standard_item_id_scheme = "0160"

        if prod is not None:
            item_name = _get_text(prod, "Name") or "Item"
            description = _get_text(prod, "Description")
            seller_item_id = _get_text(prod, "SellerAssignedID")
            buyer_item_id = _get_text(prod, "BuyerAssignedID")
            std_el = prod.find("GlobalID")
            if std_el is not None:
                standard_item_id = std_el.text.strip() if std_el.text else None
                standard_item_id_scheme = std_el.attrib.get("schemeID", "0160")

        # Agreement / Pricing
        agr_line = l_el.find("SpecifiedLineTradeAgreement")
        unit_price = _parse_float(_get_text(agr_line, "NetPriceProductTradePrice/ChargeAmount"))
        price_base_qty = 1.0
        price_base_unit = None
        base_qty_el = agr_line.find("NetPriceProductTradePrice/BasisQuantity") if agr_line is not None else None
        if base_qty_el is not None:
            price_base_qty = _parse_float(base_qty_el.text, default=1.0)
            price_base_unit = base_qty_el.attrib.get("unitCode")

        order_line_ref = _get_text(agr_line, "BuyerOrderReferencedDocument/LineID") if agr_line is not None else None

        # Delivery / Quantity
        deliv_line = l_el.find("SpecifiedLineTradeDelivery")
        qty_el = deliv_line.find("BilledQuantity") if deliv_line is not None else None
        quantity = 1.0
        unit_code = "C62"
        if qty_el is not None:
            quantity = _parse_float(qty_el.text, default=1.0)
            unit_code = qty_el.attrib.get("unitCode", "C62")

        # Settlement / Line Total & Taxes
        stl_line = l_el.find("SpecifiedLineTradeSettlement")
        line_total_amount = _parse_float(_get_text(stl_line, "SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount"))
        calculated_line_net += line_total_amount

        tax_cat = _get_text(stl_line, "ApplicableTradeTax/CategoryCode") or "S"
        tax_pct = _parse_float(_get_text(stl_line, "ApplicableTradeTax/RateApplicablePercent"), default=0.0)

        # Line allowances / charges
        line_allowances: List[LineAllowanceCharge] = []
        discount_amount = 0.0
        discount_percent = None

        if stl_line is not None:
            for lac in stl_line.findall("SpecifiedTradeAllowanceCharge"):
                is_chg = (_get_text(lac, "ChargeIndicator/Indicator") or "").lower() == "true"
                lac_amt = _parse_float(_get_text(lac, "ActualAmount"))
                lac_reason = _get_text(lac, "Reason")
                lac_pct = _parse_float(_get_text(lac, "CalculationPercent")) if _get_text(lac, "CalculationPercent") else None
                lac_base = _parse_float(_get_text(lac, "BasisAmount")) if _get_text(lac, "BasisAmount") else None

                if not is_chg and discount_amount == 0.0:
                    discount_amount = lac_amt
                    discount_percent = lac_pct

                line_allowances.append(LineAllowanceCharge(
                    charge_indicator=is_chg,
                    amount=lac_amt,
                    percentage=lac_pct,
                    base_amount=lac_base,
                    reason=lac_reason
                ))

        items.append(InvoiceLineItem(
            line_id=line_id,
            name=item_name,
            description=description,
            quantity=quantity,
            unit_code=unit_code,
            unit_price=unit_price,
            line_total_amount=line_total_amount,
            tax_category_code=tax_cat,
            tax_percent=tax_pct,
            discount_amount=discount_amount,
            discount_percent=discount_percent,
            seller_item_id=seller_item_id,
            buyer_item_id=buyer_item_id,
            standard_item_id=standard_item_id,
            standard_item_id_scheme=standard_item_id_scheme,
            order_line_reference=order_line_ref,
            price_base_quantity=price_base_qty,
            price_base_unit=price_base_unit,
            allowances_charges=line_allowances
        ))

    if not line_net_total and calculated_line_net:
        line_net_total = calculated_line_net
    if not grand_total:
        grand_total = line_net_total + extracted_tax_total
    if not due_payable_amount:
        due_payable_amount = grand_total - prepaid_amount

    return InvoiceData(
        invoice_number=invoice_number,
        issue_date=issue_date,
        due_date=due_date,
        currency=currency,
        invoice_type_code=invoice_type_code,
        document_format="zugferd",
        buyer_reference=buyer_reference,
        purchase_order_number=po_number,
        purchase_order_date=po_date,
        sales_order_number=sales_order_num,
        cost_center=cost_center,
        contract_reference=contract_ref,
        despatch_advice_reference=despatch_id,
        delivery_date=deliv_date,
        notes=notes,
        invoice_notes=notes,
        preceding_invoice_number=preceding_num,
        preceding_invoice_date=preceding_date,
        service_period_start=service_period_start,
        service_period_end=service_period_end,
        prepaid_amount=prepaid_amount,
        discounts=discounts,
        vat_exemption_reason=vat_exemption_reason,
        vat_exemption_reason_code=vat_exemption_reason_code,
        seller=seller,
        buyer=buyer,
        delivery=delivery_obj,
        payment=payment,
        factoring_payee=factoring_payee,
        items=items,
        tax_breakdown=tax_breakdown,
        line_net_total=line_net_total,
        tax_total=extracted_tax_total,
        grand_total=grand_total,
        due_payable_amount=due_payable_amount,
        confidence_scores=FieldConfidenceScores()
    )


def detect_invoice_format(xml_content: str) -> str:
    """
    Detect whether XML is:
    - 'eslog': Slovenian e-SLOG 2.0 (urn:eslog:2.00 or <M_INVOIC>)
    - 'ubl': OASIS UBL 2.1 (urn:oasis:names:specification:ubl or <Invoice / <CreditNote with cac/cbc)
    - 'cii': UN/CEFACT CII (CrossIndustryInvoice or urn:un:unece:uncefact:data:standard:CrossIndustryInvoice)
    """
    # Quick snippet inspection
    head = xml_content[:2000]
    
    if "urn:eslog:2.00" in xml_content or "<M_INVOIC" in xml_content or "S_BGM" in xml_content:
        return "eslog"
    elif "CrossIndustryInvoice" in head or "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice" in head or "rsm:CrossIndustryInvoice" in head:
        return "cii"
    elif "urn:oasis:names:specification:ubl" in head or ("<Invoice" in head and ("cac:" in head or "cbc:" in head or "Invoice-2" in head)) or ("<CreditNote" in head and ("cac:" in head or "cbc:" in head)):
        return "ubl"
    
    # Fallback to general scan
    if "CrossIndustryInvoice" in xml_content or "rsm:CrossIndustryInvoice" in xml_content:
        return "cii"
    elif "urn:oasis:names:specification:ubl" in xml_content or "<Invoice" in xml_content:
        return "ubl"
    elif "urn:eslog" in xml_content:
        return "eslog"

    return "unknown"


def parse_any_invoice_xml(xml_content_or_path: str) -> InvoiceData:
    """
    Universal XML parser entrypoint.
    Inspects root element and namespaces of incoming XML (file path or raw string),
    dispatches to the corresponding parser, and returns a populated InvoiceData model.
    """
    if os.path.exists(xml_content_or_path):
        with open(xml_content_or_path, "r", encoding="utf-8", errors="ignore") as f:
            raw_xml = f.read()
    else:
        raw_xml = xml_content_or_path

    fmt = detect_invoice_format(raw_xml)

    if fmt == "eslog":
        return parse_eslog2_xml(raw_xml)
    elif fmt == "ubl":
        return parse_ubl_xml(raw_xml)
    elif fmt == "cii":
        return parse_cii_xml(raw_xml)
    else:
        # Try best effort attempt: If CII elements present, try CII; else if UBL, try UBL; else try eslog
        if "CrossIndustryInvoice" in raw_xml or "IncludedSupplyChainTradeLineItem" in raw_xml:
            return parse_cii_xml(raw_xml)
        elif "InvoiceLine" in raw_xml or "CreditNoteLine" in raw_xml or "LegalMonetaryTotal" in raw_xml:
            return parse_ubl_xml(raw_xml)
        elif "M_INVOIC" in raw_xml:
            return parse_eslog2_xml(raw_xml)
        else:
            raise ValueError("Neveljavna XML datoteka ali neprepoznana shema (podprti so e-SLOG 2.0, UBL 2.1 in Factur-X/CII).")
