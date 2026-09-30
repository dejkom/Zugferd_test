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
from backend.xml_builder import generate_facturx_xml
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

class GenerateXmlRequest(BaseModel):
    invoice_data: InvoiceData
    profile: Optional[str] = "EN16931"

class CombineRequest(BaseModel):
    file_id: str
    xml_content: str
    profile: Optional[str] = "EN16931"

class CreateFromManualRequest(BaseModel):
    invoice_data: InvoiceData
    profile: Optional[str] = "EN16931"
    layout: Optional[str] = "layout1"

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
    
    try:
        data, usage_info = extract_invoice_data(target_path, api_key=req.api_key)
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
    chosen_layout = req.layout or "layout1"
    clean_inv_num = (req.invoice_data.invoice_number or "invoice").replace("/", "_").replace("\\", "_")
    final_pdf_name = f"zugferd_{chosen_layout}_{clean_inv_num}_{work_id[:6]}.pdf"
    final_pdf_path = os.path.join(OUTPUT_DIR, final_pdf_name)

    # 1. Generate visual PDF (incorporating company logo if uploaded and layout choice)
    logo_file = LOGO_PATH if os.path.exists(LOGO_PATH) else None
    sys_settings = load_system_settings()
    generate_invoice_pdf_from_data(req.invoice_data, visual_pdf_path, logo_path=logo_file, layout=chosen_layout, footer_config=sys_settings)

    # 2. Generate Factur-X XML
    xml_content = generate_facturx_xml(req.invoice_data, profile=req.profile or "EN16931")
    with open(xml_path, "w", encoding="utf-8") as f:
        f.write(xml_content)

    # 3. Combine into PDF/A-3
    try:
        build_pdfa3_zugferd(
            input_pdf_path=visual_pdf_path,
            facturx_xml_path=xml_path,
            output_pdf_path=final_pdf_path,
            profile=req.profile or "EN16931"
        )
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to build PDF/A-3: {str(e)}",
            "report": None
        }

    # 4. Clean up temp visual PDF
    if os.path.exists(visual_pdf_path):
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
            source_type="manual",
            layout=chosen_layout,
            xml_content=xml_content,
            is_valid=val_res.get("isValid", True)
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
    "seller_name": "Acme Solutions Ltd",
    "seller_vat": "DE123456789",
    "seller_street": "Bahnhofstrasse 10",
    "seller_city": "10115 Berlin",
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
    "seller_bank2_iban": "DE30 6005 0101 7871 5056 72"
}

def load_system_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            import json
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                res = DEFAULT_SETTINGS.copy()
                res.update(data)
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

def record_invoice_history(invoice_data: dict, output_filename: str, source_type: str = "manual", layout: str = "layout1", xml_content: str = "", is_valid: bool = True):
    from datetime import datetime
    history = load_history()
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
        "layout": layout,
        "is_valid": is_valid,
        "invoice_data": invoice_data,
        "xml_content": xml_content
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

@app.post("/api/config/settings")
async def save_server_settings(req: SaveSettingsRequest):
    save_system_settings(req.settings)
    return {"success": True, "settings": req.settings}

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
