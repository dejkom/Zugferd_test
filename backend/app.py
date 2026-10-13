import os
import re
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
from backend.ubl_builder import generate_ubl_xml
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
    lang: Optional[str] = "sl"
    show_bt_tags: Optional[bool] = False

@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    filename_lower = file.filename.lower()
    if not (filename_lower.endswith(".pdf") or filename_lower.endswith(".docx") or filename_lower.endswith(".xml")):
        raise HTTPException(status_code=400, detail="Only PDF, DOCX, and XML files are supported.")
    
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

    # Resolve API key: req.api_key > sys_settings.openai_api_key > os.environ
    effective_api_key = req.api_key or sys_settings.get("openai_api_key") or os.environ.get("OPENAI_API_KEY")

    # If the file is an XML (e-SLOG 2.0 or UBL or Factur-X), parse directly without OpenAI token costs!
    if target_path.lower().endswith(".xml"):
        try:
            with open(target_path, "r", encoding="utf-8", errors="ignore") as f:
                raw_xml = f.read()

            # Check if eSLOG 2.0
            if "urn:eslog" in raw_xml or "M_INVOIC" in raw_xml:
                from backend.eslog_parser import parse_eslog2_xml
                data = parse_eslog2_xml(raw_xml)
                xml_content = generate_facturx_xml(data)
                return {
                    "invoice_data": data.model_dump(),
                    "xml_preview": xml_content,
                    "usage": {
                        "model": "direct_xml_parser (e-SLOG 2.0)",
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                        "estimated_cost_usd": 0.0,
                        "formatted_cost": "$0.0000"
                    }
                }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"e-SLOG XML parsing error: {str(e)}")

    try:
        data, usage_info = extract_invoice_data(target_path, api_key=effective_api_key, system_prompt=custom_prompt)
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
        profile_key = (req.profile or "EN16931").upper()

        if is_orderx:
            xml_content = generate_orderx_xml(req.invoice_data, profile=req.profile or "BASIC")
        elif "UBL" in profile_key or profile_key in ["PEPPOL", "PEPPOL_UBL"]:
            xml_content = generate_ubl_xml(req.invoice_data, profile=profile_key)
        elif profile_key in ["ESLOG2", "ESLOG_2_0", "ESLOG"]:
            xml_content = generate_facturx_xml(req.invoice_data, profile="ESLOG2")
        else:
            xml_content = generate_facturx_xml(req.invoice_data, profile=req.profile or "EN16931")
        return {"xml_content": xml_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/export-xml")
async def export_xml_file(req: GenerateXmlRequest):
    """Generates raw XML and saves it to outputs folder for direct download."""
    try:
        is_orderx = getattr(req.invoice_data, "document_format", "zugferd") == "orderx" or req.invoice_data.invoice_type_code == "220"
        profile_key = (req.profile or "EN16931").upper()

        if is_orderx:
            xml_content = generate_orderx_xml(req.invoice_data, profile=req.profile or "BASIC")
            prefix = "orderx"
        elif "UBL" in profile_key or profile_key in ["PEPPOL", "PEPPOL_UBL"]:
            xml_content = generate_ubl_xml(req.invoice_data, profile=profile_key)
            prefix = "ubl"
        elif profile_key in ["ESLOG2", "ESLOG_2_0", "ESLOG"]:
            xml_content = generate_facturx_xml(req.invoice_data, profile="ESLOG2")
            prefix = "eslog2"
        else:
            xml_content = generate_facturx_xml(req.invoice_data, profile=req.profile or "EN16931")
            prefix = "facturx"

        work_id = uuid.uuid4().hex[:8]
        clean_inv = re.sub(r"[^\w\-.]", "_", req.invoice_data.invoice_number or "invoice")
        filename = f"{prefix}_{clean_inv}_{work_id}.xml"
        file_path = os.path.join(OUTPUT_DIR, filename)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(xml_content)

        return {
            "success": True,
            "filename": filename,
            "download_url": f"/api/download/{filename}",
            "xml_content": xml_content
        }
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
        hide_tags = not bool(req.show_bt_tags)
        generate_invoice_pdf_from_data(req.invoice_data, visual_pdf_path, logo_path=logo_file, layout=effective_layout, footer_config=sys_settings, lang=req.lang or "sl", hide_tags=hide_tags)
        base_pdf_path = visual_pdf_path
        is_temp_visual = True

    # 2. Generate XML (Factur-X, Order-X, e-SLOG 2.0, or UBL 2.1)
    is_orderx = getattr(req.invoice_data, "document_format", "zugferd") == "orderx" or req.invoice_data.invoice_type_code == "220"
    profile_key = (req.profile or "EN16931").upper()

    if is_orderx:
        xml_content = generate_orderx_xml(req.invoice_data, profile=req.profile or "BASIC")
        attachment_name = "order-x.xml"
    elif "UBL" in profile_key or profile_key in ["PEPPOL", "PEPPOL_UBL"]:
        xml_content = generate_ubl_xml(req.invoice_data, profile=profile_key)
        attachment_name = "invoice.xml"
    elif profile_key in ["ESLOG2", "ESLOG_2_0", "ESLOG"]:
        xml_content = generate_facturx_xml(req.invoice_data, profile="ESLOG2")
        attachment_name = "e-slog.xml"
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
            token_usage=req.token_usage,
            lang=req.lang or "multi",
            show_bt_tags=bool(req.show_bt_tags)
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
    media_type = "application/xml" if filename.lower().endswith(".xml") else "application/pdf"
    return FileResponse(
        file_path,
        media_type=media_type,
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
    "saved_parties": {
        "sellers": [],
        "buyers": []
    },
    "tax_rates": [
        {"id": "si_22", "country": "SI", "rate": 22.0, "category": "S", "label": "22% DDV Splošna stopnja (SI)", "is_default": True},
        {"id": "si_95", "country": "SI", "rate": 9.5, "category": "S", "label": "9.5% DDV Znižana stopnja (SI)", "is_default": False},
        {"id": "si_5", "country": "SI", "rate": 5.0, "category": "S", "label": "5% DDV Posebna znižana stopnja (SI)", "is_default": False},
        {"id": "de_19", "country": "DE", "rate": 19.0, "category": "S", "label": "19% MwSt. Regelsteuersatz (DE)", "is_default": True},
        {"id": "de_7", "country": "DE", "rate": 7.0, "category": "S", "label": "7% MwSt. Ermäßigter Satz (DE)", "is_default": False},
        {"id": "at_20", "country": "AT", "rate": 20.0, "category": "S", "label": "20% USt. Normalsteuersatz (AT)", "is_default": True},
        {"id": "at_10", "country": "AT", "rate": 10.0, "category": "S", "label": "10% USt. Ermäßigt (AT)", "is_default": False},
        {"id": "hr_25", "country": "HR", "rate": 25.0, "category": "S", "label": "25% PDV Opća stopa (HR)", "is_default": True},
        {"id": "dk_25", "country": "DK", "rate": 25.0, "category": "S", "label": "25% Moms Almindelig (DK)", "is_default": True},
        {"id": "fr_20", "country": "FR", "rate": 20.0, "category": "S", "label": "20% TVA Taux normal (FR)", "is_default": True},
        {"id": "it_22", "country": "IT", "rate": 22.0, "category": "S", "label": "22% IVA Ordinaria (IT)", "is_default": True},
        {"id": "ch_81", "country": "CH", "rate": 8.1, "category": "S", "label": "8.1% MWST Normalsatz (CH)", "is_default": True},
        {"id": "gen_ae", "country": "ALL", "rate": 0.0, "category": "AE", "label": "0% Reverse Charge / Obrnjena davčna obveznost (AE)", "is_default": False},
        {"id": "gen_e", "country": "ALL", "rate": 0.0, "category": "E", "label": "0% Exempt / Oproščeno (E)", "is_default": False},
        {"id": "gen_z", "country": "ALL", "rate": 0.0, "category": "Z", "label": "0% Zero Rated (Z)", "is_default": False}
    ],
    "extraction_synonyms": {
        "BT-1": {
            "bt": "BT-1",
            "field": "invoice_number",
            "name": "Invoice identifier",
            "en": ["Invoice #", "Invoice No.", "Inv No.", "Bill No.", "Invoice Number"],
            "de": ["Rechnungs-Nr.", "Rechnungsnummer", "Rg.-Nr.", "Faktura", "Rechnung Nr."],
            "sl": ["Številka računa", "Račun št.", "Št. računa", "Št. Rač", "Račun"]
        },
        "BT-2": {
            "bt": "BT-2",
            "field": "issue_date",
            "name": "Invoice issue date",
            "en": ["Invoice date", "Issue date", "Date of invoice", "Date"],
            "de": ["Rechnungsdatum", "Ausstellungsdatum", "Belegdatum", "Datum"],
            "sl": ["Datum računa", "Datum izdaje", "Izdan dne", "Datum"]
        },
        "BT-9": {
            "bt": "BT-9",
            "field": "due_date",
            "name": "Payment due date",
            "en": ["Due date", "Payment due date", "Payable by"],
            "de": ["Fälligkeitsdatum", "Fällig am", "Zahlbar bis", "Zahlungsziel"],
            "sl": ["Datum zapadlosti", "Rok plačila", "Valuta", "Zapadlost", "Plačati do"]
        },
        "BT-10": {
            "bt": "BT-10",
            "field": "buyer_reference",
            "name": "Buyer reference",
            "en": ["Buyer reference", "Routing ID", "Customer ref", "Order ref"],
            "de": ["Leitweg-ID", "Käuferreferenz", "Kundenreferenz", "Referenz"],
            "sl": ["Referenca kupca", "Sklic kupca", "Šifra partnerja", "Kupčeva referenca"]
        },
        "BT-13": {
            "bt": "BT-13",
            "field": "purchase_order_number",
            "name": "Purchase order reference",
            "en": ["Purchase Order", "PO #", "PO Number", "Order No."],
            "de": ["Bestellnummer", "Bestell-Nr.", "Best.-Nr.", "Auftragsnummer"],
            "sl": ["Številka naročilnice", "Naročilnica št.", "Naročilo št.", "Naročilnica"]
        },
        "BT-14": {
            "bt": "BT-14",
            "field": "purchase_order_date",
            "name": "Purchase order date",
            "en": ["Order date", "PO Date"],
            "de": ["Bestelldatum", "Auftragsdatum"],
            "sl": ["Datum naročila", "Datum naročilnice"]
        },
        "BT-16": {
            "bt": "BT-16",
            "field": "despatch_advice_id",
            "name": "Despatch advice reference (Delivery note)",
            "en": ["Delivery note #", "Despatch advice", "Packing slip"],
            "de": ["Lieferschein-Nr.", "Lieferscheinnummer", "LS-Nr."],
            "sl": ["Številka dobavnice", "Dobavnica št.", "Dobavnica", "Št. dobavnice"]
        },
        "BT-44": {
            "bt": "BT-44",
            "field": "buyer_name",
            "name": "Buyer name",
            "en": ["Buyer", "Customer", "Bill To", "Sold To"],
            "de": ["Käufer", "Rechnungsempfänger", "Kunde", "Auftraggeber"],
            "sl": ["Kupec", "Prejemnik računa", "Naročnik", "Plačnik"]
        },
        "BT-48": {
            "bt": "BT-48",
            "field": "buyer_vat",
            "name": "Buyer VAT identifier",
            "en": ["VAT Reg No", "VAT ID", "Customer VAT", "Tax ID"],
            "de": ["USt-IdNr.", "UID-Nr.", "Umsatzsteuer-ID", "Steuer-Nr."],
            "sl": ["ID za DDV", "Davčna št. kupca", "Davčna številka", "ID za DDV kupca"]
        },
        "BT-70": {
            "bt": "BT-70",
            "field": "recipient_name",
            "name": "Deliver-to recipient name",
            "en": ["Ship To", "Deliver To", "Consignee", "Destination"],
            "de": ["Lieferadresse", "Warenempfänger", "Lieferort"],
            "sl": ["Prejemnik blaga", "Naslov za dostavo", "Dostava", "Prevzemnik"]
        },
        "BT-71": {
            "bt": "BT-71",
            "field": "location_id",
            "name": "Deliver-to location identifier (GLN)",
            "en": ["Unloading point", "Dock", "Location ID", "GLN"],
            "de": ["Abladestelle", "Abladestelle Nr.", "Lagerort", "Tor"],
            "sl": ["Razkladalno mesto", "Prevzemno mesto", "Skladišče", "Lokacija prevzema"]
        },
        "BT-72": {
            "bt": "BT-72",
            "field": "delivery_date",
            "name": "Actual delivery date",
            "en": ["Delivery date", "Shipment date", "Performance date"],
            "de": ["Lieferdatum", "Leistungsdatum", "Lieferzeitpunkt"],
            "sl": ["Datum dobave", "Datum opravljene storitve", "Datum dobave/storitve"]
        },
        "BT-83": {
            "bt": "BT-83",
            "field": "payment_terms",
            "name": "Payment terms & remittance reference",
            "en": ["Payment terms", "Due conditions", "Payment reference"],
            "de": ["Zahlungsbedingungen", "Zahlungsziel", "Konditionen", "Skonto"],
            "sl": ["Plačilni pogoji", "Rok plačila", "Sklic", "Sklic za plačilo", "Model"]
        },
        "BT-84": {
            "bt": "BT-84",
            "field": "iban",
            "name": "Payment account (IBAN / Account)",
            "en": ["IBAN", "Bank Account", "Account #"],
            "de": ["IBAN", "Kontonummer", "Bankverbindung"],
            "sl": ["IBAN", "TRR", "Transakcijski račun", "Številka računa (TRR)"]
        },
        "BT-106": {
            "bt": "BT-106",
            "field": "line_net_total",
            "name": "Sum of line net amounts",
            "en": ["Net total", "Subtotal", "Total net amount", "Net Amount"],
            "de": ["Nettobetrag", "Gesamtbetrag Netto", "Zwischensumme Netto"],
            "sl": ["Znesek brez DDV", "Osnova", "Skupaj brez DDV", "Neto znesek"]
        },
        "BT-110": {
            "bt": "BT-110",
            "field": "tax_total",
            "name": "Invoice total VAT amount",
            "en": ["Total VAT", "VAT amount", "Total tax", "Tax"],
            "de": ["MwSt. Gesamt", "USt.", "Steuerbetrag", "MwSt."],
            "sl": ["Znesek DDV", "Vrednost DDV", "Skupaj DDV", "DDV"]
        },
        "BT-112": {
            "bt": "BT-112",
            "field": "grand_total",
            "name": "Invoice total with VAT (Gross)",
            "en": ["Grand total", "Total gross", "Gross amount", "Total Amount"],
            "de": ["Bruttobetrag", "Rechnungsbetrag", "Gesamtbetrag Brutto", "Gesamtbetrag"],
            "sl": ["Znesek z DDV", "Skupaj z DDV", "Bruto znesek", "Skupaj za plačilo z DDV"]
        },
        "BT-115": {
            "bt": "BT-115",
            "field": "due_payable_amount",
            "name": "Amount due for payment",
            "en": ["Amount due", "Due payable", "Payable amount", "Balance due"],
            "de": ["Zu zahlender Betrag", "Fälliger Betrag", "Zahlbetrag"],
            "sl": ["Za plačilo", "Znesek za plačilo", "Skupaj za plačilo", "K plačilu"]
        }
    },
    "active_prompt_id": "trilingual_dictionary",
    "extraction_prompts": {
        "trilingual_dictionary": {
            "name": "Trilingual Multilingual Parser (EN / DE / SI + Keyword Dictionary) ★",
            "description": "Optimized European & Slovenian parser using the active multilingual keyword dictionary for BT-1..BT-115.",
            "content": """You are an expert accounting AI and multilingual invoice parser specialized in European standard EN 16931, ZUGFeRD / Factur-X, and Slovenian e-SLOG 2.0 specifications.
Your goal is to parse raw text extracted from invoice documents into a clean, complete, structured InvoiceData object.

CRITICAL INSTRUCTIONS & ANTI-HALLUCINATION RULES:
1. USE THE MULTILINGUAL KEYWORD DICTIONARY: Match field values by looking for the multilingual keyword aliases appended below (English, German, and Slovenian terms).
2. EXTRACT SELLER & BANK DATA FROM DOCUMENT: Extract the actual Seller (Supplier / Izdajatelj / Verkäufer) and payment bank account (IBAN BT-84, BIC BT-86) from the document header, body, or footer.
3. Extract EXACT literal values from the document body, header, and footer. Do NOT guess, approximate, or fabricate any missing numbers, identifiers, or dates.
4. If a field is not explicitly present in the document, return null (None). Never substitute an invented value.

FIELD EXTRACTION GUIDELINES:
- Invoice Number (BT-1): Exact invoice identifier (e.g. following 'Rechnungs-Nr.', 'Rg.-Nr.', 'Številka računa', 'Račun št.', 'Št. Rač').
- Issue Date (BT-2): Invoice date normalized to YYYY-MM-DD (e.g. from 'Rechnungsdatum', 'Datum računa', 'Datum izdaje').
- Due Date (BT-9): Payment due date normalized to YYYY-MM-DD (e.g. from 'Fälligkeitsdatum', 'Datum zapadlosti', 'Rok plačila').
- Currency (BT-5): 3-letter ISO 4217 currency code (e.g. EUR).
- Buyer Reference (BT-10): Customer purchase order or routing reference (e.g. 'Leitweg-ID', 'Referenca kupca', 'Sklic kupca').
- Purchase Order (BT-13): Order reference number (e.g. 'Bestell-Nr.', 'Auftragsnummer', 'Naročilnica št.', 'Številka naročilnice').
- Delivery Note / Despatch Advice (BT-16): Delivery slip ID (e.g. 'Lieferschein-Nr.', 'LS-Nr.', 'Številka dobavnice', 'Dobavnica št.').
- Seller Details (BT-27..BT-43): Legal name, VAT ID (USt-IdNr. / ID za DDV), local tax number / Steuernummer, street, postcode, city, and country code.
- Buyer Details (BT-44..BT-55): Name, street, postcode, city, country, and VAT ID (e.g. 'USt-IdNr.', 'ID za DDV', 'Davčna št.').
- Physical Delivery (BG-13): Recipient facility name (BT-70), location/unloading point (BT-71, 'Abladestelle', 'Prevzemno mesto'), and delivery date (BT-72, 'Lieferdatum', 'Leistungsdatum', 'Datum dobave', 'Datum opravljene storitve').
- Payment Bank & Account (BT-84 / BT-86): Seller payment IBAN (BT-84) and BIC (BT-86).
- Payment Terms & Remittance Reference (BT-83): Literal payment terms or Slovenian payment reference (e.g. 'Sklic', 'Model 00/01/12', 'Skonto').
- Line Items: Line item ID, full name/description, quantity, unit_code (C62 for piece/Stück/kos, HUR for hour/ura, DAY for dan), net unit price, line net total, tax category ('S', 'AE', 'Z', 'E'), and tax rate (e.g. 19%, 22%, 9.5%, 0%).
- Tax Breakdown & Totals: line_net_total (BT-106), tax_total (BT-110), grand_total (BT-112), and due_payable_amount (BT-115). Verify line_net_total + tax_total == grand_total.
- Assign confidence scores ('HIGH', 'MEDIUM', 'LOW') in confidence_scores."""
        },
        "standard_en16931": {
            "name": "Standard EN 16931 & ZUGFeRD 2.x",
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
                # Ensure extraction_prompts always contains built-in presets
                if "extraction_prompts" not in res or not res["extraction_prompts"]:
                    res["extraction_prompts"] = DEFAULT_SETTINGS["extraction_prompts"].copy()
                else:
                    for p_id, p_val in DEFAULT_SETTINGS["extraction_prompts"].items():
                        if p_id not in res["extraction_prompts"]:
                            res["extraction_prompts"][p_id] = p_val
                if "active_prompt_id" not in res or not res["active_prompt_id"]:
                    res["active_prompt_id"] = "trilingual_dictionary"
                if "extraction_synonyms" not in res or not res["extraction_synonyms"]:
                    res["extraction_synonyms"] = DEFAULT_SETTINGS["extraction_synonyms"]
                if "tax_rates" not in res or not res["tax_rates"]:
                    res["tax_rates"] = DEFAULT_SETTINGS["tax_rates"]
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
    settings = load_system_settings()
    env_key = os.environ.get("OPENAI_API_KEY", "").strip() or settings.get("openai_api_key", "").strip()
    is_configured = bool(env_key)
    masked_key = ""
    if is_configured:
        if len(env_key) > 8:
            masked_key = f"{env_key[:4]}...{env_key[-4:]}"
        else:
            masked_key = "***"
    
    return {
        "server_api_key_configured": is_configured,
        "masked_key": masked_key,
        "openai_api_key": env_key,
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

def record_invoice_history(invoice_data: dict, output_filename: str, source_type: str = "manual", generator: str = "v1", layout: str = "layout1", xml_content: str = "", is_valid: bool = True, token_usage: dict = None, lang: str = "multi", show_bt_tags: bool = False):
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
        "lang": lang,
        "show_bt_tags": bool(show_bt_tags),
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
