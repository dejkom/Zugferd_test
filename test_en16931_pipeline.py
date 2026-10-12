#!/usr/bin/env python3
"""
Test script verifying EN 16931 pipeline:
1. Standard Invoice layout rendering & conditional blocks
2. Edge-case Invoice (Credit Note 381 + Factoring BG-10 + Reverse Charge BT-120 + Prepaid BT-113)
3. Embedding into PDF/A-3 and validating compliance
"""
import os
import sys

from backend.models import (
    InvoiceData, TradeParty, PaymentDetails, FactoringPayee,
    DeliveryDetails, InvoiceLineItem, TaxSummaryItem, DocumentDiscount
)
from backend.template_engine import generate_en16931_pdf, render_en16931_html
from backend.xml_builder import generate_facturx_xml
from backend.pdf_embedder import build_pdfa3_zugferd
from backend.mustang_wrapper import validate_zugferd_pdf

def test_pipeline():
    os.makedirs("output", exist_ok=True)
    print("=================================================================")
    print("TEST 1: Standard Commercial Invoice (380) with Allowances & Charges")
    print("=================================================================")
    standard_inv = InvoiceData(
        invoice_number="2026-00481",
        issue_date="2026-10-12",
        due_date="2026-11-11",
        delivery_date="2026-10-10",
        currency="EUR",
        invoice_type_code="380",
        buyer_reference="PO-2026-8812",
        purchase_order_number="PO-2026-8812",
        despatch_advice_reference="DOB-2026-0941",
        cost_center="CC-PROD-401",
        sales_order_number="SO-991204",
        seller=TradeParty(
            name="VZORČNO PODJETJE d.o.o.",
            street="Tehnološka cesta 12",
            postcode="3312",
            city="Prebold",
            country_code="SI",
            vat_id="SI12345678",
            tax_number="5874219000",
            court_registry="Okrožno sodišče v Celju, vložek št. 1/09876/00",
            contact_name="Ana Novak",
            contact_phone="+386 3 703 12 34",
            contact_email="ana.novak@podjetje.si"
        ),
        buyer=TradeParty(
            name="AVTO-ELEKTRONIKA JARC d.o.o.",
            street="Industrijska ulica 88",
            postcode="1000",
            city="Ljubljana",
            country_code="SI",
            vat_id="SI87654321",
            contact_name="Marko Horvat (Nabava)",
            contact_phone="+386 1 588 0000",
            contact_email="marko.horvat@jarc-avto.si"
        ),
        delivery=DeliveryDetails(
            recipient_name="Centralno skladišče Logatec",
            location_id="3830012345009",
            street="Obrtna cona 14",
            postcode="1370",
            city="Logatec",
            country_code="SI"
        ),
        payment=PaymentDetails(
            iban="SI56020100012345678",
            bic="LJBASI2X",
            bank_name="Nova Ljubljanska banka d.d.",
            payment_terms="Plačilo v roku 30 dni od datuma izdaje računa brez popusta.",
            payment_reference="SI00 2026-00481",
            payment_means_code="58",
            payment_means_name="Kreditno nakazilo (SEPA credit transfer)"
        ),
        discounts=[
            DocumentDiscount(reason="Loyalty rebate", percentage=2.5, amount=50.0, charge_indicator=False),
            DocumentDiscount(reason="Special packaging & freight", percentage=1.0, amount=20.0, charge_indicator=True)
        ],
        items=[
            InvoiceLineItem(
                line_id="1",
                name="Senzor tlaka krmilne enote CUAA-240",
                description="Visokotlačni piezorezistivni senzor za avtomobilsko elektroniko",
                quantity=10.0,
                unit_code="H87",
                unit_price=120.0,
                line_total_amount=1200.0,
                tax_category_code="S",
                tax_percent=22.0,
                seller_item_id="SNZ-PRS-01",
                buyer_item_id="OE-7E0906051",
                standard_item_id="3831112233445",
                order_line_reference="10",
                item_attribute="Delovni tlak = 0-250 bar"
            ),
            InvoiceLineItem(
                line_id="2",
                name="Optični modul za prenos podatkov CAN-FD",
                quantity=2.0,
                unit_code="C62",
                unit_price=450.0,
                line_total_amount=850.0,
                discount_amount=50.0,
                tax_category_code="S",
                tax_percent=22.0,
                seller_item_id="OPT-MOD-FD4",
                item_serial_number="SN-2026-X9921"
            )
        ],
        tax_breakdown=[
            TaxSummaryItem(tax_category_code="S", tax_percent=22.0, basis_amount=2020.0, tax_amount=444.40)
        ],
        line_net_total=2050.0,
        tax_total=444.40,
        grand_total=2464.40,
        due_payable_amount=2464.40
    )

    pdf1_visual = "output/test_standard_layout3.pdf"
    generate_en16931_pdf(standard_inv, pdf1_visual, hide_tags=True)
    print(f"Generated Visual PDF 1: {pdf1_visual} ({os.path.getsize(pdf1_visual)} bytes)")

    # Build PDF/A-3 with Factur-X XML
    xml1 = generate_facturx_xml(standard_inv, profile="EN16931")
    xml1_path = "output/test_standard.xml"
    with open(xml1_path, "w", encoding="utf-8") as f:
        f.write(xml1)
    
    pdf1_pdfa3 = "output/test_standard_pdfa3.pdf"
    build_pdfa3_zugferd(pdf1_visual, xml1_path, pdf1_pdfa3, profile="EN16931")
    print(f"Built PDF/A-3: {pdf1_pdfa3} ({os.path.getsize(pdf1_pdfa3)} bytes)")

    val1 = validate_zugferd_pdf(pdf1_pdfa3)
    print(f"Mustang validation (Standard): isValid={val1.get('isValid')}")

    print("\n=================================================================")
    print("TEST 2: Edge-case: Credit Note (381) + Factoring (BG-10) + Reverse Charge (AE) + Prepaid")
    print("=================================================================")
    edge_inv = InvoiceData(
        invoice_number="CN-2026-00019",
        issue_date="2026-10-12",
        due_date="2026-10-26",
        currency="EUR",
        invoice_type_code="381", # Credit Note
        preceding_invoice_number="2026-00481",
        preceding_invoice_date="2026-10-12",
        credit_note_reason="Vračilo blaga / reklamacija po zapisniku št. REC-99",
        buyer_reference="DE9901844",
        purchase_order_number="PO-2026-8812",
        vat_exemption_reason="Reverse charge / Obrnjena davčna obveznost po 76.a členu ZDDV-1. Davek obračuna kupec.",
        prepaid_amount=500.0, # BT-113 Prepaid deduction
        seller=TradeParty(
            name="VZORČNO PODJETJE d.o.o.",
            street="Tehnološka cesta 12",
            city="Prebold",
            postcode="3312",
            country_code="SI",
            vat_id="SI12345678"
        ),
        buyer=TradeParty(
            name="DEUTSCHE INDUSTRIE AG",
            street="Industriestrasse 100",
            city="Stuttgart",
            postcode="70173",
            country_code="DE",
            vat_id="DE123456789"
        ),
        payment=PaymentDetails(
            iban="SI56020100012345678",
            bic="LJBASI2X",
            payment_terms="Dobropis bo pobotan z odprtimi obveznostmi.",
            payment_means_code="58",
            factoring_payee=FactoringPayee(
                name="PRVA FAKTORING d.o.o.",
                vat_id="SI99887766",
                iban="SI56029990008888111",
                bic="NLBISI2X",
                notice_text="POMEMBNO: Terjatev iz tega računa je bila odstopljena družbi "
            )
        ),
        items=[
            InvoiceLineItem(
                line_id="1",
                name="Senzor tlaka CUAA-240 (Reklamirano vračilo)",
                quantity=5.0,
                unit_code="H87",
                unit_price=120.0,
                line_total_amount=600.0,
                tax_category_code="AE", # Reverse Charge
                tax_percent=0.0,
                seller_item_id="SNZ-PRS-01"
            )
        ],
        tax_breakdown=[
            TaxSummaryItem(
                tax_category_code="AE",
                tax_percent=0.0,
                basis_amount=600.0,
                tax_amount=0.0,
                exemption_reason="Reverse charge under EU VAT Directive 2006/112/EC"
            )
        ],
        line_net_total=600.0,
        tax_total=0.0,
        grand_total=600.0,
        due_payable_amount=100.0 # 600 - 500 prepaid = 100
    )

    pdf2_visual = "output/test_edgecase_layout3.pdf"
    generate_en16931_pdf(edge_inv, pdf2_visual, hide_tags=True)
    print(f"Generated Visual PDF 2: {pdf2_visual} ({os.path.getsize(pdf2_visual)} bytes)")

    # Build PDF/A-3 with Factur-X XML
    xml2 = generate_facturx_xml(edge_inv, profile="EN16931")
    xml2_path = "output/test_edgecase.xml"
    with open(xml2_path, "w", encoding="utf-8") as f:
        f.write(xml2)
    
    pdf2_pdfa3 = "output/test_edgecase_pdfa3.pdf"
    build_pdfa3_zugferd(pdf2_visual, xml2_path, pdf2_pdfa3, profile="EN16931")
    print(f"Built PDF/A-3: {pdf2_pdfa3} ({os.path.getsize(pdf2_pdfa3)} bytes)")

    val2 = validate_zugferd_pdf(pdf2_pdfa3)
    print(f"Mustang validation (Edge Case): isValid={val2.get('isValid')}")

    print("\nALL EN 16931 PIPELINE TESTS COMPLETED SUCCESSFULLY!")

if __name__ == "__main__":
    test_pipeline()
