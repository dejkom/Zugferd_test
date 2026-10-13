// Global State for Scenarios
let currentPdfFileId = null;
let currentPdfInvoiceData = null;
let currentPdfUsage = null;

let currentDocxFileId = null;
let currentDocxInvoiceData = null;
let currentDocxUsage = null;

// ================= THEME (Dark / Light) =================
const themeToggleBtn = document.getElementById("themeToggleBtn");
const themeIcon = document.getElementById("themeIcon");
const storedTheme = localStorage.getItem("ZUGFERD_THEME") || "light";
applyTheme(storedTheme);

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    if (themeIcon) themeIcon.textContent = "☀️";
  } else {
    document.documentElement.removeAttribute("data-theme");
    if (themeIcon) themeIcon.textContent = "🌙";
  }
  localStorage.setItem("ZUGFERD_THEME", theme);
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    applyTheme(isDark ? "light" : "dark");
  });
}

const configApiKey = document.getElementById("configApiKey");
const configDefaultProfile = document.getElementById("configDefaultProfile");
const configInvoiceLayout = document.getElementById("configInvoiceLayout");
const manLayoutSelect = document.getElementById("manLayoutSelect");

function getStoredApiKey() {
  return localStorage.getItem("OPENAI_API_KEY") || "";
}

function getStoredLayout() {
  return localStorage.getItem("ZUGFERD_LAYOUT") || "layout1";
}

let cachedCompanySettings = {
  seller_name: "Acme Solutions Ltd",
  seller_vat: "DE123456789",
  seller_street: "Bahnhofstrasse 10",
  seller_city: "10115 Berlin",
  seller_country: "DE",
  seller_website: "www.acme-solutions.com",
  seller_court: "Amtsgericht Stuttgart",
  seller_hrb: "HRB 736903",
  seller_managing_directors: "Mürsel Gülen, Sedat Kilic",
  seller_bank1_name: "Commerzbank AG",
  seller_bank1_bic: "DBBADEFFXXX",
  seller_bank1_iban: "DE89370400440532013000",
  seller_bank2_name: "Baden-Württembergische Bank",
  seller_bank2_bic: "SOLA DEST",
  seller_bank2_iban: "DE30 6005 0101 7871 5056 72",
  active_prompt_id: "standard_en16931",
  extraction_prompts: {
    standard_en16931: {
      name: "Standard EN 16931 & ZUGFeRD 2.x (Recommended)",
      description: "Standard European invoice parser for invoice number, dates, parties, reverse-charge taxes, and totals.",
      content: `You are an expert accounting system and invoice parser specialized in European standard EN 16931 and ZUGFeRD / Factur-X specifications.
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
   Keys: 'invoice_number', 'issue_date', 'currency', 'buyer_reference', 'seller_name', 'seller_vat', 'seller_street', 'seller_city', 'buyer_name', 'buyer_vat', 'buyer_street', 'buyer_city', 'iban', 'bic', 'total_net', 'total_tax', 'total_grand', 'total_due'.`
    },
    automotive_german: {
      name: "German Automotive & Manufacturing (Strict Tax & PO)",
      description: "Optimized for German DACH invoices with USt-IdNr, Steuernummer, Delivery Dates, and explicit PO/Order References.",
      content: `You are an accounting specialist focused on German manufacturing, supply-chain, and automotive suppliers (e.g., DIN / EN 16931).
Parse the raw document text into an InvoiceData object with extra precision on:
1. Identifying German tax numbers: USt-IdNr (format DE followed by 9 digits) and Steuernummer / HRB register court details.
2. Detecting Order Number / Purchase Order (Bestellnummer / PO) and preceding invoice references if Gutschrift / Credit Note.
3. Extracting exact German addresses (PLZ 5 digits, Ort, Strasse, Hausnummer).
4. Extracting payment terms, Skonto discounts, or banking details (IBAN/BIC).
5. Accurate line items with German standard tax rates (19% standard, 7% reduced, or 0% reverse charge § 13b UStG).
6. Provide accurate confidence scores ('HIGH', 'MEDIUM', 'LOW').`
    }
  }
};

function getSellerSettings() {
  const local = localStorage.getItem("ZUGFERD_COMPANY_SETTINGS");
  if (local) {
    try {
      const parsed = JSON.parse(local);
      const res = Object.assign({}, cachedCompanySettings, parsed);
      if (!res.extraction_prompts || Object.keys(res.extraction_prompts).length === 0) {
        res.extraction_prompts = cachedCompanySettings.extraction_prompts;
      }
      return res;
    } catch (e) { }
  }
  return cachedCompanySettings;
}

function applySellerSettingsToInputs(settings) {
  const mapping = {
    cfgSellerName: "seller_name",
    cfgSellerVat: "seller_vat",
    cfgSellerStreet: "seller_street",
    cfgSellerPostcode: "seller_postcode",
    cfgSellerCity: "seller_city",
    cfgSellerCountry: "seller_country",
    cfgSellerWebsite: "seller_website",
    cfgSellerCourt: "seller_court",
    cfgSellerHrb: "seller_hrb",
    cfgSellerTaxNumber: "seller_tax_number",
    cfgSellerUstId: "seller_ust_id",
    cfgSellerPhone: "seller_phone",
    cfgSellerFax: "seller_fax",
    cfgSellerDirectors: "seller_managing_directors",
    cfgBank1Name: "seller_bank1_name",
    cfgBank1Bic: "seller_bank1_bic",
    cfgBank1Iban: "seller_bank1_iban",
    cfgBank2Name: "seller_bank2_name",
    cfgBank2Bic: "seller_bank2_bic",
    cfgBank2Iban: "seller_bank2_iban"
  };
  for (const [elemId, key] of Object.entries(mapping)) {
    const el = document.getElementById(elemId);
    if (el && settings[key] !== undefined) {
      el.value = settings[key];
    }
  }

  // If postcode is empty but city has postcode prefix (e.g. '70329 Stuttgart'), split them
  const pcEl = document.getElementById("cfgSellerPostcode");
  const cityEl = document.getElementById("cfgSellerCity");
  if (cityEl && cityEl.value) {
    const matchPc = cityEl.value.match(/^(\d{4,5})\s+(.*)$/);
    if (matchPc) {
      if (pcEl && (!pcEl.value || pcEl.value === "10115")) {
        pcEl.value = matchPc[1];
      }
      cityEl.value = matchPc[2];
    }
  }
  if (pcEl && (!pcEl.value || pcEl.value === "10115")) {
    pcEl.value = "70329";
  }
}


function populateManualSellerDefaults() {
  const s = getSellerSettings();
  const nameEl = document.getElementById("manSellerName");
  const vatEl = document.getElementById("manSellerVat");
  const streetEl = document.getElementById("manSellerStreet");
  const cityEl = document.getElementById("manSellerCity");
  const ibanEl = document.getElementById("manIban");
  const bicEl = document.getElementById("manBic");

  if (nameEl && !nameEl.value.trim()) nameEl.value = s.seller_name || "";
  if (vatEl && !vatEl.value.trim()) vatEl.value = s.seller_vat || "";
  if (streetEl && !streetEl.value.trim()) streetEl.value = s.seller_street || "";
  if (cityEl && !cityEl.value.trim()) cityEl.value = s.seller_city || "";
  if (ibanEl && !ibanEl.value.trim()) ibanEl.value = s.seller_bank1_iban || "";
  if (bicEl && !bicEl.value.trim()) bicEl.value = s.seller_bank1_bic || "";
}

async function loadPreferences() {
  const storedKey = getStoredApiKey();
  if (configApiKey) configApiKey.value = storedKey;

  const defaultProfile = localStorage.getItem("ZUGFERD_PROFILE") || "EN16931";
  if (configDefaultProfile) configDefaultProfile.value = defaultProfile;
  const profileSelect = document.getElementById("profileSelect");
  if (profileSelect) profileSelect.value = defaultProfile;

  const layout = getStoredLayout();
  if (configInvoiceLayout) configInvoiceLayout.value = layout;
  if (manLayoutSelect) manLayoutSelect.value = layout;

  // Apply initial local settings first
  applySellerSettingsToInputs(getSellerSettings());
  populateManualSellerDefaults();

  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      const statusEl = document.getElementById("serverApiKeyStatus");
      if (statusEl) {
        if (data.server_api_key_configured) {
          statusEl.style.display = "block";
          statusEl.style.color = "#10b981";
          statusEl.innerHTML = `&#10003; Server environment key active (<code>${data.masked_key}</code>). Local key is optional.`;
        } else {
          statusEl.style.display = "block";
          statusEl.style.color = "#f59e0b";
          statusEl.innerHTML = `&#9888; No server environment key found. Provide your API key above or set <code>OPENAI_API_KEY</code> in Docker.`;
        }
      }

      if (data.company_settings) {
        cachedCompanySettings = Object.assign({}, cachedCompanySettings, data.company_settings);
        localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(cachedCompanySettings));
        applySellerSettingsToInputs(cachedCompanySettings);
        populateManualSellerDefaults();
        renderSavedPartiesConfig();
        renderPromptConfigUI();
        renderSynonymsTable();
        if (typeof loadV2SavedPartiesDropdowns === "function") {
          loadV2SavedPartiesDropdowns();
        }
        if (typeof populateV2DefaultBankAccounts === "function") {
          populateV2DefaultBankAccounts();
        }

        // Auto-populate API key from server if not already stored locally on this host
        const serverKey = data.openai_api_key || (data.company_settings && data.company_settings.openai_api_key) || "";
        if (serverKey && configApiKey && !configApiKey.value.trim()) {
          configApiKey.value = serverKey;
          localStorage.setItem("OPENAI_API_KEY", serverKey);
        }
      }
    }
  } catch (e) {
    console.warn("Could not check server config", e);
  }
}
loadPreferences();

function handleManualLayoutChange(val) {
  localStorage.setItem("ZUGFERD_LAYOUT", val);
  if (configInvoiceLayout) configInvoiceLayout.value = val;
}
window.handleManualLayoutChange = handleManualLayoutChange;

async function saveConfiguration() {
  const key = configApiKey ? configApiKey.value.trim() : "";
  if (key) {
    localStorage.setItem("OPENAI_API_KEY", key);
  } else {
    localStorage.removeItem("OPENAI_API_KEY");
  }

  const prof = configDefaultProfile ? configDefaultProfile.value : "EN16931";
  localStorage.setItem("ZUGFERD_PROFILE", prof);
  const profileSelect = document.getElementById("profileSelect");
  if (profileSelect) profileSelect.value = prof;

  const layout = configInvoiceLayout ? configInvoiceLayout.value : "layout1";
  localStorage.setItem("ZUGFERD_LAYOUT", layout);
  if (manLayoutSelect) manLayoutSelect.value = layout;

  // Fetch the latest config from server first to ensure saved_parties are 100% fresh and never clobbered
  let currentParties = (window.cachedCompanySettings && window.cachedCompanySettings.saved_parties) || { sellers: [], buyers: [] };
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      if (data.company_settings && data.company_settings.saved_parties) {
        currentParties = data.company_settings.saved_parties;
      }
    }
  } catch (e) {
    console.warn("Could not fetch latest server config before saving:", e);
  }

  // Gather seller & footer settings from configuration form
  let rawCity = document.getElementById("cfgSellerCity")?.value.trim() || "";
  let rawPostcode = document.getElementById("cfgSellerPostcode")?.value.trim() || "";
  if (!rawPostcode && rawCity) {
    const m = rawCity.match(/^(\d{4,5})\s+(.*)$/);
    if (m) {
      rawPostcode = m[1];
      rawCity = m[2];
    }
  } else if (rawCity && /^\d{4,5}\s+/.test(rawCity)) {
    rawCity = rawCity.replace(/^\d{4,5}\s+/, "").trim();
  }

  const newSettings = {
    seller_name: document.getElementById("cfgSellerName")?.value.trim() || "",
    seller_vat: document.getElementById("cfgSellerVat")?.value.trim() || "",
    seller_street: document.getElementById("cfgSellerStreet")?.value.trim() || "",
    seller_postcode: rawPostcode || "70329",
    seller_city: rawCity || "Stuttgart",
    seller_country: document.getElementById("cfgSellerCountry")?.value.trim() || "DE",
    seller_website: document.getElementById("cfgSellerWebsite")?.value.trim() || "",
    seller_court: document.getElementById("cfgSellerCourt")?.value.trim() || "",
    seller_hrb: document.getElementById("cfgSellerHrb")?.value.trim() || "",
    seller_tax_number: document.getElementById("cfgSellerTaxNumber")?.value.trim() || "",
    seller_ust_id: document.getElementById("cfgSellerUstId")?.value.trim() || "",
    seller_phone: document.getElementById("cfgSellerPhone")?.value.trim() || "",
    seller_fax: document.getElementById("cfgSellerFax")?.value.trim() || "",
    seller_managing_directors: document.getElementById("cfgSellerDirectors")?.value.trim() || "",
    seller_bank1_name: document.getElementById("cfgBank1Name")?.value.trim() || "",
    seller_bank1_bic: document.getElementById("cfgBank1Bic")?.value.trim() || "",
    seller_bank1_iban: document.getElementById("cfgBank1Iban")?.value.trim() || "",
    seller_bank2_name: document.getElementById("cfgBank2Name")?.value.trim() || "",
    seller_bank2_bic: document.getElementById("cfgBank2Bic")?.value.trim() || "",
    seller_bank2_iban: document.getElementById("cfgBank2Iban")?.value.trim() || "",
    openai_api_key: key || (window.cachedCompanySettings && window.cachedCompanySettings.openai_api_key) || "",
    saved_parties: currentParties,
    active_prompt_id: currentEditingPromptId || (window.cachedCompanySettings && window.cachedCompanySettings.active_prompt_id) || "standard_en16931",
    extraction_prompts: (window.cachedCompanySettings && window.cachedCompanySettings.extraction_prompts) || {}
  };

  // If prompt editor is modified, save current active prompt content
  if (currentEditingPromptId && newSettings.extraction_prompts[currentEditingPromptId]) {
    const pName = document.getElementById("cfgPromptName")?.value.trim();
    const pDesc = document.getElementById("cfgPromptDesc")?.value.trim();
    const pContent = document.getElementById("cfgPromptContent")?.value.trim();
    if (pName) newSettings.extraction_prompts[currentEditingPromptId].name = pName;
    if (pDesc) newSettings.extraction_prompts[currentEditingPromptId].description = pDesc;
    if (pContent) newSettings.extraction_prompts[currentEditingPromptId].content = pContent;
  }

  window.cachedCompanySettings = Object.assign({}, window.cachedCompanySettings, newSettings);
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(window.cachedCompanySettings));

  // Sync to server so Docker container stores it persistently
  try {
    const postRes = await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: newSettings })
    });
    if (postRes.ok) {
      const postData = await postRes.json();
      if (postData.settings) {
        window.cachedCompanySettings = postData.settings;
        localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(postData.settings));
      }
    }
  } catch (err) {
    console.warn("Could not persist settings to server:", err);
  }

  // Update manual and v2 forms
  populateManualSellerDefaults();
  renderSavedPartiesConfig();
  renderPromptConfigUI();
  if (typeof loadV2SavedPartiesDropdowns === "function") {
    loadV2SavedPartiesDropdowns();
  }
  if (typeof updateV2BankPresetDropdown === "function") {
    updateV2BankPresetDropdown();
  }

  alert("Configuration saved successfully!");
}
window.saveConfiguration = saveConfiguration;

// ================= PROMPT MANAGEMENT (CONFIG VIEW) =================
let currentEditingPromptId = "standard_en16931";

function renderPromptConfigUI() {
  const settings = getSellerSettings();
  window.cachedCompanySettings = settings;
  const prompts = settings.extraction_prompts || {};
  const activeId = settings.active_prompt_id || "standard_en16931";
  currentEditingPromptId = activeId;

  const selectEl = document.getElementById("cfgPromptSelect");
  if (!selectEl) return;
  selectEl.innerHTML = "";

  Object.entries(prompts).forEach(([id, p]) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${p.name || id} ${id === activeId ? '★ (Active)' : ''}`;
    if (id === currentEditingPromptId) opt.selected = true;
    selectEl.appendChild(opt);
  });

  populatePromptEditor(currentEditingPromptId);
}
window.renderPromptConfigUI = renderPromptConfigUI;

function populatePromptEditor(promptId) {
  const settings = window.cachedCompanySettings || {};
  const prompts = settings.extraction_prompts || {};
  const p = prompts[promptId];
  if (!p) return;

  currentEditingPromptId = promptId;

  const nameEl = document.getElementById("cfgPromptName");
  const descEl = document.getElementById("cfgPromptDesc");
  const contentEl = document.getElementById("cfgPromptContent");
  const badgeEl = document.getElementById("promptStatusBadge");
  const delBtn = document.getElementById("btnDeletePrompt");

  if (nameEl) nameEl.value = p.name || "";
  if (descEl) descEl.value = p.description || "";
  if (contentEl) contentEl.value = p.content || "";

  const isActive = (settings.active_prompt_id || "standard_en16931") === promptId;
  if (badgeEl) {
    badgeEl.textContent = isActive ? "Active Preset" : "Alternative Preset";
    badgeEl.style.background = isActive ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.15)";
    badgeEl.style.color = isActive ? "#10b981" : "var(--text-muted)";
  }

  if (delBtn) {
    delBtn.style.display = promptId === "standard_en16931" ? "none" : "inline-flex";
  }
}

async function handlePromptSelectionChange(promptId) {
  currentEditingPromptId = promptId;
  populatePromptEditor(promptId);

  // Set as active prompt
  const settings = window.cachedCompanySettings || {};
  settings.active_prompt_id = promptId;
  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  try {
    await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { active_prompt_id: promptId } })
    });
  } catch (e) {
    console.warn("Could not save active prompt selection:", e);
  }

  renderPromptConfigUI();
}
window.handlePromptSelectionChange = handlePromptSelectionChange;

function addNewPromptTemplate() {
  const name = prompt("Enter a title for the new prompt preset:", "Specialized Custom Prompt");
  if (!name || !name.trim()) return;

  const newId = "prompt_" + Date.now().toString(36);
  const settings = window.cachedCompanySettings || {};
  if (!settings.extraction_prompts) settings.extraction_prompts = {};

  const baseContent = (settings.extraction_prompts[currentEditingPromptId] && settings.extraction_prompts[currentEditingPromptId].content) ||
    document.getElementById("cfgPromptContent")?.value || "";

  settings.extraction_prompts[newId] = {
    name: name.trim(),
    description: "Custom user-defined invoice parser prompt",
    content: baseContent
  };
  settings.active_prompt_id = newId;

  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  // Sync to backend
  fetch("/api/config/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: settings })
  }).catch(e => console.warn(e));

  renderPromptConfigUI();
}
window.addNewPromptTemplate = addNewPromptTemplate;

async function savePromptPresetOnly() {
  const name = document.getElementById("cfgPromptName")?.value.trim();
  const desc = document.getElementById("cfgPromptDesc")?.value.trim();
  const content = document.getElementById("cfgPromptContent")?.value.trim();

  if (!name) {
    alert("Prompt Preset Name is required.");
    return;
  }
  if (!content) {
    alert("Prompt Content cannot be empty.");
    return;
  }

  const settings = window.cachedCompanySettings || {};
  if (!settings.extraction_prompts) settings.extraction_prompts = {};
  if (!settings.extraction_prompts[currentEditingPromptId]) {
    settings.extraction_prompts[currentEditingPromptId] = {};
  }

  settings.extraction_prompts[currentEditingPromptId].name = name;
  settings.extraction_prompts[currentEditingPromptId].description = desc;
  settings.extraction_prompts[currentEditingPromptId].content = content;
  settings.active_prompt_id = currentEditingPromptId;

  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  try {
    await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: settings })
    });
    alert(`✅ Prompt Preset "${name}" saved and set as active parser!`);
  } catch (err) {
    alert("Could not save prompt to server: " + err.message);
  }

  renderPromptConfigUI();
}
window.savePromptPresetOnly = savePromptPresetOnly;

async function deleteActivePrompt() {
  if (currentEditingPromptId === "standard_en16931") {
    alert("The standard default prompt preset cannot be deleted.");
    return;
  }
  if (!confirm("Are you sure you want to delete this prompt preset?")) return;

  const settings = window.cachedCompanySettings || {};
  if (settings.extraction_prompts && settings.extraction_prompts[currentEditingPromptId]) {
    delete settings.extraction_prompts[currentEditingPromptId];
  }
  settings.active_prompt_id = "standard_en16931";
  currentEditingPromptId = "standard_en16931";

  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  try {
    await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: settings })
    });
  } catch (e) {
    console.warn(e);
  }

  renderPromptConfigUI();
}
window.deleteActivePrompt = deleteActivePrompt;

function resetActivePromptToDefault() {
  const defaultPrompt = `You are an expert accounting AI and multilingual invoice parser specialized in European standard EN 16931, ZUGFeRD / Factur-X, and Slovenian e-SLOG 2.0 specifications.
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
- Assign confidence scores ('HIGH', 'MEDIUM', 'LOW') in confidence_scores.`;

  const contentEl = document.getElementById("cfgPromptContent");
  if (contentEl) contentEl.value = defaultPrompt;
}
window.resetActivePromptToDefault = resetActivePromptToDefault;

// ================= SYNONYMS / KEYWORDS DICTIONARY (CHIPS EDITOR) =================
let cachedSynonyms = null;

const DEFAULT_SYNONYMS_FALLBACK = {
  "BT-1": {
    bt: "BT-1", field: "invoice_number", name: "Invoice identifier",
    en: ["Invoice #", "Invoice No.", "Inv No.", "Bill No.", "Invoice Number"],
    de: ["Rechnungs-Nr.", "Rechnungsnummer", "Rg.-Nr.", "Faktura", "Rechnung Nr."],
    sl: ["Številka računa", "Račun št.", "Št. računa", "Št. Rač", "Račun"]
  },
  "BT-2": {
    bt: "BT-2", field: "issue_date", name: "Invoice issue date",
    en: ["Invoice date", "Issue date", "Date of invoice", "Date"],
    de: ["Rechnungsdatum", "Ausstellungsdatum", "Belegdatum", "Datum"],
    sl: ["Datum računa", "Datum izdaje", "Izdan dne", "Datum"]
  },
  "BT-9": {
    bt: "BT-9", field: "due_date", name: "Payment due date",
    en: ["Due date", "Payment due date", "Payable by"],
    de: ["Fälligkeitsdatum", "Fällig am", "Zahlbar bis", "Zahlungsziel"],
    sl: ["Datum zapadlosti", "Rok plačila", "Valuta", "Zapadlost", "Plačati do"]
  },
  "BT-10": {
    bt: "BT-10", field: "buyer_reference", name: "Buyer reference",
    en: ["Buyer reference", "Routing ID", "Customer ref", "Order ref"],
    de: ["Leitweg-ID", "Käuferreferenz", "Kundenreferenz", "Referenz"],
    sl: ["Referenca kupca", "Sklic kupca", "Šifra partnerja", "Kupčeva referenca"]
  },
  "BT-13": {
    bt: "BT-13", field: "purchase_order_number", name: "Purchase order reference",
    en: ["Purchase Order", "PO #", "PO Number", "Order No."],
    de: ["Bestellnummer", "Bestell-Nr.", "Best.-Nr.", "Auftragsnummer"],
    sl: ["Številka naročilnice", "Naročilnica št.", "Naročilo št.", "Naročilnica"]
  },
  "BT-14": {
    bt: "BT-14", field: "purchase_order_date", name: "Purchase order date",
    en: ["Order date", "PO Date"],
    de: ["Bestelldatum", "Auftragsdatum"],
    sl: ["Datum naročila", "Datum naročilnice"]
  },
  "BT-16": {
    bt: "BT-16", field: "despatch_advice_id", name: "Despatch advice reference (Delivery note)",
    en: ["Delivery note #", "Despatch advice", "Packing slip"],
    de: ["Lieferschein-Nr.", "Lieferscheinnummer", "LS-Nr."],
    sl: ["Številka dobavnice", "Dobavnica št.", "Dobavnica", "Št. dobavnice"]
  },
  "BT-44": {
    bt: "BT-44", field: "buyer_name", name: "Buyer name",
    en: ["Buyer", "Customer", "Bill To", "Sold To"],
    de: ["Käufer", "Rechnungsempfänger", "Kunde", "Auftraggeber"],
    sl: ["Kupec", "Prejemnik računa", "Naročnik", "Plačnik"]
  },
  "BT-48": {
    bt: "BT-48", field: "buyer_vat", name: "Buyer VAT identifier",
    en: ["VAT Reg No", "VAT ID", "Customer VAT", "Tax ID"],
    de: ["USt-IdNr.", "UID-Nr.", "Umsatzsteuer-ID", "Steuer-Nr."],
    sl: ["ID za DDV", "Davčna št. kupca", "Davčna številka", "ID za DDV kupca"]
  },
  "BT-70": {
    bt: "BT-70", field: "recipient_name", name: "Deliver-to recipient name",
    en: ["Ship To", "Deliver To", "Consignee", "Destination"],
    de: ["Lieferadresse", "Warenempfänger", "Lieferort"],
    sl: ["Prejemnik blaga", "Naslov za dostavo", "Dostava", "Prevzemnik"]
  },
  "BT-71": {
    bt: "BT-71", field: "location_id", name: "Deliver-to location identifier (GLN)",
    en: ["Unloading point", "Dock", "Location ID", "GLN"],
    de: ["Abladestelle", "Abladestelle Nr.", "Lagerort", "Tor"],
    sl: ["Razkladalno mesto", "Prevzemno mesto", "Skladišče", "Lokacija prevzema"]
  },
  "BT-72": {
    bt: "BT-72", field: "delivery_date", name: "Actual delivery date",
    en: ["Delivery date", "Shipment date", "Performance date"],
    de: ["Lieferdatum", "Leistungsdatum", "Lieferzeitpunkt"],
    sl: ["Datum dobave", "Datum opravljene storitve", "Datum dobave/storitve"]
  },
  "BT-83": {
    bt: "BT-83", field: "payment_terms", name: "Payment terms & remittance reference",
    en: ["Payment terms", "Due conditions", "Payment reference"],
    de: ["Zahlungsbedingungen", "Zahlungsziel", "Konditionen", "Skonto"],
    sl: ["Plačilni pogoji", "Rok plačila", "Sklic", "Sklic za plačilo", "Model"]
  },
  "BT-84": {
    bt: "BT-84", field: "iban", name: "Payment account (IBAN / Account)",
    en: ["IBAN", "Bank Account", "Account #"],
    de: ["IBAN", "Kontonummer", "Bankverbindung"],
    sl: ["IBAN", "TRR", "Transakcijski račun", "Številka računa (TRR)"]
  },
  "BT-106": {
    bt: "BT-106", field: "line_net_total", name: "Sum of line net amounts",
    en: ["Net total", "Subtotal", "Total net amount", "Net Amount"],
    de: ["Nettobetrag", "Gesamtbetrag Netto", "Zwischensumme Netto"],
    sl: ["Znesek brez DDV", "Osnova", "Skupaj brez DDV", "Neto znesek"]
  },
  "BT-110": {
    bt: "BT-110", field: "tax_total", name: "Invoice total VAT amount",
    en: ["Total VAT", "VAT amount", "Total tax", "Tax"],
    de: ["MwSt. Gesamt", "USt.", "Steuerbetrag", "MwSt."],
    sl: ["Znesek DDV", "Vrednost DDV", "Skupaj DDV", "DDV"]
  },
  "BT-112": {
    bt: "BT-112", field: "grand_total", name: "Invoice total with VAT (Gross)",
    en: ["Grand total", "Total gross", "Gross amount", "Total Amount"],
    de: ["Bruttobetrag", "Rechnungsbetrag", "Gesamtbetrag Brutto", "Gesamtbetrag"],
    sl: ["Znesek z DDV", "Skupaj z DDV", "Bruto znesek", "Skupaj za plačilo z DDV"]
  },
  "BT-115": {
    bt: "BT-115", field: "due_payable_amount", name: "Amount due for payment",
    en: ["Amount due", "Due payable", "Payable amount", "Balance due"],
    de: ["Zu zahlender Betrag", "Fälliger Betrag", "Zahlbetrag"],
    sl: ["Za plačilo", "Znesek za plačilo", "Skupaj za plačilo", "K plačilu"]
  }
};

function renderSynonymsTable() {
  const tbody = document.getElementById("synonymsTableBody");
  if (!tbody) return;

  const settings = window.cachedCompanySettings || {};
  let synonyms = settings.extraction_synonyms || DEFAULT_SYNONYMS_FALLBACK;
  cachedSynonyms = JSON.parse(JSON.stringify(synonyms));

  tbody.innerHTML = "";

  Object.entries(cachedSynonyms).forEach(([btKey, item]) => {
    const tr = document.createElement("tr");

    // BT Badge
    const tdBt = document.createElement("td");
    tdBt.style.fontWeight = "700";
    tdBt.style.color = "#3b82f6";
    tdBt.textContent = btKey;
    tr.appendChild(tdBt);

    // Field Name
    const tdField = document.createElement("td");
    tdField.innerHTML = `
      <div style="font-weight: 600; color: var(--text-main);">${escapeHtml(item.field || "")}</div>
      <div style="font-size: 0.72rem; color: var(--text-dim);">${escapeHtml(item.name || "")}</div>
    `;
    tr.appendChild(tdField);

    // Helper to create chips container for a language
    const createChipsCell = (langKey, langClass, placeholder) => {
      const td = document.createElement("td");
      const wrap = document.createElement("div");
      wrap.className = "keyword-chips-wrap";

      const tags = Array.isArray(item[langKey]) ? item[langKey] : [];

      const renderChips = () => {
        wrap.innerHTML = "";
        tags.forEach((tagText, idx) => {
          const chip = document.createElement("span");
          chip.className = `keyword-chip ${langClass}`;
          chip.innerHTML = `
            <span>${escapeHtml(tagText)}</span>
            <span class="keyword-chip-remove" title="Remove keyword">✕</span>
          `;
          chip.querySelector(".keyword-chip-remove").addEventListener("click", () => {
            tags.splice(idx, 1);
            item[langKey] = tags;
            renderChips();
          });
          wrap.appendChild(chip);
        });

        // Inline add input
        const input = document.createElement("input");
        input.type = "text";
        input.className = "keyword-chip-input";
        input.placeholder = placeholder;

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            const val = input.value.trim().replace(/^,+|,+$/g, "");
            if (val && !tags.includes(val)) {
              tags.push(val);
              item[langKey] = tags;
              renderChips();
            }
          } else if (e.key === "Backspace" && !input.value && tags.length > 0) {
            tags.pop();
            item[langKey] = tags;
            renderChips();
          }
        });

        input.addEventListener("blur", () => {
          const val = input.value.trim().replace(/^,+|,+$/g, "");
          if (val && !tags.includes(val)) {
            tags.push(val);
            item[langKey] = tags;
            renderChips();
          }
        });

        wrap.appendChild(input);
      };

      renderChips();
      td.appendChild(wrap);
      return td;
    };

    tr.appendChild(createChipsCell("en", "lang-en", "+ Add EN..."));
    tr.appendChild(createChipsCell("de", "lang-de", "+ Add DE..."));
    tr.appendChild(createChipsCell("sl", "lang-sl", "+ Add SI..."));

    tbody.appendChild(tr);
  });

  const countBadge = document.getElementById("synonymsCountBadge");
  if (countBadge) {
    countBadge.textContent = `${Object.keys(cachedSynonyms).length} Terms Active`;
  }
}
window.renderSynonymsTable = renderSynonymsTable;

function filterSynonymsTable(query) {
  const tbody = document.getElementById("synonymsTableBody");
  if (!tbody) return;
  const q = (query || "").trim().toLowerCase();
  const rows = tbody.querySelectorAll("tr");
  rows.forEach(tr => {
    if (!q) {
      tr.style.display = "";
      return;
    }
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(q) ? "" : "none";
  });
}
window.filterSynonymsTable = filterSynonymsTable;

function addNewSynonymRow() {
  const bt = prompt("Enter BT code (e.g. BT-25 or BT-153):", "BT-");
  if (!bt || !bt.trim()) return;
  const cleanBt = bt.trim().toUpperCase();

  if (cachedSynonyms && cachedSynonyms[cleanBt]) {
    alert(`Entry for ${cleanBt} already exists in the dictionary.`);
    const input = document.getElementById("synonymsFilterInput");
    if (input) {
      input.value = cleanBt;
      filterSynonymsTable(cleanBt);
    }
    return;
  }

  const fieldName = prompt(`Enter internal field name or description for ${cleanBt}:`, "custom_field");
  if (!fieldName || !fieldName.trim()) return;

  if (!cachedSynonyms) cachedSynonyms = {};
  cachedSynonyms[cleanBt] = {
    bt: cleanBt,
    field: fieldName.trim(),
    name: fieldName.trim(),
    en: [],
    de: [],
    sl: []
  };

  renderSynonymsTable();
  const input = document.getElementById("synonymsFilterInput");
  if (input) {
    input.value = cleanBt;
    filterSynonymsTable(cleanBt);
  }
}
window.addNewSynonymRow = addNewSynonymRow;

async function saveSynonymsConfig() {
  if (!cachedSynonyms) return;

  const settings = window.cachedCompanySettings || {};
  settings.extraction_synonyms = cachedSynonyms;
  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  try {
    const res = await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { extraction_synonyms: cachedSynonyms } })
    });
    if (res.ok) {
      alert("✅ Multilingual keyword dictionary saved! AI extractor will now prioritize these phrases on your documents.");
    } else {
      throw new Error("Server responded with error");
    }
  } catch (err) {
    alert("Could not save keywords: " + err.message);
  }
}
window.saveSynonymsConfig = saveSynonymsConfig;

async function resetSynonymsToDefaults() {
  if (!confirm("Reset all keyword chips back to default EN, DE, and SI definitions?")) return;

  cachedSynonyms = JSON.parse(JSON.stringify(DEFAULT_SYNONYMS_FALLBACK));
  const settings = window.cachedCompanySettings || {};
  settings.extraction_synonyms = cachedSynonyms;
  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  try {
    await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { extraction_synonyms: cachedSynonyms } })
    });
  } catch (e) {
    console.warn(e);
  }

  renderSynonymsTable();
  alert("Keywords reset to default standard.");
}
window.resetSynonymsToDefaults = resetSynonymsToDefaults;

// ================= TAX / VAT / DDV RATES CONFIGURATION =================
const DEFAULT_TAX_RATES_FALLBACK = [
  { id: "si_22", country: "SI", rate: 22.0, category: "S", label: "22% DDV Splošna stopnja (SI)" },
  { id: "si_95", country: "SI", rate: 9.5, category: "S", label: "9.5% DDV Znižana stopnja (SI)" },
  { id: "si_5", country: "SI", rate: 5.0, category: "S", label: "5% DDV Posebna znižana (SI)" },
  { id: "de_19", country: "DE", rate: 19.0, category: "S", label: "19% MwSt. Regelsteuersatz (DE)" },
  { id: "de_7", country: "DE", rate: 7.0, category: "S", label: "7% MwSt. Ermäßigter Satz (DE)" },
  { id: "at_20", country: "AT", rate: 20.0, category: "S", label: "20% USt. Normalsteuersatz (AT)" },
  { id: "at_10", country: "AT", rate: 10.0, category: "S", label: "10% USt. Ermäßigt (AT)" },
  { id: "hr_25", country: "HR", rate: 25.0, category: "S", label: "25% PDV Opća stopa (HR)" },
  { id: "dk_25", country: "DK", rate: 25.0, category: "S", label: "25% Moms Almindelig (DK)" },
  { id: "fr_20", country: "FR", rate: 20.0, category: "S", label: "20% TVA Taux normal (FR)" },
  { id: "it_22", country: "IT", rate: 22.0, category: "S", label: "22% IVA Ordinaria (IT)" },
  { id: "ch_81", country: "CH", rate: 8.1, category: "S", label: "8.1% MWST Normalsatz (CH)" },
  { id: "gen_ae", country: "ALL", rate: 0.0, category: "AE", label: "0% Reverse Charge / Obrnjena obveznost (AE)" },
  { id: "gen_e", country: "ALL", rate: 0.0, category: "E", label: "0% Exempt / Oproščeno (E)" },
  { id: "gen_z", country: "ALL", rate: 0.0, category: "Z", label: "0% Zero Rated (Z)" }
];

let cachedTaxRates = null;

function renderTaxRatesConfig() {
  const tbody = document.getElementById("cfgTaxRatesTableBody");
  if (!tbody) return;

  const settings = window.cachedCompanySettings || {};
  let rates = settings.tax_rates;
  if (!Array.isArray(rates) || rates.length === 0) {
    rates = JSON.parse(JSON.stringify(DEFAULT_TAX_RATES_FALLBACK));
  }
  cachedTaxRates = JSON.parse(JSON.stringify(rates));

  tbody.innerHTML = "";

  cachedTaxRates.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--bg-card-border)";

    tr.innerHTML = `
      <td style="padding: 0.5rem 0.75rem;">
        <input type="text" value="${escapeHtml(r.country || 'SI')}" 
               style="width: 100%; padding: 0.3rem 0.5rem; background: var(--bg-card); border: 1px solid var(--bg-card-border); color: var(--text-main); border-radius: 4px; font-weight: 700; text-transform: uppercase;"
               oninput="updateTaxRateField(${idx}, 'country', this.value.toUpperCase())" placeholder="e.g. SI">
      </td>
      <td style="padding: 0.5rem 0.75rem;">
        <div style="display: flex; align-items: center; gap: 4px;">
          <input type="number" step="0.1" min="0" max="100" value="${r.rate !== undefined ? r.rate : 0}" 
                 style="width: 100%; padding: 0.3rem 0.5rem; background: var(--bg-card); border: 1px solid var(--bg-card-border); color: var(--text-main); border-radius: 4px;"
                 oninput="updateTaxRateField(${idx}, 'rate', parseFloat(this.value)||0)">
          <span style="color: var(--text-muted); font-size: 0.8rem;">%</span>
        </div>
      </td>
      <td style="padding: 0.5rem 0.75rem;">
        <select style="width: 100%; padding: 0.3rem 0.4rem; background: var(--bg-card); border: 1px solid var(--bg-card-border); color: var(--text-main); border-radius: 4px;"
                onchange="updateTaxRateField(${idx}, 'category', this.value)">
          <option value="S" ${r.category === 'S' ? 'selected' : ''}>S - Standard Rate</option>
          <option value="AE" ${r.category === 'AE' ? 'selected' : ''}>AE - Reverse Charge</option>
          <option value="E" ${r.category === 'E' ? 'selected' : ''}>E - Exempt</option>
          <option value="Z" ${r.category === 'Z' ? 'selected' : ''}>Z - Zero Rated</option>
          <option value="K" ${r.category === 'K' ? 'selected' : ''}>K - Intra-Community</option>
        </select>
      </td>
      <td style="padding: 0.5rem 0.75rem;">
        <input type="text" value="${escapeHtml(r.label || '')}" 
               style="width: 100%; padding: 0.3rem 0.5rem; background: var(--bg-card); border: 1px solid var(--bg-card-border); color: var(--text-main); border-radius: 4px;"
               oninput="updateTaxRateField(${idx}, 'label', this.value)" placeholder="e.g. 22% DDV Splošna stopnja">
      </td>
      <td style="padding: 0.5rem 0.75rem; text-align: center;">
        <button type="button" class="btn btn-secondary" style="padding: 2px 7px; font-size: 0.75rem; color: #ef4444;" onclick="deleteTaxRateRow(${idx})" title="Delete tax rate">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
window.renderTaxRatesConfig = renderTaxRatesConfig;

function updateTaxRateField(idx, field, val) {
  if (cachedTaxRates && cachedTaxRates[idx]) {
    cachedTaxRates[idx][field] = val;
  }
}
window.updateTaxRateField = updateTaxRateField;

function addNewTaxRateRow() {
  if (!cachedTaxRates) cachedTaxRates = [];
  cachedTaxRates.unshift({
    country: "SI",
    rate: 22.0,
    category: "S",
    label: "Custom Rate"
  });
  renderTaxRatesConfigRows();
}
window.addNewTaxRateRow = addNewTaxRateRow;

function deleteTaxRateRow(idx) {
  if (!cachedTaxRates) return;
  cachedTaxRates.splice(idx, 1);
  renderTaxRatesConfigRows();
}
window.deleteTaxRateRow = deleteTaxRateRow;

function renderTaxRatesConfigRows() {
  const settings = window.cachedCompanySettings || {};
  settings.tax_rates = cachedTaxRates;
  window.cachedCompanySettings = settings;
  renderTaxRatesConfig();
}

async function saveTaxRatesConfig() {
  if (!cachedTaxRates) return;

  const settings = window.cachedCompanySettings || {};
  settings.tax_rates = cachedTaxRates;
  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  try {
    const res = await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { tax_rates: cachedTaxRates } })
    });
    if (res.ok) {
      alert("✅ VAT / Tax (DDV) Rates saved! Studio v2 and AI extractor are updated.");
    } else {
      throw new Error("Server responded with error");
    }
  } catch (err) {
    alert("Could not save tax rates: " + err.message);
  }
}
window.saveTaxRatesConfig = saveTaxRatesConfig;

async function resetTaxRatesToDefaults() {
  if (!confirm("Reset all VAT / DDV rates back to European standard presets?")) return;

  cachedTaxRates = JSON.parse(JSON.stringify(DEFAULT_TAX_RATES_FALLBACK));
  const settings = window.cachedCompanySettings || {};
  settings.tax_rates = cachedTaxRates;
  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  try {
    await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { tax_rates: cachedTaxRates } })
    });
  } catch (e) {
    console.warn(e);
  }

  renderTaxRatesConfig();
  alert("Tax rates reset to default European presets.");
}
window.resetTaxRatesToDefaults = resetTaxRatesToDefaults;

async function renderSavedPartiesConfig() {
  // If not yet populated or on demand, attempt to refresh settings from server
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      if (data.company_settings) {
        window.cachedCompanySettings = Object.assign({}, window.cachedCompanySettings, data.company_settings);
      }
    }
  } catch (e) {
    // fallback to local storage
    try {
      const local = localStorage.getItem("ZUGFERD_COMPANY_SETTINGS");
      if (local) {
        window.cachedCompanySettings = Object.assign({}, window.cachedCompanySettings, JSON.parse(local));
      }
    } catch (_) {}
  }

  const settings = window.cachedCompanySettings || {};
  const parties = settings.saved_parties || { sellers: [], buyers: [] };
  const sellers = parties.sellers || [];
  const buyers = parties.buyers || [];

  const sellersCountEl = document.getElementById("cfgSavedSellersCount");
  const buyersCountEl = document.getElementById("cfgSavedBuyersCount");
  if (sellersCountEl) sellersCountEl.textContent = sellers.length;
  if (buyersCountEl) buyersCountEl.textContent = buyers.length;

  const sellersListEl = document.getElementById("cfgSavedSellersList");
  if (sellersListEl) {
    if (sellers.length === 0) {
      sellersListEl.innerHTML = `<div style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">No saved sellers yet. Click "Save for later" on the Seller card in Studio v2.</div>`;
    } else {
      sellersListEl.innerHTML = "";
      sellers.forEach((s, idx) => {
        const partyId = s.id || `seller_${idx}`;
        const row = document.createElement("div");
        row.className = "v2-saved-party-row";
        row.innerHTML = `
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main);">${escapeHtml(s.name)}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${escapeHtml(s.city || "")} &bull; ${escapeHtml(s.vat_id || "No VAT")}</div>
          </div>
          <div style="display: flex; gap: 0.35rem; align-items: center;">
            <button type="button" class="btn btn-secondary" style="padding: 2px 7px; font-size: 0.72rem;" onclick="openEditPartyModal('seller', '${partyId}')" title="Edit seller details">✏️</button>
            <button type="button" class="btn btn-secondary" style="padding: 2px 7px; font-size: 0.72rem; color: #ef4444;" onclick="deleteSavedParty('seller', '${partyId}')" title="Delete saved seller">🗑️</button>
          </div>
        `;
        sellersListEl.appendChild(row);
      });
    }
  }

  const buyersListEl = document.getElementById("cfgSavedBuyersList");
  if (buyersListEl) {
    if (buyers.length === 0) {
      buyersListEl.innerHTML = `<div style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">No saved buyers yet. Click "Save for later" on the Buyer card in Studio v2.</div>`;
    } else {
      buyersListEl.innerHTML = "";
      buyers.forEach((b, idx) => {
        const partyId = b.id || `buyer_${idx}`;
        const row = document.createElement("div");
        row.className = "v2-saved-party-row";
        row.innerHTML = `
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main);">${escapeHtml(b.name)}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${escapeHtml(b.city || "")} &bull; ${escapeHtml(b.vat_id || "No VAT")}</div>
          </div>
          <div style="display: flex; gap: 0.35rem; align-items: center;">
            <button type="button" class="btn btn-secondary" style="padding: 2px 7px; font-size: 0.72rem;" onclick="openEditPartyModal('buyer', '${partyId}')" title="Edit buyer details">✏️</button>
            <button type="button" class="btn btn-secondary" style="padding: 2px 7px; font-size: 0.72rem; color: #ef4444;" onclick="deleteSavedParty('buyer', '${partyId}')" title="Delete saved buyer">🗑️</button>
          </div>
        `;
        buyersListEl.appendChild(row);
      });
    }
  }
}
window.renderSavedPartiesConfig = renderSavedPartiesConfig;

let currentEditingPartyType = null;
let currentEditingPartyId = null;

function openEditPartyModal(type, id) {
  const settings = window.cachedCompanySettings || {};
  const parties = settings.saved_parties || { sellers: [], buyers: [] };
  const list = type === "seller" ? (parties.sellers || []) : (parties.buyers || []);
  const party = list.find((p, idx) => (p.id === id || String(idx) === String(id) || `seller_${idx}` === id || `buyer_${idx}` === id));

  if (!party) {
    alert("Party details not found.");
    return;
  }

  currentEditingPartyType = type;
  currentEditingPartyId = party.id || id;

  const modal = document.getElementById("editPartyModal");
  const title = document.getElementById("editPartyModalTitle");
  if (title) title.textContent = `Edit Saved ${type === "seller" ? "Seller (Supplier)" : "Buyer (Customer)"}`;

  const setVal = (elId, val) => {
    const el = document.getElementById(elId);
    if (el) el.value = val || "";
  };

  setVal("editPartyName", party.name);
  setVal("editPartyVat", party.vat_id);
  setVal("editPartyStreet", party.street);
  setVal("editPartyCity", party.city);
  setVal("editPartyPostcode", party.postcode);
  setVal("editPartyCountry", party.country_code || "DE");

  const extraSellerFields = document.getElementById("editPartySellerExtra");
  if (extraSellerFields) {
    extraSellerFields.style.display = type === "seller" ? "block" : "none";
  }
  if (type === "seller") {
    setVal("editPartyPhone", party.phone);
    setVal("editPartyEmail", party.email);
    setVal("editPartyIban", party.iban);
    setVal("editPartyBic", party.bic);
  }

  if (modal) modal.style.display = "flex";
}
window.openEditPartyModal = openEditPartyModal;

function closeEditPartyModal() {
  const modal = document.getElementById("editPartyModal");
  if (modal) modal.style.display = "none";
  currentEditingPartyType = null;
  currentEditingPartyId = null;
}
window.closeEditPartyModal = closeEditPartyModal;

async function saveEditedParty() {
  const name = document.getElementById("editPartyName")?.value.trim();
  if (!name) {
    alert("Company / Party Name is required.");
    return;
  }

  const type = currentEditingPartyType;
  const id = currentEditingPartyId;
  const settings = window.cachedCompanySettings || {};
  if (!settings.saved_parties) settings.saved_parties = { sellers: [], buyers: [] };

  const listKey = type === "seller" ? "sellers" : "buyers";
  const list = settings.saved_parties[listKey] || [];
  const partyIdx = list.findIndex((p, idx) => (p.id === id || String(idx) === String(id) || `seller_${idx}` === id || `buyer_${idx}` === id));

  const updatedData = {
    id: id.startsWith("party_") ? id : ("party_" + Date.now().toString(36)),
    name: name,
    vat_id: document.getElementById("editPartyVat")?.value.trim() || "",
    street: document.getElementById("editPartyStreet")?.value.trim() || "",
    city: document.getElementById("editPartyCity")?.value.trim() || "",
    postcode: document.getElementById("editPartyPostcode")?.value.trim() || "",
    country_code: document.getElementById("editPartyCountry")?.value || "DE"
  };

  if (type === "seller") {
    updatedData.phone = document.getElementById("editPartyPhone")?.value.trim() || "";
    updatedData.email = document.getElementById("editPartyEmail")?.value.trim() || "";
    updatedData.iban = document.getElementById("editPartyIban")?.value.trim() || "";
    updatedData.bic = document.getElementById("editPartyBic")?.value.trim() || "";
  }

  if (partyIdx >= 0) {
    settings.saved_parties[listKey][partyIdx] = updatedData;
  } else {
    settings.saved_parties[listKey].push(updatedData);
  }

  if (type === "seller") {
    // If the edited seller is the primary/current seller or matches it, also keep company seller inputs in sync
    const currentCfgName = document.getElementById("cfgSellerName")?.value.trim() || "";
    if (!currentCfgName || currentCfgName.toLowerCase() === name.toLowerCase() || partyIdx === 0) {
      settings.seller_name = name;
      if (updatedData.vat_id) settings.seller_vat = updatedData.vat_id;
      if (updatedData.street) settings.seller_street = updatedData.street;
      if (updatedData.city) settings.seller_city = updatedData.city;
      if (updatedData.country_code) settings.seller_country = updatedData.country_code;
      if (updatedData.phone) settings.seller_phone = updatedData.phone;
      if (updatedData.iban) settings.seller_bank1_iban = updatedData.iban;
      if (updatedData.bic) settings.seller_bank1_bic = updatedData.bic;

      // Update the input fields in the Configuration tab directly
      applySellerSettingsToInputs(settings);
    }
  }

  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  try {
    const postRes = await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: settings })
    });
    if (postRes.ok) {
      const data = await postRes.json();
      if (data.settings) {
        window.cachedCompanySettings = data.settings;
        localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(data.settings));
      }
    }
  } catch (err) {
    console.warn("Could not sync edited party to server:", err);
  }

  closeEditPartyModal();
  renderSavedPartiesConfig();
  if (typeof loadV2SavedPartiesDropdowns === "function") {
    loadV2SavedPartiesDropdowns();
  }
}
window.saveEditedParty = saveEditedParty;


async function deleteSavedParty(type, id) {
  if (!confirm(`Are you sure you want to delete this saved ${type}?`)) return;
  const settings = window.cachedCompanySettings || {};
  if (!settings.saved_parties) settings.saved_parties = { sellers: [], buyers: [] };

  const listKey = type === "seller" ? "sellers" : "buyers";
  settings.saved_parties[listKey] = (settings.saved_parties[listKey] || []).filter((item, idx) => {
    if (item.id && item.id === id) return false;
    if (String(idx) === String(id)) return false;
    if (`${type}_${idx}` === id) return false;
    return true;
  });

  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  try {
    await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: settings })
    });
  } catch (err) {
    console.warn("Could not sync deletion:", err);
  }

  renderSavedPartiesConfig();
  if (typeof loadV2SavedPartiesDropdowns === "function") {
    loadV2SavedPartiesDropdowns();
  }
}
window.deleteSavedParty = deleteSavedParty;


// ================= LOGO MANAGEMENT =================
async function checkLogoStatus() {
  try {
    const res = await fetch("/api/logo-status");
    const data = await res.json();
    const noLogoText = document.getElementById("noLogoText");
    const logoPreviewImg = document.getElementById("logoPreviewImg");
    const removeLogoBtn = document.getElementById("removeLogoBtn");
    const uploadStatus = document.getElementById("logoUploadStatus");

    if (data.has_logo) {
      if (noLogoText) noLogoText.style.display = "none";
      if (logoPreviewImg) {
        logoPreviewImg.src = "/api/logo?t=" + new Date().getTime();
        logoPreviewImg.style.display = "block";
      }
      if (removeLogoBtn) removeLogoBtn.style.display = "inline-flex";
      if (uploadStatus) uploadStatus.textContent = "✅ Active logo loaded for PDF invoices";
    } else {
      if (noLogoText) noLogoText.style.display = "inline";
      if (logoPreviewImg) logoPreviewImg.style.display = "none";
      if (removeLogoBtn) removeLogoBtn.style.display = "none";
      if (uploadStatus) uploadStatus.textContent = "Recommended: transparent PNG, ~300x120px";
    }
  } catch (e) {
    console.error("Could not fetch logo status:", e);
  }
}
checkLogoStatus();

async function handleLogoSelected(input) {
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];
  const formData = new FormData();
  formData.append("file", file);

  const uploadStatus = document.getElementById("logoUploadStatus");
  if (uploadStatus) uploadStatus.textContent = `Uploading ${file.name}...`;

  try {
    const res = await fetch("/api/upload-logo", {
      method: "POST",
      body: formData
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.detail || "Logo upload failed");

    await checkLogoStatus();
    alert("Company logo uploaded successfully! It will now be placed on your manual PDF invoices.");
  } catch (err) {
    alert("Logo error: " + err.message);
    if (uploadStatus) uploadStatus.textContent = "Error uploading logo. Try again.";
  }
}
window.handleLogoSelected = handleLogoSelected;

async function removeLogo() {
  if (!confirm("Are you sure you want to remove the current company logo?")) return;
  try {
    await fetch("/api/logo", { method: "DELETE" });
    await checkLogoStatus();
  } catch (err) {
    alert("Could not remove logo: " + err.message);
  }
}
window.removeLogo = removeLogo;

// ================= PIN PROTECTION FOR CONFIGURATION =================
let isConfigUnlocked = false;

function getCurrentTimePin() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}${minutes}`;
}

function openPinModal() {
  const modal = document.getElementById("pinModal");
  const input = document.getElementById("pinInput");
  const err = document.getElementById("pinError");
  if (modal) modal.style.display = "flex";
  if (err) err.style.display = "none";
  if (input) {
    input.value = "";
    setTimeout(() => input.focus(), 50);
  }
}

function closePinModal() {
  const modal = document.getElementById("pinModal");
  if (modal) modal.style.display = "none";
}
window.closePinModal = closePinModal;

function handlePinInput(input) {
  const err = document.getElementById("pinError");
  if (err) err.style.display = "none";
  if (input && input.value.trim().length === 4) {
    handlePinSubmit();
  }
}
window.handlePinInput = handlePinInput;

function handlePinSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("pinInput");
  const err = document.getElementById("pinError");
  const val = input ? input.value.trim() : "";
  const expectedPin = getCurrentTimePin();

  if (val === expectedPin) {
    isConfigUnlocked = true;
    closePinModal();
    executeSwitchScenario("config");
  } else {
    if (err) err.style.display = "block";
    if (input) {
      input.value = "";
      input.focus();
    }
  }
}
window.handlePinSubmit = handlePinSubmit;

// ================= NAVIGATION / SCENARIO SWITCHING =================
function switchScenario(scenario) {
  if (scenario === "config" && !isConfigUnlocked) {
    openPinModal();
    return;
  }
  executeSwitchScenario(scenario);
}
window.switchScenario = switchScenario;

function executeSwitchScenario(scenario) {
  const scenarios = ["overview", "v2", "history", "config"];
  scenarios.forEach((s) => {
    const container = document.getElementById(`scenario-${s}-container`);
    const btn = document.getElementById(`tab-${s}`);
    if (container) {
      container.style.display = s === scenario ? "block" : "none";
    }
    if (btn) {
      if (s === scenario) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
  });

  if (scenario === "overview") {
    if (typeof renderBtTable === "function") renderBtTable();
  }
  if (scenario === "history") {
    loadInvoiceHistory();
  }
  if (scenario === "config") {
    applySellerSettingsToInputs(getSellerSettings());
    renderSavedPartiesConfig();
    renderPromptConfigUI();
    renderSynonymsTable();
    renderTaxRatesConfig();
    checkLogoStatus();
  }
  if (scenario === "v2") {
    if (typeof populateV2SellerDefaults === "function") populateV2SellerDefaults();
    if (typeof loadV2SavedPartiesDropdowns === "function") loadV2SavedPartiesDropdowns();
  }
}

// Helper: Escape HTML
function escapeHtml(string) {
  return String(string).replace(/[&<>"']/g, function (s) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[s];
  });
}

// ================= SCENARIO 1: PDF CONVERSION =================
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileInfoBar = document.getElementById("fileInfoBar");
const fileNameDisplay = document.getElementById("fileNameDisplay");
const extractBtn = document.getElementById("extractBtn");
const dataCard = document.getElementById("dataCard");
const xmlCodeViewer = document.getElementById("xmlCodeViewer");
const embedBtn = document.getElementById("embedBtn");
const embedBtnTop = document.getElementById("embedBtnTop");
const profileSelect = document.getElementById("profileSelect");
const recalcXmlBtn = document.getElementById("recalcXmlBtn");
const resultCard = document.getElementById("resultCard");
const validBadge = document.getElementById("validBadge");
const validationSummary = document.getElementById("validationSummary");
const downloadBtn = document.getElementById("downloadBtn");

if (embedBtnTop && embedBtn) {
  embedBtnTop.addEventListener("click", () => embedBtn.click());
}

function updateStep(stepNumber) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step${i}-indicator`);
    if (!el) continue;
    if (i < stepNumber) {
      el.className = "step-item completed";
    } else if (i === stepNumber) {
      el.className = "step-item active";
    } else {
      el.className = "step-item";
    }
  }
}

if (dropzone && fileInput) {
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length) {
      handlePdfUpload(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) {
      handlePdfUpload(e.target.files[0]);
    }
  });
}

async function handlePdfUpload(file) {
  const formData = new FormData();
  formData.append("file", file);

  try {
    dropzone.innerHTML = `<div class="spinner"></div><div>Uploading ${file.name}...</div>`;
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Upload failed");

    currentPdfFileId = data.file_id;
    fileNameDisplay.textContent = data.filename;
    fileInfoBar.style.display = "flex";
    dropzone.style.display = "none";
    updateStep(1);
  } catch (err) {
    alert("Upload error: " + err.message);
    dropzone.innerHTML = `<div class="dropzone-icon">📄</div><div><strong style="color:#ef4444">Error uploading. Try again.</strong></div>`;
  }
}

if (extractBtn) {
  extractBtn.addEventListener("click", async () => {
    if (!currentPdfFileId) return;
    const apiKey = getStoredApiKey() || undefined;

    extractBtn.disabled = true;
    extractBtn.innerHTML = `<div class="spinner"></div><span>Extracting with AI...</span>`;

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: currentPdfFileId,
          api_key: apiKey
        })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || "Extraction failed");

      currentPdfInvoiceData = result.invoice_data;
      currentPdfUsage = result.usage || null;
      populatePdfForm(currentPdfInvoiceData);
      xmlCodeViewer.textContent = result.xml_preview;

      // Token and Cost display
      const aiUsageStrip = document.getElementById("aiUsageStrip");
      const aiCostAmount = document.getElementById("aiCostAmount");
      const aiTokensBreakdown = document.getElementById("aiTokensBreakdown");
      if (aiUsageStrip && result.usage) {
        const u = result.usage;
        aiUsageStrip.style.display = "flex";
        if (aiCostAmount) aiCostAmount.textContent = `${u.formatted_cost} USD`;
        if (aiTokensBreakdown) {
          aiTokensBreakdown.innerHTML = `${u.total_tokens.toLocaleString()} tokens total &bull; (${u.prompt_tokens} prompt / ${u.completion_tokens} completion)`;
        }
      }

      // Action Required banner
      const aiValidationNotice = document.getElementById("aiValidationNotice");
      if (aiValidationNotice) aiValidationNotice.style.display = "flex";

      dataCard.style.display = "flex";
      embedBtn.disabled = false;
      updateStep(2);
    } catch (err) {
      alert("Extraction error: " + err.message);
    } finally {
      extractBtn.disabled = false;
      extractBtn.innerHTML = `<span>Extract with AI</span>`;
    }
  });
}

function renderPdfLineItems(items) {
  const tbody = document.getElementById("pdfItemsTableBody");
  const countEl = document.getElementById("pdfItemCount");
  if (!tbody) return;
  tbody.innerHTML = "";

  const list = items && items.length > 0 ? items : [];
  if (countEl) countEl.textContent = list.length;

  list.forEach((item, index) => {
    const itemName = item.name || item.item_name || '';
    const itemQty = item.quantity !== undefined ? item.quantity : 1;
    const itemPrice = item.unit_price !== undefined ? item.unit_price : 0;
    const itemTax = item.tax_percent !== undefined ? item.tax_percent : (item.tax_rate !== undefined ? item.tax_rate : 19.0);
    const itemNet = item.line_total_amount !== undefined ? item.line_total_amount : (item.net_amount !== undefined ? item.net_amount : (itemQty * itemPrice));

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" class="pdf-item-name" value="${escapeHtml(itemName)}" oninput="recalcPdfLineNet(${index})"></td>
      <td><input type="number" step="1" min="1" class="pdf-item-qty" value="${itemQty}" oninput="recalcPdfLineNet(${index})"></td>
      <td><input type="number" step="0.01" class="pdf-item-price" value="${itemPrice}" oninput="recalcPdfLineNet(${index})"></td>
      <td><input type="number" step="0.1" class="pdf-item-tax" value="${itemTax}" oninput="recalcPdfLineNet(${index})"></td>
      <td><input type="number" step="0.01" class="pdf-item-net" value="${itemNet}" readonly style="opacity:0.85;"></td>
      <td style="text-align: center;"><button type="button" class="btn-remove-item" onclick="removePdfLineItem(${index})" title="Remove item">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function addPdfLineItem() {
  const tbody = document.getElementById("pdfItemsTableBody");
  if (!tbody) return;
  const index = tbody.children.length;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="pdf-item-name" placeholder="Item description" oninput="recalcPdfLineNet(${index})"></td>
    <td><input type="number" step="1" min="1" class="pdf-item-qty" value="1" oninput="recalcPdfLineNet(${index})"></td>
    <td><input type="number" step="0.01" class="pdf-item-price" value="0.00" oninput="recalcPdfLineNet(${index})"></td>
    <td><input type="number" step="0.1" class="pdf-item-tax" value="19.0" oninput="recalcPdfLineNet(${index})"></td>
    <td><input type="number" step="0.01" class="pdf-item-net" value="0.00" readonly style="opacity:0.85;"></td>
    <td style="text-align: center;"><button type="button" class="btn-remove-item" onclick="removePdfLineItem(${index})" title="Remove item">🗑️</button></td>
  `;
  tbody.appendChild(tr);
  const countEl = document.getElementById("pdfItemCount");
  if (countEl) countEl.textContent = tbody.children.length;
}
window.addPdfLineItem = addPdfLineItem;

function removePdfLineItem(index) {
  const tbody = document.getElementById("pdfItemsTableBody");
  if (tbody && tbody.children[index]) {
    tbody.children[index].remove();
    // Re-index remaining rows
    Array.from(tbody.children).forEach((row, i) => {
      const btn = row.querySelector(".btn-remove-item");
      if (btn) btn.setAttribute("onclick", `removePdfLineItem(${i})`);
      row.querySelectorAll("input").forEach(inp => inp.setAttribute("oninput", `recalcPdfLineNet(${i})`));
    });
    const countEl = document.getElementById("pdfItemCount");
    if (countEl) countEl.textContent = tbody.children.length;
    recalcPdfTotalsFromItems();
  }
}
window.removePdfLineItem = removePdfLineItem;

function recalcPdfLineNet(index) {
  const tbody = document.getElementById("pdfItemsTableBody");
  if (!tbody || !tbody.children[index]) return;
  const row = tbody.children[index];
  const qty = parseFloat(row.querySelector(".pdf-item-qty").value) || 0;
  const price = parseFloat(row.querySelector(".pdf-item-price").value) || 0;
  const net = Math.round(qty * price * 100) / 100;
  row.querySelector(".pdf-item-net").value = net.toFixed(2);
  recalcPdfTotalsFromItems();
}
window.recalcPdfLineNet = recalcPdfLineNet;

function recalcPdfTotalsFromItems() {
  const tbody = document.getElementById("pdfItemsTableBody");
  if (!tbody || tbody.children.length === 0) return;
  let totalNet = 0;
  let totalTax = 0;

  Array.from(tbody.children).forEach(row => {
    const qty = parseFloat(row.querySelector(".pdf-item-qty").value) || 0;
    const price = parseFloat(row.querySelector(".pdf-item-price").value) || 0;
    const taxRate = parseFloat(row.querySelector(".pdf-item-tax").value) || 0;
    const net = Math.round(qty * price * 100) / 100;
    const tax = Math.round(net * (taxRate / 100) * 100) / 100;
    totalNet += net;
    totalTax += tax;
  });

  const grand = Math.round((totalNet + totalTax) * 100) / 100;
  document.getElementById("totNet").value = totalNet.toFixed(2);
  document.getElementById("totTax").value = totalTax.toFixed(2);
  document.getElementById("totGrand").value = grand.toFixed(2);
  document.getElementById("totDue").value = grand.toFixed(2);
}

function harvestPdfLineItems() {
  const tbody = document.getElementById("pdfItemsTableBody");
  if (!tbody) return [];
  const items = [];
  Array.from(tbody.children).forEach(row => {
    const name = row.querySelector(".pdf-item-name")?.value.trim() || "Item";
    const qty = parseFloat(row.querySelector(".pdf-item-qty")?.value) || 1;
    const price = parseFloat(row.querySelector(".pdf-item-price")?.value) || 0;
    const taxRate = parseFloat(row.querySelector(".pdf-item-tax")?.value) || 19.0;
    const net = parseFloat(row.querySelector(".pdf-item-net")?.value) || (qty * price);
    items.push({
      item_name: name,
      quantity: qty,
      unit_code: "C62",
      unit_price: price,
      net_amount: net,
      tax_rate: taxRate,
      tax_category: "S"
    });
  });
  return items;
}

function populatePdfForm(inv) {
  document.getElementById("invNumber").value = inv.invoice_number || "";
  document.getElementById("invIssueDate").value = inv.issue_date || "";
  document.getElementById("invCurrency").value = inv.currency || "EUR";
  document.getElementById("invBuyerRef").value = inv.buyer_reference || "";

  document.getElementById("sellerName").value = inv.seller?.name || "";
  document.getElementById("sellerVat").value = inv.seller?.vat_id || "";
  document.getElementById("sellerStreet").value = inv.seller?.street || "";
  document.getElementById("sellerCity").value = `${inv.seller?.postcode || ""} ${inv.seller?.city || ""}`.trim();

  document.getElementById("buyerName").value = inv.buyer?.name || "";
  document.getElementById("buyerVat").value = inv.buyer?.vat_id || "";
  document.getElementById("buyerStreet").value = inv.buyer?.street || "";
  document.getElementById("buyerCity").value = `${inv.buyer?.postcode || ""} ${inv.buyer?.city || ""}`.trim();

  document.getElementById("payIban").value = inv.payment?.iban || "";
  document.getElementById("payBic").value = inv.payment?.bic || "";

  document.getElementById("totNet").value = inv.line_net_total || 0;
  document.getElementById("totTax").value = inv.tax_total || 0;
  document.getElementById("totGrand").value = inv.grand_total || 0;
  document.getElementById("totDue").value = inv.due_payable_amount || 0;

  // Render Line Items
  renderPdfLineItems(inv.items || inv.line_items || []);

  applyConfidenceBadges(inv.confidence_scores || {});
}

function applyConfidenceBadges(scores) {
  const fieldMapping = {
    "invNumber": scores.invoice_number || "HIGH",
    "invIssueDate": scores.issue_date || "HIGH",
    "invCurrency": scores.currency || "HIGH",
    "invBuyerRef": scores.buyer_reference || (document.getElementById("invBuyerRef").value ? "MEDIUM" : "LOW"),
    "sellerName": scores.seller_name || "HIGH",
    "sellerVat": scores.seller_vat || "HIGH",
    "sellerStreet": scores.seller_street || "HIGH",
    "sellerCity": scores.seller_city || "HIGH",
    "buyerName": scores.buyer_name || "HIGH",
    "buyerVat": scores.buyer_vat || "HIGH",
    "buyerStreet": scores.buyer_street || "HIGH",
    "buyerCity": scores.buyer_city || "HIGH",
    "payIban": scores.iban || "HIGH",
    "payBic": scores.bic || "HIGH",
    "totNet": scores.total_net || "HIGH",
    "totTax": scores.total_tax || "HIGH",
    "totGrand": scores.total_grand || "HIGH",
    "totDue": scores.total_due || "HIGH"
  };

  Object.entries(fieldMapping).forEach(([inputId, rawConfidence]) => {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    const parentGroup = inputEl.closest(".form-group");
    if (!parentGroup) return;

    const labelEl = parentGroup.querySelector("label");
    if (!labelEl) return;

    const conf = (rawConfidence || "HIGH").toUpperCase();

    const existingTag = labelEl.querySelector(".conf-tag");
    if (existingTag) existingTag.remove();

    labelEl.classList.add("conf-label");
    const tag = document.createElement("span");
    tag.className = `conf-tag ${conf.toLowerCase()}`;
    tag.textContent = conf;
    labelEl.appendChild(tag);

    inputEl.classList.remove("input-conf-medium", "input-conf-low");
    if (conf === "LOW") {
      inputEl.classList.add("input-conf-low");
      inputEl.title = "AI Confidence is LOW - Please check invoice document to verify this value";
    } else if (conf === "MEDIUM") {
      inputEl.classList.add("input-conf-medium");
      inputEl.title = "AI Confidence is MEDIUM - Review suggested";
    } else {
      inputEl.title = "AI Confidence is HIGH";
    }
  });
}

function harvestPdfForm() {
  if (!currentPdfInvoiceData) return null;
  const inv = { ...currentPdfInvoiceData };
  inv.invoice_number = document.getElementById("invNumber").value;
  inv.issue_date = document.getElementById("invIssueDate").value;
  inv.currency = document.getElementById("invCurrency").value;
  inv.buyer_reference = document.getElementById("invBuyerRef").value;

  inv.seller.name = document.getElementById("sellerName").value;
  inv.seller.vat_id = document.getElementById("sellerVat").value;
  inv.seller.street = document.getElementById("sellerStreet").value;

  inv.buyer.name = document.getElementById("buyerName").value;
  inv.buyer.vat_id = document.getElementById("buyerVat").value;
  inv.buyer.street = document.getElementById("buyerStreet").value;

  inv.payment.iban = document.getElementById("payIban").value;
  inv.payment.bic = document.getElementById("payBic").value;

  // Grab updated items
  const items = harvestPdfLineItems();
  if (items.length > 0) {
    inv.line_items = items;
    inv.items = items.map(it => ({
      name: it.item_name,
      quantity: it.quantity,
      unit_code: it.unit_code,
      unit_price: it.unit_price,
      line_total_amount: it.net_amount,
      tax_category_code: it.tax_category,
      tax_percent: it.tax_rate
    }));
  }

  inv.line_net_total = parseFloat(document.getElementById("totNet").value) || 0;
  inv.tax_total = parseFloat(document.getElementById("totTax").value) || 0;
  inv.grand_total = parseFloat(document.getElementById("totGrand").value) || 0;
  inv.due_payable_amount = parseFloat(document.getElementById("totDue").value) || 0;
  return inv;
}

if (recalcXmlBtn) {
  recalcXmlBtn.addEventListener("click", async () => {
    const inv = harvestPdfForm();
    if (!inv) return;

    const res = await fetch("/api/generate-xml", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice_data: inv,
        profile: profileSelect ? profileSelect.value : "EN16931"
      })
    });
    const data = await res.json();
    if (data.xml_content) {
      xmlCodeViewer.textContent = data.xml_content;
      updateStep(3);
    }
  });
}

if (embedBtn) {
  embedBtn.addEventListener("click", async () => {
    if (!currentPdfFileId) return;
    const xml = xmlCodeViewer.textContent;

    embedBtn.disabled = true;
    embedBtn.innerHTML = `<div class="spinner"></div><span>Embedding & Validating...</span>`;

    try {
      const res = await fetch("/api/combine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: currentPdfFileId,
          xml_content: xml,
          profile: profileSelect ? profileSelect.value : "EN16931",
          invoice_data: harvestPdfForm() || currentPdfInvoiceData,
          token_usage: currentPdfUsage,
          source_type: "pdf",
          layout: "pdf_original"
        })
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Mustang combine failed");

      resultCard.style.display = "flex";
      downloadBtn.href = `/api/download/${result.output_filename}`;

      const isValid = result.validation?.isValid;
      validBadge.textContent = isValid ? "✅ Valid PDF/A-3 & Factur-X" : "⚠️ Validation Issues Detected";
      validBadge.className = isValid ? "status-pill" : "status-pill error";

      if (isValid) {
        validationSummary.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0;">
            <div style="font-size: 1.8rem;">🎉</div>
            <div>
              <div style="font-size: 0.95rem; font-weight: 700; color: #10b981;">ZUGFeRD / Factur-X PDF/A-3 Generated Successfully</div>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                ISO 19005-3 and EN 16931 rules validated with Mustangproject.
              </div>
            </div>
          </div>
        `;
        downloadBtn.style.display = "inline-flex";
        downloadBtn.href = `/api/download/${result.output_filename}`;
        downloadBtn.textContent = `⬇️ Download ZUGFeRD PDF/A-3`;
      } else {
        validationSummary.innerHTML = `
          <div style="color: #ef4444; font-weight: 700; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
            <span>⚠️</span> Validation Errors / Notices Detected:
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.5rem;">
            The document did not pass all ZUGFeRD/Factur-X criteria. Download is locked until resolved.
          </div>
          <div style="font-family: 'Fira Code', monospace; font-size: 0.75rem; white-space: pre-wrap; max-height: 200px; overflow-y: auto; background: var(--code-bg); color: var(--code-color); padding: 0.75rem; border-radius: 6px; border: 1px solid var(--bg-card-border);">${escapeHtml(result.validation?.report_xml || "Validation report unavailable.")}</div>
        `;
        downloadBtn.style.display = "none";
      }

      updateStep(4);
      resultCard.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      alert("Embedding error: " + err.message);
    } finally {
      embedBtn.disabled = false;
      embedBtn.innerHTML = `<span>⚡ Embed to PDF/A-3 & Validate</span>`;
    }
  });
}

// ================= SCENARIO 2: DOCX CONVERSION =================
const docxDropzone = document.getElementById("docxDropzone");
const docxFileInput = document.getElementById("docxFileInput");
const docxFileInfoBar = document.getElementById("docxFileInfoBar");
const docxFileNameDisplay = document.getElementById("docxFileNameDisplay");
const docxExtractBtn = document.getElementById("docxExtractBtn");
const docxDataCard = document.getElementById("docxDataCard");
const docxXmlViewer = document.getElementById("docxXmlViewer");
const docxEmbedBtn = document.getElementById("docxEmbedBtn");
const docxRecalcXmlBtn = document.getElementById("docxRecalcXmlBtn");
const docxResultCard = document.getElementById("docxResultCard");
const docxValidBadge = document.getElementById("docxValidBadge");
const docxValidationSummary = document.getElementById("docxValidationSummary");
const docxDownloadBtn = document.getElementById("docxDownloadBtn");

if (docxDropzone && docxFileInput) {
  docxDropzone.addEventListener("click", () => docxFileInput.click());
  docxDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    docxDropzone.classList.add("dragover");
  });
  docxDropzone.addEventListener("dragleave", () => docxDropzone.classList.remove("dragover"));
  docxDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    docxDropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length) {
      handleDocxUpload(e.dataTransfer.files[0]);
    }
  });
  docxFileInput.addEventListener("change", (e) => {
    if (e.target.files.length) {
      handleDocxUpload(e.target.files[0]);
    }
  });
}

async function handleDocxUpload(file) {
  const formData = new FormData();
  formData.append("file", file);

  try {
    docxDropzone.innerHTML = `<div class="spinner"></div><div>Uploading ${file.name}...</div>`;
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Upload failed");

    currentDocxFileId = data.file_id;
    docxFileNameDisplay.textContent = data.filename;
    docxFileInfoBar.style.display = "flex";
    docxDropzone.style.display = "none";
  } catch (err) {
    alert("DOCX upload error: " + err.message);
    docxDropzone.innerHTML = `<div class="dropzone-icon">📝</div><div><strong style="color:#ef4444">Error uploading Word file. Try again.</strong></div>`;
  }
}

function renderDocxLineItems(items) {
  const tbody = document.getElementById("docxItemsTableBody");
  const countEl = document.getElementById("docxItemCount");
  if (!tbody) return;
  tbody.innerHTML = "";

  const list = items && items.length > 0 ? items : [];
  if (countEl) countEl.textContent = list.length;

  list.forEach((item, index) => {
    const itemName = item.name || item.item_name || '';
    const itemQty = item.quantity !== undefined ? item.quantity : 1;
    const itemPrice = item.unit_price !== undefined ? item.unit_price : 0;
    const itemTax = item.tax_percent !== undefined ? item.tax_percent : (item.tax_rate !== undefined ? item.tax_rate : 19.0);
    const itemNet = item.line_total_amount !== undefined ? item.line_total_amount : (item.net_amount !== undefined ? item.net_amount : (itemQty * itemPrice));

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" class="docx-item-name" value="${escapeHtml(itemName)}" oninput="recalcDocxLineNet(${index})"></td>
      <td><input type="number" step="1" min="1" class="docx-item-qty" value="${itemQty}" oninput="recalcDocxLineNet(${index})"></td>
      <td><input type="number" step="0.01" class="docx-item-price" value="${itemPrice}" oninput="recalcDocxLineNet(${index})"></td>
      <td><input type="number" step="0.1" class="docx-item-tax" value="${itemTax}" oninput="recalcDocxLineNet(${index})"></td>
      <td><input type="number" step="0.01" class="docx-item-net" value="${itemNet}" readonly style="opacity:0.85;"></td>
      <td style="text-align: center;"><button type="button" class="btn-remove-item" onclick="removeDocxLineItem(${index})" title="Remove item">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function addDocxLineItem() {
  const tbody = document.getElementById("docxItemsTableBody");
  if (!tbody) return;
  const index = tbody.children.length;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="docx-item-name" placeholder="Item description" oninput="recalcDocxLineNet(${index})"></td>
    <td><input type="number" step="1" min="1" class="docx-item-qty" value="1" oninput="recalcDocxLineNet(${index})"></td>
    <td><input type="number" step="0.01" class="docx-item-price" value="0.00" oninput="recalcDocxLineNet(${index})"></td>
    <td><input type="number" step="0.1" class="docx-item-tax" value="19.0" oninput="recalcDocxLineNet(${index})"></td>
    <td><input type="number" step="0.01" class="docx-item-net" value="0.00" readonly style="opacity:0.85;"></td>
    <td style="text-align: center;"><button type="button" class="btn-remove-item" onclick="removeDocxLineItem(${index})" title="Remove item">🗑️</button></td>
  `;
  tbody.appendChild(tr);
  const countEl = document.getElementById("docxItemCount");
  if (countEl) countEl.textContent = tbody.children.length;
}
window.addDocxLineItem = addDocxLineItem;

function removeDocxLineItem(index) {
  const tbody = document.getElementById("docxItemsTableBody");
  if (tbody && tbody.children[index]) {
    tbody.children[index].remove();
    Array.from(tbody.children).forEach((row, i) => {
      const btn = row.querySelector(".btn-remove-item");
      if (btn) btn.setAttribute("onclick", `removeDocxLineItem(${i})`);
      row.querySelectorAll("input").forEach(inp => inp.setAttribute("oninput", `recalcDocxLineNet(${i})`));
    });
    const countEl = document.getElementById("docxItemCount");
    if (countEl) countEl.textContent = tbody.children.length;
    recalcDocxTotalsFromItems();
  }
}
window.removeDocxLineItem = removeDocxLineItem;

function recalcDocxLineNet(index) {
  const tbody = document.getElementById("docxItemsTableBody");
  if (!tbody || !tbody.children[index]) return;
  const row = tbody.children[index];
  const qty = parseFloat(row.querySelector(".docx-item-qty").value) || 0;
  const price = parseFloat(row.querySelector(".docx-item-price").value) || 0;
  const net = Math.round(qty * price * 100) / 100;
  row.querySelector(".docx-item-net").value = net.toFixed(2);
  recalcDocxTotalsFromItems();
}
window.recalcDocxLineNet = recalcDocxLineNet;

function recalcDocxTotalsFromItems() {
  const tbody = document.getElementById("docxItemsTableBody");
  if (!tbody || tbody.children.length === 0) return;
  let totalNet = 0;
  let totalTax = 0;

  Array.from(tbody.children).forEach(row => {
    const qty = parseFloat(row.querySelector(".docx-item-qty").value) || 0;
    const price = parseFloat(row.querySelector(".docx-item-price").value) || 0;
    const taxRate = parseFloat(row.querySelector(".docx-item-tax").value) || 0;
    const net = Math.round(qty * price * 100) / 100;
    const tax = Math.round(net * (taxRate / 100) * 100) / 100;
    totalNet += net;
    totalTax += tax;
  });

  const grand = Math.round((totalNet + totalTax) * 100) / 100;
  document.getElementById("docxTotNet").value = totalNet.toFixed(2);
  document.getElementById("docxTotGrand").value = grand.toFixed(2);
}

function harvestDocxLineItems() {
  const tbody = document.getElementById("docxItemsTableBody");
  if (!tbody) return [];
  const items = [];
  Array.from(tbody.children).forEach(row => {
    const name = row.querySelector(".docx-item-name")?.value.trim() || "Item";
    const qty = parseFloat(row.querySelector(".docx-item-qty")?.value) || 1;
    const price = parseFloat(row.querySelector(".docx-item-price")?.value) || 0;
    const taxRate = parseFloat(row.querySelector(".docx-item-tax")?.value) || 19.0;
    const net = parseFloat(row.querySelector(".docx-item-net")?.value) || (qty * price);
    items.push({
      item_name: name,
      quantity: qty,
      unit_code: "C62",
      unit_price: price,
      net_amount: net,
      tax_rate: taxRate,
      tax_category: "S"
    });
  });
  return items;
}

if (docxExtractBtn) {
  docxExtractBtn.addEventListener("click", async () => {
    if (!currentDocxFileId) return;
    const apiKey = getStoredApiKey() || undefined;

    docxExtractBtn.disabled = true;
    docxExtractBtn.innerHTML = `<div class="spinner"></div><span>Extracting DOCX with AI...</span>`;

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: currentDocxFileId,
          api_key: apiKey
        })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || "DOCX extraction failed");

      currentDocxInvoiceData = result.invoice_data;
      currentDocxUsage = result.usage || null;
      populateDocxForm(currentDocxInvoiceData);
      docxXmlViewer.textContent = result.xml_preview;

      // Usage strip
      const docxAiUsageStrip = document.getElementById("docxAiUsageStrip");
      const docxAiCostAmount = document.getElementById("docxAiCostAmount");
      const docxAiTokensBreakdown = document.getElementById("docxAiTokensBreakdown");
      if (docxAiUsageStrip && result.usage) {
        docxAiUsageStrip.style.display = "flex";
        if (docxAiCostAmount) docxAiCostAmount.textContent = `${result.usage.formatted_cost} USD`;
        if (docxAiTokensBreakdown) {
          docxAiTokensBreakdown.textContent = `${result.usage.total_tokens.toLocaleString()} tokens (${result.usage.prompt_tokens} in / ${result.usage.completion_tokens} out)`;
        }
      }

      docxDataCard.style.display = "flex";
      docxEmbedBtn.disabled = false;
    } catch (err) {
      alert("DOCX Extraction error: " + err.message);
    } finally {
      docxExtractBtn.disabled = false;
      docxExtractBtn.innerHTML = `<span>Extract with AI</span>`;
    }
  });
}

function populateDocxForm(inv) {
  document.getElementById("docxInvNumber").value = inv.invoice_number || "";
  document.getElementById("docxInvIssueDate").value = inv.issue_date || "";
  document.getElementById("docxSellerName").value = inv.seller?.name || "";
  document.getElementById("docxBuyerName").value = inv.buyer?.name || "";
  document.getElementById("docxTotNet").value = inv.line_net_total || 0;
  document.getElementById("docxTotGrand").value = inv.grand_total || 0;

  renderDocxLineItems(inv.items || inv.line_items || []);
}

if (docxRecalcXmlBtn) {
  docxRecalcXmlBtn.addEventListener("click", async () => {
    if (!currentDocxInvoiceData) return;
    const inv = { ...currentDocxInvoiceData };
    inv.invoice_number = document.getElementById("docxInvNumber").value;
    inv.issue_date = document.getElementById("docxInvIssueDate").value;
    if (inv.seller) inv.seller.name = document.getElementById("docxSellerName").value;
    if (inv.buyer) inv.buyer.name = document.getElementById("docxBuyerName").value;

    const items = harvestDocxLineItems();
    if (items.length > 0) {
      inv.line_items = items;
      inv.items = items.map(it => ({
        name: it.item_name,
        quantity: it.quantity,
        unit_code: it.unit_code,
        unit_price: it.unit_price,
        line_total_amount: it.net_amount,
        tax_category_code: it.tax_category,
        tax_percent: it.tax_rate
      }));
    }

    inv.line_net_total = parseFloat(document.getElementById("docxTotNet").value) || 0;
    inv.grand_total = parseFloat(document.getElementById("docxTotGrand").value) || 0;
    inv.due_payable_amount = inv.grand_total;

    const res = await fetch("/api/generate-xml", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice_data: inv,
        profile: "EN16931"
      })
    });
    const data = await res.json();
    if (data.xml_content) {
      docxXmlViewer.textContent = data.xml_content;
    }
  });
}

if (docxEmbedBtn) {
  docxEmbedBtn.addEventListener("click", async () => {
    if (!currentDocxFileId) return;
    const xml = docxXmlViewer.textContent;

    docxEmbedBtn.disabled = true;
    docxEmbedBtn.innerHTML = `<div class="spinner"></div><span>Building Visual PDF & PDF/A-3...</span>`;

    try {
      const res = await fetch("/api/combine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: currentDocxFileId,
          xml_content: xml,
          profile: "EN16931",
          invoice_data: currentDocxInvoiceData,
          token_usage: currentDocxUsage,
          source_type: "docx",
          layout: "docx_layout"
        })
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || "DOCX PDF/A-3 build failed");

      docxResultCard.style.display = "flex";
      docxDownloadBtn.href = `/api/download/${result.output_filename}`;

      const isValid = result.validation?.isValid;
      docxValidBadge.textContent = isValid ? "✅ Valid PDF/A-3 & Factur-X" : "⚠️ Validation Issues Detected";
      docxValidBadge.className = isValid ? "status-pill" : "status-pill error";

      if (isValid) {
        docxValidationSummary.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0;">
            <div style="font-size: 1.8rem;">🎉</div>
            <div>
              <div style="font-size: 0.95rem; font-weight: 700; color: #10b981;">ZUGFeRD PDF/A-3 Created from DOCX!</div>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                Visual invoice layout rendered, XML attached, and validated via Mustangproject.
              </div>
            </div>
          </div>
        `;
        docxDownloadBtn.style.display = "inline-flex";
      } else {
        docxValidationSummary.innerHTML = `
          <div style="color: #ef4444; font-weight: 700; margin-bottom: 0.5rem;">Validation Issues:</div>
          <div style="font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; background: var(--code-bg); padding: 0.75rem; border-radius: 6px;">${escapeHtml(result.validation?.report_xml || "Report unavailable")}</div>
        `;
        docxDownloadBtn.style.display = "none";
      }
      docxResultCard.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      alert("DOCX Combine Error: " + err.message);
    } finally {
      docxEmbedBtn.disabled = false;
      docxEmbedBtn.innerHTML = `<span>⚡ Build PDF/A-3 & Validate</span>`;
    }
  });
}

// ================= SCENARIO 3: MANUAL INVOICE CREATION =================
function initManualLineItems() {
  const tbody = document.getElementById("manItemsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  // Start with 1 clean blank line item
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="man-item-name" placeholder="e.g. Consulting / Item description" oninput="recalcManualLineNet(0)"></td>
    <td><input type="number" step="1" min="1" class="man-item-qty" value="1" oninput="recalcManualLineNet(0)"></td>
    <td><input type="number" step="0.01" class="man-item-price" placeholder="0.00" oninput="recalcManualLineNet(0)"></td>
    <td><input type="number" step="0.1" class="man-item-tax" value="19.0" oninput="recalcManualLineNet(0)"></td>
    <td><input type="number" step="0.01" class="man-item-net" value="0.00" readonly style="opacity: 0.85;"></td>
    <td style="text-align: center;"><button type="button" class="btn-remove-item" onclick="removeManualLineItem(0)" title="Remove item">🗑️</button></td>
  `;
  tbody.appendChild(tr);

  const countEl = document.getElementById("manItemCount");
  if (countEl) countEl.textContent = 1;

  // Set default issue date to today
  const issueDateEl = document.getElementById("manIssueDate");
  if (issueDateEl && !issueDateEl.value) {
    issueDateEl.value = new Date().toISOString().split("T")[0];
  }

  recalcManualTotals();
}

function fillManualExampleData() {
  const s = getSellerSettings();
  document.getElementById("manInvNumber").value = "INV-" + new Date().getFullYear() + "-042";
  const today = new Date();
  document.getElementById("manIssueDate").value = today.toISOString().split("T")[0];
  const due = new Date();
  due.setDate(today.getDate() + 30);
  document.getElementById("manDueDate").value = due.toISOString().split("T")[0];
  document.getElementById("manCurrency").value = "EUR";

  document.getElementById("manSellerName").value = s.seller_name || "Acme Solutions GmbH";
  document.getElementById("manSellerVat").value = s.seller_vat || "DE123456789";
  document.getElementById("manSellerStreet").value = s.seller_street || "Bahnhofstrasse 10";
  document.getElementById("manSellerCity").value = s.seller_city || "10115 Berlin";

  document.getElementById("manBuyerName").value = "Global Logistics AG";
  const buyerVatEl = document.getElementById("manBuyerVat");
  if (buyerVatEl) buyerVatEl.value = "DE987654321";
  document.getElementById("manBuyerRef").value = "PO-2026-9941";
  document.getElementById("manBuyerStreet").value = "Industriestrasse 42";
  document.getElementById("manBuyerCity").value = "80331 Munich";

  document.getElementById("manIban").value = s.seller_bank1_iban || "DE89370400440532013000";
  document.getElementById("manBic").value = s.seller_bank1_bic || "DBBADEFFXXX";

  const tbody = document.getElementById("manItemsTableBody");
  if (tbody) {
    tbody.innerHTML = "";
    const exampleItems = [
      { name: "Software Development & Architecture", qty: 24, price: 125.00, tax: 19.0 },
      { name: "Cloud Infrastructure Setup & Security Audit", qty: 1, price: 650.00, tax: 19.0 }
    ];
    exampleItems.forEach((it, index) => {
      const net = Math.round(it.qty * it.price * 100) / 100;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="text" class="man-item-name" value="${it.name}" oninput="recalcManualLineNet(${index})"></td>
        <td><input type="number" step="1" min="1" class="man-item-qty" value="${it.qty}" oninput="recalcManualLineNet(${index})"></td>
        <td><input type="number" step="0.01" class="man-item-price" value="${it.price.toFixed(2)}" oninput="recalcManualLineNet(${index})"></td>
        <td><input type="number" step="0.1" class="man-item-tax" value="${it.tax}" oninput="recalcManualLineNet(${index})"></td>
        <td><input type="number" step="0.01" class="man-item-net" value="${net.toFixed(2)}" readonly style="opacity: 0.85;"></td>
        <td style="text-align: center;"><button type="button" class="btn-remove-item" onclick="removeManualLineItem(${index})" title="Remove item">🗑️</button></td>
      `;
      tbody.appendChild(tr);
    });
    const countEl = document.getElementById("manItemCount");
    if (countEl) countEl.textContent = exampleItems.length;
  }
  recalcManualTotals();
}
window.fillManualExampleData = fillManualExampleData;

function clearManualForm() {
  document.getElementById("manInvNumber").value = "";
  document.getElementById("manIssueDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("manDueDate").value = "";
  document.getElementById("manCurrency").value = "EUR";

  document.getElementById("manSellerName").value = "";
  document.getElementById("manSellerVat").value = "";
  document.getElementById("manSellerStreet").value = "";
  document.getElementById("manSellerCity").value = "";

  document.getElementById("manBuyerName").value = "";
  const clrBuyerVat = document.getElementById("manBuyerVat");
  if (clrBuyerVat) clrBuyerVat.value = "";
  document.getElementById("manBuyerRef").value = "";
  document.getElementById("manBuyerStreet").value = "";
  document.getElementById("manBuyerCity").value = "";

  document.getElementById("manIban").value = "";
  document.getElementById("manBic").value = "";

  // Restore seller default values
  populateManualSellerDefaults();
  initManualLineItems();
}
window.clearManualForm = clearManualForm;

function addManualLineItem() {
  const tbody = document.getElementById("manItemsTableBody");
  if (!tbody) return;
  const index = tbody.children.length;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="man-item-name" placeholder="Item description" oninput="recalcManualLineNet(${index})"></td>
    <td><input type="number" step="1" min="1" class="man-item-qty" value="1" oninput="recalcManualLineNet(${index})"></td>
    <td><input type="number" step="0.01" class="man-item-price" value="0.00" oninput="recalcManualLineNet(${index})"></td>
    <td><input type="number" step="0.1" class="man-item-tax" value="19.0" oninput="recalcManualLineNet(${index})"></td>
    <td><input type="number" step="0.01" class="man-item-net" value="0.00" readonly style="opacity: 0.85;"></td>
    <td style="text-align: center;"><button type="button" class="btn-remove-item" onclick="removeManualLineItem(${index})" title="Remove item">🗑️</button></td>
  `;
  tbody.appendChild(tr);
  const countEl = document.getElementById("manItemCount");
  if (countEl) countEl.textContent = tbody.children.length;
}
window.addManualLineItem = addManualLineItem;

function removeManualLineItem(index) {
  const tbody = document.getElementById("manItemsTableBody");
  if (tbody && tbody.children[index]) {
    tbody.children[index].remove();
    // Re-index remaining rows
    Array.from(tbody.children).forEach((row, i) => {
      const btn = row.querySelector(".btn-remove-item");
      if (btn) btn.setAttribute("onclick", `removeManualLineItem(${i})`);
      row.querySelectorAll("input").forEach(inp => inp.setAttribute("oninput", `recalcManualLineNet(${i})`));
    });
    const countEl = document.getElementById("manItemCount");
    if (countEl) countEl.textContent = tbody.children.length;
    recalcManualTotals();
  }
}
window.removeManualLineItem = removeManualLineItem;

function recalcManualLineNet(index) {
  const tbody = document.getElementById("manItemsTableBody");
  if (!tbody || !tbody.children[index]) return;
  const row = tbody.children[index];
  const qty = parseFloat(row.querySelector(".man-item-qty").value) || 0;
  const price = parseFloat(row.querySelector(".man-item-price").value) || 0;
  const net = Math.round(qty * price * 100) / 100;
  row.querySelector(".man-item-net").value = net.toFixed(2);
  recalcManualTotals();
}
window.recalcManualLineNet = recalcManualLineNet;

function recalcManualTotals() {
  const tbody = document.getElementById("manItemsTableBody");
  if (!tbody) return;
  let totalNet = 0;
  let totalTax = 0;

  Array.from(tbody.children).forEach(row => {
    const qty = parseFloat(row.querySelector(".man-item-qty")?.value) || 0;
    const price = parseFloat(row.querySelector(".man-item-price")?.value) || 0;
    const taxRate = parseFloat(row.querySelector(".man-item-tax")?.value) || 0;
    const net = Math.round(qty * price * 100) / 100;
    const tax = Math.round(net * (taxRate / 100) * 100) / 100;
    totalNet += net;
    totalTax += tax;
  });

  const grand = Math.round((totalNet + totalTax) * 100) / 100;

  const manNetTotal = document.getElementById("manNetTotal");
  const manTaxTotal = document.getElementById("manTaxTotal");
  const manGrandTotal = document.getElementById("manGrandTotal");

  if (manNetTotal) manNetTotal.value = totalNet.toFixed(2);
  if (manTaxTotal) manTaxTotal.value = totalTax.toFixed(2);
  if (manGrandTotal) manGrandTotal.value = grand.toFixed(2);
}
window.calculateManualTotals = recalcManualTotals;

function harvestManualLineItems() {
  const tbody = document.getElementById("manItemsTableBody");
  if (!tbody) return [];
  const items = [];
  Array.from(tbody.children).forEach(row => {
    const name = row.querySelector(".man-item-name")?.value.trim() || "Service / Item";
    const qty = parseFloat(row.querySelector(".man-item-qty")?.value) || 1;
    const price = parseFloat(row.querySelector(".man-item-price")?.value) || 0;
    const taxRate = parseFloat(row.querySelector(".man-item-tax")?.value) || 19.0;
    const net = parseFloat(row.querySelector(".man-item-net")?.value) || (qty * price);
    items.push({
      item_name: name,
      quantity: qty,
      unit_code: "C62",
      unit_price: price,
      net_amount: net,
      tax_rate: taxRate,
      tax_category: "S"
    });
  });
  return items;
}

const generateManualPdfBtn = document.getElementById("generateManualPdfBtn");
const manResultCard = document.getElementById("manResultCard");
const manValidBadge = document.getElementById("manValidBadge");
const manValidationSummary = document.getElementById("manValidationSummary");
const manDownloadBtn = document.getElementById("manDownloadBtn");
const manXmlViewer = document.getElementById("manXmlViewer");

if (generateManualPdfBtn) {
  generateManualPdfBtn.addEventListener("click", async () => {
    recalcManualTotals();
    const lineItems = harvestManualLineItems();

    const invNumber = document.getElementById("manInvNumber").value.trim();
    const issueDate = document.getElementById("manIssueDate").value.trim();
    const sellerName = document.getElementById("manSellerName").value.trim();
    const buyerName = document.getElementById("manBuyerName").value.trim();

    const missing = [];
    if (!invNumber) missing.push("Invoice Number");
    if (!issueDate) missing.push("Issue Date");
    if (!sellerName) missing.push("Seller Name");
    if (!buyerName) missing.push("Buyer Name");
    if (!lineItems || lineItems.length === 0 || !lineItems[0].item_name) missing.push("At least one line item with description");

    if (missing.length > 0) {
      alert("Please complete the following required fields before generating:\n- " + missing.join("\n- "));
      return;
    }

    const net = parseFloat(document.getElementById("manNetTotal").value) || 0;
    const tax = parseFloat(document.getElementById("manTaxTotal").value) || 0;
    const grand = parseFloat(document.getElementById("manGrandTotal").value) || 0;

    const payload = {
      invoice_data: {
        invoice_number: document.getElementById("manInvNumber").value || "INV-MANUAL-001",
        issue_date: document.getElementById("manIssueDate").value || new Date().toISOString().split("T")[0],
        due_date: document.getElementById("manDueDate").value || "",
        currency: document.getElementById("manCurrency").value || "EUR",
        buyer_reference: document.getElementById("manBuyerRef").value || "",
        seller: {
          name: document.getElementById("manSellerName").value || "Seller",
          street: document.getElementById("manSellerStreet").value || "",
          city: document.getElementById("manSellerCity").value || "",
          country: getSellerSettings().seller_country || "DE",
          vat_id: document.getElementById("manSellerVat").value || ""
        },
        buyer: {
          name: document.getElementById("manBuyerName").value || "Buyer",
          vat_id: document.getElementById("manBuyerVat") ? document.getElementById("manBuyerVat").value.trim() : "",
          street: document.getElementById("manBuyerStreet").value || "",
          city: document.getElementById("manBuyerCity").value || "",
          country: "DE"
        },
        payment: {
          iban: document.getElementById("manIban").value || "",
          bic: document.getElementById("manBic").value || ""
        },
        items: lineItems.map(it => ({
          name: it.item_name,
          quantity: it.quantity,
          unit_code: it.unit_code,
          unit_price: it.unit_price,
          line_total_amount: it.net_amount,
          tax_category_code: it.tax_category,
          tax_percent: it.tax_rate
        })),
        line_items: lineItems,
        line_net_total: net,
        tax_basis_total: net,
        tax_total: tax,
        grand_total: grand,
        due_payable_amount: grand
      },
      profile: "EN16931",
      layout: manLayoutSelect ? manLayoutSelect.value : getStoredLayout()
    };

    const chosenLayout = manLayoutSelect ? manLayoutSelect.value : getStoredLayout();
    payload.layout = chosenLayout;

    generateManualPdfBtn.disabled = true;
    generateManualPdfBtn.innerHTML = `<div class="spinner"></div><span>Generating Visual PDF & PDF/A-3...</span>`;

    try {
      const res = await fetch("/api/create-invoice-pdfa3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Manual PDF/A-3 generation failed");

      if (manXmlViewer && result.xml_content) {
        manXmlViewer.textContent = result.xml_content;
      }

      manResultCard.style.display = "flex";
      const isValid = result.validation?.isValid;
      manValidBadge.textContent = isValid ? "✅ Valid PDF/A-3 & Factur-X" : "⚠️ Validation Issues Detected";
      manValidBadge.className = isValid ? "status-pill" : "status-pill error";

      if (isValid) {
        manValidationSummary.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0;">
            <div style="font-size: 1.8rem;">🎉</div>
            <div>
              <div style="font-size: 0.95rem; font-weight: 700; color: #10b981;">ZUGFeRD PDF/A-3 Invoice Created Successfully!</div>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                Visual PDF layout synthesized (${chosenLayout === "layout3" ? "Layout 3: Most Complete Format" : chosenLayout === "layout2" ? "Layout 2: Odelo Corporate" : "Layout 1: Modern Studio"}), factur-x.xml embedded with ${lineItems.length} items, and verified via Mustangproject.
              </div>
            </div>
          </div>
        `;
        manDownloadBtn.style.display = "inline-flex";
        manDownloadBtn.href = `/api/download/${result.output_filename}?t=${Date.now()}`;
        manDownloadBtn.textContent = `⬇️ Download ZUGFeRD PDF/A-3 (${result.output_filename})`;
      } else {
        manValidationSummary.innerHTML = `
          <div style="color: #ef4444; font-weight: 700; margin-bottom: 0.5rem;">Validation Issues:</div>
          <div style="font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; background: var(--code-bg); padding: 0.75rem; border-radius: 6px;">${escapeHtml(result.validation?.report_xml || "Report unavailable")}</div>
        `;
        manDownloadBtn.style.display = "none";
      }
      manResultCard.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      alert("Manual creation error: " + err.message);
    } finally {
      generateManualPdfBtn.disabled = false;
      generateManualPdfBtn.innerHTML = `<span>⚡ Generate ZUGFeRD PDF/A-3</span>`;
    }
  });
}

// Initialize manual line items on page load
initManualLineItems();

// ================= INVOICE HISTORY MANAGEMENT =================
let cachedHistoryRecords = [];
let historySortDirection = "desc"; // 'asc' or 'desc'
const hiddenHistoryColumns = new Set();

function toggleColumnMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById("colTogglerMenu");
  if (!menu) return;
  menu.style.display = menu.style.display === "none" ? "block" : "none";
}
window.toggleColumnMenu = toggleColumnMenu;

// Close menu when clicking outside
document.addEventListener("click", (e) => {
  const container = document.getElementById("colTogglerContainer");
  const menu = document.getElementById("colTogglerMenu");
  if (menu && container && !container.contains(e.target)) {
    menu.style.display = "none";
  }
});

function toggleColumnVisibility(colClass, isVisible) {
  if (isVisible) {
    hiddenHistoryColumns.delete(colClass);
  } else {
    hiddenHistoryColumns.add(colClass);
  }
  applyColumnVisibility();
}
window.toggleColumnVisibility = toggleColumnVisibility;

function applyColumnVisibility() {
  const allCols = ["col-date", "col-inv", "col-buyer", "col-layout", "col-cost", "col-total", "col-status", "col-actions"];
  allCols.forEach(colClass => {
    const isHidden = hiddenHistoryColumns.has(colClass);
    document.querySelectorAll(`.${colClass}`).forEach(el => {
      el.style.display = isHidden ? "none" : "";
    });
  });
}
window.applyColumnVisibility = applyColumnVisibility;

function toggleHistoryDateSort() {
  historySortDirection = historySortDirection === "desc" ? "asc" : "desc";
  const icon = document.getElementById("sortDateIcon");
  if (icon) {
    icon.textContent = historySortDirection === "desc" ? "▼" : "▲";
  }
  renderHistoryTable();
}
window.toggleHistoryDateSort = toggleHistoryDateSort;

function handleHistoryFilterChange() {
  renderHistoryTable();
}
window.handleHistoryFilterChange = handleHistoryFilterChange;

function resetHistoryFilters() {
  const invFilter = document.getElementById("historyFilterInv");
  const buyerFilter = document.getElementById("historyFilterBuyer");
  if (invFilter) invFilter.value = "";
  if (buyerFilter) buyerFilter.value = "";
  renderHistoryTable();
}
window.resetHistoryFilters = resetHistoryFilters;

async function loadInvoiceHistory() {
  const loading = document.getElementById("historyLoading");
  const empty = document.getElementById("historyEmpty");
  const wrapper = document.getElementById("historyTableWrapper");
  const badge = document.getElementById("historyCountBadge");

  if (loading) loading.style.display = "block";
  if (empty) empty.style.display = "none";
  if (wrapper) wrapper.style.display = "none";

  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    cachedHistoryRecords = data.history || [];

    if (badge) badge.textContent = `${cachedHistoryRecords.length} invoices`;
    if (loading) loading.style.display = "none";

    renderHistoryTable();
  } catch (err) {
    if (loading) loading.style.display = "none";
    console.error("Could not load history:", err);
  }
}
window.loadInvoiceHistory = loadInvoiceHistory;

function renderHistoryTable() {
  const empty = document.getElementById("historyEmpty");
  const emptySubtitle = document.getElementById("historyEmptySubtitle");
  const wrapper = document.getElementById("historyTableWrapper");
  const tbody = document.getElementById("historyTableBody");
  const badge = document.getElementById("historyCountBadge");

  const filterInv = (document.getElementById("historyFilterInv")?.value || "").toLowerCase().trim();
  const filterBuyer = (document.getElementById("historyFilterBuyer")?.value || "").toLowerCase().trim();

  // 1. Filter
  let records = cachedHistoryRecords.filter(item => {
    const invNo = String(item.invoice_number || "").toLowerCase();
    const buyer = String(item.buyer_name || "").toLowerCase();
    if (filterInv && !invNo.includes(filterInv)) return false;
    if (filterBuyer && !buyer.includes(filterBuyer)) return false;
    return true;
  });

  // 2. Sort by date & time
  records.sort((a, b) => {
    const timeA = new Date(a.created_at || 0).getTime() || 0;
    const timeB = new Date(b.created_at || 0).getTime() || 0;
    return historySortDirection === "desc" ? timeB - timeA : timeA - timeB;
  });

  if (badge) {
    if (filterInv || filterBuyer) {
      badge.textContent = `${records.length} of ${cachedHistoryRecords.length} filtered`;
    } else {
      badge.textContent = `${cachedHistoryRecords.length} invoices`;
    }
  }

  if (records.length === 0) {
    if (empty) {
      empty.style.display = "block";
      if (emptySubtitle) {
        if (filterInv || filterBuyer) {
          emptySubtitle.textContent = "No invoices match your current search filters. Try clearing your search inputs.";
        } else {
          emptySubtitle.textContent = "Invoices you create using the Manual Form, PDF or DOCX converter will appear here.";
        }
      }
    }
    if (wrapper) wrapper.style.display = "none";
    return;
  }

  if (empty) empty.style.display = "none";
  if (wrapper) wrapper.style.display = "block";

  if (tbody) {
    tbody.innerHTML = "";
    records.forEach((item) => {
      // Find index in original cachedHistoryRecords for edit
      const originalIndex = cachedHistoryRecords.findIndex(r => r.id === item.id);
      const tr = document.createElement("tr");
      const statusBadge = item.is_valid
        ? `<span class="conf-tag high" style="padding: 2px 6px; font-size: 0.72rem;">VALID</span>`
        : `<span class="conf-tag low" style="padding: 2px 6px; font-size: 0.72rem;">ISSUE</span>`;

      // Token and Cost display
      let costDisplay = `<span style="color: var(--text-muted); font-size: 0.75rem;">$0.00 (manual)</span>`;
      if (item.tokens && item.tokens.total_tokens > 0) {
        const costStr = item.tokens.formatted_cost || `$${Number(item.tokens.cost_usd || 0).toFixed(4)}`;
        const tokCount = Number(item.tokens.total_tokens || 0).toLocaleString();
        costDisplay = `
          <div style="font-size: 0.78rem; line-height: 1.2;">
            <strong style="color: #60a5fa;">${costStr}</strong>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${tokCount} tok</div>
          </div>
        `;
      } else if (item.source_type && item.source_type !== "manual") {
        costDisplay = `<span style="color: var(--text-muted); font-size: 0.75rem;">N/A</span>`;
      }

      // Generator & Layout display badge
      const genType = (item.generator === "v2" || item.source_type === "v2" || item.source_type === "v2_manual") ? "v2" : "v1";
      const genBadge = genType === "v2"
        ? `<span class="tag" style="background: rgba(147, 51, 234, 0.15); color: #a855f7; border: 1px solid rgba(147, 51, 234, 0.3); font-weight: 700; font-size: 0.7rem; padding: 2px 6px;">Studio v2</span>`
        : `<span class="tag" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-weight: 700; font-size: 0.7rem; padding: 2px 6px;">Classic v1</span>`;

      tr.innerHTML = `
        <td class="col-date" style="font-size: 0.78rem; color: var(--text-muted); white-space: nowrap;">${item.created_at || "N/A"}</td>
        <td class="col-inv"><strong style="color: var(--text-main); font-size: 0.85rem;">${escapeHtml(item.invoice_number)}</strong></td>
        <td class="col-buyer" style="font-size: 0.82rem;">${escapeHtml(item.buyer_name || "N/A")}</td>
        <td class="col-layout" style="font-size: 0.75rem; white-space: nowrap;">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <div>${genBadge}</div>
            <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">${escapeHtml(item.layout || "layout1")}</div>
          </div>
        </td>
        <td class="col-cost">${costDisplay}</td>
        <td class="col-total" style="text-align: right; font-weight: 700; color: #10b981;">€${(Number(item.grand_total) || 0).toFixed(2)}</td>
        <td class="col-status" style="text-align: center;">${statusBadge}</td>
        <td class="col-actions" style="text-align: center;">
          <div style="display: flex; gap: 0.35rem; justify-content: center; flex-wrap: nowrap;">
            <button type="button" class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="openPdfPreview('${item.output_filename}', '${escapeHtml(item.invoice_number)}')" title="Preview PDF in modal">
              <span>👁️ View</span>
            </button>
            <a href="/api/download/${item.output_filename}" target="_blank" class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" title="Download PDF/A-3">
              <span>⬇️ Download</span>
            </a>
            <button type="button" class="btn btn-primary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;" onclick="editHistoryInvoice(${originalIndex})" title="Load into editor to edit and regenerate">
              <span>✏️ Edit</span>
            </button>
            <button type="button" class="btn btn-secondary" style="padding: 0.25rem 0.45rem; font-size: 0.75rem; color: #ef4444;" onclick="deleteHistoryInvoice('${item.id}')" title="Delete record">
              <span>🗑️</span>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Apply hidden columns setting to newly rendered DOM elements
  applyColumnVisibility();
}
window.renderHistoryTable = renderHistoryTable;

function openPdfPreview(filename, invoiceNumber) {
  const modal = document.getElementById("pdfPreviewModal");
  const iframe = document.getElementById("pdfPreviewIframe");
  const title = document.getElementById("pdfPreviewTitle");
  const subtitle = document.getElementById("pdfPreviewSubtitle");
  const downloadLink = document.getElementById("pdfPreviewDownloadLink");

  if (!modal || !iframe) return;

  if (title) title.textContent = `Invoice ${invoiceNumber || filename}`;
  if (subtitle) subtitle.textContent = filename;
  if (downloadLink) downloadLink.href = `/api/download/${filename}`;

  // Use inline preview endpoint
  iframe.src = `/api/preview/${filename}#toolbar=1&navpanes=0`;
  modal.style.display = "flex";
}
window.openPdfPreview = openPdfPreview;

function closePdfPreview() {
  const modal = document.getElementById("pdfPreviewModal");
  const iframe = document.getElementById("pdfPreviewIframe");
  if (iframe) iframe.src = "";
  if (modal) modal.style.display = "none";
}
window.closePdfPreview = closePdfPreview;

function editHistoryInvoice(index) {
  const item = cachedHistoryRecords[index];
  if (!item || !item.invoice_data) {
    alert("Invoice data not found for this entry.");
    return;
  }

  const inv = item.invoice_data;

  // Switch directly to Studio v2 tab
  switchScenario("v2");
  if (typeof populateV2FromHistory === "function") {
    populateV2FromHistory(inv, item.layout, item.lang);
  }
  const v2Container = document.getElementById("scenario-v2-container");
  if (v2Container) v2Container.scrollIntoView({ behavior: "smooth" });
  return;


  // Populate Header Data
  const numEl = document.getElementById("manInvNumber");
  if (numEl) numEl.value = inv.invoice_number || "";

  const issueDateEl = document.getElementById("manIssueDate");
  if (issueDateEl) issueDateEl.value = inv.issue_date || "";

  const dueDateEl = document.getElementById("manDueDate");
  if (dueDateEl) dueDateEl.value = inv.due_date || "";

  const currEl = document.getElementById("manCurrency");
  if (currEl) currEl.value = inv.currency || "EUR";

  // Layout choice
  const layoutSelect = document.getElementById("manLayoutSelect");
  if (layoutSelect && item.layout) {
    layoutSelect.value = item.layout;
  }

  // Populate Seller
  const seller = inv.seller || {};
  const sName = document.getElementById("manSellerName");
  if (sName) sName.value = seller.name || "";
  const sVat = document.getElementById("manSellerVat");
  if (sVat) sVat.value = seller.vat_id || "";
  const sStreet = document.getElementById("manSellerStreet");
  if (sStreet) sStreet.value = seller.street || "";
  const sCity = document.getElementById("manSellerCity");
  if (sCity) sCity.value = seller.city || "";

  // Populate Buyer
  const buyer = inv.buyer || {};
  const bName = document.getElementById("manBuyerName");
  if (bName) bName.value = buyer.name || "";
  const bVat = document.getElementById("manBuyerVat");
  if (bVat) bVat.value = buyer.vat_id || "";
  const bRef = document.getElementById("manBuyerRef");
  if (bRef) bRef.value = inv.buyer_reference || "";
  const bStreet = document.getElementById("manBuyerStreet");
  if (bStreet) bStreet.value = buyer.street || "";
  const bCity = document.getElementById("manBuyerCity");
  if (bCity) bCity.value = buyer.city || "";

  // Populate Payment
  const pay = inv.payment || {};
  const ibanEl = document.getElementById("manIban");
  if (ibanEl) ibanEl.value = pay.iban || "";
  const bicEl = document.getElementById("manBic");
  if (bicEl) bicEl.value = pay.bic || "";

  // Populate Line Items
  const items = inv.items || inv.line_items || [];
  const tbody = document.getElementById("manItemsTableBody");
  if (tbody) {
    tbody.innerHTML = "";
    items.forEach((it, i) => {
      const name = it.name || it.item_name || "";
      const qty = it.quantity || 1;
      const price = it.unit_price || 0;
      const tax = it.tax_percent || it.tax_rate || 19.0;
      const net = (qty * price);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="text" class="man-item-name" value="${escapeHtml(name)}" oninput="recalcManualLineNet(${i})"></td>
        <td><input type="number" step="1" min="1" class="man-item-qty" value="${qty}" oninput="recalcManualLineNet(${i})"></td>
        <td><input type="number" step="0.01" class="man-item-price" value="${Number(price).toFixed(2)}" oninput="recalcManualLineNet(${i})"></td>
        <td><input type="number" step="0.1" class="man-item-tax" value="${tax}" oninput="recalcManualLineNet(${i})"></td>
        <td><input type="number" step="0.01" class="man-item-net" value="${net.toFixed(2)}" readonly style="opacity: 0.85;"></td>
        <td style="text-align: center;"><button type="button" class="btn-remove-item" onclick="removeManualLineItem(${i})" title="Remove item">🗑️</button></td>
      `;
      tbody.appendChild(tr);
    });
    const countEl = document.getElementById("manItemCount");
    if (countEl) countEl.textContent = items.length;
  }

  recalcManualTotals();

  // Scroll to manual form top
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.editHistoryInvoice = editHistoryInvoice;

async function deleteHistoryInvoice(id) {
  if (!confirm("Are you sure you want to remove this invoice from history?")) return;
  try {
    const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
    if (res.ok) {
      loadInvoiceHistory();
    }
  } catch (err) {
    alert("Could not delete record: " + err.message);
  }
}
window.deleteHistoryInvoice = deleteHistoryInvoice;

// =========================================================================
// UNIVERSAL XML FIELD HIGHLIGHTING ENGINE (v1 & v2)
// When clicking/focusing any form field, highlights the corresponding XML tags/data in the viewer
// =========================================================================

const XML_FIELD_MAP = {
  // Document Info
  "invNumber": ["<ram:ID>", "</ram:ID>"],
  "invIssueDate": ["<ram:IssueDateTime>", "</ram:IssueDateTime>", "<udt:DateTimeString"],
  "invCurrency": ["<ram:InvoiceCurrencyCode>", "</ram:InvoiceCurrencyCode>"],
  "invBuyerRef": ["<ram:BuyerReference>", "</ram:BuyerReference>"],

  // Manual Form (v1)
  "manInvNumber": ["<ram:ID>", "</ram:ID>"],
  "manIssueDate": ["<ram:IssueDateTime>", "</ram:IssueDateTime>", "<udt:DateTimeString"],
  "manDueDate": ["<ram:DueDateDateTime>", "</ram:DueDateDateTime>", "<ram:SpecifiedTradePaymentTerms>"],
  "manCurrency": ["<ram:InvoiceCurrencyCode>", "</ram:InvoiceCurrencyCode>"],
  "manBuyerRef": ["<ram:BuyerReference>", "</ram:BuyerReference>"],
  "manSellerName": ["<ram:SellerTradeParty>", "<ram:Name>"],
  "manSellerVat": ["<ram:SellerTradeParty>", "schemeID=\"VA\">"],
  "manSellerStreet": ["<ram:SellerTradeParty>", "<ram:LineOne>"],
  "manSellerCity": ["<ram:SellerTradeParty>", "<ram:CityName>"],
  "manBuyerName": ["<ram:BuyerTradeParty>", "<ram:Name>"],
  "manBuyerVat": ["<ram:BuyerTradeParty>", "schemeID=\"VA\">"],
  "manBuyerStreet": ["<ram:BuyerTradeParty>", "<ram:LineOne>"],
  "manBuyerCity": ["<ram:BuyerTradeParty>", "<ram:CityName>"],
  "manIban": ["<ram:PayeePartyCreditorFinancialAccount>", "<ram:IBANID>"],
  "manBic": ["<ram:PayeeSpecifiedCreditorFinancialInstitution>", "<ram:BICID>"],
  "manNetTotal": ["<ram:LineTotalAmount>", "<ram:TaxBasisTotalAmount>"],
  "manTaxTotal": ["<ram:TaxTotalAmount"],
  "manGrandTotal": ["<ram:GrandTotalAmount>"],

  // PDF Extraction form
  "sellerName": ["<ram:SellerTradeParty>", "<ram:Name>"],
  "sellerVat": ["<ram:SellerTradeParty>", "schemeID=\"VA\">"],
  "sellerStreet": ["<ram:SellerTradeParty>", "<ram:LineOne>"],
  "sellerCity": ["<ram:SellerTradeParty>", "<ram:CityName>"],
  "buyerName": ["<ram:BuyerTradeParty>", "<ram:Name>"],
  "buyerVat": ["<ram:BuyerTradeParty>", "schemeID=\"VA\">"],
  "buyerStreet": ["<ram:BuyerTradeParty>", "<ram:LineOne>"],
  "buyerCity": ["<ram:BuyerTradeParty>", "<ram:CityName>"],
  "payIban": ["<ram:PayeePartyCreditorFinancialAccount>", "<ram:IBANID>"],
  "payBic": ["<ram:PayeeSpecifiedCreditorFinancialInstitution>", "<ram:BICID>"],
  "totNet": ["<ram:LineTotalAmount>", "<ram:TaxBasisTotalAmount>"],
  "totTax": ["<ram:TaxTotalAmount"],
  "totGrand": ["<ram:GrandTotalAmount>"],
  "totDue": ["<ram:DuePayableAmount>"],

  // DOCX form
  "docxInvNumber": ["<ram:ID>", "</ram:ID>"],
  "docxInvIssueDate": ["<ram:IssueDateTime>", "</ram:IssueDateTime>"],
  "docxSellerName": ["<ram:SellerTradeParty>", "<ram:Name>"],
  "docxBuyerName": ["<ram:BuyerTradeParty>", "<ram:Name>"],
  "docxTotNet": ["<ram:LineTotalAmount>"],
  "docxTotGrand": ["<ram:GrandTotalAmount>"],

  // Studio v2 (both UN/CEFACT CII & OASIS UBL 2.1 tags)
  "v2InvNumber": ["<ram:ID>", "</ram:ID>", "<cbc:ID>", "</cbc:ID>"],
  "v2DocTypeSelect": ["<ram:TypeCode>", "</ram:TypeCode>", "<cbc:InvoiceTypeCode>"],
  "v2IssueDate": ["<ram:IssueDateTime>", "</ram:IssueDateTime>", "<udt:DateTimeString", "<cbc:IssueDate>"],
  "v2DueDate": ["<ram:DueDateDateTime>", "</ram:DueDateDateTime>", "<ram:SpecifiedTradePaymentTerms>", "<cbc:DueDate>"],
  "v2Currency": ["<ram:InvoiceCurrencyCode>", "</ram:InvoiceCurrencyCode>", "<cbc:DocumentCurrencyCode>"],
  "v2BuyerRef": ["<ram:BuyerReference>", "</ram:BuyerReference>", "<cbc:BuyerReference>"],
  "v2PurchaseOrder": ["<ram:BuyerOrderReferencedDocument>", "<ram:IssuerAssignedID>", "<cac:OrderReference>", "<cbc:ID>"],
  "v2PrecedingInvNumber": ["<ram:InvoiceReferencedDocument>", "<ram:IssuerAssignedID>", "<cac:BillingReference>"],
  "v2PrecedingInvDate": ["<ram:InvoiceReferencedDocument>", "<ram:FormattedIssueDateTime>", "<cbc:IssueDate>"],
  "v2PrepaidAmount": ["<ram:TotalPrepaidAmount>", "<cbc:PrepaidAmount>"],
  "v2PayTerms": ["<ram:SpecifiedTradePaymentTerms>", "<ram:Description>", "<cac:PaymentTerms>"],
  "v2ExemptionReason": ["<ram:ExemptionReason>", "<cbc:TaxExemptionReason>"],
  "v2SellerName": ["<ram:SellerTradeParty>", "<ram:Name>", "<cac:AccountingSupplierParty>", "<cbc:RegistrationName>"],
  "v2SellerVat": ["<ram:SellerTradeParty>", "schemeID=\"VA\">", "<cac:AccountingSupplierParty>", "<cbc:CompanyID>"],
  "v2SellerStreet": ["<ram:SellerTradeParty>", "<ram:LineOne>", "<cac:AccountingSupplierParty>", "<cbc:StreetName>"],
  "v2SellerPostcode": ["<ram:SellerTradeParty>", "<ram:PostcodeCode>", "<cac:AccountingSupplierParty>", "<cbc:PostalZone>"],
  "v2SellerCity": ["<ram:SellerTradeParty>", "<ram:CityName>", "<cac:AccountingSupplierParty>", "<cbc:CityName>"],
  "v2SellerCountry": ["<ram:SellerTradeParty>", "<ram:CountryID>", "<cac:AccountingSupplierParty>", "<cbc:IdentificationCode>"],
  "v2SellerContactName": ["<ram:SellerTradeParty>", "<ram:DefinedTradeContact>", "<ram:PersonName>", "<cac:AccountingSupplierParty>", "<cac:Contact>", "<cbc:Name>"],
  "v2SellerPhone": ["<ram:SellerTradeParty>", "<ram:CompleteNumber>", "<cac:AccountingSupplierParty>", "<cbc:Telephone>"],
  "v2SellerEmail": ["<ram:SellerTradeParty>", "<ram:URIID>", "<cac:AccountingSupplierParty>", "<cbc:ElectronicMail>"],
  "v2BuyerName": ["<ram:BuyerTradeParty>", "<ram:Name>", "<cac:AccountingCustomerParty>", "<cbc:RegistrationName>"],
  "v2BuyerVat": ["<ram:BuyerTradeParty>", "schemeID=\"VA\">", "<cac:AccountingCustomerParty>", "<cbc:CompanyID>"],
  "v2BuyerStreet": ["<ram:BuyerTradeParty>", "<ram:LineOne>", "<cac:AccountingCustomerParty>", "<cbc:StreetName>"],
  "v2BuyerPostcode": ["<ram:BuyerTradeParty>", "<ram:PostcodeCode>", "<cac:AccountingCustomerParty>", "<cbc:PostalZone>"],
  "v2BuyerCity": ["<ram:BuyerTradeParty>", "<ram:CityName>", "<cac:AccountingCustomerParty>", "<cbc:CityName>"],
  "v2BuyerCountry": ["<ram:BuyerTradeParty>", "<ram:CountryID>", "<cac:AccountingCustomerParty>", "<cbc:IdentificationCode>"],
  "v2BuyerContactName": ["<ram:BuyerTradeParty>", "<ram:DefinedTradeContact>", "<ram:PersonName>", "<cac:AccountingCustomerParty>", "<cac:Contact>", "<cbc:Name>"],
  "v2BuyerPhone": ["<ram:BuyerTradeParty>", "<ram:CompleteNumber>", "<cac:AccountingCustomerParty>", "<cbc:Telephone>"],
  "v2BuyerEmail": ["<ram:BuyerTradeParty>", "<ram:URIID>", "<cac:AccountingCustomerParty>", "<cbc:ElectronicMail>"],
  "v2DelivName": ["<ram:ShipToTradeParty>", "<ram:Name>", "<cac:DeliveryParty>", "<cbc:Name>"],
  "v2DelivDate": ["<ram:ActualDeliverySupplyChainEvent>", "<ram:OccurrenceDateTime>", "<cbc:ActualDeliveryDate>"],
  "v2DelivStreet": ["<ram:ShipToTradeParty>", "<ram:LineOne>", "<cac:DeliveryParty>", "<cbc:StreetName>"],
  "v2DelivCity": ["<ram:ShipToTradeParty>", "<ram:CityName>", "<cac:DeliveryParty>", "<cbc:CityName>"],
  "v2DelivPostcode": ["<ram:ShipToTradeParty>", "<ram:PostcodeCode>", "<cac:DeliveryParty>", "<cbc:PostalZone>"],
  "v2PayIban": ["<ram:PayeePartyCreditorFinancialAccount>", "<ram:IBANID>", "<cac:PayeeFinancialAccount>", "<cbc:ID>"],
  "v2PayBic": ["<ram:PayeeSpecifiedCreditorFinancialInstitution>", "<ram:BICID>"]
};

// Highlighting execution function
function highlightXmlForInput(inputEl, shouldScroll = false) {
  if (!inputEl) return;
  const inputId = inputEl.id;
  const val = inputEl.value ? String(inputEl.value).trim() : "";

  // Locate the active XML viewer depending on the visible tab/scenario
  let viewer = null;
  const v2Card = document.getElementById("v2XmlCard");
  const v2Container = document.getElementById("scenario-v2-container");

  if (v2Container && v2Container.style.display !== "none") {
    viewer = document.getElementById("v2XmlViewer");
    if (v2Card && (v2Card.style.display === "none" || v2Card.classList.contains("hidden"))) {
      v2Card.style.display = "block";
      v2Card.classList.remove("hidden");
    }
  } else {
    // Check v1 viewers
    const manCard = document.getElementById("scenario-manual-container");
    const docxCard = document.getElementById("scenario-docx-container");
    if (manCard && manCard.style.display !== "none") {
      viewer = document.getElementById("manXmlViewer");
    } else if (docxCard && docxCard.style.display !== "none") {
      viewer = document.getElementById("docxXmlViewer");
    } else {
      viewer = document.getElementById("xmlCodeViewer");
    }
  }

  if (!viewer) return;

  // Store raw text in data attribute if not already stored
  if (!viewer.dataset.rawXml) {
    viewer.dataset.rawXml = viewer.textContent;
  }
  const raw = viewer.dataset.rawXml;
  if (!raw || raw.trim().startsWith("<!--") || raw.length < 20) return;

  let targetTags = XML_FIELD_MAP[inputId] || [];
  if (targetTags.length === 0 && inputId) {
    if (inputId.startsWith("v2DiscountReason_")) targetTags = ["<ram:SpecifiedTradeAllowanceCharge>", "<ram:Reason>", "<cac:AllowanceCharge>", "<cbc:AllowanceChargeReason>"];
    else if (inputId.startsWith("v2DiscountPct_")) targetTags = ["<ram:CalculationPercent>", "<cbc:MultiplierFactorNumeric>"];
    else if (inputId.startsWith("v2DiscountAmount_")) targetTags = ["<ram:ActualAmount>", "<cac:AllowanceCharge>", "<cbc:Amount"];
    else if (inputId.startsWith("v2ItemName_")) targetTags = ["<ram:SpecifiedTradeProduct>", "<ram:Name>", "<cac:InvoiceLine>", "<cac:Item>", "<cbc:Name>"];
    else if (inputId.startsWith("v2ItemQty_")) targetTags = ["<ram:BilledQuantity>", "<cbc:InvoicedQuantity>"];
    else if (inputId.startsWith("v2ItemUnit_")) targetTags = ["unitCode=", "@unitCode"];
    else if (inputId.startsWith("v2ItemPrice_")) targetTags = ["<ram:ChargeAmount>", "<cac:Price>", "<cbc:PriceAmount>"];
    else if (inputId.startsWith("v2ItemTax_")) targetTags = ["<ram:CategoryCode>", "<ram:RateApplicablePercent>", "<cac:ClassifiedTaxCategory>", "<cbc:Percent>"];
  }
  let matched = false;

  // Build escaped HTML representation with marked matches
  let html = escapeHtml(raw);

  // Strategy 1: If value is present, search for the exact value inside XML tags
  if (val && val.length >= 2) {
    const escapedVal = escapeHtml(val);
    const regexVal = new RegExp(escapeRegex(escapedVal), "g");
    if (regexVal.test(html)) {
      html = html.replace(regexVal, `<mark class="xml-hl-value">${escapedVal}</mark>`);
      matched = true;
    }
  }

  // Strategy 2: Search for relevant tag(s) associated with this field
  if (targetTags.length > 0) {
    targetTags.forEach(tag => {
      const escapedTag = escapeHtml(tag);
      const regexTag = new RegExp(escapeRegex(escapedTag), "g");
      if (regexTag.test(html)) {
        html = html.replace(regexTag, `<mark class="xml-hl-tag">${escapedTag}</mark>`);
        matched = true;
      }
    });
  }

  if (matched) {
    viewer.innerHTML = html;
    // Smooth scroll the XML card into user's view if explicitly requested
    if (shouldScroll && v2Card) {
      v2Card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    // Smooth scroll the first match into view inside the code-viewer
    const firstMark = viewer.querySelector("mark");
    if (firstMark) {
      firstMark.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } else if (shouldScroll && v2Card) {
    v2Card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}
window.highlightXmlForInput = highlightXmlForInput;

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Function to explicitly jump to and highlight field XML on demand (e.g. via ? button)
function jumpToXmlForField(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  const v2Card = document.getElementById("v2XmlCard");
  const v2Container = document.getElementById("scenario-v2-container");

  // Ensure Studio v2 is shown
  if (v2Container && v2Container.style.display === "none") {
    if (typeof switchScenario === "function") switchScenario("v2");
  }

  // Open the XML Card if closed
  if (v2Card && (v2Card.style.display === "none" || v2Card.classList.contains("hidden"))) {
    v2Card.style.display = "block";
    v2Card.classList.remove("hidden");
  }

  // Generate or refresh live XML, then highlight and scroll to matched tag
  if (typeof updateV2LiveXml === "function") {
    updateV2LiveXml().then(() => {
      highlightXmlForInput(el, true);
    });
  } else {
    highlightXmlForInput(el, true);
  }
}
window.jumpToXmlForField = jumpToXmlForField;

// =========================================================================
// EN 16931 BUSINESS TERM (BT-X) METADATA MAP FOR STUDIO V2
// Maps each form input ID to its standard Business Term, legal title, and XML path
// =========================================================================

// =========================================================================
// EN 16931 BUSINESS TERM (BT-X) METADATA MAP FOR STUDIO V2
// Maps each form input ID to standard BT, legal title, XML path, and requirement rules per format:
// xr: XRechnung (German B2G), peppol: Peppol BIS 3.0, zugferd: ZUGFeRD / Factur-X 2.3
// =========================================================================

let v2ActiveTargetFormat = "zugferd";

const V2_BT_FIELD_MAP = {
  // Document Details
  "v2DocTypeSelect": {
    bt: "BT-3",
    name: "Invoice type code",
    name_de: "Rechnungsartcode",
    desc: "Specifies the document type code (e.g. 380 = Commercial Invoice, 381 = Credit Note, 384 = Corrected Invoice, 220 = Order-X).",
    xml: "rsm:ExchangedDocument/ram:TypeCode",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2InvNumber": {
    bt: "BT-1",
    name: "Invoice number",
    name_de: "Rechnungsnummer",
    desc: "Unique sequential commercial document identifier issued by the seller.",
    xml: "rsm:ExchangedDocument/ram:ID",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2IssueDate": {
    bt: "BT-2",
    name: "Invoice issue date",
    name_de: "Rechnungsdatum",
    desc: "The date when the invoice was legally issued (YYYY-MM-DD).",
    xml: "rsm:ExchangedDocument/ram:IssueDateTime",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2Currency": {
    bt: "BT-5",
    name: "Invoice currency code",
    name_de: "Rechnungswährungscode",
    desc: "ISO 4217 3-letter currency code in which amounts are billed (EUR, USD, CHF, GBP).",
    xml: ".../ram:InvoiceCurrencyCode",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2DueDate": {
    bt: "BT-9",
    name: "Payment due date",
    name_de: "Fälligkeitsdatum der Zahlung",
    desc: "The date when net payment is legally due by the debtor.",
    xml: ".../ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2PayMethod": {
    bt: "BT-81",
    name: "Payment means type code",
    name_de: "Zahlungsmittelcode",
    desc: "Code indicating how payment should be made (58 = SEPA transfer, 30 = Credit transfer, 48 = Bank card, 10 = Cash).",
    xml: ".../ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode",
    req_xr: true, req_peppol: true, req_zugferd: false
  },
  "v2PayIban": {
    bt: "BT-84",
    name: "Payment account identifier (IBAN)",
    name_de: "Zahlungskonto-Kennung (IBAN)",
    desc: "The International Bank Account Number to which the invoice amount must be transferred.",
    xml: ".../ram:PayeePartyCreditorFinancialAccount/ram:IBANID",
    req_xr: true, req_peppol: true, req_zugferd: false
  },
  "v2PayBic": {
    bt: "BT-86",
    name: "Bank BIC / SWIFT code",
    name_de: "Bank-Identifikator (BIC / SWIFT)",
    desc: "BIC identifier of the payment service provider.",
    xml: ".../ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2PurchaseOrder": {
    bt: "BT-13",
    name: "Purchase order reference (PO)",
    name_de: "Bestellnummer (PO)",
    desc: "Buyer-issued purchase order or contract order number.",
    xml: ".../ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2BuyerRef": {
    bt: "BT-10",
    name: "Buyer reference (Leitweg-ID)",
    name_de: "Leitweg-ID / Käuferreferenz",
    desc: "Buyer reference identifier, internal cost center, or German public sector Leitweg-ID for B2G routing.",
    xml: ".../ram:BuyerReference",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2PrepaidAmount": {
    bt: "BT-113",
    name: "Prepaid amount",
    name_de: "Gezahlter Betrag / Anzahlung",
    desc: "Sum of amounts already paid in advance or deducted prior to issuing the invoice.",
    xml: ".../ram:TotalPrepaidAmount",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2PayTerms": {
    bt: "BT-83",
    name: "Payment terms / Skonto",
    name_de: "Zahlungsbedingungen (Skonto)",
    desc: "Detailed conditions of payment, early settlement cash discounts (Skonto), and penalty interest.",
    xml: ".../ram:SpecifiedTradePaymentTerms/ram:Description",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2ServiceStart": {
    bt: "BT-73",
    name: "Invoicing period start date",
    name_de: "Beginn des Leistungszeitraums",
    desc: "Date when delivery or service provision began.",
    xml: ".../ram:BillingSpecifiedPeriod/ram:StartDateTime",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2ServiceEnd": {
    bt: "BT-74",
    name: "Invoicing period end date",
    name_de: "Ende des Leistungszeitraums",
    desc: "Date when delivery or service provision concluded.",
    xml: ".../ram:BillingSpecifiedPeriod/ram:EndDateTime",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2PrecedingInvNumber": {
    bt: "BT-25",
    name: "Preceding invoice reference",
    name_de: "Vorherige Rechnungsnummer",
    desc: "Identification number of the earlier invoice that is being credited or corrected.",
    xml: ".../ram:InvoiceReferencedDocument/ram:IssuerAssignedID",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2PrecedingInvDate": {
    bt: "BT-26",
    name: "Preceding invoice issue date",
    name_de: "Rechnungsdatum der vorherigen Rechnung",
    desc: "Issue date of the invoice that this credit note or correction refers to.",
    xml: ".../ram:InvoiceReferencedDocument/ram:FormattedIssueDateTime",
    req_xr: false, req_peppol: false, req_zugferd: false
  },

  // Seller Details
  "v2SellerName": {
    bt: "BT-27",
    name: "Seller full legal name",
    name_de: "Name des Verkäufers",
    desc: "The full legal and registered commercial trade name of the selling company.",
    xml: ".../ram:SellerTradeParty/ram:Name",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2SellerVat": {
    bt: "BT-31",
    name: "Seller VAT identifier",
    name_de: "Umsatzsteuer-Identifikationsnummer des Verkäufers",
    desc: "Value Added Tax identification number of the seller (e.g. DE123456789).",
    xml: ".../ram:SellerTradeParty/ram:SpecifiedTaxRegistration (VA)",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2SellerTaxNumber": {
    bt: "BT-32",
    name: "Seller tax registration ID (Steuernummer)",
    name_de: "Steuernummer des Verkäufers (FC)",
    desc: "Local tax number or commercial register court number (e.g. 99022/20844).",
    xml: ".../ram:SellerTradeParty/ram:SpecifiedTaxRegistration (FC)",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2SellerStreet": {
    bt: "BT-35",
    name: "Seller address line 1",
    name_de: "Straße des Verkäufers",
    desc: "Street name and building number of the seller's registered legal seat.",
    xml: ".../ram:SellerTradeParty/.../ram:LineOne",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2SellerPostcode": {
    bt: "BT-38",
    name: "Seller post code",
    name_de: "Postleitzahl des Verkäufers",
    desc: "Postal zip code of the seller address.",
    xml: ".../ram:SellerTradeParty/.../ram:PostcodeCode",
    req_xr: true, req_peppol: true, req_zugferd: false
  },
  "v2SellerCity": {
    bt: "BT-37",
    name: "Seller city / municipality",
    name_de: "Ort des Verkäufers",
    desc: "City or town of the seller address.",
    xml: ".../ram:SellerTradeParty/.../ram:CityName",
    req_xr: true, req_peppol: true, req_zugferd: false
  },
  "v2SellerCountry": {
    bt: "BT-40",
    name: "Seller country code",
    name_de: "Ländercode des Verkäufers",
    desc: "ISO 3166-1 2-letter country code of the seller (e.g. DE, SI, FR).",
    xml: ".../ram:SellerTradeParty/.../ram:CountryID",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2SellerContactName": {
    bt: "BT-41",
    name: "Seller contact point / person",
    name_de: "Kontaktstelle / Ansprechpartner des Verkäufers",
    desc: "Name of the contact person or department at the seller.",
    xml: ".../ram:DefinedTradeContact/ram:PersonName",
    req_xr: true, req_peppol: true, req_zugferd: false
  },
  "v2SellerPhone": {
    bt: "BT-42",
    name: "Seller contact telephone",
    name_de: "Telefonnummer des Verkäufers",
    desc: "Direct contact telephone number of the invoicing department.",
    xml: ".../ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber",
    req_xr: true, req_peppol: true, req_zugferd: false
  },
  "v2SellerEmail": {
    bt: "BT-43",
    name: "Seller contact email",
    name_de: "E-Mail-Adresse des Verkäufers",
    desc: "Billing email address for inquiries.",
    xml: ".../ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID",
    req_xr: true, req_peppol: true, req_zugferd: false
  },

  // Buyer Details
  "v2BuyerName": {
    bt: "BT-44",
    name: "Buyer full legal name",
    name_de: "Name des Erwerbers / Käufers",
    desc: "Full legal entity name or individual name of the purchasing customer.",
    xml: ".../ram:BuyerTradeParty/ram:Name",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2BuyerVat": {
    bt: "BT-48",
    name: "Buyer VAT identifier",
    name_de: "Umsatzsteuer-Identifikationsnummer des Erwerbers",
    desc: "Customer's Value Added Tax ID (e.g. SI52093808 or DE987654321).",
    xml: ".../ram:BuyerTradeParty/ram:SpecifiedTaxRegistration (VA)",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2BuyerStreet": {
    bt: "BT-50",
    name: "Buyer address line 1",
    name_de: "Straße des Erwerbers",
    desc: "Street name and house number of the buyer.",
    xml: ".../ram:BuyerTradeParty/.../ram:LineOne",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2BuyerPostcode": {
    bt: "BT-53",
    name: "Buyer post code",
    name_de: "Postleitzahl des Erwerbers",
    desc: "Postal zip code of the buyer's destination.",
    xml: ".../ram:BuyerTradeParty/.../ram:PostcodeCode",
    req_xr: true, req_peppol: true, req_zugferd: false
  },
  "v2BuyerCity": {
    bt: "BT-52",
    name: "Buyer city",
    name_de: "Ort des Erwerbers",
    desc: "City or town of the buyer address.",
    xml: ".../ram:BuyerTradeParty/.../ram:CityName",
    req_xr: true, req_peppol: true, req_zugferd: false
  },
  "v2BuyerCountry": {
    bt: "BT-55",
    name: "Buyer country code",
    name_de: "Ländercode des Erwerbers",
    desc: "ISO 3166-1 2-letter country code of the buyer.",
    xml: ".../ram:BuyerTradeParty/.../ram:CountryID",
    req_xr: true, req_peppol: true, req_zugferd: true
  },
  "v2BuyerContactName": {
    bt: "BT-56",
    name: "Buyer contact point / person",
    name_de: "Kontaktstelle / Ansprechpartner des Erwerbers",
    desc: "Name of the contact person or department at the buyer.",
    xml: ".../ram:BuyerTradeParty/ram:DefinedTradeContact/ram:PersonName",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2BuyerPhone": {
    bt: "BT-57",
    name: "Buyer contact telephone number",
    name_de: "Telefonnummer des Erwerbers",
    desc: "Telephone contact number of the buyer contact point.",
    xml: ".../ram:BuyerTradeParty/.../ram:TelephoneUniversalCommunication",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2BuyerEmail": {
    bt: "BT-58",
    name: "Buyer contact email address",
    name_de: "E-Mail-Adresse des Erwerbers",
    desc: "Email address of the buyer contact point.",
    xml: ".../ram:BuyerTradeParty/.../ram:EmailURIUniversalCommunication",
    req_xr: false, req_peppol: false, req_zugferd: false
  },

  // Delivery / Ship-to
  "v2DelivName": {
    bt: "BT-70",
    name: "Deliver-to party name",
    name_de: "Name des Empfängers / Lieferorts",
    desc: "Name of the actual physical recipient or site if different from buyer.",
    xml: ".../ram:ShipToTradeParty/ram:Name",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2DelivLocationId": {
    bt: "BT-71",
    name: "Deliver-to location identifier (GLN)",
    name_de: "Lieferort-Kennung (Abladestelle / GLN)",
    desc: "Global Location Number (GLN) of the destination warehouse.",
    xml: ".../ram:ShipToTradeParty/ram:ID",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2DelivDate": {
    bt: "BT-72",
    name: "Actual delivery date",
    name_de: "Tatsächliches Lieferdatum",
    desc: "Date when goods were received or service fulfilled.",
    xml: ".../ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2DelivDespatchRef": {
    bt: "BT-16",
    name: "Despatch advice reference (Delivery Note #)",
    name_de: "Lieferscheinnummer (Despatch Advice)",
    desc: "Reference number of the physical delivery packing slip / Lieferschein.",
    xml: ".../ram:DespatchAdviceReferencedDocument/ram:IssuerAssignedID",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2DelivStreet": {
    bt: "BT-75",
    name: "Deliver-to street address",
    name_de: "Straße des Lieferorts",
    desc: "Street address where goods are unloaded.",
    xml: ".../ram:ShipToTradeParty/.../ram:LineOne",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2DelivPostcode": {
    bt: "BT-78",
    name: "Deliver-to post code",
    name_de: "Postleitzahl des Lieferorts",
    desc: "Zip code of the delivery location.",
    xml: ".../ram:ShipToTradeParty/.../ram:PostcodeCode",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2DelivCity": {
    bt: "BT-77",
    name: "Deliver-to city",
    name_de: "Ort des Lieferorts",
    desc: "City of the physical unloading point.",
    xml: ".../ram:ShipToTradeParty/.../ram:CityName",
    req_xr: false, req_peppol: false, req_zugferd: false
  },
  "v2DelivCountry": {
    bt: "BT-80",
    name: "Deliver-to country code",
    name_de: "Ländercode des Lieferorts",
    desc: "ISO 3166-1 2-letter country code of delivery destination.",
    xml: ".../ram:ShipToTradeParty/.../ram:CountryID",
    req_xr: false, req_peppol: false, req_zugferd: false
  },

  // Tax Exemption Reason
  "v2ExemptionReason": {
    bt: "BT-120",
    name: "Tax exemption reason text",
    name_de: "Grund für die Steuerbefreiung",
    desc: "Legal justification text when VAT is 0% (e.g. Reverse Charge § 13b UStG, Intra-Community supply).",
    xml: ".../ram:ApplicableTradeTax/ram:ExemptionReason",
    req_xr: false, req_peppol: false, req_zugferd: false
  }
};

function isBtFieldMandatory(btInfo, formatKey) {
  if (!btInfo) return false;
  if (formatKey === "xrechnung") return Boolean(btInfo.req_xr);
  if (formatKey === "peppol" || formatKey === "ubl") return Boolean(btInfo.req_peppol);
  if (formatKey === "eslog") return Boolean(btInfo.req_peppol || btInfo.req_zugferd);
  return Boolean(btInfo.req_zugferd);
}

function handleV2FormatChange(format) {
  v2ActiveTargetFormat = format || "zugferd";

  // Update tabs active state
  ["zugferd", "xrechnung", "peppol", "eslog", "ubl"].forEach(f => {
    const btn = document.getElementById(`v2FmtBtn-${f}`);
    if (btn) {
      if (f === v2ActiveTargetFormat) btn.classList.add("active");
      else btn.classList.remove("active");
    }
  });

  // Update asterisks and tooltip badges across all form fields
  updateMandatoryAsterisks();

  // If live XML viewer is visible, automatically regenerate for the new format
  if (typeof updateV2LiveXml === "function") {
    const v2Card = document.getElementById("v2XmlCard");
    if (v2Card && v2Card.style.display !== "none" && !v2Card.classList.contains("hidden")) {
      updateV2LiveXml();
    }
  }
}
window.handleV2FormatChange = handleV2FormatChange;

function updateMandatoryAsterisks() {
  const formFields = document.querySelectorAll(".v2-field");
  formFields.forEach(fieldDiv => {
    const input = fieldDiv.querySelector("input, select, textarea");
    if (!input || !input.id) return;
    const btInfo = V2_BT_FIELD_MAP[input.id];
    if (!btInfo) return;

    const isMand = isBtFieldMandatory(btInfo, v2ActiveTargetFormat);

    // Update or insert star element
    const starEl = fieldDiv.querySelector(".v2-req-star");
    if (starEl) {
      if (isMand) starEl.classList.remove("hidden");
      else starEl.classList.add("hidden");
    }

    // Update status badge inside tooltip
    const tooltipStatus = fieldDiv.querySelector(".v2-bt-tooltip-status");
    if (tooltipStatus) {
      if (isMand) {
        tooltipStatus.className = "v2-bt-tooltip-status req";
        tooltipStatus.textContent = `● Mandatory in ${v2ActiveTargetFormat.toUpperCase()}`;
      } else {
        tooltipStatus.className = "v2-bt-tooltip-status opt";
        tooltipStatus.textContent = `Optional in ${v2ActiveTargetFormat.toUpperCase()}`;
      }
    }
  });
}
window.updateMandatoryAsterisks = updateMandatoryAsterisks;

// Initialize BT-X labels, dynamic asterisks, tooltips, and question mark buttons
function initXmlQuestionButtons() {
  const formFields = document.querySelectorAll(".v2-field");
  formFields.forEach(fieldDiv => {
    const input = fieldDiv.querySelector("input, select, textarea");
    const label = fieldDiv.querySelector(".v2-label");
    if (!input || !label || !input.id) return;

    const btInfo = V2_BT_FIELD_MAP[input.id];
    const hasXmlMap = Boolean(XML_FIELD_MAP[input.id]);

    // Build or ensure left wrapper for label title & BT badge
    let leftWrap = label.querySelector(".v2-label-left");
    if (!leftWrap) {
      const childNodes = Array.from(label.childNodes);
      leftWrap = document.createElement("span");
      leftWrap.className = "v2-label-left";

      // Move existing label title text (stripping hardcoded asterisks)
      childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const cleanText = node.textContent.replace(/\s*\*\s*$/, "").trim();
          if (cleanText) leftWrap.appendChild(document.createTextNode(cleanText + " "));
          label.removeChild(node);
        } else if (node.tagName && !node.classList.contains("v2-label-link") && !node.classList.contains("v2-xml-help-btn")) {
          leftWrap.appendChild(node);
        }
      });

      // Add dynamic star element
      const star = document.createElement("span");
      star.className = "v2-req-star hidden";
      star.textContent = "*";
      leftWrap.appendChild(star);

      label.insertBefore(leftWrap, label.firstChild);
    }

    // 1. Inject BT-X Badge with Rich Tooltip
    if (btInfo && !leftWrap.querySelector(`.v2-bt-badge[data-bt="${btInfo.bt}"]`)) {
      const badge = document.createElement("span");
      badge.className = "v2-bt-badge";
      badge.dataset.bt = btInfo.bt;
      badge.textContent = btInfo.bt;

      const isMand = isBtFieldMandatory(btInfo, v2ActiveTargetFormat);
      const tooltip = document.createElement("div");
      tooltip.className = "v2-bt-tooltip";
      const titleDisplay = btInfo.name_de 
        ? `${btInfo.bt}: ${escapeHtml(btInfo.name_de)} (${escapeHtml(btInfo.name)})`
        : `${btInfo.bt}: ${escapeHtml(btInfo.name)}`;
      tooltip.innerHTML = `
        <span class="v2-bt-tooltip-title">${titleDisplay}</span>
        <div>${escapeHtml(btInfo.desc)}</div>
        <span class="v2-bt-tooltip-xml">XML: ${escapeHtml(btInfo.xml)}</span>
        <span class="v2-bt-tooltip-status ${isMand ? 'req' : 'opt'}">${isMand ? '● Mandatory Standard Field / Pflichtfeld' : 'Optional / Bedingt'}</span>
      `;

      badge.appendChild(tooltip);
      leftWrap.appendChild(badge);
    }

    // 2. Inject Questionmark (?) XML Jump Button
    if (hasXmlMap && !label.querySelector(`.v2-xml-help-btn[data-field="${input.id}"]`)) {
      const qBtn = document.createElement("button");
      qBtn.type = "button";
      qBtn.className = "v2-xml-help-btn";
      qBtn.dataset.field = input.id;
      qBtn.title = `Jump to ${btInfo ? btInfo.bt + ' in ' : ''}factur-x.xml`;
      qBtn.textContent = "?";
      qBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        jumpToXmlForField(input.id);
      };

      label.appendChild(qBtn);
    }
  });

  updateMandatoryAsterisks();
}
window.initXmlQuestionButtons = initXmlQuestionButtons;

// Document ready
document.addEventListener("DOMContentLoaded", () => {
  initXmlQuestionButtons();
});

// Document ready
document.addEventListener("DOMContentLoaded", () => {
  initXmlQuestionButtons();
});

