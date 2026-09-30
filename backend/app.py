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
    generate_invoice_pdf_from_data(req.invoice_data, visual_pdf_path, logo_path=logo_file, layout=chosen_layout)

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
