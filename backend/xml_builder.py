import re
from datetime import datetime
from xml.sax.saxutils import escape
from backend.models import InvoiceData

def clean_date(d_str: str) -> str:
    """Format any date string as YYYYMMDD for CII DateTimeString format 102."""
    if not d_str:
        return datetime.now().strftime("%Y%m%d")
    digits = re.sub(r"[^\d]", "", d_str)
    if len(digits) == 8:
        # Check if dd.mm.yyyy or yyyymmdd
        if d_str.find(".") != -1:
            parts = [p.strip() for p in d_str.split(".") if p.strip()]
            if len(parts) == 3 and len(parts[2]) == 4:
                return f"{parts[2]}{int(parts[1]):02d}{int(parts[0]):02d}"
        return digits
    elif len(digits) >= 8 and "-" in d_str:
        parts = [p.strip() for p in d_str.split("-") if p.strip()]
        if len(parts) == 3 and len(parts[0]) == 4:
            return f"{parts[0]}{int(parts[1]):02d}{int(parts[2]):02d}"
    return datetime.now().strftime("%Y%m%d")

def generate_facturx_xml(inv: InvoiceData, profile: str = "EN16931") -> str:
    """
    Generate compliant factur-x.xml (ZUGFeRD 2.x / UN/CEFACT CII 16B).
    Default guideline: urn:cen.eu:en16931:2017
    """
    guideline_id = "urn:cen.eu:en16931:2017" if profile == "EN16931" else "urn:factur-x.eu:1p0:basic"
    issue_date_formatted = clean_date(inv.issue_date)
    due_date_formatted = clean_date(inv.due_date) if inv.due_date else None
    
    # Seller cleanups
    s_vat = inv.seller.vat_id.replace(" ", "").upper() if inv.seller.vat_id else ""
    b_vat = inv.buyer.vat_id.replace(" ", "").upper() if inv.buyer.vat_id else ""
    s_iban = inv.payment.iban.replace(" ", "").upper() if inv.payment.iban else ""
    s_bic = inv.payment.bic.replace(" ", "").upper() if inv.payment.bic else ""

    buyer_ref = inv.buyer_reference or "N/A"
    
    # Notes XML
    notes_xml = ""
    for note in inv.notes:
        if note and note.strip():
            notes_xml += f"""    <ram:IncludedNote>
      <ram:Content>{escape(note.strip())}</ram:Content>
    </ram:IncludedNote>\n"""
    if not notes_xml:
        notes_xml = """    <ram:IncludedNote>
      <ram:Content>Invoice processed with ZUGFeRD PDF/A-3 Generator</ram:Content>
    </ram:IncludedNote>\n"""

    # Line Items XML
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
        <ram:BilledQuantity unitCode="{item.unit_code}">{item.quantity:.4f}</ram:BilledQuantity>
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

    # Tax breakdown XML
    tax_breakdown_xml = ""
    if not inv.tax_breakdown:
        # Default single breakdown from totals
        tax_category = "S" if inv.tax_total > 0 else "AE"
        tax_pct = round((inv.tax_total / inv.line_net_total * 100), 2) if inv.line_net_total > 0 and inv.tax_total > 0 else 0.0
        tax_breakdown_xml = f"""      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>{inv.tax_total:.2f}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>{inv.line_net_total:.2f}</ram:BasisAmount>
        <ram:CategoryCode>{tax_category}</ram:CategoryCode>
        <ram:RateApplicablePercent>{tax_pct:.2f}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>\n"""
    else:
        for tax in inv.tax_breakdown:
            exemption_xml = f"<ram:ExemptionReason>{escape(tax.exemption_reason)}</ram:ExemptionReason>\n        " if tax.exemption_reason else ""
            tax_breakdown_xml += f"""      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>{tax.tax_amount:.2f}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        {exemption_xml}<ram:BasisAmount>{tax.basis_amount:.2f}</ram:BasisAmount>
        <ram:CategoryCode>{tax.tax_category_code}</ram:CategoryCode>
        <ram:RateApplicablePercent>{tax.tax_percent:.2f}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>\n"""

    # Payment Means XML
    payment_means_xml = ""
    if s_iban:
        bic_xml = f"<ram:BICID>{s_bic}</ram:BICID>" if s_bic else ""
        payment_means_xml = f"""      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>{inv.payment.payment_means_code or "58"}</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>{s_iban}</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>
        <ram:PayeeSpecifiedCreditorFinancialInstitution>
          {bic_xml}
        </ram:PayeeSpecifiedCreditorFinancialInstitution>
      </ram:SpecifiedTradeSettlementPaymentMeans>\n"""

    # Payment terms XML
    payment_terms_xml = ""
    if inv.payment.payment_terms or due_date_formatted:
        desc_xml = f"<ram:Description>{escape(inv.payment.payment_terms)}</ram:Description>\n        " if inv.payment.payment_terms else ""
        due_xml = f"""<ram:DueDateDateTime>
          <udt:DateTimeString format="102">{due_date_formatted}</udt:DateTimeString>
        </ram:DueDateDateTime>\n        """ if due_date_formatted else ""
        payment_terms_xml = f"""      <ram:SpecifiedTradePaymentTerms>
        {desc_xml}{due_xml}
      </ram:SpecifiedTradePaymentTerms>\n"""

    # Seller tax IDs
    seller_tax_xml = ""
    if s_vat:
        seller_tax_xml += f"""        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">{s_vat}</ram:ID>
        </ram:SpecifiedTaxRegistration>\n"""
    if inv.seller.tax_registration_id:
        seller_tax_xml += f"""        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="FC">{escape(inv.seller.tax_registration_id)}</ram:ID>
        </ram:SpecifiedTaxRegistration>\n"""

    # Buyer tax IDs
    buyer_tax_xml = ""
    if b_vat:
        buyer_tax_xml += f"""        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">{b_vat}</ram:ID>
        </ram:SpecifiedTaxRegistration>\n"""

    # Seller contact
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
      <ram:SellerTradeParty>
        <ram:Name>{escape(inv.seller.name)}</ram:Name>
{seller_contact_xml}        <ram:PostalTradeAddress>
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
      <ram:InvoiceCurrencyCode>{inv.currency or "EUR"}</ram:InvoiceCurrencyCode>
{payment_means_xml}{tax_breakdown_xml}{payment_terms_xml}      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>{inv.line_net_total:.2f}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>{inv.line_net_total:.2f}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="{inv.currency or "EUR"}">{inv.tax_total:.2f}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>{inv.grand_total:.2f}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>{inv.due_payable_amount:.2f}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
"""
    return xml
