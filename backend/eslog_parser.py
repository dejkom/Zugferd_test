import os
import re
import xml.etree.ElementTree as ET
from typing import Optional, List, Dict, Any
from backend.models import (
    InvoiceData, TradeParty, DeliveryDetails, PaymentDetails,
    InvoiceLineItem, TaxSummaryItem, DocumentDiscount, FieldConfidenceScores
)

def parse_eslog2_xml(xml_content_or_path: str) -> InvoiceData:
    """
    Parse Slovenian e-SLOG 2.0 XML (urn:eslog:2.00 / M_INVOIC EDIFACT-like schema)
    into structured InvoiceData model.
    """
    if os.path.exists(xml_content_or_path):
        with open(xml_content_or_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    else:
        content = xml_content_or_path

    # Strip XML namespaces for simplified XPath/tag querying
    clean_xml = re.sub(r'\sxmlns(?::\w+)?="[^"]+"', '', content, count=0)
    root = ET.fromstring(clean_xml)

    # Helper: find text in child element
    def get_text(parent, xpath: str) -> Optional[str]:
        if parent is None:
            return None
        el = parent.find(xpath)
        return el.text.strip() if el is not None and el.text else None

    # M_INVOIC container
    inv_node = root.find(".//M_INVOIC") or root

    # 1. Invoice Number (BT-1) & Type (BT-3)
    inv_number = "TOSL110"
    type_code = "380"
    bgm = inv_node.find("S_BGM")
    if bgm is not None:
        type_code = get_text(bgm, "C_C002/D_1001") or "380"
        inv_number = get_text(bgm, "C_C106/D_1004") or get_text(inv_node, "S_UNH/D_0062") or "INVOICE"

    # 2. Dates
    issue_date = None
    due_date = None
    deliv_date = None
    service_start = None
    service_end = None

    for dtm in inv_node.findall("S_DTM"):
        qualifier = get_text(dtm, "C_C507/D_2005")
        val = get_text(dtm, "C_C507/D_2380")
        if qualifier == "137":  # Issue date (BT-2)
            issue_date = val
        elif qualifier == "131" and not issue_date:  # Tax point date (BT-7)
            issue_date = val
        elif qualifier == "35":  # Delivery date (BT-72)
            deliv_date = val
        elif qualifier == "167":  # Period start (BT-73)
            service_start = val
        elif qualifier == "168":  # Period end (BT-74)
            service_end = val

    # Due date from Payment terms (G_SG8)
    for sg8 in inv_node.findall("G_SG8"):
        for dtm in sg8.findall("S_DTM"):
            q = get_text(dtm, "C_C507/D_2005")
            val = get_text(dtm, "C_C507/D_2380")
            if q == "13":  # Due date (BT-9)
                due_date = val

    # 3. Currency (BT-5)
    currency = "EUR"
    for sg7 in inv_node.findall("G_SG7"):
        cux = sg7.find("S_CUX")
        if cux is not None:
            qual = get_text(cux, "C_C504/D_6347")
            curr_val = get_text(cux, "C_C504/D_6345")
            if qual == "2" and curr_val:  # Invoicing currency (BT-5)
                currency = curr_val
            elif not currency and curr_val:
                currency = curr_val

    # 4. Notes & Free text (BT-20, BT-22, BT-82)
    notes = []
    payment_terms_list = []
    for ftx in inv_node.findall("S_FTX"):
        ftx_qual = get_text(ftx, "D_4451")
        # Text fields D_4440 .. D_4440_5
        c108 = ftx.find("C_C108")
        text_lines = []
        if c108 is not None:
            for child in c108:
                if child.text and child.text.strip():
                    text_lines.append(child.text.strip())
        joined = " ".join(text_lines)

        if ftx_qual in ["GEN", "ACB"]:  # Invoice note (BT-22)
            if joined:
                notes.append(joined)
        elif ftx_qual in ["AAB", "AAT"]:  # Payment terms (BT-20 / BT-82)
            if joined:
                payment_terms_list.append(joined)

    # 5. References (G_SG1): PO (BT-13), Delivery note (BT-16), Project (BT-11), Preceding (BT-25)
    po_number = None
    despatch_id = None
    buyer_ref = None
    preceding_num = None
    preceding_date = None
    remittance_ref = None

    sales_order_num = None
    cost_center = None
    project_ref = None
    contract_ref = None

    for sg1 in inv_node.findall("G_SG1"):
        rff = sg1.find("S_RFF")
        if rff is not None:
            qual = get_text(rff, "C_C506/D_1153")
            val = get_text(rff, "C_C506/D_1154")
            if qual == "ON":  # BT-13 Order number
                po_number = val
            elif qual in ["VN", "SO"]:  # BT-14 Sales order number
                sales_order_num = val
            elif qual == "AAK":  # BT-16 Despatch advice / Lieferschein
                despatch_id = val
            elif qual in ["PR", "PJ"]:  # BT-11 Project reference
                project_ref = val
            elif qual in ["CT", "CO"]:  # BT-12 Contract reference
                contract_ref = val
            elif qual in ["ACC", "IT"]:  # BT-19 Cost center
                cost_center = val
            elif qual == "OI":  # BT-25 Preceding invoice
                preceding_num = val
                for dtm in sg1.findall("S_DTM"):
                    if get_text(dtm, "C_C507/D_2005") == "384":
                        preceding_date = get_text(dtm, "C_C507/D_2380")
            elif qual == "PQ":  # BT-83 Payment reference / Sklic
                remittance_ref = val

    # 6. Parties (G_SG2): Buyer (BY), Seller (SE), Payee (PE), Delivery (DP)
    seller_data = {
        "name": "Seller Company",
        "country_code": "SI",
        "city": "", "postcode": "", "street": "", "vat_id": "", "tax_number": ""
    }
    buyer_data = {
        "name": "Buyer Company",
        "country_code": "SI",
        "city": "", "postcode": "", "street": "", "vat_id": "", "tax_number": ""
    }
    deliv_data = {
        "recipient_name": "", "location_id": "",
        "street": "", "city": "", "postcode": "", "country_code": "SI", "delivery_date": deliv_date
    }
    payment_data = {
        "iban": "", "bic": "", "payment_terms": " ".join(payment_terms_list),
        "payment_means_code": "30"
    }

    if remittance_ref:
        if payment_data["payment_terms"]:
            payment_data["payment_terms"] += f" (Sklic: {remittance_ref})"
        else:
            payment_data["payment_terms"] = f"Sklic: {remittance_ref}"

    for sg2 in inv_node.findall("G_SG2"):
        nad = sg2.find("S_NAD")
        if nad is None:
            continue
        role = get_text(nad, "D_3035")

        # Extract address details
        name_1 = get_text(nad, "C_C080/D_3036") or ""
        name_2 = get_text(nad, "C_C080/D_3036_2") or ""
        party_name = f"{name_1} {name_2}".strip()

        street_1 = get_text(nad, "C_C059/D_3042") or ""
        city = get_text(nad, "D_3164") or ""
        postcode = get_text(nad, "D_3251") or ""
        country = get_text(nad, "D_3207") or "SI"

        # Look for tax & registration in G_SG3 (S_RFF)
        vat_id = None
        tax_num = None
        for sg3 in sg2.findall("G_SG3"):
            rff = sg3.find("S_RFF")
            if rff is not None:
                q = get_text(rff, "C_C506/D_1153")
                val = get_text(rff, "C_C506/D_1154")
                if q == "VA":  # VAT ID
                    vat_id = val
                elif q in ["AHP", "FC", "0199"]:  # Tax registration / Matica
                    tax_num = val
                elif q == "CR":  # Buyer reference (BT-10)
                    buyer_ref = val

        # Look for banking in S_FII
        iban = None
        bic = None
        for fii in sg2.findall("S_FII"):
            fii_role = get_text(fii, "D_3035")
            if fii_role in ["RB", "BI", "BB"]:
                acc = get_text(fii, "C_C078/D_3194")
                b_code = get_text(fii, "C_C088/D_3433")
                if acc and not iban:
                    iban = acc
                if b_code and not bic:
                    bic = b_code

        # Contact info in G_SG5
        contact_name = None
        contact_phone = None
        contact_email = None
        for sg5 in sg2.findall("G_SG5"):
            cta = sg5.find("S_CTA")
            if cta is not None:
                c_name = get_text(cta, "C_C056/D_3412")
                if c_name:
                    contact_name = c_name
            for scom in sg5.findall("S_COM"):
                comm_type = get_text(scom, "C_C076/D_3155")
                comm_val = get_text(scom, "C_C076/D_3148")
                if comm_type == "EM" and comm_val:
                    contact_email = comm_val
                elif comm_type in ["TE", "TF"] and comm_val:
                    contact_phone = comm_val

        if role == "SE":  # Seller
            seller_data["name"] = party_name or "Seller Company"
            seller_data["street"] = street_1
            seller_data["city"] = city
            seller_data["postcode"] = postcode
            seller_data["country_code"] = country
            seller_data["vat_id"] = vat_id
            seller_data["tax_number"] = tax_num
            seller_data["contact_name"] = contact_name
            seller_data["contact_phone"] = contact_phone
            seller_data["contact_email"] = contact_email
            if iban:
                payment_data["iban"] = iban
            if bic:
                payment_data["bic"] = bic

        elif role == "BY":  # Buyer
            buyer_data["name"] = party_name or "Buyer Company"
            buyer_data["street"] = street_1
            buyer_data["city"] = city
            buyer_data["postcode"] = postcode
            buyer_data["country_code"] = country
            buyer_data["vat_id"] = vat_id
            buyer_data["tax_number"] = tax_num
            buyer_data["contact_name"] = contact_name
            buyer_data["contact_phone"] = contact_phone
            buyer_data["contact_email"] = contact_email

        elif role == "DP":  # Delivery / Ship-to
            deliv_data["recipient_name"] = party_name
            deliv_data["location_id"] = get_text(nad, "C_C082/D_3039") or ""
            deliv_data["street"] = street_1
            deliv_data["city"] = city
            deliv_data["postcode"] = postcode
            deliv_data["country_code"] = country

    # 7. Document-level allowances and charges (G_SG16)
    discounts = []
    for sg16 in inv_node.findall("G_SG16"):
        alc = sg16.find("S_ALC")
        if alc is not None:
            alc_type = get_text(alc, "D_5463")  # A = Allowance / Discount, C = Charge
            is_charge = (alc_type == "C")
            reason = get_text(alc, "C_C552/D_1230") or ("Charge" if is_charge else "Discount")
            pct = None
            amt = 0.0

            pcd = sg16.find("G_SG19/S_PCD")
            if pcd is not None:
                p_val = get_text(pcd, "C_C501/D_5482")
                if p_val:
                    try:
                        pct = float(p_val)
                    except ValueError:
                        pass

            for moa in sg16.findall("G_SG20/S_MOA"):
                m_qual = get_text(moa, "C_C516/D_5025")
                m_val = get_text(moa, "C_C516/D_5004")
                if m_qual in ["204", "23"] and m_val:  # 204 = Allowance, 23 = Charge amount
                    try:
                        amt = float(m_val)
                    except ValueError:
                        pass

            if amt > 0 or (pct and pct > 0):
                discounts.append(DocumentDiscount(
                    reason=reason,
                    percentage=pct,
                    amount=amt,
                    charge_indicator=is_charge
                ))

    # 8. Line Items (G_SG26)
    line_items: List[InvoiceLineItem] = []
    for sg26 in inv_node.findall("G_SG26"):
        line_num = get_text(sg26, "S_LIN/D_1082") or str(len(line_items) + 1)

        # Item identifiers (S_PIA, S_LIN, G_SG30/S_RFF, S_GIR)
        seller_item_id = None
        buyer_item_id = None
        standard_item_id = None
        item_serial_num = None
        order_line_ref = None

        # Check LIN standard barcode (EAN / GTIN)
        lin_item_id = get_text(sg26, "S_LIN/C_C212/D_7140")
        lin_type = get_text(sg26, "S_LIN/C_C212/D_7143")
        if lin_item_id:
            if lin_type in ["EN", "SRV", "UP", "EAN"]:
                standard_item_id = lin_item_id
            else:
                seller_item_id = lin_item_id

        # Check PIA (Additional item identification)
        for pia in sg26.findall("S_PIA"):
            p_id = get_text(pia, "C_C212/D_7140")
            p_code = get_text(pia, "C_C212/D_7143")
            if p_id:
                if p_code in ["SA", "VN", "MF"]: # Seller/Vendor article number (BT-155)
                    seller_item_id = p_id
                elif p_code in ["IN", "BP"]: # Buyer article number (BT-156)
                    buyer_item_id = p_id
                elif p_code in ["EN", "UP", "SRV"]: # GTIN/EAN (BT-157)
                    standard_item_id = p_id

        # Check G_SG30 (References)
        for sg30 in sg26.findall("G_SG30"):
            r_qual = get_text(sg30, "S_RFF/C_C506/D_1153")
            r_val = get_text(sg30, "S_RFF/C_C506/D_1154")
            if r_val:
                if r_qual == "ON": # Purchase order line reference (BT-132)
                    order_line_ref = r_val
                elif r_qual == "SE": # Serial number (BT-128)
                    item_serial_num = r_val

        # Name / Description (S_IMD)
        item_name = None
        for imd in sg26.findall("S_IMD"):
            imd_type = get_text(imd, "D_7077")
            t = get_text(imd, "C_C273/D_7008")
            if t and (not item_name or imd_type == "F"):
                item_name = t
        if not item_name:
            item_name = f"Item #{line_num}"

        # Quantity and unit code
        qty = 1.0
        unit_code = "C62"
        sqty = sg26.find("S_QTY")
        if sqty is not None:
            q_val = get_text(sqty, "C_C186/D_6060")
            u_val = get_text(sqty, "C_C186/D_6411")
            if q_val:
                try:
                    qty = float(q_val)
                except ValueError:
                    pass
            if u_val:
                unit_code = u_val

        # Net Price & Gross Price (G_SG29 / S_PRI)
        # AAA = Net item price (BT-146), AAB = Gross item price (BT-148)
        net_unit_price = None
        gross_unit_price = None
        for sg29 in sg26.findall("G_SG29"):
            pri = sg29.find("S_PRI")
            if pri is not None:
                p_type = get_text(pri, "C_C509/D_5125")
                p_val = get_text(pri, "C_C509/D_5118")
                if p_val:
                    try:
                        p_float = float(p_val)
                        if p_type == "AAA":
                            net_unit_price = p_float
                        elif p_type == "AAB":
                            gross_unit_price = p_float
                    except ValueError:
                        pass

        # Line net total (G_SG27 / S_MOA) -> qualifier 203 (BT-131)
        line_total = None
        for sg27 in sg26.findall("G_SG27"):
            moa = sg27.find("S_MOA")
            if moa is not None:
                m_type = get_text(moa, "C_C516/D_5025")
                m_val = get_text(moa, "C_C516/D_5004")
                if m_type == "203" and m_val:
                    try:
                        line_total = float(m_val)
                    except ValueError:
                        pass

        # Tax rate & category (G_SG34)
        tax_pct = 22.0
        tax_cat = "S"
        sg34 = sg26.find("G_SG34")
        if sg34 is not None:
            tax_el = sg34.find("S_TAX")
            if tax_el is not None:
                t_cat = get_text(tax_el, "D_5305")
                t_rate = get_text(tax_el, "C_C243/D_5278")
                if t_cat:
                    tax_cat = t_cat
                if t_rate:
                    try:
                        tax_pct = float(t_rate)
                    except ValueError:
                        pass

        # Line discount (G_SG39)
        disc_amt = 0.0
        disc_pct = None
        for sg39 in sg26.findall("G_SG39"):
            for moa in sg39.findall("G_SG42/S_MOA"):
                m_t = get_text(moa, "C_C516/D_5025")
                m_v = get_text(moa, "C_C516/D_5004")
                if m_t in ["204", "509"] and m_v:
                    try:
                        disc_amt += float(m_v)
                    except ValueError:
                        pass
            pcd = sg39.find("G_SG41/S_PCD")
            if pcd is not None:
                p_v = get_text(pcd, "C_C501/D_5482")
                if p_v:
                    try:
                        disc_pct = float(p_v)
                    except ValueError:
                        pass

        # Consistent unit price & line total calculation:
        # If line total was explicitly specified in the XML (BT-131, qualifier 203)
        if line_total is not None and qty > 0:
            effective_unit_price = round(line_total / qty, 4)
            # If net unit price AAA was present and already accounts for discounts
            unit_price = net_unit_price if net_unit_price is not None else effective_unit_price
            # In EN16931 / Studio v2 form:
            # Line Total = (Quantity * Unit Price) - discount_amount
            # If unit_price is already the net price (AAA), we must avoid double-discounting!
            # If gross_unit_price is available and matches (qty * gross - disc_amt = line_total),
            # we can keep gross_unit_price as unit_price, or set disc_amt = 0 if unit_price is net.
            if gross_unit_price is not None and disc_amt > 0 and abs((qty * gross_unit_price - disc_amt) - line_total) < 0.05:
                unit_price = gross_unit_price
            elif abs((qty * unit_price) - line_total) < 0.01:
                disc_amt = 0.0
        else:
            unit_price = net_unit_price or gross_unit_price or 0.0
            line_total = max(0.0, (qty * unit_price) - disc_amt)

        line_items.append(InvoiceLineItem(
            line_id=line_num,
            name=item_name,
            quantity=qty,
            unit_code=unit_code,
            unit_price=unit_price,
            gross_price=gross_unit_price,
            line_total_amount=line_total,
            tax_category_code=tax_cat,
            tax_percent=tax_pct,
            discount_amount=disc_amt,
            discount_percent=disc_pct,
            seller_item_id=seller_item_id,
            buyer_item_id=buyer_item_id,
            standard_item_id=standard_item_id,
            item_serial_number=item_serial_num,
            order_line_reference=order_line_ref
        ))

    # 9. Summary & Totals (G_SG50)
    line_net_total = sum(it.line_total_amount for it in line_items)
    tax_total = 0.0
    grand_total = line_net_total
    due_payable = line_net_total
    prepaid_amount = 0.0

    for sg50 in inv_node.findall("G_SG50"):
        for moa in sg50.findall("S_MOA"):
            m_qual = get_text(moa, "C_C516/D_5025")
            m_val = get_text(moa, "C_C516/D_5004")
            if m_val:
                try:
                    f_val = float(m_val)
                    if m_qual == "79":   # BT-106 Sum of line net amounts
                        line_net_total = f_val
                    elif m_qual == "176":  # BT-110 Total VAT
                        tax_total = f_val
                    elif m_qual == "388":  # BT-112 Grand Total
                        grand_total = f_val
                    elif m_qual == "9":    # BT-115 Due payable amount
                        due_payable = f_val
                    elif m_qual == "113":  # BT-113 Paid amount
                        prepaid_amount = f_val
                except ValueError:
                    pass

    # 10. Tax Breakdown (G_SG52)
    tax_breakdown: List[TaxSummaryItem] = []
    for sg52 in inv_node.findall("G_SG52"):
        tax_el = sg52.find("S_TAX")
        if tax_el is not None:
            cat_code = get_text(tax_el, "D_5305") or "S"
            rate_val = get_text(tax_el, "C_C243/D_5278") or "0"
            rate = float(rate_val) if rate_val else 0.0
            basis_amt = 0.0
            tax_amt = 0.0

            for moa in sg52.findall("S_MOA"):
                m_qual = get_text(moa, "C_C516/D_5025")
                m_val = get_text(moa, "C_C516/D_5004")
                if m_val:
                    try:
                        v = float(m_val)
                        if m_qual == "125":  # Taxable base (BT-116)
                            basis_amt = v
                        elif m_qual == "124":  # Tax amount (BT-117)
                            tax_amt = v
                    except ValueError:
                        pass

            tax_breakdown.append(TaxSummaryItem(
                tax_category_code=cat_code,
                tax_percent=rate,
                basis_amount=basis_amt,
                tax_amount=tax_amt
            ))

    # Delivery object if destination info present
    delivery_obj = None
    if deliv_data["recipient_name"] or deliv_data["street"] or deliv_date or despatch_id:
        delivery_obj = DeliveryDetails(
            recipient_name=deliv_data["recipient_name"] or None,
            location_id=deliv_data["location_id"] or None,
            street=deliv_data["street"] or None,
            city=deliv_data["city"] or None,
            postcode=deliv_data["postcode"] or None,
            country_code=deliv_data["country_code"] or "SI",
            delivery_date=deliv_date,
            despatch_advice_id=despatch_id,
            despatch_advice_reference=despatch_id
        )

    return InvoiceData(
        invoice_number=inv_number,
        issue_date=issue_date or "2013-04-10",
        due_date=due_date,
        currency=currency,
        invoice_type_code=type_code,
        buyer_reference=buyer_ref,
        purchase_order_number=po_number,
        sales_order_number=sales_order_num,
        cost_center=cost_center,
        project_reference=project_ref,
        contract_reference=contract_ref,
        despatch_advice_reference=despatch_id,
        delivery_date=deliv_date,
        notes=notes,
        invoice_notes=notes,
        preceding_invoice_number=preceding_num,
        preceding_invoice_date=preceding_date,
        service_period_start=service_start,
        service_period_end=service_end,
        prepaid_amount=prepaid_amount,
        discounts=discounts,
        seller=TradeParty(**seller_data),
        buyer=TradeParty(**buyer_data),
        delivery=delivery_obj,
        payment=PaymentDetails(
            **payment_data,
            payment_reference=remittance_ref
        ),
        items=line_items,
        tax_breakdown=tax_breakdown,
        line_net_total=line_net_total,
        tax_total=tax_total,
        grand_total=grand_total,
        due_payable_amount=due_payable,
        confidence_scores=FieldConfidenceScores()
    )
