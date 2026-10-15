import os
import re
from typing import List, Optional
from pydantic import BaseModel, Field

class TaxSummaryItem(BaseModel):
    tax_category_code: str = Field(default="S", description="DutyTaxFeeTypeCode: S (Standard), Z (Zero), E (Exempt), AE (Vat reverse charge), G (Export), K (Intra-Community)")
    tax_percent: float = Field(default=0.0, description="Tax rate percentage e.g. 19.0 or 0.0")
    basis_amount: float = Field(..., description="Tax basis taxable amount")
    tax_amount: float = Field(default=0.0, description="Calculated tax amount for this category")
    exemption_reason: Optional[str] = Field(None, description="Reason for tax exemption or reverse charge if applicable (BT-120)")
    exemption_reason_code: Optional[str] = Field(None, description="VAT Exemption Reason Code (BT-121)")

class DocumentDiscount(BaseModel):
    reason: Optional[str] = Field(default="", description="Reason for discount or charge (BT-97 / BT-104)")
    percentage: Optional[float] = Field(default=None, description="Discount or charge percentage (BT-94 / BT-101)")
    amount: float = Field(default=0.0, description="Monetary amount (BT-92 / BT-99)")
    charge_indicator: bool = Field(default=False, description="False = Allowance/Discount (-), True = Charge/Surcharge (+)")
    tax_category_code: str = Field(default="S", description="Tax category code (BT-95 / BT-102): S, Z, E, AE, K, G")
    tax_percent: float = Field(default=19.0, description="Tax rate percentage (BT-96 / BT-103)")
    base_amount: Optional[float] = Field(default=None, description="Allowance or charge base amount (BT-93 / BT-100)")

class LineAllowanceCharge(BaseModel):
    """BG-27 / BG-28: Line-level allowance or charge"""
    charge_indicator: bool = Field(default=False, description="False = Allowance (BT-136), True = Charge (BT-141)")
    amount: float = Field(default=0.0, description="Amount (BT-136 or BT-141)")
    percentage: Optional[float] = Field(default=None, description="Percentage (BT-138 or BT-143)")
    base_amount: Optional[float] = Field(default=None, description="Allowance base amount (BT-137) or charge base amount (BT-142)")
    reason: Optional[str] = Field(default=None, description="Reason (BT-139 or BT-144)")

class DeliveryDetails(BaseModel):
    recipient_name: Optional[str] = Field(None, description="Ship-to party legal/trade name (BT-70)")
    location_id: Optional[str] = Field(None, description="Ship-to location identifier / Abladestelle (BT-71)")
    location_scheme: Optional[str] = Field(default="0088", description="Location scheme e.g. 0088 (GLN) (BT-71-1)")
    street: Optional[str] = Field(None, description="Ship-to street address (BT-75)")
    city: Optional[str] = Field(None, description="Ship-to city name (BT-77)")
    postcode: Optional[str] = Field(None, description="Ship-to postcode (BT-76)")
    country_code: str = Field(default="DE", description="Ship-to ISO 3166-1 alpha-2 country code (BT-80)")
    delivery_date: Optional[str] = Field(None, description="Actual delivery date YYYY-MM-DD (BT-72)")
    despatch_advice_id: Optional[str] = Field(None, description="Despatch advice reference / Lieferschein-Nr. (BT-16)")
    despatch_advice_reference: Optional[str] = Field(None, description="Alias for despatch advice reference (BT-16)")

class InvoiceLineItem(BaseModel):
    line_id: str = Field(default="1", description="Line number / identifier (BT-126)")
    name: str = Field(..., description="Item or service description (BT-153)")
    description: Optional[str] = Field(None, description="Detailed item description (BT-154)")
    quantity: float = Field(default=1.0, description="Quantity (BT-129)")
    unit_code: str = Field(default="C62", description="UN/ECE Rec 20 unit code (BT-130)")
    unit_price: float = Field(..., description="Net unit price (BT-146)")
    gross_price: Optional[float] = Field(None, description="Gross unit price before discount (BT-148)")
    line_total_amount: float = Field(..., description="Line net total amount (BT-131)")
    tax_category_code: str = Field(default="S", description="Tax category code (BT-151): S, Z, E, AE, K, G")
    tax_percent: float = Field(default=0.0, description="Tax rate percentage (BT-152)")
    discount_amount: float = Field(default=0.0, description="Line item discount amount (BT-136/BT-147)")
    discount_percent: Optional[float] = Field(None, description="Line item discount percent (BT-138)")
    
    # EN 16931 Line Item Identifiers & Price Base
    seller_item_id: Optional[str] = Field(None, description="Seller item identifier / Article code (BT-155)")
    buyer_item_id: Optional[str] = Field(None, description="Buyer item identifier / Customer part number (BT-156)")
    standard_item_id: Optional[str] = Field(None, description="Standard item identifier / GTIN / EAN (BT-157)")
    standard_item_id_scheme: Optional[str] = Field(default="0160", description="Standard item identifier scheme e.g. 0160 (BT-157-1)")
    item_serial_number: Optional[str] = Field(None, description="Item serial or lot number / Object identifier (BT-128)")
    order_line_reference: Optional[str] = Field(None, description="Purchase order line reference (BT-132)")
    price_base_quantity: Optional[float] = Field(default=1.0, description="Item price base quantity (BT-149)")
    price_base_unit: Optional[str] = Field(None, description="Item price base quantity unit (BT-150)")
    item_attribute: Optional[str] = Field(None, description="Item attribute name/value (BG-32)")
    allowances_charges: List[LineAllowanceCharge] = Field(default_factory=list, description="Item-level allowances and charges (BG-27 & BG-28)")

class TradeParty(BaseModel):
    name: str = Field(..., description="Company or individual legal name (BT-27 / BT-44)")
    trading_name: Optional[str] = Field(None, description="Trading name (BT-28 / BT-45)")
    company_id: Optional[str] = Field(None, description="Company identification number (BT-29 / BT-46)")
    seller_identifier: Optional[str] = Field(None, description="Seller identifier / Supplier Code (BT-29)")
    our_supplier_code: Optional[str] = Field(None, description="Our supplier code at buyer (BT-29)")
    company_legal_form: Optional[str] = Field(None, description="Company Registration / Commercial Register Number (BT-30)")
    legal_info: Optional[str] = Field(None, description="Additional Legal Information e.g. Court of Registration, Managing Directors / Geschäftsführer (BT-33)")
    endpoint_id: Optional[str] = Field(None, description="Electronic Address / Peppol Endpoint ID (BT-34 / BT-49)")
    endpoint_scheme: Optional[str] = Field(None, description="Electronic Address Scheme (e.g. 0088, 9930, 9948, 0208)")
    vat_id: Optional[str] = Field(None, description="VAT ID starting with 2-letter country code (BT-31 / BT-48)")
    tax_registration_id: Optional[str] = Field(None, description="Local tax number or commercial register (BT-32 / BT-47)")
    tax_number: Optional[str] = Field(None, description="Local tax number / Steuernummer (FC)")
    street: Optional[str] = Field(None, description="Street and building number (BT-35 / BT-50)")
    address_line_2: Optional[str] = Field(None, description="Address line 2 / Additional address line (BT-36 / BT-51)")
    address_line_3: Optional[str] = Field(None, description="Address line 3 (BT-162 / BT-163)")
    city: Optional[str] = Field(None, description="City (BT-37 / BT-52)")
    postcode: Optional[str] = Field(None, description="Postal code (BT-38 / BT-53)")
    country_code: str = Field(default="DE", description="ISO 3166-1 alpha-2 country code (BT-40 / BT-55)")
    contact_name: Optional[str] = Field(None, description="Contact person name (BT-41 / BT-56)")
    contact_phone: Optional[str] = Field(None, description="Contact telephone (BT-42 / BT-57)")
    contact_email: Optional[str] = Field(None, description="Contact email (BT-43 / BT-58)")
    court_registry: Optional[str] = Field(None, description="Court registry / Vpis v sodni register (BT-30)")

class FactoringPayee(BaseModel):
    """BG-10: Factoring / Alternate Payee details"""
    name: Optional[str] = Field(None, description="Payee legal name (BT-59)")
    payee_id: Optional[str] = Field(None, description="Payee identifier (BT-60)")
    vat_id: Optional[str] = Field(None, description="Payee VAT ID or registration ID (BT-61)")
    iban: Optional[str] = Field(None, description="Payee IBAN TRR (BT-84)")
    bic: Optional[str] = Field(None, description="Payee BIC / SWIFT (BT-86)")
    bank_name: Optional[str] = Field(None, description="Payee Bank Name (BT-85)")
    notice_text: Optional[str] = Field(None, description="Assignment notice text / Obvestilo o odstopu terjatve")

class BankAccount(BaseModel):
    """BG-17: Credit transfer financial account"""
    iban: str = Field(..., description="IBAN without spaces (BT-84)")
    bank_name: Optional[str] = Field(None, description="Bank Name / Account Name (BT-85)")
    bic: Optional[str] = Field(None, description="BIC / SWIFT code (BT-86)")

class PaymentDetails(BaseModel):
    iban: Optional[str] = Field(None, description="Primary IBAN (BT-84)")
    bic: Optional[str] = Field(None, description="Primary BIC (BT-86)")
    bank_name: Optional[str] = Field(None, description="Primary Bank Name (BT-85)")
    bank_accounts: List[BankAccount] = Field(default_factory=list, description="Multiple Bank Accounts (BG-17)")
    payment_terms: Optional[str] = Field(None, description="Payment terms description (BT-20)")
    payment_reference: Optional[str] = Field(None, description="Remittance payment reference / Sklic (BT-83)")
    payment_means_code: str = Field(default="58", description="Payment means code (BT-81: 58=SEPA credit transfer, 30=Credit transfer, etc.)")
    payment_means_name: Optional[str] = Field(None, description="Payment means description text (BT-82)")
    factoring_payee: Optional[FactoringPayee] = Field(None, description="Factoring / alternate payee (BG-10)")

class FieldConfidenceScores(BaseModel):
    invoice_number: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    issue_date: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    currency: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    buyer_reference: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    seller_name: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    seller_vat: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    seller_street: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    seller_city: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    buyer_name: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    buyer_vat: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    buyer_street: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    buyer_city: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    iban: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    bic: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    total_net: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    total_tax: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    total_grand: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")
    total_due: str = Field(default="HIGH", description="Confidence: HIGH, MEDIUM, or LOW")

class InvoiceData(BaseModel):
    invoice_number: str = Field(..., description="Invoice identifier / number (BT-1)")
    issue_date: str = Field(..., description="Issue date in YYYY-MM-DD or DD.MM.YYYY format (BT-2)")
    due_date: Optional[str] = Field(None, description="Due date in YYYY-MM-DD or DD.MM.YYYY format (BT-9)")
    delivery_date: Optional[str] = Field(None, description="Delivery date (BT-72)")
    currency: str = Field(default="EUR", description="ISO 4217 Currency code (BT-5)")
    invoice_type_code: str = Field(default="380", description="380: Invoice, 381: Credit Note, 384: Corrected (BT-3)")
    document_format: Optional[str] = Field(default="zugferd", description="'zugferd', 'orderx', 'eslog', 'ubl'")
    buyer_reference: Optional[str] = Field(None, description="Buyer reference or Leitweg-ID (BT-10)")
    
    # EN 16931 Document References
    purchase_order_number: Optional[str] = Field(None, description="Purchase order reference (BT-13)")
    purchase_order_date: Optional[str] = Field(None, description="Purchase order date (BT-14)")
    sales_order_number: Optional[str] = Field(None, description="Sales order reference / Interno naročilo (BT-14)")
    cost_center: Optional[str] = Field(None, description="Buyer accounting cost center / Stroškovno mesto (BT-19)")
    project_reference: Optional[str] = Field(None, description="Project reference / Projekt (BT-11)")
    contract_reference: Optional[str] = Field(None, description="Contract reference / Pogodba (BT-12)")
    despatch_advice_reference: Optional[str] = Field(None, description="Despatch advice reference / Dobavnica (BT-16)")
    
    notes: List[str] = Field(default_factory=list, description="General document notes or remarks (BT-22: IncludedNote)")
    invoice_notes: Optional[List[str]] = Field(None, description="Alias for notes (BT-22)")
    
    # Preceding invoice for Credit Notes (381) and Corrected Invoices (384) (BG-3)
    preceding_invoice_number: Optional[str] = Field(None, description="Reference to preceding invoice (BT-25)")
    preceding_invoice_date: Optional[str] = Field(None, description="Issue date of preceding invoice (BT-26)")
    credit_note_reason: Optional[str] = Field(None, description="Reason for credit note / Razlog za dobropis")
    
    # Service / Invoicing period
    service_period_start: Optional[str] = Field(None, description="Service / billing period start date (BT-73)")
    service_period_end: Optional[str] = Field(None, description="Service / billing period end date (BT-74)")
    
    # Prepayment / paid amounts & Document discounts
    prepaid_amount: float = Field(default=0.0, description="Amount already settled/paid (BT-113)")
    discounts: List[DocumentDiscount] = Field(default_factory=list, description="Document-level discounts/rebates (BG-20/BG-21)")
    vat_exemption_reason: Optional[str] = Field(None, description="Exemption reason text for tax category (BT-120)")
    vat_exemption_reason_code: Optional[str] = Field(None, description="Exemption reason code for tax category (BT-121)")
    
    seller: TradeParty = Field(..., description="Supplier / Seller details (BG-4)")
    buyer: TradeParty = Field(..., description="Customer / Buyer details (BG-7)")
    delivery: Optional[DeliveryDetails] = Field(default=None, description="Delivery / Shipping destination details (BG-13)")
    payment: PaymentDetails = Field(default_factory=PaymentDetails, description="Payment details (BG-16)")
    factoring_payee: Optional[FactoringPayee] = Field(None, description="Factoring / alternate payee (BG-10)")
    
    items: List[InvoiceLineItem] = Field(default_factory=list, description="List of line items")
    tax_breakdown: List[TaxSummaryItem] = Field(default_factory=list, description="Tax summary per rate")
    
    line_net_total: float = Field(..., description="Sum of line item net amounts")
    tax_total: float = Field(default=0.0, description="Total VAT/tax amount")
    grand_total: float = Field(..., description="Total invoice amount including VAT")
    due_payable_amount: float = Field(..., description="Amount due for payment")

    confidence_scores: FieldConfidenceScores = Field(
        default_factory=FieldConfidenceScores,
        description="Confidence ranking per field ('HIGH', 'MEDIUM', 'LOW')"
    )
