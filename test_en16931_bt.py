import os
import subprocess
import xml.etree.ElementTree as ET
from backend.models import InvoiceData
from backend.xml_builder import generate_facturx_xml
from backend.ubl_builder import generate_ubl_xml

def run_tests():
    # Primary Test Invoice (Type 380 with allowances, charges, exemptions, multi-bank accounts)
    payload_380 = {
        'invoice_number': 'TEST-BT-2026-001',
        'issue_date': '2026-10-12',
        'due_date': '2026-10-26',
        'currency': 'EUR',
        'invoice_type_code': '380',
        'purchase_order_number': '11462833',
        'sales_order_number': 'SO-9921',
        'contract_reference': 'F465RG1',
        'buyer_reference': 'EP53',
        'cost_center': 'CC-PROD-401',
        'seller': {
            'name': 'Tech Solutions GmbH',
            'vat_id': 'DE123456789',
            'company_legal_form': 'HRB 736903',
            'legal_info': 'Amtsgericht Muenchen, GF: Max Mustermann',
            'endpoint_id': 'DE123456789',
            'endpoint_scheme': '9930',
            'street': 'Innovationsstr. 10',
            'city': 'Muenchen',
            'postcode': '80331',
            'country_code': 'DE'
        },
        'buyer': {
            'name': 'Automotive OEM AG',
            'vat_id': 'DE987654321',
            'endpoint_id': '4012345000010',
            'endpoint_scheme': '0088',
            'contact_name': 'Hans Schmidt',
            'contact_phone': '+49 89 123456',
            'contact_email': 'procurement@oem.example',
            'street': 'Petuelring 130',
            'city': 'Muenchen',
            'postcode': '80809',
            'country_code': 'DE'
        },
        'delivery': {
            'location_id': '4012345000010',
            'location_scheme': '0088',
            'despatch_advice_reference': 'DESP-8841',
            'recipient_name': 'Automotive OEM AG - Werk 1',
            'street': 'Petuelring 130',
            'city': 'Muenchen',
            'postcode': '80809',
            'country_code': 'DE'
        },
        'payment': {
            'payment_means_code': '58',
            'payment_reference': 'RF18539007547034',
            'bank_accounts': [
                {'iban': 'DE89370400440532013000', 'bank_name': 'Commerzbank AG', 'bic': 'COBADEFFXXX'},
                {'iban': 'DE27200411440123456789', 'bank_name': 'Commerzbank AG', 'bic': 'COBADEFFXXX'}
            ]
        },
        'factoring_payee': {
            'name': 'ABC Factoring Bank',
            'payee_id': 'FAC-8891',
            'vat_id': 'DE555666777'
        },
        'discounts': [
            {
                'charge_indicator': False,
                'reason': 'Early payment discount',
                'percentage': 2.0,
                'amount': 190.0,
                'tax_category_code': 'AE',
                'tax_percent': 0.0,
                'base_amount': 9500.0
            }
        ],
        'vat_exemption_reason': 'Reverse charge according to §13b UStG / Art. 194/196',
        'vat_exemption_reason_code': 'VATEX-EU-AE',
        'line_net_total': 9500.0,
        'tax_basis_total': 9310.0,
        'tax_total': 0.0,
        'grand_total': 9310.0,
        'due_payable_amount': 9310.0,
        'items': [
            {
                'line_id': '1',
                'name': 'Development costs',
                'description': 'Frontend and backend development sprint 42',
                'seller_item_id': '930000006',
                'buyer_item_id': 'ACK688 FATEV Simplification RST LC G45',
                'standard_item_id': '4012345999990',
                'standard_item_id_scheme': '0160',
                'order_line_reference': '2',
                'quantity': 100.0,
                'unit_code': 'HUR',
                'unit_price': 100.0,
                'price_base_quantity': 1.0,
                'price_base_unit': 'HUR',
                'line_total_amount': 9500.0,
                'tax_category_code': 'AE',
                'tax_percent': 0.0,
                'allowances_charges': [
                    {
                        'charge_indicator': False,
                        'amount': 500.0,
                        'base_amount': 10000.0,
                        'percentage': 5.0,
                        'reason': 'Volume discount'
                    }
                ]
            }
        ]
    }

    # Credit Note Invoice (Type 381 with preceding invoice BG-3 reference and optional due date)
    payload_381 = dict(payload_380)
    payload_381['invoice_number'] = 'CN-2026-0042'
    payload_381['invoice_type_code'] = '381'
    payload_381['preceding_invoice_number'] = 'TEST-BT-2026-001'
    payload_381['preceding_invoice_date'] = '2026-10-12'
    payload_381['due_date'] = None # Optional for 381

    inv_380 = InvoiceData(**payload_380)
    inv_381 = InvoiceData(**payload_381)

    cii_380_xml = generate_facturx_xml(inv_380, profile="EN16931")
    ubl_380_xml = generate_ubl_xml(inv_380, profile="PEPPOL")
    cii_381_xml = generate_facturx_xml(inv_381, profile="EN16931")
    ubl_381_xml = generate_ubl_xml(inv_381, profile="PEPPOL")

    # XML Namespaces
    ns_cii = {
        'rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
        'ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
        'udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
        'qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:10'
    }
    ns_ubl = {
        'ubl': 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
        'cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        'cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
    }

    tree_cii_380 = ET.fromstring(cii_380_xml)
    tree_ubl_380 = ET.fromstring(ubl_380_xml)
    tree_cii_381 = ET.fromstring(cii_381_xml)
    tree_ubl_381 = ET.fromstring(ubl_381_xml)

    print("=========================================================")
    print("=== STRUCTURAL XPATH ASSERTIONS: CII (CrossIndustry) ===")
    print("=========================================================")

    # 1. BT-136, BT-137, BT-138 on line item
    line_item = tree_cii_380.find('.//ram:IncludedSupplyChainTradeLineItem', ns_cii)
    assert line_item is not None, "CII: IncludedSupplyChainTradeLineItem missing"
    line_ac = line_item.find('.//ram:SpecifiedTradeAllowanceCharge', ns_cii)
    assert line_ac is not None, "CII: SpecifiedTradeAllowanceCharge on line missing"
    
    bt136 = line_ac.find('ram:ActualAmount', ns_cii)
    assert bt136 is not None and float(bt136.text) == 500.0, f"CII BT-136 mismatch: {bt136}"
    print("  [PASS] Line BT-136 (Amount): 500.00")

    bt137 = line_ac.find('ram:BasisAmount', ns_cii)
    assert bt137 is not None and float(bt137.text) == 10000.0, f"CII BT-137 mismatch: {bt137}"
    print("  [PASS] Line BT-137 (Base Amount): 10000.00")

    bt138 = line_ac.find('ram:CalculationPercent', ns_cii)
    assert bt138 is not None and abs(float(bt138.text) - 5.0) < 0.01, f"CII BT-138 mismatch: {bt138}"
    print("  [PASS] Line BT-138 (Percentage): 5.00%")

    # 2. BT-157 on CII
    global_id = line_item.find('.//ram:SpecifiedTradeProduct/ram:GlobalID', ns_cii)
    assert global_id is not None and global_id.text == "4012345999990", "CII BT-157 value missing"
    assert global_id.attrib.get('schemeID') == "0160", f"CII BT-157 schemeID mismatch: {global_id.attrib}"
    print("  [PASS] Item BT-157 (GlobalID schemeID=0160): 4012345999990")

    # 3. BT-95 & BT-96 on document-level allowance
    doc_ac = tree_cii_380.find('.//ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge', ns_cii)
    assert doc_ac is not None, "CII: Document-level allowance missing"
    bt95 = doc_ac.find('.//ram:CategoryTradeTax/ram:CategoryCode', ns_cii)
    assert bt95 is not None and bt95.text == "AE", f"CII BT-95 mismatch: {bt95}"
    print("  [PASS] Doc Allowance BT-95 (Tax Category): AE")

    bt96 = doc_ac.find('.//ram:CategoryTradeTax/ram:RateApplicablePercent', ns_cii)
    assert bt96 is not None and float(bt96.text) == 0.0, f"CII BT-96 mismatch: {bt96}"
    print("  [PASS] Doc Allowance BT-96 (Tax Rate): 0.00%")

    bt93 = doc_ac.find('ram:BasisAmount', ns_cii)
    assert bt93 is not None and float(bt93.text) == 9500.0, f"CII BT-93 mismatch: {bt93}"
    print("  [PASS] Doc Allowance BT-93 (Base Amount): 9500.00")

    # 4. BT-120 & BT-121 (VAT Exemption)
    tax_node = tree_cii_380.find('.//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax', ns_cii)
    assert tax_node is not None, "CII: ApplicableTradeTax missing"
    bt120 = tax_node.find('ram:ExemptionReason', ns_cii)
    assert bt120 is not None and "Reverse charge" in bt120.text, f"CII BT-120 mismatch: {bt120}"
    print("  [PASS] Tax Breakdown BT-120 (Reason): " + bt120.text[:40] + "...")

    bt121 = tax_node.find('ram:ExemptionReasonCode', ns_cii)
    assert bt121 is not None and bt121.text == "VATEX-EU-AE", f"CII BT-121 mismatch: {bt121.text if bt121 is not None else None}"
    print("  [PASS] Tax Breakdown BT-121 (CEF Code): VATEX-EU-AE")

    # 5. BG-17 (Multi-Bank Accounts)
    accounts = tree_cii_380.findall('.//ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount', ns_cii)
    assert len(accounts) == 2, f"CII BG-17 expected 2 accounts, found {len(accounts)}"
    ibans = [acc.find('ram:IBANID', ns_cii).text for acc in accounts]
    assert 'DE89370400440532013000' in ibans and 'DE27200411440123456789' in ibans, f"CII IBANs mismatch: {ibans}"
    print(f"  [PASS] BG-17 (Multi-Bank Accounts in CII): {ibans}")

    # 6. BG-3 (Preceding invoice for 381)
    prec_doc = tree_cii_381.find('.//ram:ApplicableHeaderTradeSettlement/ram:InvoiceReferencedDocument', ns_cii)
    assert prec_doc is not None, "CII 381: InvoiceReferencedDocument missing"
    bt25 = prec_doc.find('ram:IssuerAssignedID', ns_cii)
    assert bt25 is not None and bt25.text == "TEST-BT-2026-001", f"CII BT-25 mismatch: {bt25}"
    print("  [PASS] Credit Note 381 BT-25 (Preceding Invoice): TEST-BT-2026-001")

    print("\n=========================================================")
    print("=== STRUCTURAL XPATH ASSERTIONS: UBL 2.1 (OASIS) =======")
    print("=========================================================")

    # 1. BT-136, BT-137, BT-138 on cac:InvoiceLine
    ubl_line = tree_ubl_380.find('.//cac:InvoiceLine', ns_ubl)
    assert ubl_line is not None, "UBL: InvoiceLine missing"
    ubl_line_ac = ubl_line.find('.//cac:AllowanceCharge', ns_ubl)
    assert ubl_line_ac is not None, "UBL: cac:AllowanceCharge on InvoiceLine missing"

    ubl_bt136 = ubl_line_ac.find('cbc:Amount', ns_ubl)
    assert ubl_bt136 is not None and float(ubl_bt136.text) == 500.0, f"UBL BT-136 mismatch: {ubl_bt136}"
    print("  [PASS] Line BT-136 (Amount): 500.00")

    ubl_bt137 = ubl_line_ac.find('cbc:BaseAmount', ns_ubl)
    assert ubl_bt137 is not None and float(ubl_bt137.text) == 10000.0, f"UBL BT-137 mismatch: {ubl_bt137}"
    print("  [PASS] Line BT-137 (Base Amount): 10000.00")

    ubl_bt138 = ubl_line_ac.find('cbc:MultiplierFactorNumeric', ns_ubl)
    # Critical UBL rule: decimal factor 0.05 (NOT 5.0)
    assert ubl_bt138 is not None and abs(float(ubl_bt138.text) - 0.05) < 0.001, f"UBL BT-138 mismatch: {ubl_bt138.text if ubl_bt138 is not None else None}"
    print(f"  [PASS] Line BT-138 (MultiplierFactorNumeric decimal factor): {ubl_bt138.text}")

    # 2. Document level allowance in UBL
    ubl_doc_ac = tree_ubl_380.find('.//cac:AllowanceCharge', ns_ubl)
    assert ubl_doc_ac is not None, "UBL: Root cac:AllowanceCharge missing"
    ubl_bt95 = ubl_doc_ac.find('.//cac:TaxCategory/cbc:ID', ns_ubl)
    assert ubl_bt95 is not None and ubl_bt95.text == "AE", f"UBL BT-95 mismatch: {ubl_bt95}"
    print("  [PASS] Doc Allowance BT-95 (Tax Category): AE")

    ubl_bt93 = ubl_doc_ac.find('cbc:BaseAmount', ns_ubl)
    assert ubl_bt93 is not None and float(ubl_bt93.text) == 9500.0, f"UBL BT-93 mismatch: {ubl_bt93}"
    print("  [PASS] Doc Allowance BT-93 (Base Amount): 9500.00")

    ubl_bt94 = ubl_doc_ac.find('cbc:MultiplierFactorNumeric', ns_ubl)
    assert ubl_bt94 is not None and abs(float(ubl_bt94.text) - 0.02) < 0.001, f"UBL BT-94 mismatch: {ubl_bt94}"
    print(f"  [PASS] Doc Allowance BT-94 (MultiplierFactorNumeric decimal factor): {ubl_bt94.text}")

    # 3. BT-120 & BT-121 in UBL
    ubl_tax_cat = tree_ubl_380.find('.//cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory', ns_ubl)
    assert ubl_tax_cat is not None, "UBL: TaxCategory missing"
    ubl_bt120 = ubl_tax_cat.find('cbc:TaxExemptionReason', ns_ubl)
    assert ubl_bt120 is not None and "Reverse charge" in ubl_bt120.text, f"UBL BT-120 mismatch: {ubl_bt120}"
    print("  [PASS] Tax Breakdown BT-120 (Reason): " + ubl_bt120.text[:40] + "...")

    ubl_bt121 = ubl_tax_cat.find('cbc:TaxExemptionReasonCode', ns_ubl)
    assert ubl_bt121 is not None and ubl_bt121.text == "VATEX-EU-AE", f"UBL BT-121 mismatch: {ubl_bt121.text if ubl_bt121 is not None else None}"
    print("  [PASS] Tax Breakdown BT-121 (CEF Code): VATEX-EU-AE")

    # 4. BG-17 (Multi-Bank Accounts as multiple cac:PaymentMeans)
    ubl_pm_nodes = tree_ubl_380.findall('.//cac:PaymentMeans', ns_ubl)
    assert len(ubl_pm_nodes) == 2, f"UBL BG-17 expected 2 PaymentMeans, found {len(ubl_pm_nodes)}"
    ubl_ibans = [pm.find('.//cac:PayeeFinancialAccount/cbc:ID', ns_ubl).text for pm in ubl_pm_nodes]
    assert 'DE89370400440532013000' in ubl_ibans and 'DE27200411440123456789' in ubl_ibans, f"UBL IBANs mismatch: {ubl_ibans}"
    print(f"  [PASS] BG-17 (Multiple cac:PaymentMeans entries): {ubl_ibans}")

    # 5. Preceding invoice BT-25 for 381 in UBL
    ubl_prec = tree_ubl_381.find('.//cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID', ns_ubl)
    assert ubl_prec is not None and ubl_prec.text == "TEST-BT-2026-001", f"UBL BT-25 mismatch: {ubl_prec}"
    print("  [PASS] Credit Note 381 BT-25 (BillingReference): TEST-BT-2026-001")

    # 6. Optional due date on 381
    ubl_due_date = tree_ubl_381.find('cbc:DueDate', ns_ubl)
    assert ubl_due_date is None, "UBL DueDate should be omitted when not provided on 381"
    print("  [PASS] Credit Note 381 DueDate correctly omitted when not provided")

    # MUSTANG VALIDATION
    os.makedirs("output", exist_ok=True)
    xml_out_path = os.path.join("output", "test_verification_facturx.xml")
    with open(xml_out_path, "w", encoding="utf-8") as f:
        f.write(cii_380_xml)

    print("\n=========================================================")
    print("=== MUSTANGPROJECT SCHEMATRON VALIDATION (CII) =======")
    print("=========================================================")
    res = subprocess.run(['java', '-jar', 'Mustang-CLI.jar', '--action', 'validate', '--source', xml_out_path], capture_output=True, text=True)
    is_valid = 'summary status="valid"' in res.stdout
    print(f"  Mustang Validation: {'PASS (VALID)' if is_valid else 'FAIL'}")
    if not is_valid:
        print("Mustang output:\n", res.stdout)
    assert is_valid, "Mustang validation failed for generated Factur-X XML!"

    print("\nALL STRUCTURAL XPATH AND SCHEMATRON CHECKS COMPLETED SUCCESSFULLY!")

if __name__ == "__main__":
    run_tests()
