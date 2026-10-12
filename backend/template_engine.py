import os
import re
import json
import base64
import subprocess
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from backend.models import InvoiceData

TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
I18N_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "i18n")

_I18N_CACHE = {}

def load_i18n_bundle(lang: str = "sl") -> dict:
    lang = (lang or "sl").lower()
    if lang not in _I18N_CACHE:
        file_path = os.path.join(I18N_DIR, f"messages_{lang}.json")
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    _I18N_CACHE[lang] = json.load(f)
            except Exception:
                _I18N_CACHE[lang] = {}
        else:
            # Fallback to English or empty
            _I18N_CACHE[lang] = {}
    return _I18N_CACHE[lang]

def get_i18n_translator(lang: str = "sl"):
    lang = (lang or "sl").lower()
    if lang in ["multi", "multilingual"]:
        # Build multilingual trilingual dictionary (SL / EN / DE)
        sl_dict = load_i18n_bundle("sl")
        en_dict = load_i18n_bundle("en")
        de_dict = load_i18n_bundle("de")
        def t_multi(key: str, default: str = "") -> str:
            v_sl = sl_dict.get(key)
            v_en = en_dict.get(key)
            v_de = de_dict.get(key)
            if v_sl and v_en and v_de:
                return f"{v_sl} / {v_en} / {v_de}"
            elif v_sl and v_en:
                return f"{v_sl} / {v_en}"
            return v_sl or v_en or v_de or default or key
        return t_multi

    bundle = load_i18n_bundle(lang)
    # Fallback to English if not in chosen language
    en_bundle = load_i18n_bundle("en") if lang != "en" else {}

    def t(key: str, default: str = "") -> str:
        return bundle.get(key) or en_bundle.get(key) or default or key

    return t

def _format_date(val: str) -> str:
    if not val:
        return ""
    val_clean = str(val).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}", val_clean):
        parts = val_clean[:10].split("-")
        return f"{parts[2]}.{parts[1]}.{parts[0]}"
    elif re.match(r"^\d{8}$", val_clean):
        return f"{val_clean[6:8]}.{val_clean[4:6]}.{val_clean[:4]}"
    return val_clean

def _format_num(val, decimals: int = 2) -> str:
    try:
        f = float(val or 0.0)
        formatted = f"{f:,.{decimals}f}"
        # Convert 1,234.56 -> 1.234,56
        return formatted.replace(",", "X").replace(".", ",").replace("X", ".")
    except (ValueError, TypeError):
        return "0,00"

def _format_price(val) -> str:
    try:
        f = float(val or 0.0)
        # Up to 4 decimal places if needed, else 2
        decimals = 4 if abs(f * 100 - round(f * 100)) > 0.0001 else 2
        return _format_num(f, decimals)
    except (ValueError, TypeError):
        return "0,00"

def get_chrome_executable() -> str:
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return "chrome"

def render_en16931_html(inv: InvoiceData, logo_path: str = None, hide_tags: bool = True, footer_config: dict = None, lang: str = "sl") -> str:
    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=True)
    env.filters["format_date"] = _format_date
    env.filters["format_num"] = _format_num
    env.filters["format_price"] = _format_price
    
    t_func = get_i18n_translator(lang)
    template = env.get_template("en16931_complete.html")

    doc_type = str(inv.invoice_type_code or "380")
    is_credit_note = (doc_type == "381")
    if is_credit_note:
        doc_type_title = t_func("doc_title_credit", "DOBROPIS / CREDIT NOTE / GUTSCHRIFT")
    elif doc_type == "384":
        doc_type_title = t_func("doc_title_corrected", "POPRAVLJENI RAČUN / CORRECTED INVOICE / RECHNUNGSKORREKTUR")
    elif doc_type == "326":
        doc_type_title = t_func("doc_title_partial", "DELNI RAČUN / PARTIAL INVOICE / TEILRECHNUNG")
    elif doc_type == "386":
        doc_type_title = t_func("doc_title_prepayment", "AVANSNI RAČUN / PREPAYMENT INVOICE / ANZAHLUNGSRECHNUNG")
    else:
        doc_type_title = t_func("doc_title_invoice", "RAČUN / INVOICE / RECHNUNG")

    # Logo base64
    logo_b64 = None
    if logo_path and os.path.exists(logo_path):
        try:
            with open(logo_path, "rb") as lf:
                ext = os.path.splitext(logo_path)[1].lower().replace(".", "")
                if ext == "jpg": ext = "jpeg"
                logo_b64 = f"data:image/{ext};base64,{base64.b64encode(lf.read()).decode('utf-8')}"
        except Exception:
            pass

    # Preceding invoice / Credit Note conditions (BG-3)
    # Contact buyer condition (BG-9)
    has_buyer_contact = bool(inv.buyer.contact_name or inv.buyer.contact_phone or inv.buyer.contact_email)

    # Delivery condition (BG-13): differ or location_id
    has_delivery = False
    if inv.delivery:
        has_delivery = bool(
            inv.delivery.location_id or 
            inv.delivery.recipient_name or 
            inv.delivery.street or 
            (inv.delivery.street and inv.delivery.street != inv.buyer.street)
        )

    # Effective delivery date (BT-72)
    effective_delivery_date = inv.delivery_date
    if not effective_delivery_date and inv.delivery and inv.delivery.delivery_date:
        effective_delivery_date = inv.delivery.delivery_date

    # References matrix (BT-10, BT-16, BT-19, BT-14, BT-11, BT-12)
    references = []
    if inv.buyer_reference:
        references.append({"tag": "BT-10", "label": t_func("ref_po", "Kupčeva ref."), "value": inv.buyer_reference})
    if inv.purchase_order_number:
        references.append({"tag": "BT-13", "label": t_func("ref_po", "Naročilnica (PO)"), "value": inv.purchase_order_number})
    if inv.despatch_advice_reference:
        references.append({"tag": "BT-16", "label": t_func("ref_delivery", "Dobavnica"), "value": inv.despatch_advice_reference})
    if getattr(inv, "cost_center", None):
        references.append({"tag": "BT-19", "label": t_func("ref_cost_center", "Stroškovno mesto"), "value": inv.cost_center})
    if getattr(inv, "sales_order_number", None):
        references.append({"tag": "BT-14", "label": t_func("ref_order", "Interno naročilo"), "value": inv.sales_order_number})
    if getattr(inv, "project_reference", None):
        references.append({"tag": "BT-11", "label": t_func("ref_project", "Projekt"), "value": inv.project_reference})
    if getattr(inv, "contract_reference", None):
        references.append({"tag": "BT-12", "label": t_func("ref_contract", "Pogodba"), "value": inv.contract_reference})

    # Factoring (BG-10)
    factoring = getattr(inv.payment, "factoring_payee", None)
    has_factoring = bool(factoring and (factoring.name or factoring.iban))

    # Allowances (BT-107) and Charges (BT-108)
    sum_allowance = 0.0
    sum_charge = 0.0
    for d in (inv.discounts or []):
        amt = float(d.amount or 0.0)
        if getattr(d, "charge_indicator", False):
            sum_charge += amt
        else:
            sum_allowance += amt

    tax_basis_total = inv.line_net_total - sum_allowance + sum_charge

    # VAT Breakdown (BG-23)
    vat_breakdown_list = []
    has_exemption = False
    exemption_text = inv.vat_exemption_reason or ""
    
    if inv.tax_breakdown:
        for tb in inv.tax_breakdown:
            cat = tb.tax_category_code or "S"
            cat_key = f"vat_cat_{cat.lower()}"
            cat_label = t_func(cat_key, {
                "S": "Standardna",
                "AE": "Obrnjena davčna obv.",
                "E": "Oproščeno",
                "Z": "Ničelna stopnja",
                "K": "Znotraj Skupnosti"
            }.get(cat, "Davek"))
            if cat in ["AE", "E", "Z", "K"]:
                has_exemption = True
                if not exemption_text and tb.exemption_reason:
                    exemption_text = tb.exemption_reason
            vat_breakdown_list.append({
                "category": cat,
                "category_label": cat_label,
                "rate": tb.tax_percent,
                "basis": tb.basis_amount,
                "tax": tb.tax_amount
            })
    else:
        # Fallback single rate
        vat_breakdown_list.append({
            "category": "S",
            "category_label": t_func("vat_cat_s", "Standardna"),
            "rate": 22.0 if (inv.seller.country_code == "SI" or inv.buyer.country_code == "SI") else 19.0,
            "basis": tax_basis_total,
            "tax": inv.tax_total
        })

    if not exemption_text and has_exemption:
        exemption_text = t_func("reverse_charge_clause")

    html_rendered = template.render(
        inv=inv,
        t=t_func,
        lang_code=lang,
        doc_type_title=doc_type_title,
        is_credit_note=is_credit_note,
        logo_base64=logo_b64,
        hide_tags=hide_tags,
        has_buyer_contact=has_buyer_contact,
        has_delivery=has_delivery,
        effective_delivery_date=effective_delivery_date,
        references=references,
        ref_columns=max(2, min(4, len(references) or 4)),
        has_factoring=has_factoring,
        factoring=factoring,
        sum_allowance=sum_allowance,
        sum_charge=sum_charge,
        tax_basis_total=tax_basis_total,
        vat_breakdown_list=vat_breakdown_list,
        has_exemption=has_exemption,
        exemption_text=exemption_text,
        footer_config=footer_config or {}
    )
    return html_rendered

def generate_en16931_pdf(inv: InvoiceData, output_pdf_path: str, logo_path: str = None, hide_tags: bool = True, footer_config: dict = None, lang: str = "sl") -> str:
    """
    Renders EN 16931 complete layout using headless Chrome/Edge with specific language.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_pdf_path)), exist_ok=True)
    html_content = render_en16931_html(inv, logo_path=logo_path, hide_tags=hide_tags, footer_config=footer_config, lang=lang)
    
    temp_html_path = output_pdf_path.replace(".pdf", "_temp.html")
    with open(temp_html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    chrome_bin = get_chrome_executable()
    file_uri = f"file:///{os.path.abspath(temp_html_path).replace(chr(92), '/')}"

    cmd = [
        chrome_bin,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        f"--print-to-pdf={os.path.abspath(output_pdf_path)}",
        "--no-pdf-header-footer",
        file_uri
    ]
    
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if not os.path.exists(output_pdf_path) or os.path.getsize(output_pdf_path) == 0:
            raise RuntimeError(f"Headless print failed (exit code {res.returncode}): {res.stderr}")
    finally:
        if os.path.exists(temp_html_path):
            try:
                os.remove(temp_html_path)
            except Exception:
                pass

    return output_pdf_path
