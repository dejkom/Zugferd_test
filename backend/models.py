import os
import re
from typing import List, Optional
from pydantic import BaseModel, Field

class TaxSummaryItem(BaseModel):
    tax_category_code: str = Field(default="S", description="DutyTaxFeeTypeCode: S (Standard), Z (Zero), E (Exempt), AE (Vat reverse charge)")
    tax_percent: float = Field(default=0.0, description="Tax rate percentage e.g. 19.0 or 0.0")
    basis_amount: float = Field(..., description="Tax basis taxable amount")
    tax_amount: float = Field(default=0.0, description="Calculated tax amount for this category")
    exemption_reason: Optional[str] = Field(None, description="Reason for tax exemption or reverse charge if applicable")

class DocumentDiscount(BaseModel):
    reason: Optional[str] = Field(default="", description="Reason for discount, e.g. Early payment discount")
    percentage: Optional[float] = Field(default=None, description="Discount percentage")
    amount: float = Field(default=0.0, description="Discount amount")

class DeliveryDetails(BaseModel):
    recipient_name: Optional[str] = Field(None, description="Delivery recipient name")
    delivery_date: Optional[str] = Field(None, description="Actual delivery date YYYY-MM-DD")
    location_id: Optional[str] = Field(None, description="GLN or location identifier")
    location_scheme: Optional[str] = Field(default="0088", description="Location scheme e.g. 0088 (GLN)")
    street: Optional[str] = Field(None, description="Delivery street")
    city: Optional[str] = Field(None, description="Delivery city")
    postcode: Optional[str] = Field(None, description="Delivery postal code")
    country_code: Optional[str] = Field(default="DE", description="Delivery ISO country code")

class InvoiceLineItem(BaseModel):
    line_id: str = Field(default="1", description="Line number / identifier")
    name: str = Field(..., description="Item or service description")
    quantity: float = Field(default=1.0, description="Quantity")
    unit_code: str = Field(default="C62", description="UN/ECE Rec 20 unit code (e.g. C62 for piece/one, HUR for hour, DAY for day)")
    unit_price: float = Field(..., description="Net unit price")
    line_total_amount: float = Field(..., description="Line net total amount (quantity * unit_price)")
    tax_category_code: str = Field(default="S", description="Tax category code: S, Z, E, AE, K")
    tax_percent: float = Field(default=0.0, description="Tax rate percentage")
    discount_amount: float = Field(default=0.0, description="Line item discount amount")
    discount_percent: Optional[float] = Field(None, description="Line item discount percent")

class TradeParty(BaseModel):
    name: str = Field(..., description="Company or individual legal name")
    vat_id: Optional[str] = Field(None, description="VAT ID starting with 2-letter country code (e.g. DE814113634, SI52093808)")
    tax_registration_id: Optional[str] = Field(None, description="Local tax number or commercial register (e.g. HRB 265115)")
    street: Optional[str] = Field(None, description="Street and building number")
    city: Optional[str] = Field(None, description="City")
    postcode: Optional[str] = Field(None, description="Postal code")
    country_code: str = Field(default="DE", description="ISO 3166-1 alpha-2 country code (e.g. DE, SI, AT, FR)")
    contact_name: Optional[str] = Field(None, description="Contact person name")
    contact_phone: Optional[str] = Field(None, description="Contact telephone")
    contact_email: Optional[str] = Field(None, description="Contact email")

class PaymentDetails(BaseModel):
    iban: Optional[str] = Field(None, description="IBAN without spaces")
    bic: Optional[str] = Field(None, description="BIC / SWIFT code")
    bank_name: Optional[str] = Field(None, description="Bank institution name")
    payment_terms: Optional[str] = Field(None, description="Payment terms description (e.g. payment due end of next month)")
    payment_means_code: str = Field(default="58", description="Payment means code (58: SEPA credit transfer, 30: Credit transfer, 10: Cash, etc.)")

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
    invoice_number: str = Field(..., description="Invoice identifier / number")
    issue_date: str = Field(..., description="Issue date in YYYY-MM-DD or YYYYMMDD format")
    due_date: Optional[str] = Field(None, description="Due date in YYYY-MM-DD or YYYYMMDD format")
    currency: str = Field(default="EUR", description="ISO 4217 Currency code, e.g. EUR, USD")
    invoice_type_code: str = Field(default="380", description="380: Invoice, 381: Credit Note, 384: Corrected, 326: Partial, 386: Prepayment, 220: Order-X")
    document_format: Optional[str] = Field(default="zugferd", description="'zugferd' or 'orderx'")
    buyer_reference: Optional[str] = Field(None, description="Buyer reference or order number or Leitweg-ID")
    purchase_order_number: Optional[str] = Field(None, description="Purchase order reference ID")
    notes: List[str] = Field(default_factory=list, description="General document notes or remarks")
    
    # Preceding invoice for Credit Notes (381) and Corrected Invoices (384)
    preceding_invoice_number: Optional[str] = Field(None, description="Reference to preceding invoice being credited/corrected")
    preceding_invoice_date: Optional[str] = Field(None, description="Issue date of preceding invoice")
    
    # Service / Invoicing period
    service_period_start: Optional[str] = Field(None, description="Service / billing period start date")
    service_period_end: Optional[str] = Field(None, description="Service / billing period end date")
    
    # Prepayment / paid amounts & Document discounts
    prepaid_amount: float = Field(default=0.0, description="Amount already settled/paid")
    discounts: List[DocumentDiscount] = Field(default_factory=list, description="Document-level discounts/rebates")
    vat_exemption_reason: Optional[str] = Field(None, description="Exemption reason text for tax category E")
    
    seller: TradeParty = Field(..., description="Supplier / Seller details")
    buyer: TradeParty = Field(..., description="Customer / Buyer details")
    delivery: Optional[DeliveryDetails] = Field(default=None, description="Delivery / Shipping destination details")
    payment: PaymentDetails = Field(default_factory=PaymentDetails, description="Payment details")
    
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
