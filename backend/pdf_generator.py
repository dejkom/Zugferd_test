import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, Image as RLImage
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from backend.models import InvoiceData

def generate_invoice_pdf_from_data(inv: InvoiceData, output_pdf_path: str, logo_path: str = None, layout: str = "layout1") -> str:
    """
    Renders a print-ready PDF invoice from structured InvoiceData.
    Supports:
      - 'layout1': Modern Card-based Standard Layout
      - 'layout2': Odelo Industrial DIN / Automotive Clean Layout
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_pdf_path)), exist_ok=True)
    if layout == "layout2":
        return _generate_odelo_layout(inv, output_pdf_path, logo_path)
    else:
        return _generate_standard_layout(inv, output_pdf_path, logo_path)

def _generate_standard_layout(inv: InvoiceData, output_pdf_path: str, logo_path: str = None) -> str:
    """Option 1: Modern Standard Studio Layout"""
    doc = SimpleDocTemplate(
        output_pdf_path,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm
    )

    styles = getSampleStyleSheet()
    normal_style = styles["Normal"]
    normal_style.fontSize = 9
    normal_style.leading = 12

    title_style = ParagraphStyle(
        "InvoiceTitle",
        parent=styles["Heading1"],
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#1e293b"),
        fontName="Helvetica-Bold"
    )

    header_label = ParagraphStyle(
        "HeaderLabel",
        parent=normal_style,
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#64748b")
    )

    story = []

    # Header: INVOICE title & Seller details on left, Logo on right
    seller_details = Paragraph(
        f"<b>{inv.seller.name}</b><br/>"
        f"{inv.seller.street or ''}<br/>"
        f"{inv.seller.postcode or ''} {inv.seller.city or ''}<br/>"
        f"{inv.seller.country_code or ''}<br/>"
        f"VAT: {inv.seller.vat_id or 'N/A'}",
        normal_style
    )

    left_header_elements = [
        Paragraph(f"<b>INVOICE</b><br/><font size=9 color='#64748b'>#{inv.invoice_number}</font>", title_style),
        Spacer(1, 4 * mm),
        seller_details
    ]

    right_header_elements = []
    if logo_path and os.path.exists(logo_path):
        try:
            img = RLImage(logo_path, width=48 * mm, height=18 * mm, kind='proportional')
            img.hAlign = 'RIGHT'
            right_header_elements.append(img)
        except Exception:
            pass

    header_data = [
        [
            left_header_elements,
            right_header_elements
        ]
    ]
    t_header = Table(header_data, colWidths=[100 * mm, 80 * mm])
    t_header.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
    ]))
    story.append(t_header)
    story.append(Spacer(1, 8 * mm))

    # Bill To (Left) & Invoice Details (Pushed more to the right)
    meta_info = f"""
    <b>Invoice Date:</b> {inv.issue_date}<br/>
    <b>Due Date:</b> {inv.due_date or 'N/A'}<br/>
    <b>Currency:</b> {inv.currency}<br/>
    <b>Buyer Ref:</b> {inv.buyer_reference or 'N/A'}
    """
    party_data = [
        [
            Paragraph("<b>BILLED TO:</b>", header_label),
            Paragraph("<b>INVOICE DETAILS:</b>", header_label)
        ],
        [
            Paragraph(f"<b>{inv.buyer.name}</b><br/>{inv.buyer.street or ''}<br/>{inv.buyer.postcode or ''} {inv.buyer.city or ''}<br/>{inv.buyer.country_code or ''}<br/>VAT: {inv.buyer.vat_id or 'N/A'}", normal_style),
            Paragraph(meta_info, normal_style)
        ]
    ]
    t_party = Table(party_data, colWidths=[110 * mm, 70 * mm])
    t_party.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(t_party)
    story.append(Spacer(1, 8 * mm))

    # Line Items Table
    table_rows = [
        [
            Paragraph("<b>#</b>", header_label),
            Paragraph("<b>Description</b>", header_label),
            Paragraph("<b>Qty</b>", header_label),
            Paragraph("<b>Unit Price</b>", header_label),
            Paragraph("<b>Tax %</b>", header_label),
            Paragraph("<b>Total</b>", header_label)
        ]
    ]

    items = inv.items or []
    if not items:
        table_rows.append([
            Paragraph("1", normal_style),
            Paragraph("General Services", normal_style),
            Paragraph("1", normal_style),
            Paragraph(f"{inv.line_net_total:.2f} {inv.currency}", normal_style),
            Paragraph(f"{inv.tax_total:.2f}", normal_style),
            Paragraph(f"{inv.line_net_total:.2f} {inv.currency}", normal_style)
        ])
    else:
        for idx, item in enumerate(items, start=1):
            tax_val = getattr(item, 'tax_rate', None)
            if tax_val is None:
                tax_val = getattr(item, 'tax_percent', 0.0)
            table_rows.append([
                Paragraph(str(idx), normal_style),
                Paragraph(item.name, normal_style),
                Paragraph(f"{item.quantity:g}", normal_style),
                Paragraph(f"{item.unit_price:.2f}", normal_style),
                Paragraph(f"{tax_val:.1f}%", normal_style),
                Paragraph(f"{item.line_total_amount:.2f}", normal_style)
            ])

    col_widths = [10 * mm, 80 * mm, 25 * mm, 22 * mm, 18 * mm, 25 * mm]
    t_items = Table(table_rows, colWidths=col_widths)
    t_items.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('ALIGN', (2, 0), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(t_items)
    story.append(Spacer(1, 6 * mm))

    # Totals block
    totals_data = [
        [Paragraph("Net Total:", normal_style), Paragraph(f"<b>{inv.line_net_total:.2f} {inv.currency}</b>", normal_style)],
        [Paragraph("Tax Total:", normal_style), Paragraph(f"<b>{inv.tax_total:.2f} {inv.currency}</b>", normal_style)],
        [Paragraph("<b>Grand Total:</b>", normal_style), Paragraph(f"<b><font size=11 color='#059669'>{inv.grand_total:.2f} {inv.currency}</font></b>", normal_style)],
        [Paragraph("Due Amount:", normal_style), Paragraph(f"<b>{inv.due_payable_amount:.2f} {inv.currency}</b>", normal_style)]
    ]
    t_totals = Table(totals_data, colWidths=[35 * mm, 35 * mm])
    t_totals.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'RIGHT'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))

    totals_container = Table([["", t_totals]], colWidths=[110 * mm, 70 * mm])
    totals_container.setStyle(TableStyle([
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
    ]))
    story.append(totals_container)
    story.append(Spacer(1, 8 * mm))

    # Payment details (Notes removed as requested)
    payment_txt = ""
    if inv.payment.iban:
        payment_txt += f"<b>IBAN:</b> {inv.payment.iban} &bull; <b>BIC:</b> {inv.payment.bic or 'N/A'}<br/>"
    if inv.payment.bank_name:
        payment_txt += f"<b>Bank:</b> {inv.payment.bank_name}<br/>"
    if inv.payment.payment_terms:
        payment_txt += f"<b>Terms:</b> {inv.payment.payment_terms}<br/>"

    notes_txt = "<br/>".join(inv.notes) if inv.notes else ""
    notes_block = f"<br/><font size=8 color='#94a3b8'><b>Notes:</b> {notes_txt}</font>" if notes_txt else ""

    footer_text = f"""
    <font color='#475569'><b>Payment Information:</b><br/>{payment_txt or 'Credit transfer / standard terms'}</font>{notes_block}
    """
    story.append(Paragraph(footer_text, normal_style))

    doc.build(story)
    return output_pdf_path

def _generate_odelo_layout(inv: InvoiceData, output_pdf_path: str, logo_path: str = None) -> str:
    """
    Option 2: Odelo Corporate Automotive Layout
    Features:
      - Top-right large corporate Logo
      - Mini sender line in small banner
      - Left-aligned Buyer address
      - Right-aligned contact info (Fon, Fax)
      - Centered bold title 'Rechnung'
      - Dual-box header for Rechnungsnummer & Rechnungsdatum with border
      - Your VAT Number right aligned
      - Horizontal rule bounded table: 'date of delivery | Position | Artikel-Bezeichnung | quantity | unit price | total amount'
      - Distinct bold double-underline 'Gesamtrechnungsbetrag'
      - Payment note: 'Zahlung: Ende des Folgemonats'
      - Multi-column 4-column light-gray corporate footer (Gericht, Banken, Geschäftsführer)
    """
    doc = SimpleDocTemplate(
        output_pdf_path,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm
    )

    styles = getSampleStyleSheet()
    normal_style = styles["Normal"]
    normal_style.fontSize = 8.5
    normal_style.leading = 11.5
    normal_style.fontName = "Helvetica"

    small_style = ParagraphStyle(
        "SmallOdelo",
        parent=normal_style,
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#334155")
    )

    odelo_title = ParagraphStyle(
        "OdeloTitle",
        parent=styles["Heading1"],
        fontSize=15,
        leading=18,
        alignment=1, # Center
        fontName="Helvetica-Bold",
        textColor=colors.black
    )

    story = []

    # 1. Top Logo Row (Logo on right side)
    right_logo_el = []
    if logo_path and os.path.exists(logo_path):
        try:
            img = RLImage(logo_path, width=45 * mm, height=18 * mm, kind='proportional')
            right_logo_el.append(img)
        except Exception:
            pass
    if not right_logo_el:
        right_logo_el.append(Paragraph(f"<b><font size=18 color='#c00000'>odelo:</font></b>", ParagraphStyle("LogoTxt", alignment=2)))

    t_top_logo = Table([["", right_logo_el]], colWidths=[120 * mm, 54 * mm])
    t_top_logo.setStyle(TableStyle([
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(t_top_logo)
    story.append(Spacer(1, 4 * mm))

    # 2. Buyer Address on Left with Multi-line Seller Info on top vs Telecommunication on Right
    seller_multiline = f"""<font size=7 color='#000000'><b>{inv.seller.name}</b><br/>{inv.seller.street or ''}<br/>{inv.seller.postcode or ''} {inv.seller.city or ''}<br/>{inv.seller.country_code or ''}</font>"""

    left_party_html = f"""
    {seller_multiline}
    <br/><br/>
    <b>{inv.buyer.name}</b><br/>
    {inv.buyer.street or ''}<br/><br/>
    {inv.buyer.postcode or ''} {inv.buyer.city or ''}<br/>
    {inv.buyer.country_code or 'Slowenien'}
    """
    contact_html = f"""
    <font size=7 color='#475569'>Fon: +49 (0)711 18563144<br/>Fax: +49 (0)711 185633144</font>
    """
    t_parties = Table([
        [Paragraph(left_party_html, normal_style), Paragraph(contact_html, ParagraphStyle("RightTel", alignment=2, fontName="Helvetica", fontSize=7, leading=10))]
    ], colWidths=[110 * mm, 64 * mm])
    t_parties.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(t_parties)
    story.append(Spacer(1, 8 * mm))

    # 4. Central Document Title 'Rechnung'
    story.append(Paragraph("<b>Rechnung</b>", odelo_title))
    story.append(Spacer(1, 4 * mm))

    # 5. Boxed Metadata Table (Rechnungsnummer / Rechnungsdatum) on right side
    inv_date_formatted = inv.issue_date
    meta_box_data = [
        [Paragraph("<font size=7><b>Rechnungsnummer</b></font>", small_style), Paragraph("<font size=7><b>Rechnungsdatum</b></font>", small_style)],
        [Paragraph(f"<b>{inv.invoice_number}</b>", ParagraphStyle("InvNoStyle", parent=normal_style, fontSize=8, leading=10)), Paragraph(f"<b>{inv_date_formatted}</b>", ParagraphStyle("InvDateStyle", parent=normal_style, fontSize=8, leading=10))]
    ]
    t_meta_box = Table(meta_box_data, colWidths=[32 * mm, 28 * mm])
    t_meta_box.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.6, colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))

    vat_num_html = f"<font size=7.5><b>Your VAT Number:</b><br/><b>{inv.buyer.vat_id or 'N/A'}</b></font>"
    right_meta_table = Table([
        [t_meta_box],
        [Spacer(1, 2 * mm)],
        [Paragraph(vat_num_html, ParagraphStyle("VatNum", alignment=2, fontName="Helvetica", fontSize=7.5, leading=10))]
    ], colWidths=[60 * mm])
    right_meta_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'RIGHT'),
    ]))

    t_meta_row = Table([["", right_meta_table]], colWidths=[114 * mm, 60 * mm])
    t_meta_row.setStyle(TableStyle([
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
    ]))
    story.append(t_meta_row)
    story.append(Spacer(1, 4 * mm))

    # 6. Odelo Line Items Table with black top/bottom border
    th_style = ParagraphStyle("OdeloTH", fontName="Helvetica-Bold", fontSize=7.5, leading=9.5, textColor=colors.black)
    th_style_right = ParagraphStyle("OdeloTHRight", fontName="Helvetica-Bold", fontSize=7.5, leading=9.5, alignment=2, textColor=colors.black)

    # Header Row: Boxed with border around headers
    t_odelo_header = Table([
        [
            Paragraph("<b>date of<br/>delivery</b>", th_style),
            Paragraph("<b>Position</b>", th_style),
            Paragraph("<b>Artikel-Bezeichnung</b>", th_style),
            Paragraph("<b>quantity</b>", th_style_right),
            Paragraph("<b>unit price</b>", th_style_right),
            Paragraph(f"<b>total amount<br/>in {inv.currency}</b>", th_style_right)
        ]
    ], colWidths=[20 * mm, 16 * mm, 68 * mm, 18 * mm, 24 * mm, 28 * mm])
    t_odelo_header.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.8, colors.black),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(t_odelo_header)
    story.append(Spacer(1, 3 * mm))

    # Formatted month delivery date, e.g. "Dez. 25" or "Sep. 26"
    deliv_label = ""
    if inv.issue_date:
        try:
            parts = inv.issue_date.split("-")
            month_names = {
                "01": "Jan.", "02": "Feb.", "03": "Mär.", "04": "Apr.",
                "05": "Mai", "06": "Jun.", "07": "Jul.", "08": "Aug.",
                "09": "Sep.", "10": "Okt.", "11": "Nov.", "12": "Dez."
            }
            if len(parts) >= 2:
                deliv_label = f"{month_names.get(parts[1], parts[1])} {parts[0][-2:]}"
        except Exception:
            deliv_label = inv.issue_date[:7]

    table_data = [
        [
            Paragraph(f"<b>{deliv_label}</b>", small_style),
            Paragraph("", small_style),
            Paragraph("<b>Gemäß Dienstleistungsvertrag stellen wir Ihnen<br/>wie folgt in Rechnung:</b>", small_style),
            Paragraph("", small_style),
            Paragraph("", small_style),
            Paragraph("", small_style)
        ]
    ]

    items = inv.items or []
    if not items:
        table_data.append([
            Paragraph("", small_style),
            Paragraph("10", small_style),
            Paragraph("Dienstleistungen & Deliverables", normal_style),
            Paragraph("1", ParagraphStyle("R", alignment=2, fontSize=8)),
            Paragraph(f"{inv.line_net_total:,.2f}", ParagraphStyle("R", alignment=2, fontSize=8)),
            Paragraph(f"{inv.line_net_total:,.2f}", ParagraphStyle("R", alignment=2, fontSize=8))
        ])
    else:
        for idx, item in enumerate(items, start=1):
            pos_num = str(idx * 10)
            table_data.append([
                Paragraph("", small_style),
                Paragraph(pos_num, small_style),
                Paragraph(item.name, normal_style),
                Paragraph(f"{item.quantity:g}", ParagraphStyle("R", alignment=2, fontSize=8)),
                Paragraph(f"{item.unit_price:,.2f}", ParagraphStyle("R", alignment=2, fontSize=8)),
                Paragraph(f"{item.line_total_amount:,.2f}", ParagraphStyle("R", alignment=2, fontSize=8))
            ])

    t_odelo_items = Table(table_data, colWidths=[20 * mm, 16 * mm, 68 * mm, 18 * mm, 24 * mm, 28 * mm])
    t_odelo_items.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
    ]))
    story.append(t_odelo_items)
    story.append(Spacer(1, 10 * mm))

    # 7. Gesamtrechnungsbetrag with double underline
    td_sum_label = Paragraph("<font size=9><b>Gesamtrechnungsbetrag</b></font>", ParagraphStyle("SumLbl", alignment=2))
    td_sum_val = Paragraph(f"<font size=9.5><b>{inv.grand_total:,.2f}</b></font>", ParagraphStyle("SumVal", alignment=2))

    t_grand = Table([["", td_sum_label, td_sum_val]], colWidths=[80 * mm, 58 * mm, 36 * mm])
    t_grand.setStyle(TableStyle([
        ('LINEABOVE', (2, 0), (2, 0), 0.5, colors.black),
        ('LINEBELOW', (2, 0), (2, 0), 1.5, colors.black),
        ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(t_grand)
    story.append(Spacer(1, 14 * mm))

    # 8. Tax exemption / Terms note
    terms_txt = inv.payment.payment_terms or "Ende des Folgemonats"
    terms_line = f"<i>Zahlung: {terms_txt}</i>"
    exemption_line = "<i>The beneficiary is responsible for the taxation of this amount</i>"
    t_terms = Table([
        [Paragraph(terms_line, small_style), Paragraph(exemption_line, ParagraphStyle("Exemp", alignment=2, fontSize=7))]
    ], colWidths=[85 * mm, 89 * mm])
    story.append(t_terms)
    story.append(Spacer(1, 12 * mm))

    # 9. Multi-column corporate footer strip (as in Odelo template)
    s_name = inv.seller.name or "odelo GmbH"
    s_street = inv.seller.street or "Hedelfinger Strasse 137"
    s_city = f"{inv.seller.postcode or '70329'} {inv.seller.city or 'Stuttgart'}"
    s_country = inv.seller.country_code or "Deutschland"
    s_vat = inv.seller.vat_id or "DE 347120003"
    s_iban = inv.payment.iban or "DE44 6004 0071 0556 7060 00"
    s_bic = inv.payment.bic or "COBADEFFXXX"

    # Row 1 and Row 2 matching the Odelo 4-column 2-row layout exactly
    r1c1 = f"<b>{s_name}</b><br/>Sitz Stuttgart<br/>www.odelo.de"
    r1c2 = f"Amtsgericht Stuttgart<br/>HRB 736903<br/>UST-ID-Nr.: {s_vat}"
    r1c3 = f"Commerzbank AG<br/>S.W.I.F.T/BIC: {s_bic}<br/>IBAN: {s_iban}"
    r1c4 = f"Baden-Württembergische Bank<br/>S.W.I.F.T/BIC: SOLA DEST<br/>IBAN: DE30 6005 0101 7871 5056 72"

    r2c1 = f"{s_street}<br/>{s_city}<br/>{s_country}"
    r2c2 = f"Geschäftsführer:<br/>Mürsel Gülen, Sedat Kilic"
    r2c3 = ""
    r2c4 = ""

    t_footer = Table([
        [
            Paragraph(r1c1, small_style),
            Paragraph(r1c2, small_style),
            Paragraph(r1c3, small_style),
            Paragraph(r1c4, small_style)
        ],
        [
            Paragraph(r2c1, small_style),
            Paragraph(r2c2, small_style),
            Paragraph(r2c3, small_style),
            Paragraph(r2c4, small_style)
        ]
    ], colWidths=[40 * mm, 44 * mm, 45 * mm, 45 * mm])
    t_footer.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ('LINEABOVE', (0, 0), (-1, 0), 0.5, colors.HexColor("#e2e8f0")),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(t_footer)

    doc.build(story)
    return output_pdf_path
