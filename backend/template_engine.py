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
        decimals = 4 if abs(f * 100 - round(f * 100)) > 0.0001 else 2
        return _format_num(f, decimals)
    except (ValueError, TypeError):
        return "0,00"

UNIT_LABELS = {
    "C62": {"sl": "KOS", "en": "PCS", "de": "STK"},
    "H87": {"sl": "KOS", "en": "PCS", "de": "STK"},
    "PCE": {"sl": "KOS", "en": "PCS", "de": "STK"},
    "NAR": {"sl": "KOS", "en": "PCS", "de": "STK"},
    "HUR": {"sl": "URA", "en": "HRS", "de": "STD"},
    "DAY": {"sl": "DAN", "en": "DAY", "de": "TAG"},
    "WEE": {"sl": "TED", "en": "WK", "de": "WO"},
    "MON": {"sl": "MES", "en": "MTH", "de": "MON"},
    "ANN": {"sl": "LETO", "en": "YR", "de": "JAHR"},
    "SEC": {"sl": "SEK", "en": "SEC", "de": "SEK"},
    "MIN": {"sl": "MIN", "en": "MIN", "de": "MIN"},
    "KGM": {"sl": "KG", "en": "KG", "de": "KG"},
    "GRM": {"sl": "G", "en": "G", "de": "G"},
    "DTN": {"sl": "DT", "en": "DT", "de": "DT"},
    "TNE": {"sl": "T", "en": "T", "de": "T"},
    "MTR": {"sl": "M", "en": "M", "de": "M"},
    "CMT": {"sl": "CM", "en": "CM", "de": "CM"},
    "MMT": {"sl": "MM", "en": "MM", "de": "MM"},
    "KMT": {"sl": "KM", "en": "KM", "de": "KM"},
    "MTK": {"sl": "M²", "en": "M²", "de": "M²"},
    "MTQ": {"sl": "M³", "en": "M³", "de": "M³"},
    "LTR": {"sl": "L", "en": "L", "de": "L"},
    "MLT": {"sl": "ML", "en": "ML", "de": "ML"},
    "KWT": {"sl": "KW", "en": "KW", "de": "KW"},
    "KWH": {"sl": "KWH", "en": "KWH", "de": "KWH"},
    "MWH": {"sl": "MWH", "en": "MWH", "de": "MWH"},
    "SET": {"sl": "KOMP", "en": "SET", "de": "SET"},
    "PR":  {"sl": "PAR", "en": "PAIR", "de": "PAAR"},
    "BX":  {"sl": "ŠKTL", "en": "BOX", "de": "KART"},
    "PK":  {"sl": "PAK", "en": "PKG", "de": "PAK"},
    "XPK": {"sl": "PAK", "en": "PKG", "de": "PAK"},
}

def _format_unit(code: str, lang: str = "sl") -> str:
    if not code:
        return "PCS" if lang == "en" else ("STK" if lang == "de" else "KOS")
    c = str(code).strip().upper()
    lang = (lang or "sl").lower()
    mapping = UNIT_LABELS.get(c)
    if mapping:
        if lang in ["multi", "multilingual"]:
            # Trilingual or bilingual representation
            return mapping.get("en", c)
        return mapping.get(lang, mapping.get("en", c))
    return code

def translate_payment_terms(terms: str, lang: str = "sl") -> str:
    """
    Translates standard payment terms expressions (e.g. 'within 30 days due net')
    into the selected export language.
    Preserves custom terms or references that do not match standard patterns.
    """
    if not terms:
        return ""
    t_clean = terms.strip()
    l = (lang or "sl").lower()

    # Detect day count if present, default 30
    days_match = re.search(r"\b(\d{1,3})\s*(?:days?|tage?|dni|dneh)\b", t_clean, re.IGNORECASE)
    days = days_match.group(1) if days_match else "30"

    # Check if text corresponds to standard net payment terms
    is_standard_net = bool(re.search(r"(?:within\s+\d+\s+days\s+due\s+net|30\s*days\s*due\s*net|payable\s+within|30\s*tage\s*netto|innerhalb\s+von\s+\d+\s+tagen|v\s+roku\s+\d+\s+dni)", t_clean, re.IGNORECASE))
    
    if is_standard_net:
        if l in ["de", "ger", "german"]:
            return f"{days} Tage rein netto ohne Abzug."
        elif l in ["sl", "slovenian"]:
            return f"Plačilo v roku {days} dni od datuma izdaje računa brez popusta."
        elif l in ["multi", "multilingual"]:
            return f"Plačilo v {days} dneh / Payment within {days} days net / {days} Tage netto"
        else: # en
            return f"Payment due within {days} days of invoice date net without deduction."

    return terms

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
    env.filters["format_unit"] = lambda val: _format_unit(val, lang=lang)
    
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

    cfg = footer_config or {}
    sync_delivery = bool(cfg.get("auto_sync_delivery_date", False))

    # Effective delivery date (BT-72)
    effective_delivery_date = inv.delivery_date
    if not effective_delivery_date and inv.delivery and inv.delivery.delivery_date:
        effective_delivery_date = inv.delivery.delivery_date
    if not effective_delivery_date and sync_delivery and inv.issue_date:
        effective_delivery_date = inv.issue_date

    # Ensure "Rechnungsdatum = Leistungsdatum" is included in inv.notes (BT-22) if auto_sync_delivery_date is True
    if sync_delivery:
        sync_clause = "Rechnungsdatum = Leistungsdatum"
        current_notes = list(inv.notes or [])
        if not any(sync_clause.lower() in str(n).lower() for n in current_notes):
            current_notes.append(sync_clause)
            inv.notes = current_notes

    # References matrix (BT-10, BT-13, BT-29, BT-12, BT-16, BT-19, BT-14, BT-11)
    references = []
    if inv.buyer_reference:
        references.append({"tag": "BT-10", "label": t_func("ref_buyer", "Referenca kupca"), "value": inv.buyer_reference})
    if inv.purchase_order_number:
        references.append({"tag": "BT-13", "label": t_func("ref_po", "Naročilnica (PO)"), "value": inv.purchase_order_number})
    if getattr(inv.seller, "seller_identifier", None):
        references.append({"tag": "BT-29", "label": t_func("ref_supplier", "Koda dobavitelja"), "value": inv.seller.seller_identifier})
    if getattr(inv, "contract_reference", None):
        references.append({"tag": "BT-12", "label": t_func("ref_contract", "Pogodba"), "value": inv.contract_reference})
    if inv.despatch_advice_reference:
        references.append({"tag": "BT-16", "label": t_func("ref_delivery", "Dobavnica"), "value": inv.despatch_advice_reference})
    if getattr(inv, "cost_center", None):
        references.append({"tag": "BT-19", "label": t_func("ref_cost_center", "Stroškovno mesto"), "value": inv.cost_center})
    if getattr(inv, "sales_order_number", None):
        references.append({"tag": "BT-14", "label": t_func("ref_order", "Interno naročilo"), "value": inv.sales_order_number})
    if getattr(inv, "project_reference", None):
        references.append({"tag": "BT-11", "label": t_func("ref_project", "Projekt"), "value": inv.project_reference})

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

    # Fallbacks from configuration (footer_config)
    seller_court_cfg = (cfg.get("seller_court") or "").strip()
    seller_hrb_cfg = (cfg.get("seller_hrb") or "").strip()
    combined_court_hrb = " | ".join(filter(None, [seller_court_cfg, seller_hrb_cfg]))

    raw_seller_court = (inv.seller.court_registry or inv.seller.company_legal_form or "").strip()
    if not raw_seller_court:
        effective_seller_court = combined_court_hrb
    elif seller_hrb_cfg and seller_hrb_cfg.lower() not in raw_seller_court.lower():
        effective_seller_court = f"{raw_seller_court} | {seller_hrb_cfg}" if raw_seller_court else combined_court_hrb
    else:
        effective_seller_court = raw_seller_court

    effective_seller_tax_number = (
        (getattr(inv.seller, "tax_number", None) or inv.seller.tax_registration_id or "").strip()
        or (cfg.get("seller_tax_number") or "").strip()
    )

    effective_seller_legal_info = (
        (getattr(inv.seller, "legal_info", None) or "").strip()
        or (cfg.get("seller_managing_directors") or "").strip()
    )

    effective_seller_phone = (
        (inv.seller.contact_phone or "").strip()
        or (cfg.get("seller_phone") or "").strip()
    )

    # Effective bank accounts list for Block 6
    effective_bank_accounts = []
    if getattr(inv.payment, "bank_accounts", None) and len(inv.payment.bank_accounts) > 0:
        effective_bank_accounts = inv.payment.bank_accounts
    else:
        # Fallback to configured bank accounts
        b1_iban = (cfg.get("seller_bank1_iban") or inv.payment.iban or "").strip()
        b1_name = (cfg.get("seller_bank1_name") or inv.payment.bank_name or "Primary Bank").strip()
        b1_bic = (cfg.get("seller_bank1_bic") or inv.payment.bic or "").strip()
        if b1_iban:
            effective_bank_accounts.append({"bank_name": b1_name, "iban": b1_iban, "bic": b1_bic})

        b2_iban = (cfg.get("seller_bank2_iban") or "").strip()
        b2_name = (cfg.get("seller_bank2_name") or "Secondary Bank").strip()
        b2_bic = (cfg.get("seller_bank2_bic") or "").strip()
        if b2_iban:
            effective_bank_accounts.append({"bank_name": b2_name, "iban": b2_iban, "bic": b2_bic})

    # Localize payment terms according to selected export language
    raw_payment_terms = (getattr(inv.payment, "payment_terms", None) or "").strip()
    effective_payment_terms = translate_payment_terms(raw_payment_terms, lang=lang) if raw_payment_terms else t_func("terms_text", "")

    html_rendered = template.render(
        inv=inv,
        t=t_func,
        lang_code=lang,
        doc_type_title=doc_type_title,
        effective_payment_terms=effective_payment_terms,
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
        footer_config=footer_config or {},
        effective_seller_court=effective_seller_court,
        effective_seller_tax_number=effective_seller_tax_number,
        effective_seller_legal_info=effective_seller_legal_info,
        effective_seller_phone=effective_seller_phone,
        effective_bank_accounts=effective_bank_accounts
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
