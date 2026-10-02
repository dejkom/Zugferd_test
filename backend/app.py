import os
import shutil
import uuid
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.models import InvoiceData
from backend.extractor import extract_invoice_data, extract_raw_text_from_doc
from backend.xml_builder import generate_facturx_xml, generate_orderx_xml
from backend.pdf_embedder import build_pdfa3_zugferd
from backend.pdf_generator import generate_invoice_pdf_from_data
from backend.mustang_wrapper import validate_zugferd_pdf

app = FastAPI(title="ZUGFeRD & Factur-X Studio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "uploads"))
OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "outputs"))
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

class ExtractionRequest(BaseModel):
    file_id: str
    api_key: Optional[str] = None
    prompt_id: Optional[str] = None
    prompt_text: Optional[str] = None

class GenerateXmlRequest(BaseModel):
    invoice_data: InvoiceData
    profile: Optional[str] = "EN16931"

class CombineRequest(BaseModel):
    file_id: str
    xml_content: str
    profile: Optional[str] = "EN16931"
    invoice_data: Optional[dict] = None
    token_usage: Optional[dict] = None
    source_type: Optional[str] = "pdf"
    layout: Optional[str] = "layout1"

class CreateFromManualRequest(BaseModel):
    invoice_data: InvoiceData
    profile: Optional[str] = "EN16931"
    layout: Optional[str] = "original"
    file_id: Optional[str] = None
    token_usage: Optional[dict] = None
    generator: Optional[str] = "v1"
    source_type: Optional[str] = "manual"

@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    filename_lower = file.filename.lower()
    if not (filename_lower.endswith(".pdf") or filename_lower.endswith(".docx")):
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported.")
    
    file_id = f"{uuid.uuid4().hex}_{file.filename}"
    target_path = os.path.join(UPLOAD_DIR, file_id)
    
    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    try:
        raw_text = extract_raw_text_from_doc(target_path)
    except Exception as e:
        raw_text = f"Could not preview text: {str(e)}"

    return {
        "file_id": file_id,
        "filename": file.filename,
        "raw_text_preview": raw_text[:800]
    }

@app.post("/api/upload-sample")
def upload_sample_invoice():
    sample_source = os.path.join(os.path.dirname(__file__), "..", "documentsforconversion", "C2025012_zig.pdf")
    if not os.path.exists(sample_source):
        raise HTTPException(status_code=404, detail="Sample PDF not found.")
    
    file_id = f"sample_{uuid.uuid4().hex}_C2025012_zig.pdf"
    target_path = os.path.join(UPLOAD_DIR, file_id)
    shutil.copyfile(sample_source, target_path)
    
    try:
        raw_text = extract_raw_text_from_pdf(target_path)
    except Exception as e:
        raw_text = f"Could not preview text: {str(e)}"

    return {
        "file_id": file_id,
        "filename": "C2025012_zig.pdf",
        "raw_text_preview": raw_text[:800]
    }

@app.post("/api/extract")
async def extract_pdf(req: ExtractionRequest):
    target_path = os.path.join(UPLOAD_DIR, req.file_id)
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="Uploaded file not found.")
    
    # Resolve system prompt: user request prompt_text > prompt_id from settings > active_prompt_id from settings > default
    sys_settings = load_system_settings()
    custom_prompt = None
    if req.prompt_text and req.prompt_text.strip():
        custom_prompt = req.prompt_text.strip()
    elif req.prompt_id and "extraction_prompts" in sys_settings:
        prompts = sys_settings.get("extraction_prompts", {})
        if req.prompt_id in prompts:
            custom_prompt = prompts[req.prompt_id].get("content")
    elif "active_prompt_id" in sys_settings and "extraction_prompts" in sys_settings:
        active_id = sys_settings.get("active_prompt_id")
        prompts = sys_settings.get("extraction_prompts", {})
        if active_id in prompts:
            custom_prompt = prompts[active_id].get("content")

    try:
        data, usage_info = extract_invoice_data(target_path, api_key=req.api_key, system_prompt=custom_prompt)
        # Also build initial XML for instant preview
        xml_content = generate_facturx_xml(data)
        return {
            "invoice_data": data.model_dump(),
            "xml_preview": xml_content,
            "usage": usage_info
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate-xml")
async def generate_xml(req: GenerateXmlRequest):
    try:
        is_orderx = getattr(req.invoice_data, "document_format", "zugferd") == "orderx" or req.invoice_data.invoice_type_code == "220"
        if is_orderx:
            xml_content = generate_orderx_xml(req.invoice_data, profile=req.profile or "BASIC")
        else:
            xml_content = generate_facturx_xml(req.invoice_data, profile=req.profile or "EN16931")
        return {"xml_content": xml_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/combine")
def combine_and_validate(req: CombineRequest):
    source_pdf = os.path.join(UPLOAD_DIR, req.file_id)
    if not os.path.exists(source_pdf):
        raise HTTPException(status_code=404, detail="Source PDF file not found.")
    
    work_id = uuid.uuid4().hex
    xml_path = os.path.join(OUTPUT_DIR, f"{work_id}_factur-x.xml")
    with open(xml_path, "w", encoding="utf-8") as f:
        f.write(req.xml_content)
    
    # If source is DOCX, generate visual PDF first
    if source_pdf.lower().endswith(".docx"):
        pdf_source_path = os.path.join(UPLOAD_DIR, f"{req.file_id}.pdf")
        # Try generating visual PDF using docx data or pdf generator
        try:
            # First extract data from docx or use generated visual representation
            # If docx2pdf works with Word, otherwise generate crisp layout
            from backend.models import InvoiceData
            import docx
            # We convert or generate visual PDF
            # Build clean visual PDF representation of the invoice
            if not os.path.exists(pdf_source_path):
                # Generate visual layout from invoice xml data
                # Or use docx text to create a clean PDF
                from backend.pdf_generator import generate_invoice_pdf_from_data
                temp_inv = extract_invoice_data(source_pdf)[0]
                generate_invoice_pdf_from_data(temp_inv, pdf_source_path)
            source_pdf = pdf_source_path
        except Exception:
            pass

    out_pdf_filename = f"zugferd_{os.path.splitext(req.file_id)[0]}.pdf"
    out_pdf_path = os.path.join(OUTPUT_DIR, out_pdf_filename)
        
    try:
        build_pdfa3_zugferd(
            input_pdf_path=source_pdf,
            facturx_xml_path=xml_path,
            output_pdf_path=out_pdf_path,
            profile=req.profile or "EN16931"
        )
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to build PDF/A-3: {str(e)}",
            "report": None
        }
        
    validation_res = validate_zugferd_pdf(out_pdf_path)
    
    # Record history if invoice_data was supplied
    if req.invoice_data:
        try:
            record_invoice_history(
                invoice_data=req.invoice_data,
                output_filename=out_pdf_filename,
                source_type=req.source_type or "pdf",
                layout=req.layout or "layout1",
                xml_content=req.xml_content,
                is_valid=validation_res.get("isValid", True),
                token_usage=req.token_usage
            )
        except Exception as e:
            print("Could not record history in combine:", e)

    return {
        "success": True,
        "output_filename": out_pdf_filename,
        "validation": validation_res
    }

LOGO_PATH = os.path.join(UPLOAD_DIR, "company_logo.png")

@app.post("/api/upload-logo")
async def upload_company_logo(file: UploadFile = File(...)):
    filename_lower = file.filename.lower()
    if not (filename_lower.endswith(".png") or filename_lower.endswith(".jpg") or filename_lower.endswith(".jpeg")):
        raise HTTPException(status_code=400, detail="Only PNG, JPG, and JPEG images are supported for logos.")
    
    with open(LOGO_PATH, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    return {"success": True, "filename": file.filename}

@app.get("/api/logo-status")
def get_logo_status():
    exists = os.path.exists(LOGO_PATH)
    return {"has_logo": exists}

@app.get("/api/logo")
def get_company_logo():
    if not os.path.exists(LOGO_PATH):
        raise HTTPException(status_code=404, detail="No logo uploaded.")
    return FileResponse(LOGO_PATH)

@app.delete("/api/logo")
def delete_company_logo():
    if os.path.exists(LOGO_PATH):
        try:
            os.remove(LOGO_PATH)
        except Exception:
            pass
    return {"success": True}

@app.post("/api/create-invoice-pdfa3")
def create_invoice_pdfa3_from_manual(req: CreateFromManualRequest):
    """
    Direct creation scenario:
    Renders visual PDF from manual form data with optional custom company logo,
    generates factur-x.xml, embeds as PDF/A-3, and validates.
    """
    work_id = uuid.uuid4().hex
    visual_pdf_path = os.path.join(OUTPUT_DIR, f"{work_id}_visual.pdf")
    xml_path = os.path.join(OUTPUT_DIR, f"{work_id}_factur-x.xml")
    chosen_layout = req.layout or "original"
    clean_inv_num = (req.invoice_data.invoice_number or "invoice").replace("/", "_").replace("\\", "_")
    final_pdf_name = f"zugferd_{chosen_layout}_{clean_inv_num}_{work_id[:6]}.pdf"
    final_pdf_path = os.path.join(OUTPUT_DIR, final_pdf_name)

    # 1. Determine base PDF: If original format chosen and file uploaded, use original PDF; otherwise synthesize layout
    is_original_format = chosen_layout == "original"
    source_uploaded_pdf = None
    if req.file_id:
        cand_path = os.path.join(UPLOAD_DIR, req.file_id)
        if os.path.exists(cand_path) and cand_path.lower().endswith(".pdf"):
            source_uploaded_pdf = cand_path

    if is_original_format and source_uploaded_pdf:
        base_pdf_path = source_uploaded_pdf
        is_temp_visual = False
    else:
        # Fall back or use selected layout
        effective_layout = "layout1" if chosen_layout == "original" else chosen_layout
        logo_file = LOGO_PATH if os.path.exists(LOGO_PATH) else None
        sys_settings = load_system_settings()
        generate_invoice_pdf_from_data(req.invoice_data, visual_pdf_path, logo_path=logo_file, layout=effective_layout, footer_config=sys_settings)
        base_pdf_path = visual_pdf_path
        is_temp_visual = True

    # 2. Generate XML (Factur-X or Order-X)
    is_orderx = getattr(req.invoice_data, "document_format", "zugferd") == "orderx" or req.invoice_data.invoice_type_code == "220"
    if is_orderx:
        xml_content = generate_orderx_xml(req.invoice_data, profile=req.profile or "BASIC")
        attachment_name = "order-x.xml"
    else:
        xml_content = generate_facturx_xml(req.invoice_data, profile=req.profile or "EN16931")
        attachment_name = "factur-x.xml"

    with open(xml_path, "w", encoding="utf-8") as f:
        f.write(xml_content)

    # 3. Combine into PDF/A-3
    try:
        build_pdfa3_zugferd(
            input_pdf_path=base_pdf_path,
            facturx_xml_path=xml_path,
            output_pdf_path=final_pdf_path,
            profile=req.profile or ("BASIC" if is_orderx else "EN16931"),
            attachment_filename=attachment_name
        )
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to build PDF/A-3: {str(e)}",
            "report": None
        }

    # 4. Clean up temp visual PDF
    if is_temp_visual and os.path.exists(visual_pdf_path):
        try:
            os.remove(visual_pdf_path)
        except Exception:
            pass

    # 5. Validate with Mustang
    val_res = validate_zugferd_pdf(final_pdf_path)

    # 6. Record in history
    try:
        record_invoice_history(
            invoice_data=req.invoice_data.model_dump(),
            output_filename=final_pdf_name,
            source_type=req.source_type or ("v2" if req.generator == "v2" else "manual"),
            generator=req.generator or ("v2" if req.source_type == "v2" else "v1"),
            layout=chosen_layout,
            xml_content=xml_content,
            is_valid=val_res.get("isValid", True),
            token_usage=req.token_usage
        )
    except Exception as e:
        print("Could not record history:", e)

    return {
        "success": True,
        "output_filename": final_pdf_name,
        "xml_content": xml_content,
        "validation": val_res
    }

@app.get("/api/download/{filename}")
async def download_file(filename: str):
    file_path = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=filename,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.get("/api/preview/{filename}")
async def preview_file(filename: str):
    file_path = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        file_path,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

SETTINGS_FILE = os.path.join(UPLOAD_DIR, "system_settings.json")

DEFAULT_SETTINGS = {
    "seller_name": "odelo GmbH",
    "seller_vat": "DE347120003",
    "seller_street": "Hedelfinger Straße 137",
    "seller_postcode": "70329",
    "seller_city": "Stuttgart",
    "seller_country": "DE",
    "seller_website": "www.acme-solutions.com",
    "seller_court": "Amtsgericht Stuttgart",
    "seller_hrb": "HRB 736903",
    "seller_ust_id": "DE 347120003",
    "seller_phone": "+49 (0)711 18563144",
    "seller_fax": "+49 (0)711 185633144",
    "seller_managing_directors": "Mürsel Gülen, Sedat Kilic",
    "seller_bank1_name": "Commerzbank AG",
    "seller_bank1_bic": "DBBADEFFXXX",
    "seller_bank1_iban": "DE89370400440532013000",
    "seller_bank2_name": "Baden-Württembergische Bank",
    "seller_bank2_bic": "SOLA DEST",
    "seller_bank2_iban": "DE30 6005 0101 7871 5056 72",
    "saved_parties": {
        "sellers": [],
        "buyers": []
    },
    "active_prompt_id": "standard_en16931",
    "extraction_prompts": {
        "standard_en16931": {
            "name": "Standard EN 16931 & ZUGFeRD 2.x (Recommended)",
            "description": "Standard European invoice parser for invoice number, dates, parties, reverse-charge taxes, and totals.",
            "content": """You are an expert accounting system and invoice parser specialized in European standard EN 16931 and ZUGFeRD / Factur-X specifications.
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
   Keys: 'invoice_number', 'issue_date', 'currency', 'buyer_reference', 'seller_name', 'seller_vat', 'seller_street', 'seller_city', 'buyer_name', 'buyer_vat', 'buyer_street', 'buyer_city', 'iban', 'bic', 'total_net', 'total_tax', 'total_grand', 'total_due'."""
        },
        "automotive_german": {
            "name": "German Automotive & Manufacturing (Strict Tax & PO)",
            "description": "Optimized for German DACH invoices with USt-IdNr, Steuernummer, Delivery Dates, and explicit PO/Order References.",
            "content": """You are an accounting specialist focused on German manufacturing, supply-chain, and automotive suppliers (e.g., DIN / EN 16931).
Parse the raw document text into an InvoiceData object with extra precision on:
1. Identifying German tax numbers: USt-IdNr (format DE followed by 9 digits) and Steuernummer / HRB register court details.
2. Detecting Order Number / Purchase Order (Bestellnummer / PO) and preceding invoice references if Gutschrift / Credit Note.
3. Extracting exact German addresses (PLZ 5 digits, Ort, Strasse, Hausnummer).
4. Extracting payment terms, Skonto discounts, or banking details (IBAN/BIC).
5. Accurate line items with German standard tax rates (19% standard, 7% reduced, or 0% reverse charge § 13b UStG).
6. Provide accurate confidence scores ('HIGH', 'MEDIUM', 'LOW')."""
        }
    }
}

def load_system_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            import json
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                res = DEFAULT_SETTINGS.copy()
                res.update(data)
                # Ensure extraction_prompts is always present
                if "extraction_prompts" not in res or not res["extraction_prompts"]:
                    res["extraction_prompts"] = DEFAULT_SETTINGS["extraction_prompts"]
                if "active_prompt_id" not in res or not res["active_prompt_id"]:
                    res["active_prompt_id"] = "standard_en16931"
                return res
        except Exception:
            pass
    return DEFAULT_SETTINGS.copy()

def save_system_settings(settings: dict):
    import json
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)

@app.get("/api/config")
async def get_server_config():
    env_key = os.environ.get("OPENAI_API_KEY", "").strip()
    is_configured = bool(env_key)
    masked_key = ""
    if is_configured:
        if len(env_key) > 8:
            masked_key = f"{env_key[:4]}...{env_key[-4:]}"
        else:
            masked_key = "***"
    
    settings = load_system_settings()
    return {
        "server_api_key_configured": is_configured,
        "masked_key": masked_key,
        "company_settings": settings
    }

class SaveSettingsRequest(BaseModel):
    settings: dict

@app.post("/api/config/settings")
async def update_company_settings(req: SaveSettingsRequest):
    current = load_system_settings()
    incoming = req.settings or {}
    
    # Safely merge saved_parties if present in both
    if "saved_parties" in incoming:
        cur_parties = current.get("saved_parties", {})
        inc_parties = incoming.get("saved_parties", {})
        # If incoming has sellers or buyers, merge them; never wipe existing with empty list if caller omitted or sent empty accidentally
        merged_sellers = inc_parties.get("sellers") if "sellers" in inc_parties else cur_parties.get("sellers", [])
        merged_buyers = inc_parties.get("buyers") if "buyers" in inc_parties else cur_parties.get("buyers", [])
        incoming["saved_parties"] = {
            "sellers": merged_sellers,
            "buyers": merged_buyers
        }

    current.update(incoming)
    save_system_settings(current)
    return {"success": True, "settings": current}

HISTORY_FILE = os.path.join(UPLOAD_DIR, "invoice_history.json")

def load_history() -> list:
    if os.path.exists(HISTORY_FILE):
        try:
            import json
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []

def save_history(history: list):
    import json
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)

def record_invoice_history(invoice_data: dict, output_filename: str, source_type: str = "manual", generator: str = "v1", layout: str = "layout1", xml_content: str = "", is_valid: bool = True, token_usage: dict = None):
    from datetime import datetime
    history = load_history()
    
    total_tokens = 0
    prompt_tokens = 0
    completion_tokens = 0
    cost_usd = 0.0
    cost_formatted = "$0.0000"
    
    if token_usage and isinstance(token_usage, dict):
        total_tokens = token_usage.get("total_tokens", 0) or 0
        prompt_tokens = token_usage.get("prompt_tokens", 0) or 0
        completion_tokens = token_usage.get("completion_tokens", 0) or 0
        cost_usd = token_usage.get("estimated_cost_usd", 0.0) or 0.0
        cost_formatted = token_usage.get("formatted_cost") or f"${cost_usd:.4f}"

    entry = {
        "id": uuid.uuid4().hex[:8],
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "invoice_number": invoice_data.get("invoice_number") or "N/A",
        "issue_date": invoice_data.get("issue_date") or "",
        "due_date": invoice_data.get("due_date") or "",
        "currency": invoice_data.get("currency") or "EUR",
        "seller_name": invoice_data.get("seller", {}).get("name") if isinstance(invoice_data.get("seller"), dict) else "",
        "buyer_name": invoice_data.get("buyer", {}).get("name") if isinstance(invoice_data.get("buyer"), dict) else "",
        "grand_total": invoice_data.get("grand_total") or invoice_data.get("due_payable_amount") or 0.0,
        "output_filename": output_filename,
        "source_type": source_type,
        "generator": generator,
        "layout": layout,
        "is_valid": is_valid,
        "invoice_data": invoice_data,
        "xml_content": xml_content,
        "tokens": {
            "total_tokens": total_tokens,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cost_usd": cost_usd,
            "formatted_cost": cost_formatted
        }
    }
    # Prepend newest first
    history.insert(0, entry)
    # Keep up to 200 items in history
    history = history[:200]
    save_history(history)
    return entry

@app.get("/api/history")
def get_invoice_history():
    return {"history": load_history()}

@app.delete("/api/history/{entry_id}")
def delete_history_item(entry_id: str):
    history = load_history()
    history = [h for h in history if h.get("id") != entry_id]
    save_history(history)
    return {"success": True}



# Mount frontend static files
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
async def serve_index():
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>ZUGFeRD Studio Backend Active</h1>")
