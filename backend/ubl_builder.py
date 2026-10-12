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

    # Seller EndpointID (BT-34) for Peppol routing (falls back to VAT with 9948 / 9957 / etc)
    s_endpoint_xml = ""
    if s_vat:
        scheme = "9957" if s_vat.startswith("FR") else ("9930" if s_vat.startswith("DE") else "9948")
        if s_vat.startswith("SI"):
            scheme = "9948"  # Slovenian Chamber of Commerce / VAT
        s_endpoint_xml = f"      <cbc:EndpointID schemeID=\"{scheme}\">{escape(s_vat)}</cbc:EndpointID>\n"

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
    if b_vat:
        scheme = "9957" if b_vat.startswith("FR") else ("9930" if b_vat.startswith("DE") else "9948")
        b_endpoint_xml = f"      <cbc:EndpointID schemeID=\"{scheme}\">{escape(b_vat)}</cbc:EndpointID>\n"

    # Delivery (BG-13 / BT-70..BT-80)
    delivery_xml = ""
    if inv.delivery and (inv.delivery.recipient_name or inv.delivery.street or inv.delivery.delivery_date):
        deliv_date_elem = ""
        if inv.delivery.delivery_date:
            d_clean = clean_ubl_date(inv.delivery.delivery_date)
            deliv_date_elem = f"    <cbc:ActualDeliveryDate>{d_clean}</cbc:ActualDeliveryDate>\n"

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
{deliv_date_elem}{deliv_party_elem}  </cac:Delivery>\n"""

    # Payment Means (BG-16 / BT-81..BT-86)
    payment_means_xml = ""
    p_code = inv.payment.payment_means_code or "58"
    # Slovenian Sklic / Remittance Reference mapping:
    # Model and reference (e.g. SI00 123456 or invoice number)
    sklic_ref = escape(inv.invoice_number or "")
    if s_iban:
        payment_means_xml = f"""  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>{p_code}</cbc:PaymentMeansCode>
    <cbc:PaymentID>{sklic_ref}</cbc:PaymentID>
    <cac:PayeeFinancialAccount>
      <cbc:ID>{s_iban}</cbc:ID>
    </cac:PayeeFinancialAccount>
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
            pct_tag = f"    <cbc:MultiplierFactorNumeric>{disc.percentage:.2f}</cbc:MultiplierFactorNumeric>\n" if disc.percentage else ""
            allowance_charges_xml += f"""  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>{indicator_txt}</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>{reason_txt}</cbc:AllowanceChargeReason>
{pct_tag}    <cbc:Amount currencyID="{currency}">{amt:.2f}</cbc:Amount>
    <cac:TaxCategory>
      <cbc:ID>{dom_tax_cat}</cbc:ID>
      <cbc:Percent>{dom_tax_pct:.2f}</cbc:Percent>
      <cac:TaxScheme>
        <cbc:ID>VAT</cbc:ID>
      </cac:TaxScheme>
    </cac:TaxCategory>
  </cac:AllowanceCharge>\n"""

    # Tax Total & Subtotals (BG-22 & BG-23)
    tax_subtotals_xml = ""
    for t_item in inv.tax_breakdown:
        cat_id = t_item.tax_category_code or "S"
        exemp_reason_tag = ""
        if cat_id in ["E", "AE", "K", "G"] and (t_item.exemption_reason or inv.vat_exemption_reason):
            reason_str = escape(t_item.exemption_reason or inv.vat_exemption_reason)
            exemp_reason_tag = f"        <cbc:TaxExemptionReason>{reason_str}</cbc:TaxExemptionReason>\n"

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

    # Line Items (BG-25)
    lines_xml = ""
    for idx, item in enumerate(inv.items, start=1):
        line_num = item.line_id or str(idx)
        u_code = item.unit_code or "C62"
        cat_id = item.tax_category_code or "S"
        item_tax_pct = item.tax_percent if item.tax_percent is not None else 22.0

        line_allowance_xml = ""
        if item.discount_amount and item.discount_amount > 0:
            line_allowance_xml = f"""    <cac:PriceAllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:Amount currencyID="{currency}">{item.discount_amount:.2f}</cbc:Amount>
    </cac:PriceAllowanceCharge>\n"""

        lines_xml += f"""  <cac:InvoiceLine>
    <cbc:ID>{line_num}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="{escape(u_code)}">{item.quantity:.4f}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="{currency}">{item.line_total_amount:.2f}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>{escape(item.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>{cat_id}</cbc:ID>
        <cbc:Percent>{item_tax_pct:.2f}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="{currency}">{item.unit_price:.4f}</cbc:PriceAmount>
{line_allowance_xml}    </cac:Price>
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
{period_xml}{order_ref_xml}{billing_ref_xml}{despatch_xml}  <cac:AccountingSupplierParty>
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
{s_tax_scheme_xml}      <cac:PartyLegalEntity>
        <cbc:RegistrationName>{escape(inv.seller.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
{s_contact_xml}    </cac:Party>
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
{b_tax_scheme_xml}      <cac:PartyLegalEntity>
        <cbc:RegistrationName>{escape(inv.buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
{b_contact_xml}    </cac:Party>
  </cac:AccountingCustomerParty>
{delivery_xml}{payment_means_xml}{payment_terms_xml}{allowance_charges_xml}{tax_total_xml}{monetary_total_xml}{lines_xml}</Invoice>
"""
    return ubl_xml
