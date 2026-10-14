"""
e-SLOG 2.0 (BizBox / GZS) XML Builder
Generates national Slovenian e-SLOG 2.0 invoices conforming to schema:
<Invoice xmlns="urn:eslog:2.00">
  <M_INVOIC Id="data">
    ... EDIFACT INVOIC D01B XML elements ...
  </M_INVOIC>
</Invoice>
"""
import re
from xml.sax.saxutils import escape
from backend.models import InvoiceData

def _fmt_date(d_str: str) -> str:
    """Format date to YYYY-MM-DD for e-SLOG 2.0 DTM/D_2380."""
    if not d_str:
        return ""
    d_clean = str(d_str).strip()
    digits = re.sub(r"[^\d]", "", d_clean)
    if len(digits) == 8:
        if "." in d_clean:
            parts = [p.strip() for p in d_clean.split(".") if p.strip()]
            if len(parts) == 3 and len(parts[2]) == 4:
                return f"{parts[2]}-{int(parts[1]):02d}-{int(parts[0]):02d}"
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:]}"
    elif len(digits) >= 8 and "-" in d_clean:
        parts = [p.strip() for p in d_clean.split("-") if p.strip()]
        if len(parts) == 3 and len(parts[0]) == 4:
            return f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
    return d_clean[:10]

def _fmt_num(val, decimals: int = 2) -> str:
    """Format numeric string with fixed decimal places."""
    try:
        f = float(val or 0.0)
        return f"{f:.{decimals}f}"
    except (ValueError, TypeError):
        return f"0.{'0'*decimals}"

def generate_eslog_bizbox_xml(inv: InvoiceData) -> str:
    """
    Generate national Slovenian e-SLOG 2.0 (urn:eslog:2.00) XML.
    Conforms to BizBox / GZS validator specifications.
    """
    inv_num = escape(inv.invoice_number or "INV-001")
    doc_type = str(inv.invoice_type_code or "380")
    currency = escape(inv.currency or "EUR")
    issue_date = _fmt_date(inv.issue_date)
    due_date = _fmt_date(inv.due_date)
    delivery_date = _fmt_date(inv.delivery_date or (inv.delivery.delivery_date if inv.delivery else None))

    lines = []
    lines.append('<?xml version="1.0" encoding="UTF-8"?>')
    lines.append('<Invoice xmlns="urn:eslog:2.00" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">')
    lines.append('  <M_INVOIC Id="data">')

    # S_UNH (Header)
    lines.append('    <S_UNH>')
    lines.append(f'      <D_0062>{inv_num}</D_0062>')
    lines.append('      <C_S009>')
    lines.append('        <D_0065>INVOIC</D_0065>')
    lines.append('        <D_0052>D</D_0052>')
    lines.append('        <D_0054>01B</D_0054>')
    lines.append('        <D_0051>UN</D_0051>')
    lines.append('      </C_S009>')
    lines.append('    </S_UNH>')

    # S_BGM (Document type & number)
    lines.append('    <S_BGM>')
    lines.append('      <C_C002>')
    lines.append(f'        <D_1001>{doc_type}</D_1001>')
    lines.append('      </C_C002>')
    lines.append('      <C_C106>')
    lines.append(f'        <D_1004>{inv_num}</D_1004>')
    lines.append('      </C_C106>')
    lines.append('    </S_BGM>')

    # S_DTM (Issue date, Tax point, Delivery date, Service period)
    if issue_date:
        lines.append('    <S_DTM>')
        lines.append('      <C_C507>')
        lines.append('        <D_2005>137</D_2005>')
        lines.append(f'        <D_2380>{issue_date}</D_2380>')
        lines.append('      </C_C507>')
        lines.append('    </S_DTM>')
        # Tax point date (131)
        lines.append('    <S_DTM>')
        lines.append('      <C_C507>')
        lines.append('        <D_2005>131</D_2005>')
        lines.append(f'        <D_2380>{issue_date}</D_2380>')
        lines.append('      </C_C507>')
        lines.append('    </S_DTM>')

    if delivery_date:
        lines.append('    <S_DTM>')
        lines.append('      <C_C507>')
        lines.append('        <D_2005>35</D_2005>')
        lines.append(f'        <D_2380>{delivery_date}</D_2380>')
        lines.append('      </C_C507>')
        lines.append('    </S_DTM>')

    srv_start = _fmt_date(inv.service_period_start)
    if srv_start:
        lines.append('    <S_DTM>')
        lines.append('      <C_C507>')
        lines.append('        <D_2005>167</D_2005>')
        lines.append(f'        <D_2380>{srv_start}</D_2380>')
        lines.append('      </C_C507>')
        lines.append('    </S_DTM>')

    srv_end = _fmt_date(inv.service_period_end)
    if srv_end:
        lines.append('    <S_DTM>')
        lines.append('      <C_C507>')
        lines.append('        <D_2005>168</D_2005>')
        lines.append(f'        <D_2380>{srv_end}</D_2380>')
        lines.append('      </C_C507>')
        lines.append('    </S_DTM>')

    # Free text notes & payment terms (S_FTX)
    # Payment terms text (AAB)
    pmt_terms = (inv.payment.payment_terms or "").strip()
    if pmt_terms:
        lines.append('    <S_FTX>')
        lines.append('      <D_4451>AAB</D_4451>')
        lines.append('      <C_C108>')
        lines.append(f'        <D_4440>{escape(pmt_terms[:70])}</D_4440>')
        if len(pmt_terms) > 70:
            lines.append(f'        <D_4440_2>{escape(pmt_terms[70:140])}</D_4440_2>')
        lines.append('      </C_C108>')
        lines.append('    </S_FTX>')

    # Seller legal info (REG)
    legal_info = (getattr(inv.seller, "legal_info", None) or "").strip()
    if legal_info:
        lines.append('    <S_FTX>')
        lines.append('      <D_4451>REG</D_4451>')
        lines.append('      <C_C108>')
        lines.append(f'        <D_4440>{escape(legal_info[:70])}</D_4440>')
        lines.append('      </C_C108>')
        lines.append('    </S_FTX>')

    # General notes (GEN)
    all_notes = list(inv.notes or []) + list(inv.invoice_notes or [])
    seen_notes = set()
    for note in all_notes:
        n_str = str(note).strip()
        if n_str and n_str not in seen_notes:
            seen_notes.add(n_str)
            lines.append('    <S_FTX>')
            lines.append('      <D_4451>GEN</D_4451>')
            lines.append('      <C_C108>')
            lines.append(f'        <D_4440>{escape(n_str[:70])}</D_4440>')
            if len(n_str) > 70:
                lines.append(f'        <D_4440_2>{escape(n_str[70:140])}</D_4440_2>')
            lines.append('      </C_C108>')
            lines.append('    </S_FTX>')

    # Exemption clause (AGM)
    exemption_reason = (inv.vat_exemption_reason or "").strip()
    exemption_code = (getattr(inv, "vat_exemption_reason_code", None) or "").strip()
    if exemption_reason or exemption_code:
        lines.append('    <S_FTX>')
        lines.append('      <D_4451>AGM</D_4451>')
        if exemption_code:
            lines.append('      <C_C107>')
            lines.append(f'        <D_4441>{escape(exemption_code)}</D_4441>')
            lines.append('      </C_C107>')
        if exemption_reason:
            lines.append('      <C_C108>')
            lines.append(f'        <D_4440>{escape(exemption_reason[:70])}</D_4440>')
            lines.append('      </C_C108>')
        lines.append('    </S_FTX>')

    # Document references (G_SG1)
    if inv.project_reference:
        lines.append('    <G_SG1>')
        lines.append('      <S_RFF>')
        lines.append('        <C_C506>')
        lines.append('          <D_1153>AEP</D_1153>')
        lines.append(f'          <D_1154>{escape(inv.project_reference)}</D_1154>')
        lines.append('        </C_C506>')
        lines.append('      </S_RFF>')
        lines.append('    </G_SG1>')

    if inv.contract_reference:
        lines.append('    <G_SG1>')
        lines.append('      <S_RFF>')
        lines.append('        <C_C506>')
        lines.append('          <D_1153>CT</D_1153>')
        lines.append(f'          <D_1154>{escape(inv.contract_reference)}</D_1154>')
        lines.append('        </C_C506>')
        lines.append('      </S_RFF>')
        lines.append('    </G_SG1>')

    if inv.purchase_order_number:
        lines.append('    <G_SG1>')
        lines.append('      <S_RFF>')
        lines.append('        <C_C506>')
        lines.append('          <D_1153>ON</D_1153>')
        lines.append(f'          <D_1154>{escape(inv.purchase_order_number)}</D_1154>')
        lines.append('        </C_C506>')
        lines.append('      </S_RFF>')
        lines.append('    </G_SG1>')

    if inv.sales_order_number:
        lines.append('    <G_SG1>')
        lines.append('      <S_RFF>')
        lines.append('        <C_C506>')
        lines.append('          <D_1153>VN</D_1153>')
        lines.append(f'          <D_1154>{escape(inv.sales_order_number)}</D_1154>')
        lines.append('        </C_C506>')
        lines.append('      </S_RFF>')
        lines.append('    </G_SG1>')

    if inv.despatch_advice_reference:
        lines.append('    <G_SG1>')
        lines.append('      <S_RFF>')
        lines.append('        <C_C506>')
        lines.append('          <D_1153>AAK</D_1153>')
        lines.append(f'          <D_1154>{escape(inv.despatch_advice_reference)}</D_1154>')
        lines.append('        </C_C506>')
        lines.append('      </S_RFF>')
        lines.append('    </G_SG1>')

    # Preceding invoice reference (OI)
    if inv.preceding_invoice_number:
        lines.append('    <G_SG1>')
        lines.append('      <S_RFF>')
        lines.append('        <C_C506>')
        lines.append('          <D_1153>OI</D_1153>')
        lines.append(f'          <D_1154>{escape(inv.preceding_invoice_number)}</D_1154>')
        lines.append('        </C_C506>')
        lines.append('      </S_RFF>')
        if inv.preceding_invoice_date:
            lines.append('      <S_DTM>')
            lines.append('        <C_C507>')
            lines.append('          <D_2005>384</D_2005>')
            lines.append(f'          <D_2380>{_fmt_date(inv.preceding_invoice_date)}</D_2380>')
            lines.append('        </C_C507>')
            lines.append('      </S_DTM>')
        lines.append('    </G_SG1>')

    # Remittance reference / Sklic (PQ)
    pmt_ref = (inv.payment.payment_reference or "").strip()
    if pmt_ref:
        lines.append('    <G_SG1>')
        lines.append('      <S_RFF>')
        lines.append('        <C_C506>')
        lines.append('          <D_1153>PQ</D_1153>')
        lines.append(f'          <D_1154>{escape(pmt_ref)}</D_1154>')
        lines.append('        </C_C506>')
        lines.append('      </S_RFF>')
        lines.append('    </G_SG1>')

    # G_SG2: BUYER (BY)
    buyer = inv.buyer
    lines.append('    <G_SG2>')
    lines.append('      <S_NAD>')
    lines.append('        <D_3035>BY</D_3035>')
    b_endpoint = (buyer.endpoint_id or "").strip()
    if b_endpoint:
        lines.append('        <C_C082>')
        lines.append(f'          <D_3039>{escape(b_endpoint)}</D_3039>')
        lines.append(f'          <D_1131>{escape(buyer.endpoint_scheme or "0088")}</D_1131>')
        lines.append('        </C_C082>')
    lines.append('        <C_C080>')
    lines.append(f'          <D_3036>{escape(buyer.name or "Kupac")}</D_3036>')
    lines.append('        </C_C080>')
    if buyer.street:
        lines.append('        <C_C059>')
        lines.append(f'          <D_3042>{escape(buyer.street)}</D_3042>')
        lines.append('        </C_C059>')
    if buyer.city:
        lines.append(f'        <D_3164>{escape(buyer.city)}</D_3164>')
    if buyer.postcode:
        lines.append(f'        <D_3251>{escape(buyer.postcode)}</D_3251>')
    lines.append(f'        <D_3207>{escape(buyer.country_code or "SI")}</D_3207>')
    lines.append('      </S_NAD>')

    # Buyer VAT (VA) & Tax/Matica (0199)
    if buyer.vat_id:
        lines.append('      <G_SG3>')
        lines.append('        <S_RFF>')
        lines.append('          <C_C506>')
        lines.append('            <D_1153>VA</D_1153>')
        lines.append(f'            <D_1154>{escape(buyer.vat_id)}</D_1154>')
        lines.append('          </C_C506>')
        lines.append('        </S_RFF>')
        lines.append('      </G_SG3>')

    b_tax = (getattr(buyer, "tax_number", None) or buyer.tax_registration_id or "").strip()
    if b_tax:
        lines.append('      <G_SG3>')
        lines.append('        <S_RFF>')
        lines.append('          <C_C506>')
        lines.append('            <D_1153>0199</D_1153>')
        lines.append(f'            <D_1154>{escape(b_tax)}</D_1154>')
        lines.append('          </C_C506>')
        lines.append('        </S_RFF>')
        lines.append('      </G_SG3>')

    if inv.buyer_reference:
        lines.append('      <G_SG3>')
        lines.append('        <S_RFF>')
        lines.append('          <C_C506>')
        lines.append('            <D_1153>CR</D_1153>')
        lines.append(f'            <D_1154>{escape(inv.buyer_reference)}</D_1154>')
        lines.append('          </C_C506>')
        lines.append('        </S_RFF>')
        lines.append('      </G_SG3>')

    # Buyer contact
    if buyer.contact_name or buyer.contact_email or buyer.contact_phone:
        lines.append('      <G_SG5>')
        lines.append('        <S_CTA>')
        lines.append('          <D_3139>PD</D_3139>')
        if buyer.contact_name:
            lines.append('          <C_C056>')
            lines.append(f'            <D_3412>{escape(buyer.contact_name)}</D_3412>')
            lines.append('          </C_C056>')
        lines.append('        </S_CTA>')
        if buyer.contact_email:
            lines.append('        <S_COM>')
            lines.append('          <C_C076>')
            lines.append(f'            <D_3148>{escape(buyer.contact_email)}</D_3148>')
            lines.append('            <D_3155>EM</D_3155>')
            lines.append('          </C_C076>')
            lines.append('        </S_COM>')
        if buyer.contact_phone:
            lines.append('        <S_COM>')
            lines.append('          <C_C076>')
            lines.append(f'            <D_3148>{escape(buyer.contact_phone)}</D_3148>')
            lines.append('            <D_3155>TE</D_3155>')
            lines.append('          </C_C076>')
            lines.append('        </S_COM>')
        lines.append('      </G_SG5>')
    lines.append('    </G_SG2>')

    # G_SG2: SELLER (SE)
    seller = inv.seller
    lines.append('    <G_SG2>')
    lines.append('      <S_NAD>')
    lines.append('        <D_3035>SE</D_3035>')
    s_ident = (seller.seller_identifier or seller.endpoint_id or "").strip()
    if s_ident:
        lines.append('        <C_C082>')
        lines.append(f'          <D_3039>{escape(s_ident)}</D_3039>')
        lines.append(f'          <D_1131>{escape(seller.endpoint_scheme or "0088")}</D_1131>')
        lines.append('        </C_C082>')
    lines.append('        <C_C080>')
    lines.append(f'          <D_3036>{escape(seller.name or "Prodajalec")}</D_3036>')
    lines.append('        </C_C080>')
    if seller.street:
        lines.append('        <C_C059>')
        lines.append(f'          <D_3042>{escape(seller.street)}</D_3042>')
        lines.append('        </C_C059>')
    if seller.city:
        lines.append(f'        <D_3164>{escape(seller.city)}</D_3164>')
    if seller.postcode:
        lines.append(f'        <D_3251>{escape(seller.postcode)}</D_3251>')
    lines.append(f'        <D_3207>{escape(seller.country_code or "SI")}</D_3207>')
    lines.append('      </S_NAD>')

    # Financial account / Bank (S_FII)
    primary_iban = (inv.payment.iban or "").replace(" ", "").strip()
    primary_bic = (inv.payment.bic or "").strip()
    primary_bank = (inv.payment.bank_name or seller.name or "").strip()
    if primary_iban:
        lines.append('      <S_FII>')
        lines.append('        <D_3035>RB</D_3035>')
        lines.append('        <C_C078>')
        lines.append(f'          <D_3194>{escape(primary_iban)}</D_3194>')
        if primary_bank:
            lines.append(f'          <D_3192>{escape(primary_bank)}</D_3192>')
        lines.append('        </C_C078>')
        if primary_bic:
            lines.append('        <C_C088>')
            lines.append(f'          <D_3433>{escape(primary_bic)}</D_3433>')
            lines.append('        </C_C088>')
        lines.append('      </S_FII>')

    # Seller VAT (VA) & Tax/Matica (AHP / 0199) & Court reg (0199)
    if seller.vat_id:
        lines.append('      <G_SG3>')
        lines.append('        <S_RFF>')
        lines.append('          <C_C506>')
        lines.append('            <D_1153>VA</D_1153>')
        lines.append(f'            <D_1154>{escape(seller.vat_id)}</D_1154>')
        lines.append('          </C_C506>')
        lines.append('        </S_RFF>')
        lines.append('      </G_SG3>')

    s_tax = (getattr(seller, "tax_number", None) or seller.tax_registration_id or "").strip()
    if s_tax:
        lines.append('      <G_SG3>')
        lines.append('        <S_RFF>')
        lines.append('          <C_C506>')
        lines.append('            <D_1153>AHP</D_1153>')
        lines.append(f'            <D_1154>{escape(s_tax)}</D_1154>')
        lines.append('          </C_C506>')
        lines.append('        </S_RFF>')
        lines.append('      </G_SG3>')

    s_reg = (getattr(seller, "company_legal_form", None) or seller.company_id or seller.court_registry or "").strip()
    if s_reg:
        lines.append('      <G_SG3>')
        lines.append('        <S_RFF>')
        lines.append('          <C_C506>')
        lines.append('            <D_1153>0199</D_1153>')
        lines.append(f'            <D_1154>{escape(s_reg)}</D_1154>')
        lines.append('          </C_C506>')
        lines.append('        </S_RFF>')
        lines.append('      </G_SG3>')

    # Seller Contact
    if seller.contact_name or seller.contact_email or seller.contact_phone:
        lines.append('      <G_SG5>')
        lines.append('        <S_CTA>')
        lines.append('          <D_3139>SU</D_3139>')
        if seller.contact_name:
            lines.append('          <C_C056>')
            lines.append(f'            <D_3412>{escape(seller.contact_name)}</D_3412>')
            lines.append('          </C_C056>')
        lines.append('        </S_CTA>')
        if seller.contact_phone:
            lines.append('        <S_COM>')
            lines.append('          <C_C076>')
            lines.append(f'            <D_3148>{escape(seller.contact_phone)}</D_3148>')
            lines.append('            <D_3155>TE</D_3155>')
            lines.append('          </C_C076>')
            lines.append('        </S_COM>')
        if seller.contact_email:
            lines.append('        <S_COM>')
            lines.append('          <C_C076>')
            lines.append(f'            <D_3148>{escape(seller.contact_email)}</D_3148>')
            lines.append('            <D_3155>EM</D_3155>')
            lines.append('          </C_C076>')
            lines.append('        </S_COM>')
        lines.append('      </G_SG5>')
    lines.append('    </G_SG2>')

    # G_SG2: DELIVERY / SHIP-TO (DP) if present
    if inv.delivery and (inv.delivery.recipient_name or inv.delivery.street or inv.delivery.location_id):
        deliv = inv.delivery
        lines.append('    <G_SG2>')
        lines.append('      <S_NAD>')
        lines.append('        <D_3035>DP</D_3035>')
        if deliv.location_id:
            lines.append('        <C_C082>')
            lines.append(f'          <D_3039>{escape(deliv.location_id)}</D_3039>')
            lines.append(f'          <D_1131>{escape(getattr(deliv, "location_scheme", None) or "0088")}</D_1131>')
            lines.append('        </C_C082>')
        if deliv.recipient_name:
            lines.append('        <C_C080>')
            lines.append(f'          <D_3036>{escape(deliv.recipient_name)}</D_3036>')
            lines.append('        </C_C080>')
        if deliv.street:
            lines.append('        <C_C059>')
            lines.append(f'          <D_3042>{escape(deliv.street)}</D_3042>')
            lines.append('        </C_C059>')
        if deliv.city:
            lines.append(f'        <D_3164>{escape(deliv.city)}</D_3164>')
        if deliv.postcode:
            lines.append(f'        <D_3251>{escape(deliv.postcode)}</D_3251>')
        lines.append(f'        <D_3207>{escape(deliv.country_code or "SI")}</D_3207>')
        lines.append('      </S_NAD>')
        lines.append('    </G_SG2>')

    # G_SG7: CURRENCY (CUX)
    lines.append('    <G_SG7>')
    lines.append('      <S_CUX>')
    lines.append('        <C_C504>')
    lines.append('          <D_6347>2</D_6347>')
    lines.append(f'          <D_6345>{currency}</D_6345>')
    lines.append('        </C_C504>')
    lines.append('      </S_CUX>')
    lines.append('    </G_SG7>')

    # G_SG8: PAYMENT TERMS & DUE DATE
    lines.append('    <G_SG8>')
    lines.append('      <S_PAT>')
    lines.append('        <D_4279>1</D_4279>')
    lines.append('      </S_PAT>')
    if due_date:
        lines.append('      <S_DTM>')
        lines.append('        <C_C507>')
        lines.append('          <D_2005>13</D_2005>')
        lines.append(f'          <D_2380>{due_date}</D_2380>')
        lines.append('        </C_C507>')
        lines.append('      </S_DTM>')
    pay_means_code = str(inv.payment.payment_means_code or "58")
    lines.append('      <S_PAI>')
    lines.append('        <C_C534>')
    lines.append(f'          <D_4461>{escape(pay_means_code)}</D_4461>')
    lines.append('        </C_C534>')
    lines.append('      </S_PAI>')
    lines.append('    </G_SG8>')

    # G_SG16: DOCUMENT-LEVEL ALLOWANCES & CHARGES
    for disc in (inv.discounts or []):
        is_charge = bool(getattr(disc, "charge_indicator", False))
        alc_type = "C" if is_charge else "A"
        amt = float(disc.amount or 0.0)
        pct = float(disc.percentage) if getattr(disc, "percentage", None) is not None else None
        reason = getattr(disc, "reason", None) or ("Charge" if is_charge else "Discount")

        lines.append('    <G_SG16>')
        lines.append('      <S_ALC>')
        lines.append(f'        <D_5463>{alc_type}</D_5463>')
        lines.append('        <C_C552>')
        lines.append(f'          <D_1230>{escape(reason)}</D_1230>')
        lines.append('        </C_C552>')
        lines.append('      </S_ALC>')
        if pct is not None:
            lines.append('      <G_SG19>')
            lines.append('        <S_PCD>')
            lines.append('          <C_C501>')
            lines.append('            <D_5245>1</D_5245>')
            lines.append(f'            <D_5482>{_fmt_num(pct, 2)}</D_5482>')
            lines.append('          </C_C501>')
            lines.append('        </S_PCD>')
            lines.append('      </G_SG19>')
        lines.append('      <G_SG20>')
        lines.append('        <S_MOA>')
        lines.append('          <C_C516>')
        lines.append(f'            <D_5025>{"23" if is_charge else "204"}</D_5025>')
        lines.append(f'            <D_5004>{_fmt_num(amt, 2)}</D_5004>')
        lines.append('          </C_C516>')
        lines.append('        </S_MOA>')
        lines.append('      </G_SG20>')
        # Tax on allowance/charge
        cat = getattr(disc, "tax_category_code", "S") or "S"
        rate = float(getattr(disc, "tax_percent", 22.0) or 22.0)
        lines.append('      <G_SG22>')
        lines.append('        <S_TAX>')
        lines.append('          <D_5283>7</D_5283>')
        lines.append('          <C_C241><D_5153>VAT</D_5153></C_C241>')
        lines.append('          <C_C243>')
        lines.append(f'            <D_5278>{_fmt_num(rate, 2)}</D_5278>')
        lines.append('          </C_C243>')
        lines.append(f'          <D_5305>{escape(cat)}</D_5305>')
        lines.append('        </S_TAX>')
        lines.append('      </G_SG22>')
        lines.append('    </G_SG16>')

    # G_SG26: LINE ITEMS
    items = inv.items or []
    for idx, item in enumerate(items, start=1):
        line_id = str(item.line_id or idx)
        qty = float(item.quantity or 1.0)
        unit = escape(item.unit_code or "C62")
        unit_price = float(item.unit_price or 0.0)
        line_total = float(item.line_total_amount if item.line_total_amount is not None else (qty * unit_price))
        item_name = escape(item.name or f"Artikel {line_id}")
        item_desc = escape(item.description or "")
        tax_rate = float(item.tax_percent if item.tax_percent is not None else 22.0)
        tax_cat = escape(item.tax_category_code or "S")

        lines.append('    <G_SG26>')
        lines.append('      <S_LIN>')
        lines.append(f'        <D_1082>{line_id}</D_1082>')
        if item.standard_item_id:
            lines.append('        <C_C212>')
            lines.append(f'          <D_7140>{escape(item.standard_item_id)}</D_7140>')
            lines.append(f'          <D_7143>{escape(getattr(item, "standard_item_id_scheme", "0160") or "0160")}</D_7143>')
            lines.append('        </C_C212>')
        lines.append('      </S_LIN>')

        # Article IDs in S_PIA
        if item.seller_item_id:
            lines.append('      <S_PIA>')
            lines.append('        <D_4347>5</D_4347>')
            lines.append('        <C_C212>')
            lines.append(f'          <D_7140>{escape(item.seller_item_id)}</D_7140>')
            lines.append('          <D_7143>SA</D_7143>')
            lines.append('        </C_C212>')
            lines.append('      </S_PIA>')

        if item.buyer_item_id:
            lines.append('      <S_PIA>')
            lines.append('        <D_4347>5</D_4347>')
            lines.append('        <C_C212>')
            lines.append(f'          <D_7140>{escape(item.buyer_item_id)}</D_7140>')
            lines.append('          <D_7143>IN</D_7143>')
            lines.append('        </C_C212>')
            lines.append('      </S_PIA>')

        # Item name and description in S_IMD
        lines.append('      <S_IMD>')
        lines.append('        <D_7077>F</D_7077>')
        lines.append('        <C_C273>')
        lines.append(f'          <D_7008>{item_name[:70]}</D_7008>')
        if len(item_name) > 70:
            lines.append(f'          <D_7008_2>{item_name[70:140]}</D_7008_2>')
        lines.append('        </C_C273>')
        lines.append('      </S_IMD>')

        if item_desc:
            lines.append('      <S_IMD>')
            lines.append('        <D_7077>A</D_7077>')
            lines.append('        <C_C273>')
            lines.append(f'          <D_7008>{item_desc[:70]}</D_7008>')
            if len(item_desc) > 70:
                lines.append(f'          <D_7008_2>{item_desc[70:140]}</D_7008_2>')
            lines.append('        </C_C273>')
            lines.append('      </S_IMD>')

        # Quantity
        lines.append('      <S_QTY>')
        lines.append('        <C_C186>')
        lines.append('          <D_6063>47</D_6063>')
        lines.append(f'          <D_6060>{_fmt_num(qty, 4).rstrip("0").rstrip(".") if "." in _fmt_num(qty, 4) else str(int(qty))}</D_6060>')
        lines.append(f'          <D_6411>{unit}</D_6411>')
        lines.append('        </C_C186>')
        lines.append('      </S_QTY>')

        # Line net total (MOA 203)
        lines.append('      <G_SG27>')
        lines.append('        <S_MOA>')
        lines.append('          <C_C516>')
        lines.append('            <D_5025>203</D_5025>')
        lines.append(f'            <D_5004>{_fmt_num(line_total, 2)}</D_5004>')
        lines.append('          </C_C516>')
        lines.append('        </S_MOA>')
        lines.append('      </G_SG27>')

        # Unit price (PRI AAA)
        lines.append('      <G_SG29>')
        lines.append('        <S_PRI>')
        lines.append('          <C_C509>')
        lines.append('            <D_5125>AAA</D_5125>')
        lines.append(f'            <D_5118>{_fmt_num(unit_price, 4)}</D_5118>')
        lines.append('            <D_5284>1</D_5284>')
        lines.append(f'            <D_6411>{unit}</D_6411>')
        lines.append('          </C_C509>')
        lines.append('        </S_PRI>')
        lines.append('      </G_SG29>')

        # Order line reference if present (G_SG30 ON)
        if getattr(item, "order_line_reference", None):
            lines.append('      <G_SG30>')
            lines.append('        <S_RFF>')
            lines.append('          <C_C506>')
            lines.append('            <D_1153>ON</D_1153>')
            lines.append(f'            <D_1156>{escape(str(item.order_line_reference))}</D_1156>')
            lines.append('          </C_C506>')
            lines.append('        </S_RFF>')
            lines.append('      </G_SG30>')

        # Line Tax (G_SG34)
        tax_line_amt = round(line_total * (tax_rate / 100.0), 2)
        lines.append('      <G_SG34>')
        lines.append('        <S_TAX>')
        lines.append('          <D_5283>7</D_5283>')
        lines.append('          <C_C241><D_5153>VAT</D_5153></C_C241>')
        lines.append('          <C_C243>')
        lines.append(f'            <D_5278>{_fmt_num(tax_rate, 2)}</D_5278>')
        lines.append('          </C_C243>')
        lines.append(f'          <D_5305>{tax_cat}</D_5305>')
        lines.append('        </S_TAX>')
        lines.append('        <S_MOA>')
        lines.append('          <C_C516>')
        lines.append('            <D_5025>125</D_5025>')
        lines.append(f'            <D_5004>{_fmt_num(line_total, 2)}</D_5004>')
        lines.append('          </C_C516>')
        lines.append('        </S_MOA>')
        lines.append('        <S_MOA>')
        lines.append('          <C_C516>')
        lines.append('            <D_5025>124</D_5025>')
        lines.append(f'            <D_5004>{_fmt_num(tax_line_amt, 2)}</D_5004>')
        lines.append('          </C_C516>')
        lines.append('        </S_MOA>')
        lines.append('      </G_SG34>')

        # Line discount if present (G_SG39)
        disc_amt = float(getattr(item, "discount_amount", 0.0) or 0.0)
        disc_pct = float(getattr(item, "discount_percent", 0.0) or 0.0) if getattr(item, "discount_percent", None) else None
        if disc_amt > 0 or (disc_pct and disc_pct > 0):
            lines.append('      <G_SG39>')
            lines.append('        <S_ALC>')
            lines.append('          <D_5463>A</D_5463>')
            lines.append('          <C_C552>')
            lines.append('            <D_1230>Popust</D_1230>')
            lines.append('          </C_C552>')
            lines.append('        </S_ALC>')
            if disc_pct:
                lines.append('        <G_SG41>')
                lines.append('          <S_PCD>')
                lines.append('            <C_C501>')
                lines.append('              <D_5245>1</D_5245>')
                lines.append(f'              <D_5482>{_fmt_num(disc_pct, 2)}</D_5482>')
                lines.append('            </C_C501>')
                lines.append('          </S_PCD>')
                lines.append('        </G_SG41>')
            lines.append('        <G_SG42>')
            lines.append('          <S_MOA>')
            lines.append('            <C_C516>')
            lines.append('              <D_5025>204</D_5025>')
            lines.append(f'              <D_5004>{_fmt_num(disc_amt, 2)}</D_5004>')
            lines.append('            </C_C516>')
            lines.append('          </S_MOA>')
            lines.append('        </G_SG42>')
            lines.append('      </G_SG39>')

        lines.append('    </G_SG26>')

    # G_SG50: MONETARY TOTALS
    line_net = float(inv.line_net_total or 0.0)
    tax_base_attr = getattr(inv, "tax_basis_total", None)
    tax_base = float(tax_base_attr if tax_base_attr is not None else line_net)
    tax_total = float(inv.tax_total or 0.0)
    grand_total = float(inv.grand_total or (line_net + tax_total))
    due_amt = float(inv.due_payable_amount if inv.due_payable_amount is not None else grand_total)
    prepaid_amt = float(getattr(inv, "prepaid_amount", 0.0) or 0.0)

    # 79 = Sum of line net amounts (BT-106)
    lines.append('    <G_SG50>')
    lines.append('      <S_MOA>')
    lines.append('        <C_C516>')
    lines.append('          <D_5025>79</D_5025>')
    lines.append(f'          <D_5004>{_fmt_num(line_net, 2)}</D_5004>')
    lines.append('        </C_C516>')
    lines.append('      </S_MOA>')
    lines.append('    </G_SG50>')

    # 389 = Taxable base (BT-109)
    lines.append('    <G_SG50>')
    lines.append('      <S_MOA>')
    lines.append('        <C_C516>')
    lines.append('          <D_5025>389</D_5025>')
    lines.append(f'          <D_5004>{_fmt_num(tax_base, 2)}</D_5004>')
    lines.append('        </C_C516>')
    lines.append('      </S_MOA>')
    lines.append('    </G_SG50>')

    # 388 = Grand total with VAT (BT-112)
    lines.append('    <G_SG50>')
    lines.append('      <S_MOA>')
    lines.append('        <C_C516>')
    lines.append('          <D_5025>388</D_5025>')
    lines.append(f'          <D_5004>{_fmt_num(grand_total, 2)}</D_5004>')
    lines.append('        </C_C516>')
    lines.append('      </S_MOA>')
    lines.append('    </G_SG50>')

    # 9 = Amount due for payment (BT-115)
    lines.append('    <G_SG50>')
    lines.append('      <S_MOA>')
    lines.append('        <C_C516>')
    lines.append('          <D_5025>9</D_5025>')
    lines.append(f'          <D_5004>{_fmt_num(due_amt, 2)}</D_5004>')
    lines.append('        </C_C516>')
    lines.append('      </S_MOA>')
    lines.append('    </G_SG50>')

    # 176 = Total VAT amount (BT-110)
    lines.append('    <G_SG50>')
    lines.append('      <S_MOA>')
    lines.append('        <C_C516>')
    lines.append('          <D_5025>176</D_5025>')
    lines.append(f'          <D_5004>{_fmt_num(tax_total, 2)}</D_5004>')
    lines.append('        </C_C516>')
    lines.append('      </S_MOA>')
    lines.append('    </G_SG50>')

    if prepaid_amt > 0:
        lines.append('    <G_SG50>')
        lines.append('      <S_MOA>')
        lines.append('        <C_C516>')
        lines.append('          <D_5025>113</D_5025>')
        lines.append(f'          <D_5004>{_fmt_num(prepaid_amt, 2)}</D_5004>')
        lines.append('        </C_C516>')
        lines.append('      </S_MOA>')
        lines.append('    </G_SG50>')

    # G_SG52: TAX BREAKDOWN
    tax_breakdown = inv.tax_breakdown or []
    if not tax_breakdown:
        # Default single rate
        rate_val = 22.0 if (inv.seller.country_code == "SI" or inv.buyer.country_code == "SI") else 19.0
        tax_breakdown = [{
            "category_code": "S",
            "tax_percent": rate_val,
            "basis_amount": tax_base,
            "tax_amount": tax_total
        }]

    for tb in tax_breakdown:
        cat_c = getattr(tb, "tax_category_code", "S") or "S"
        t_rate = float(getattr(tb, "tax_percent", 22.0) or 0.0)
        t_base = float(getattr(tb, "basis_amount", tax_base) or 0.0)
        t_amt = float(getattr(tb, "tax_amount", tax_total) or 0.0)

        lines.append('    <G_SG52>')
        lines.append('      <S_TAX>')
        lines.append('        <D_5283>7</D_5283>')
        lines.append('        <C_C241><D_5153>VAT</D_5153></C_C241>')
        lines.append('        <C_C243>')
        lines.append(f'          <D_5278>{_fmt_num(t_rate, 2)}</D_5278>')
        lines.append('        </C_C243>')
        lines.append(f'        <D_5305>{escape(cat_c)}</D_5305>')
        lines.append('      </S_TAX>')
        lines.append('      <S_MOA>')
        lines.append('        <C_C516>')
        lines.append('          <D_5025>125</D_5025>')
        lines.append(f'          <D_5004>{_fmt_num(t_base, 2)}</D_5004>')
        lines.append('        </C_C516>')
        lines.append('      </S_MOA>')
        lines.append('      <S_MOA>')
        lines.append('        <C_C516>')
        lines.append('          <D_5025>124</D_5025>')
        lines.append(f'          <D_5004>{_fmt_num(t_amt, 2)}</D_5004>')
        lines.append('        </C_C516>')
        lines.append('      </S_MOA>')
        lines.append('    </G_SG52>')

    lines.append('  </M_INVOIC>')
    lines.append('</Invoice>')

    return "\n".join(lines)
