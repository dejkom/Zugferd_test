import os
import json
import pypdf
from typing import Optional
from openai import OpenAI
from backend.models import InvoiceData

import docx

def extract_raw_text_from_pdf(pdf_path: str) -> str:
    reader = pypdf.PdfReader(pdf_path)
    full_text = []
    for idx, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        full_text.append(f"--- PAGE {idx+1} ---\n{text}")
    return "\n\n".join(full_text)

def extract_raw_text_from_docx(docx_path: str) -> str:
    doc = docx.Document(docx_path)
    full_text = []
    for p in doc.paragraphs:
        if p.text.strip():
            full_text.append(p.text.strip())
    # Extract from tables
    for table in doc.tables:
        for row in table.rows:
            row_text = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if row_text:
                full_text.append(" | ".join(row_text))
    return "\n".join(full_text)

def extract_raw_text_from_doc(file_path: str) -> str:
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".docx":
        return extract_raw_text_from_docx(file_path)
    return extract_raw_text_from_pdf(file_path)

SYSTEM_PROMPT = """You are an expert accounting system and invoice parser specialized in European standard EN 16931 and ZUGFeRD / Factur-X specifications.
Your goal is to parse raw text extracted from invoice PDFs into a clean, complete, structured InvoiceData object.

Instructions:
1. Identify Invoice Number, Issue Date (format YYYY-MM-DD or DD.MM.YYYY), Due Date, and Currency (e.g. EUR).
2. Identify Seller (Supplier) details: Name, Street, Postcode, City, Country Code (ISO alpha-2 e.g. DE, SI), VAT ID (e.g. DE814113634), Tax Registration Number (e.g. HRB number or local tax number), and Contact details.
3. Identify Buyer (Customer) details: Name, Street, Postcode, City, Country Code (e.g. SI, DE), VAT ID (e.g. SI52093808), and Buyer Reference (if present).
4. Payment information: IBAN (remove spaces), BIC/SWIFT, Bank Name, and Payment Terms text.
5. Line items: For each line item, extract name/description, quantity (default 1.0 if not listed), unit code (e.g. C62 for pieces/units, HUR for hours, or DAY), unit price, net line total amount, tax category code ('S' for standard, 'AE' for reverse charge, 'Z' for zero, 'E' for exempt), and tax rate percent.
6. Tax breakdown: Provide tax basis amount, tax percent, tax amount, and exemption reason if reverse charge (e.g. "Reverse charge / The beneficiary is responsible for the taxation of this amount").
7. Totals: Calculate or extract line_net_total, tax_total, grand_total, and due_payable_amount. Verify that line_net_total + tax_total == grand_total (and due_payable_amount).
8. Confidence scoring: In confidence_scores dictionary, assign 'HIGH', 'MEDIUM', or 'LOW' for each field:
   - 'HIGH' if the field was clearly labeled and explicitly printed on the document.
   - 'MEDIUM' if inferred, calculated from other numbers, or slightly ambiguous.
   - 'LOW' if guessed, defaulted, or hard to distinguish on the invoice.
   Keys: 'invoice_number', 'issue_date', 'currency', 'buyer_reference', 'seller_name', 'seller_vat', 'seller_street', 'seller_city', 'buyer_name', 'buyer_vat', 'buyer_street', 'buyer_city', 'iban', 'bic', 'total_net', 'total_tax', 'total_grand', 'total_due'.
"""

def extract_invoice_data(file_path: str, api_key: Optional[str] = None):
    api_key = api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OpenAI API Key is required. Please set OPENAI_API_KEY in environment or pass it in.")
    
    client = OpenAI(api_key=api_key)
    raw_text = extract_raw_text_from_doc(file_path)
    
    completion = client.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Please parse this invoice:\n\n{raw_text}"}
        ],
        response_format=InvoiceData,
    )
    
    parsed_data = completion.choices[0].message.parsed
    usage = completion.usage
    
    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0
    total_tokens = usage.total_tokens if usage else 0
    
    # Official OpenAI gpt-4o pricing: $2.50 / 1M prompt tokens, $10.00 / 1M completion tokens
    cost = (prompt_tokens * (2.50 / 1_000_000)) + (completion_tokens * (10.00 / 1_000_000))
    
    usage_info = {
        "model": "gpt-4o",
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "estimated_cost_usd": round(cost, 6),
        "formatted_cost": f"${cost:.4f}"
    }
    
    return parsed_data, usage_info
