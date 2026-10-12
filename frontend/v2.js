// =========================================================================
// ZUGFeRD Studio v2 Client Engine
// Matches GetZUGFeRD.com Guided Flow with 6 Document Types
// =========================================================================

let v2LineItems = [];
let v2DocumentDiscounts = [];
let v2ExtractedNotes = [];
let v2TokenUsage = null;
let v2UploadedFileId = null;
let v2UploadedFileName = null;

// Initialize on script load
function initV2Studio() {
  populateV2CountryDropdowns();
  initV2LineItems();
  initV2DocumentDiscounts();
  initV2InvoiceNotes();
  populateV2SellerDefaults();
  updateV2DocumentTypeFields();
  loadV2SavedPartiesDropdowns();
  setupV2PrefillDropzone();
  recalcV2Totals();
  if (typeof initXmlQuestionButtons === "function") initXmlQuestionButtons();
}

// Populate country select menus with full ISO 3166-1 alpha-2 list
function populateV2CountryDropdowns() {
  const countryIds = ["v2SellerCountry", "v2BuyerCountry", "v2DelivCountry"];
  const list = window.ALL_ISO_COUNTRIES;
  if (!Array.isArray(list) || list.length === 0) return;

  const frequentCodes = ["DE", "SI", "AT", "CH", "NL", "DK", "FR", "IT", "HR", "BE", "PL", "ES", "SE", "NO", "FI", "GB", "US"];
  const frequentMap = new Map();
  list.forEach(([code, name]) => {
    if (frequentCodes.includes(code)) frequentMap.set(code, name);
  });

  countryIds.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const currentVal = sel.value || (id === "v2SellerCountry" ? "DE" : (id === "v2BuyerCountry" ? "DE" : "DE"));

    let html = `<option value="">-- Select Country --</option>`;
    
    // Frequent / European group
    html += `<optgroup label="Frequent / European">`;
    frequentCodes.forEach(c => {
      const name = frequentMap.get(c);
      if (name) {
        html += `<option value="${c}">${name}</option>`;
      }
    });
    html += `</optgroup>`;

    // Complete ISO List group
    html += `<optgroup label="All Countries (A - Z)">`;
    list.forEach(([c, name]) => {
      html += `<option value="${c}">${name}</option>`;
    });
    html += `</optgroup>`;

    sel.innerHTML = html;
    if (currentVal) sel.value = currentVal;

    if (id === "v2SellerCountry") {
      sel.onchange = () => {
        if (v2LineItems && v2LineItems.length > 0) {
          renderV2LineItems();
        }
      };
    }
  });
}
window.populateV2CountryDropdowns = populateV2CountryDropdowns;

function onV2FileInputChanged(input) {
  if (input && input.files && input.files.length) {
    const file = input.files[0];
    input.value = "";
    handleV2PrefillUpload(file);
  }
}
window.onV2FileInputChanged = onV2FileInputChanged;

function setupV2PrefillDropzone() {
  const banner = document.getElementById("v2PrefillBanner");
  const fileInput = document.getElementById("v2PrefillFileInput");
  if (!banner || !fileInput) return;

  fileInput.onchange = function() {
    if (this.files && this.files.length) {
      const file = this.files[0];
      this.value = "";
      handleV2PrefillUpload(file);
    }
  };

  banner.ondragover = (e) => {
    e.preventDefault();
    banner.style.borderColor = "var(--accent)";
    banner.style.background = "rgba(37, 99, 235, 0.12)";
  };

  banner.ondragleave = (e) => {
    e.preventDefault();
    banner.style.borderColor = "";
    banner.style.background = "";
  };

  banner.ondrop = (e) => {
    e.preventDefault();
    banner.style.borderColor = "";
    banner.style.background = "";
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleV2PrefillUpload(e.dataTransfer.files[0]);
    }
  };
}

// 1. Populate Seller from Configuration (optional explicit helper)
function populateV2SellerDefaults(force = false) {
  if (!force) return; // Keep form completely blank upon initial load as requested
  const settings = window.cachedCompanySettings || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };

  let cityStr = settings.seller_city || "";
  let postcodeStr = settings.seller_postcode || "";
  if (!postcodeStr && cityStr) {
    const pcMatch = cityStr.match(/^(\d{4,5})\s+(.*)$/);
    if (pcMatch) {
      postcodeStr = pcMatch[1];
      cityStr = pcMatch[2];
    }
  }

  setVal("v2SellerName", settings.seller_name || "");
  setVal("v2SellerVat", settings.seller_vat || "");
  setVal("v2SellerTaxNumber", settings.seller_tax_number || "");
  setVal("v2SellerStreet", settings.seller_street || "");
  setVal("v2SellerCity", cityStr);
  setVal("v2SellerPostcode", postcodeStr);
  setVal("v2SellerCountry", settings.seller_country || "");
  setVal("v2SellerPhone", settings.seller_phone || "");
  setVal("v2SellerFax", settings.seller_fax || "");
  setVal("v2PayIban", settings.seller_bank1_iban || "");
  setVal("v2PayBic", settings.seller_bank1_bic || "");
}
window.populateV2SellerDefaults = populateV2SellerDefaults;

// 2. Document Type Switching
function handleV2DocTypeChange(docType) {
  const creditCard = document.getElementById("v2CreditNoteCard");
  const isCreditOrCorrected = docType === "381" || docType === "384";
  if (creditCard) {
    creditCard.style.display = isCreditOrCorrected ? "block" : "none";
  }

  // Update badge & title hints
  const labelMap = {
    "380": "Commercial Invoice",
    "381": "Credit Note (Gutschrift)",
    "384": "Corrected Invoice (Rechnungskorrektur)",
    "326": "Partial Invoice (Teilrechnung)",
    "386": "Prepayment Invoice (Vorauszahlungsrechnung)",
    "orderx": "Order-X Purchase Order"
  };

  const titleEl = document.getElementById("v2DocTypeLabel");
  if (titleEl) titleEl.textContent = labelMap[docType] || "Invoice";
}
window.handleV2DocTypeChange = handleV2DocTypeChange;

function updateV2DocumentTypeFields() {
  const sel = document.getElementById("v2DocTypeSelect");
  if (sel) handleV2DocTypeChange(sel.value);
}

// 3. Accordion toggling
function toggleV2Section(sectionId, chevronId) {
  const sec = document.getElementById(sectionId);
  const chev = document.getElementById(chevronId);
  if (!sec) return;
  const isHidden = sec.style.display === "none" || sec.classList.contains("hidden");
  sec.style.display = isHidden ? "block" : "none";
  sec.classList.remove("hidden");
  if (chev) {
    chev.textContent = isHidden ? "▲" : "▼";
  }
}
window.toggleV2Section = toggleV2Section;

// 4. Line Items Management
function initV2LineItems() {
  v2LineItems = [];
  renderV2LineItems();
}

function renderV2LineItems() {
  const container = document.getElementById("v2LineItemsContainer");
  if (!container) return;
  container.innerHTML = "";

  v2LineItems.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "v2-item-card";
    const lineTotal = Math.max(0, (item.quantity * item.unit_price) - (item.discount_amount || 0));

    card.innerHTML = `
      <div class="v2-item-topbar">
        <span class="v2-item-number">Line #${idx + 1}</span>
        <button type="button" class="v2-item-trash" onclick="removeV2LineItem(${idx})" title="Remove Line">🗑️</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <div class="v2-field">
          <label class="v2-label">
            <span class="v2-label-left">
              Description / Bezeichnung <span class="v2-req-star">*</span>
              <span class="v2-bt-badge" data-bt="BT-153">BT-153
                <div class="v2-bt-tooltip">
                  <span class="v2-bt-tooltip-title">BT-153: Artikelname / Leistungsbezeichnung (Item name)</span>
                  <div>Full name or clear textual description of the good or service billed.</div>
                  <span class="v2-bt-tooltip-xml">XML: .../ram:SpecifiedTradeProduct/ram:Name</span>
                  <span class="v2-bt-tooltip-status req">● Mandatory Standard Field / Pflichtfeld</span>
                </div>
              </span>
            </span>
            <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2ItemName_${idx}')" title="Jump to BT-153 in factur-x.xml">?</button>
          </label>
          <input type="text" id="v2ItemName_${idx}" class="v2-input" value="${escapeHtml(item.name)}" oninput="updateV2ItemField(${idx}, 'name', this.value)" placeholder="Product or consulting deliverable">
        </div>
        <div class="v2-grid-4">
          <div class="v2-field">
            <label class="v2-label">
              <span class="v2-label-left">
                Qty / Menge <span class="v2-req-star">*</span>
                <span class="v2-bt-badge" data-bt="BT-129">BT-129
                  <div class="v2-bt-tooltip">
                    <span class="v2-bt-tooltip-title">BT-129: Menge der Rechnungsposition (Invoiced quantity)</span>
                    <div>Quantity of items, hours, or units invoiced for this line.</div>
                    <span class="v2-bt-tooltip-xml">XML: .../ram:BilledQuantity</span>
                    <span class="v2-bt-tooltip-status req">● Mandatory Standard Field / Pflichtfeld</span>
                  </div>
                </span>
              </span>
              <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2ItemQty_${idx}')" title="Jump to BT-129 in factur-x.xml">?</button>
            </label>
            <input type="number" id="v2ItemQty_${idx}" step="0.01" min="0.01" class="v2-input" value="${item.quantity}" oninput="updateV2ItemField(${idx}, 'quantity', parseFloat(this.value)||0)">
          </div>
          <div class="v2-field">
            <label class="v2-label">
              <span class="v2-label-left">
                Unit / Einheit <span class="v2-req-star">*</span>
                <span class="v2-bt-badge" data-bt="BT-130">BT-130
                  <div class="v2-bt-tooltip">
                    <span class="v2-bt-tooltip-title">BT-130: Mengeneinheitencode (Quantity unit code)</span>
                    <div>UN/ECE Recommendation 20 unit code (C62 = pcs, HUR = hours, KGM = kg).</div>
                    <span class="v2-bt-tooltip-xml">XML: @unitCode</span>
                    <span class="v2-bt-tooltip-status req">● Mandatory Standard Field / Pflichtfeld</span>
                  </div>
                </span>
              </span>
              <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2ItemUnit_${idx}')" title="Jump to BT-130 in factur-x.xml">?</button>
            </label>
            <select id="v2ItemUnit_${idx}" class="v2-select" onchange="updateV2ItemField(${idx}, 'unit_code', this.value)">
              <option value="C62" ${item.unit_code === "C62" ? "selected" : ""}>Piece / Stück (C62)</option>
              <option value="HUR" ${item.unit_code === "HUR" ? "selected" : ""}>Hour / Stunde (HUR)</option>
              <option value="DAY" ${item.unit_code === "DAY" ? "selected" : ""}>Day / Tag (DAY)</option>
              <option value="MON" ${item.unit_code === "MON" ? "selected" : ""}>Month / Monat (MON)</option>
              <option value="KGM" ${item.unit_code === "KGM" ? "selected" : ""}>Kilogram / Kilogramm (KGM)</option>
            </select>
          </div>
          <div class="v2-field">
            <label class="v2-label">
              <span class="v2-label-left">
                Unit Price (€) / Einzelpreis <span class="v2-req-star">*</span>
                <span class="v2-bt-badge" data-bt="BT-146">BT-146
                  <div class="v2-bt-tooltip">
                    <span class="v2-bt-tooltip-title">BT-146: Artikel-Nettopreis (Item net price)</span>
                    <div>Net price per single item unit excluding VAT.</div>
                    <span class="v2-bt-tooltip-xml">XML: .../ram:ChargeAmount</span>
                    <span class="v2-bt-tooltip-status req">● Mandatory Standard Field / Pflichtfeld</span>
                  </div>
                </span>
              </span>
              <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2ItemPrice_${idx}')" title="Jump to BT-146 in factur-x.xml">?</button>
            </label>
            <input type="number" id="v2ItemPrice_${idx}" step="0.01" class="v2-input" value="${item.unit_price}" oninput="updateV2ItemField(${idx}, 'unit_price', parseFloat(this.value)||0)">
          </div>
          <div class="v2-field">
            <label class="v2-label">
              <span class="v2-label-left">
                Tax Rate / Steuersatz <span class="v2-req-star">*</span>
                <span class="v2-bt-badge" data-bt="BT-151">BT-151
                  <div class="v2-bt-tooltip">
                    <span class="v2-bt-tooltip-title">BT-151 &amp; BT-152: Steuerkategorie &amp; Steuersatz %</span>
                    <div>Tax category code ('S' standard, 'AE' reverse charge) and percentage rate.</div>
                    <span class="v2-bt-tooltip-xml">XML: .../ram:ApplicableTradeTax</span>
                    <span class="v2-bt-tooltip-status req">● Mandatory Standard Field / Pflichtfeld</span>
                  </div>
                </span>
              </span>
              <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2ItemTax_${idx}')" title="Jump to BT-151 in factur-x.xml">?</button>
            </label>
            <select id="v2ItemTax_${idx}" class="v2-select" onchange="handleV2ItemTaxChange(${idx}, this.value)">
              ${getV2ItemTaxOptionsHtml(item)}
            </select>
          </div>
        </div>
        <div style="display: flex; justify-content: flex-end; align-items: center; gap: 1rem; border-top: 1px dashed var(--bg-card-border); padding-top: 0.5rem; margin-top: 0.25rem;">
          <div style="font-size: 0.78rem; color: var(--text-muted); display: inline-flex; align-items: center; gap: 0.4rem;">
            Line Net Total / Positions-Nettobetrag: 
            <span class="v2-bt-badge" data-bt="BT-131">BT-131
              <div class="v2-bt-tooltip">
                <span class="v2-bt-tooltip-title">BT-131: Nettobetrag der Rechnungsposition (Invoice line net amount)</span>
                <div>Total net amount for this line (Qty × Net Price - Discount).</div>
                <span class="v2-bt-tooltip-xml">XML: .../ram:LineTotalAmount</span>
                <span class="v2-bt-tooltip-status req">● Mandatory Standard Field / Pflichtfeld</span>
              </div>
            </span>
            <strong style="color: var(--text-main); font-size: 0.95rem;">€${lineTotal.toFixed(2)}</strong>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  recalcV2Totals();
}

function addV2LineItem() {
  v2LineItems.push({
    name: "New Line Item",
    quantity: 1,
    unit_code: "C62",
    unit_price: 100.0,
    tax_category_code: "S",
    tax_percent: 19.0,
    discount_amount: 0.0,
    discount_percent: null
  });
  renderV2LineItems();
}
window.addV2LineItem = addV2LineItem;

function removeV2LineItem(idx) {
  if (v2LineItems.length <= 1) {
    alert("At least one line item is required.");
    return;
  }
  v2LineItems.splice(idx, 1);
  renderV2LineItems();
}
window.removeV2LineItem = removeV2LineItem;

function updateV2ItemField(idx, field, value) {
  if (v2LineItems[idx]) {
    v2LineItems[idx][field] = value;
    recalcV2Totals();
  }
}
window.updateV2ItemField = updateV2ItemField;

function handleV2ItemTaxChange(idx, valStr) {
  if (valStr === "CUSTOM") {
    const input = prompt("Enter custom tax rate percentage (e.g. 25 or 12.5):", "22.0");
    if (input !== null) {
      const num = parseFloat(input.replace(",", "."));
      if (!isNaN(num) && num >= 0) {
        v2LineItems[idx].tax_percent = num;
        v2LineItems[idx].tax_category_code = num === 0 ? "Z" : "S";
        renderV2LineItems();
        return;
      }
    }
    renderV2LineItems();
    return;
  }

  const parts = valStr.split(":");
  if (v2LineItems[idx] && parts.length === 2) {
    v2LineItems[idx].tax_percent = parseFloat(parts[0]) || 0.0;
    v2LineItems[idx].tax_category_code = parts[1] || "S";
    renderV2LineItems();
  }
}
window.handleV2ItemTaxChange = handleV2ItemTaxChange;

// Helper to generate dynamic, country-aware tax options
function getV2ItemTaxOptionsHtml(item) {
  const sellerCountry = (document.getElementById("v2SellerCountry")?.value || "DE").toUpperCase();
  const settings = window.cachedCompanySettings || {};
  const allConfiguredRates = settings.tax_rates || [
    { country: "SI", rate: 22.0, category: "S", label: "22% DDV Splošna stopnja (SI)" },
    { country: "SI", rate: 9.5, category: "S", label: "9.5% DDV Znižana stopnja (SI)" },
    { country: "SI", rate: 5.0, category: "S", label: "5% DDV Posebna znižana (SI)" },
    { country: "DE", rate: 19.0, category: "S", label: "19% MwSt. Regelsteuersatz (DE)" },
    { country: "DE", rate: 7.0, category: "S", label: "7% MwSt. Ermäßigter Satz (DE)" },
    { country: "AT", rate: 20.0, category: "S", label: "20% USt. Normalsteuersatz (AT)" },
    { country: "AT", rate: 10.0, category: "S", label: "10% USt. Ermäßigt (AT)" },
    { country: "HR", rate: 25.0, category: "S", label: "25% PDV Opća stopa (HR)" },
    { country: "DK", rate: 25.0, category: "S", label: "25% Moms Almindelig (DK)" },
    { country: "FR", rate: 20.0, category: "S", label: "20% TVA Taux normal (FR)" },
    { country: "IT", rate: 22.0, category: "S", label: "22% IVA Ordinaria (IT)" },
    { country: "CH", rate: 8.1, category: "S", label: "8.1% MWST Normalsatz (CH)" },
    { country: "ALL", rate: 0.0, category: "AE", label: "0% Reverse Charge / Obrnjena obveznost (AE)" },
    { country: "ALL", rate: 0.0, category: "E", label: "0% Exempt / Oproščeno (E)" },
    { country: "ALL", rate: 0.0, category: "Z", label: "0% Zero Rated (Z)" }
  ];

  const currentRate = parseFloat(item.tax_percent !== undefined ? item.tax_percent : 19.0);
  const currentCat = item.tax_category_code || (currentRate === 0 ? "AE" : "S");
  const currentKey = `${currentRate.toFixed(1)}:${currentCat}`;

  let matched = false;
  let optionsHtml = "";

  // 1. Matching country rates
  const countryRates = allConfiguredRates.filter(r => r.country === sellerCountry);
  const otherRates = allConfiguredRates.filter(r => r.country !== sellerCountry && r.country !== "ALL");
  const exemptRates = allConfiguredRates.filter(r => r.country === "ALL");

  if (countryRates.length > 0) {
    optionsHtml += `<optgroup label="Rates for ${sellerCountry}">`;
    countryRates.forEach(r => {
      const key = `${parseFloat(r.rate).toFixed(1)}:${r.category}`;
      const isSelected = key === currentKey;
      if (isSelected) matched = true;
      optionsHtml += `<option value="${key}" ${isSelected ? "selected" : ""}>${escapeHtml(r.label || `${r.rate}% (${r.category})`)}</option>`;
    });
    optionsHtml += `</optgroup>`;
  }

  // 2. Common / Zero / Reverse Charge
  if (exemptRates.length > 0) {
    optionsHtml += `<optgroup label="Exempt / Reverse Charge">`;
    exemptRates.forEach(r => {
      const key = `${parseFloat(r.rate).toFixed(1)}:${r.category}`;
      const isSelected = key === currentKey;
      if (isSelected) matched = true;
      optionsHtml += `<option value="${key}" ${isSelected ? "selected" : ""}>${escapeHtml(r.label || `${r.rate}% (${r.category})`)}</option>`;
    });
    optionsHtml += `</optgroup>`;
  }

  // 3. Other European rates
  if (otherRates.length > 0) {
    optionsHtml += `<optgroup label="Other European Rates">`;
    otherRates.forEach(r => {
      const key = `${parseFloat(r.rate).toFixed(1)}:${r.category}`;
      const isSelected = key === currentKey;
      if (isSelected) matched = true;
      optionsHtml += `<option value="${key}" ${isSelected ? "selected" : ""}>${escapeHtml(r.label || `${r.rate}% (${r.category})`)}</option>`;
    });
    optionsHtml += `</optgroup>`;
  }

  // 4. If current extracted rate was not in the configured list, inject it dynamically at top!
  if (!matched) {
    const customKey = `${currentRate.toFixed(1)}:${currentCat}`;
    const customOpt = `<optgroup label="Document Extracted Rate"><option value="${customKey}" selected>★ ${currentRate}% (${currentCat}) [From Document]</option></optgroup>`;
    optionsHtml = customOpt + optionsHtml;
  }

  optionsHtml += `<option value="CUSTOM">➕ Custom Tax Rate...</option>`;

  return optionsHtml;
}
window.getV2ItemTaxOptionsHtml = getV2ItemTaxOptionsHtml;

// ================= DOCUMENT-LEVEL DISCOUNTS =================
function initV2DocumentDiscounts() {
  renderV2DocumentDiscounts();
}

function renderV2DocumentDiscounts() {
  const container = document.getElementById("v2DiscountsContainer");
  if (!container) return;

  if (v2DocumentDiscounts.length === 0) {
    container.innerHTML = `
      <div id="v2NoDiscountsMsg" style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; padding: 0.5rem 0;">
        No document-level discounts or charges applied. Click "+ Add Discount" or "+ Add Charge" to add allowances/surcharges.
      </div>
    `;
    recalcV2Totals();
    return;
  }

  container.innerHTML = "";
  v2DocumentDiscounts.forEach((disc, idx) => {
    const isCharge = Boolean(disc.charge_indicator);
    const card = document.createElement("div");
    card.className = "v2-discount-card";
    if (isCharge) {
      card.style.borderColor = "rgba(16, 185, 129, 0.35)";
    }
    const badgeLabel = isCharge ? `📈 Charge #${idx + 1} (Zuschlag / BT-99)` : `🏷️ Discount #${idx + 1} (Nachlass / BT-92)`;
    const reasonBt = isCharge ? "BT-104" : "BT-97";
    const reasonTitle = isCharge ? "BT-104: Grund für den Zuschlag (Document level charge reason)" : "BT-97: Grund für den Nachlass (Document level allowance reason)";
    const pctBt = isCharge ? "BT-101" : "BT-94";
    const pctTitle = isCharge ? "BT-101: Zuschlagsprozentsatz (Document level charge percentage)" : "BT-94: Nachlassprozentsatz (Document level allowance percentage)";
    const amtBt = isCharge ? "BT-99" : "BT-92";
    const amtTitle = isCharge ? "BT-99: Zuschlagsbetrag auf Dokumentenebene (Document level charge amount)" : "BT-92: Nachlassbetrag auf Dokumentenebene (Document level allowance amount)";

    card.innerHTML = `
      <div class="v2-discount-topbar">
        <div class="v2-discount-title" style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="${isCharge ? 'color: #10b981; font-weight: 600;' : ''}">${badgeLabel}</span>
          <select class="v2-select" style="width: auto; padding: 0.2rem 0.5rem; font-size: 0.75rem;" onchange="updateV2DiscountField(${idx}, 'charge_indicator', this.value === 'charge')">
            <option value="allowance" ${!isCharge ? 'selected' : ''}>Allowance / Discount (-)</option>
            <option value="charge" ${isCharge ? 'selected' : ''}>Charge / Surcharge (+)</option>
          </select>
        </div>
        <button type="button" class="v2-item-trash" onclick="removeV2DocumentDiscount(${idx})" title="Remove">🗑️</button>
      </div>
      <div class="v2-grid-3">
        <div class="v2-field" style="grid-column: span 1;">
          <label class="v2-label">
            <span class="v2-label-left">
              Reason / Grund
              <span class="v2-bt-badge" data-bt="${reasonBt}">${reasonBt}
                <div class="v2-bt-tooltip">
                  <span class="v2-bt-tooltip-title">${reasonTitle}</span>
                  <div>Textual reason for the document-level adjustment.</div>
                  <span class="v2-bt-tooltip-xml">XML: .../ram:SpecifiedTradeAllowanceCharge/ram:Reason</span>
                  <span class="v2-bt-tooltip-status opt">Optional / Bedingt</span>
                </div>
              </span>
            </span>
            <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2DiscountReason_${idx}')" title="Jump to ${reasonBt} in factur-x.xml">?</button>
          </label>
          <input type="text" id="v2DiscountReason_${idx}" class="v2-input" value="${escapeHtml(disc.reason || "")}" placeholder="${isCharge ? 'e.g. Packaging, Freight, Handling' : 'e.g. Early payment rebate or Loyalty'}" oninput="updateV2DiscountField(${idx}, 'reason', this.value)">
        </div>
        <div class="v2-field">
          <label class="v2-label">
            <span class="v2-label-left">
              ${isCharge ? 'Charge % / Prozentsatz' : 'Discount % / Prozentsatz'}
              <span class="v2-bt-badge" data-bt="${pctBt}">${pctBt}
                <div class="v2-bt-tooltip">
                  <span class="v2-bt-tooltip-title">${pctTitle}</span>
                  <div>Percentage rate of the document-level adjustment.</div>
                  <span class="v2-bt-tooltip-xml">XML: .../ram:SpecifiedTradeAllowanceCharge/ram:CalculationPercent</span>
                  <span class="v2-bt-tooltip-status opt">Optional / Bedingt</span>
                </div>
              </span>
            </span>
            <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2DiscountPct_${idx}')" title="Jump to ${pctBt} in factur-x.xml">?</button>
          </label>
          <input type="number" id="v2DiscountPct_${idx}" step="0.1" min="0" max="100" class="v2-input" value="${disc.percentage !== null && disc.percentage !== undefined ? disc.percentage : ''}" placeholder="e.g. 5" oninput="handleV2DiscountPercentChange(${idx}, this.value)">
        </div>
        <div class="v2-field">
          <label class="v2-label">
            <span class="v2-label-left">
              ${isCharge ? 'Charge Amount (€) / Betrag' : 'Discount Amount (€) / Betrag'} <span class="v2-req-star">*</span>
              <span class="v2-bt-badge" data-bt="${amtBt}">${amtBt}
                <div class="v2-bt-tooltip">
                  <span class="v2-bt-tooltip-title">${amtTitle}</span>
                  <div>The actual monetary amount of the adjustment.</div>
                  <span class="v2-bt-tooltip-xml">XML: .../ram:SpecifiedTradeAllowanceCharge/ram:ActualAmount</span>
                  <span class="v2-bt-tooltip-status req">● Mandatory Standard Field / Pflichtfeld</span>
                </div>
              </span>
            </span>
            <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2DiscountAmount_${idx}')" title="Jump to ${amtBt} in factur-x.xml">?</button>
          </label>
          <input type="number" id="v2DiscountAmount_${idx}" step="0.01" min="0" class="v2-input" value="${disc.amount || 0}" placeholder="0.00" oninput="updateV2DiscountField(${idx}, 'amount', parseFloat(this.value)||0)">
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  recalcV2Totals();
}

function addV2DocumentDiscount(isCharge = false) {
  v2DocumentDiscounts.push({
    reason: isCharge ? "Packaging / Freight" : "Document Discount",
    percentage: null,
    amount: 0.0,
    charge_indicator: Boolean(isCharge)
  });
  renderV2DocumentDiscounts();
}
window.addV2DocumentDiscount = addV2DocumentDiscount;

function removeV2DocumentDiscount(idx) {
  v2DocumentDiscounts.splice(idx, 1);
  renderV2DocumentDiscounts();
}
window.removeV2DocumentDiscount = removeV2DocumentDiscount;

function updateV2DiscountField(idx, field, val) {
  if (v2DocumentDiscounts[idx]) {
    v2DocumentDiscounts[idx][field] = val;
    if (field === 'charge_indicator') {
      renderV2DocumentDiscounts();
    } else {
      recalcV2Totals();
    }
  }
}
window.updateV2DiscountField = updateV2DiscountField;

function handleV2DiscountPercentChange(idx, pctVal) {
  if (!v2DocumentDiscounts[idx]) return;
  const pct = parseFloat(pctVal);
  if (!isNaN(pct) && pct > 0) {
    v2DocumentDiscounts[idx].percentage = pct;
    // Calculate amount from net line items
    let itemsNet = 0;
    v2LineItems.forEach(it => {
      itemsNet += Math.max(0, (it.quantity * it.unit_price) - (it.discount_amount || 0));
    });
    const calculatedAmt = Math.round(itemsNet * (pct / 100) * 100) / 100;
    v2DocumentDiscounts[idx].amount = calculatedAmt;
  } else {
    v2DocumentDiscounts[idx].percentage = null;
  }
  renderV2DocumentDiscounts();
}
window.handleV2DiscountPercentChange = handleV2DiscountPercentChange;

// 4b. Dynamic Document Notes (<ram:IncludedNote> / BT-22)
function initV2InvoiceNotes() {
  renderV2InvoiceNotes();
}

function renderV2InvoiceNotes() {
  const container = document.getElementById("v2NotesContainer");
  if (!container) return;
  container.innerHTML = "";

  if (!v2ExtractedNotes || v2ExtractedNotes.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.76rem; color: var(--text-muted); font-style: italic; padding: 0.4rem 0.6rem; background: var(--bg-input); border-radius: 6px; border: 1px dashed var(--bg-card-border);">
        No document notes added. Click "+ Add Note" to include performance notices, delivery terms, or legal remarks.
      </div>
    `;
    return;
  }

  v2ExtractedNotes.forEach((noteText, idx) => {
    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; gap: 0.5rem;";
    row.innerHTML = `
      <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; width: 1.5rem; text-align: center;">#${idx + 1}</span>
      <input type="text" class="v2-input" style="flex: 1;" value="${escapeHtml(noteText || '')}" 
             placeholder="e.g. Wir berechnen 100% gemäß beigefügter Musterprüfberichte"
             oninput="updateV2InvoiceNoteField(${idx}, this.value)">
      <button type="button" class="v2-item-trash" onclick="removeV2InvoiceNote(${idx})" title="Remove this note">🗑️</button>
    `;
    container.appendChild(row);
  });
}

function addV2InvoiceNote(text = "") {
  if (!Array.isArray(v2ExtractedNotes)) v2ExtractedNotes = [];
  v2ExtractedNotes.push(text);
  renderV2InvoiceNotes();
  if (typeof updateV2LiveXml === "function") {
    updateV2LiveXml();
  }
}
window.addV2InvoiceNote = addV2InvoiceNote;

function removeV2InvoiceNote(idx) {
  if (!Array.isArray(v2ExtractedNotes)) return;
  v2ExtractedNotes.splice(idx, 1);
  renderV2InvoiceNotes();
  if (typeof updateV2LiveXml === "function") {
    updateV2LiveXml();
  }
}
window.removeV2InvoiceNote = removeV2InvoiceNote;

function updateV2InvoiceNoteField(idx, val) {
  if (Array.isArray(v2ExtractedNotes) && v2ExtractedNotes[idx] !== undefined) {
    v2ExtractedNotes[idx] = val;
    if (typeof updateV2LiveXml === "function") {
      updateV2LiveXml();
    }
  }
}
window.updateV2InvoiceNoteField = updateV2InvoiceNoteField;

// 5. Dynamic Calculations & Tax Matrix
function recalcV2Totals() {
  let lineNetTotal = 0;
  const taxGroups = {};
  let hasExemption = false;

  v2LineItems.forEach(it => {
    const lineNet = Math.max(0, (it.quantity * it.unit_price) - (it.discount_amount || 0));
    lineNetTotal += lineNet;

    const rateKey = `${it.tax_category_code}_${it.tax_percent}`;
    if (!taxGroups[rateKey]) {
      taxGroups[rateKey] = {
        category: it.tax_category_code,
        rate: it.tax_percent,
        basis: 0,
        tax: 0
      };
    }
    taxGroups[rateKey].basis += lineNet;
    taxGroups[rateKey].tax += Math.round(lineNet * (it.tax_percent / 100) * 100) / 100;

    if (it.tax_category_code === "E") hasExemption = true;
  });

  // Calculate document-level allowances (BT-92) and charges (BT-99)
  let totalDocAllowance = 0;
  let totalDocCharge = 0;
  v2DocumentDiscounts.forEach(d => {
    const amt = Math.max(0, parseFloat(d.amount) || 0);
    if (d.charge_indicator) {
      totalDocCharge += amt;
    } else {
      totalDocAllowance += amt;
    }
  });

  const netAdjustment = totalDocCharge - totalDocAllowance;
  const taxableNet = Math.max(0, lineNetTotal + netAdjustment);

  // If there are document allowances or charges, adjust tax basis proportionally across groups
  let totalTax = 0;
  const matrixContainer = document.getElementById("v2TaxMatrixContainer");
  if (matrixContainer) {
    matrixContainer.innerHTML = "";
    Object.values(taxGroups).forEach(grp => {
      // Pro-rate adjustment if lines exist
      const groupRatio = lineNetTotal > 0 ? (grp.basis / lineNetTotal) : 0;
      const effectiveGroupBasis = Math.max(0, grp.basis + (netAdjustment * groupRatio));
      const effectiveGroupTax = Math.round(effectiveGroupBasis * (grp.rate / 100) * 100) / 100;
      grp.tax = effectiveGroupTax;
      totalTax += effectiveGroupTax;

      const tile = document.createElement("div");
      tile.className = "v2-tax-tile";
      tile.innerHTML = `
        <div class="v2-tax-tile-label">${grp.rate}% (${grp.category})</div>
        <div class="v2-tax-tile-val">€${effectiveGroupTax.toFixed(2)}</div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">Base: €${effectiveGroupBasis.toFixed(2)}</div>
      `;
      matrixContainer.appendChild(tile);
    });
  }

  // Prepayment deduction
  const prepaidEl = document.getElementById("v2PrepaidAmount");
  const prepaidAmount = parseFloat(prepaidEl?.value) || 0.0;

  const grandTotal = Math.round((taxableNet + totalTax) * 100) / 100;
  const dueAmount = Math.max(0, Math.round((grandTotal - prepaidAmount) * 100) / 100);

  // Update KPI strip
  const setTxt = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setTxt("v2TotalNet", `€${lineNetTotal.toFixed(2)}`);
  
  // Allowance (BT-107)
  const discountWrapper = document.getElementById("v2TotalDiscountWrapper");
  if (discountWrapper) {
    if (totalDocAllowance > 0) {
      discountWrapper.style.display = "block";
      setTxt("v2TotalDiscount", `-€${totalDocAllowance.toFixed(2)}`);
    } else {
      discountWrapper.style.display = "none";
    }
  }

  // Charge (BT-108)
  const chargeWrapper = document.getElementById("v2TotalChargeWrapper");
  if (chargeWrapper) {
    if (totalDocCharge > 0) {
      chargeWrapper.style.display = "block";
      setTxt("v2TotalCharge", `+€${totalDocCharge.toFixed(2)}`);
    } else {
      chargeWrapper.style.display = "none";
    }
  }

  setTxt("v2TotalVat", `€${totalTax.toFixed(2)}`);
  setTxt("v2GrandTotal", `€${grandTotal.toFixed(2)}`);
  setTxt("v2DuePayable", `€${dueAmount.toFixed(2)}`);

  // Reveal exemption input if category E present
  const exCard = document.getElementById("v2ExemptionCard");
  if (exCard) exCard.style.display = hasExemption ? "block" : "none";
}
window.recalcV2Totals = recalcV2Totals;

// ================= AI CONFIDENCE BADGES (STUDIO V2) =================
function applyV2ConfidenceScores(scores) {
  if (!scores) return;

  // Map AI confidence scores to form fields
  const fieldMapping = {
    "v2InvNumber": scores.invoice_number || "HIGH",
    "v2IssueDate": scores.issue_date || "HIGH",
    "v2DueDate": scores.due_date || (document.getElementById("v2DueDate")?.value ? "HIGH" : "MEDIUM"),
    "v2Currency": scores.currency || "HIGH",
    "v2BuyerRef": scores.buyer_reference || (document.getElementById("v2BuyerRef")?.value ? "MEDIUM" : "LOW"),
    "v2SellerName": scores.seller_name || "HIGH",
    "v2SellerVat": scores.seller_vat || "HIGH",
    "v2SellerTaxNumber": scores.seller_tax_number || "HIGH",
    "v2SellerStreet": scores.seller_street || "HIGH",
    "v2SellerCity": scores.seller_city || "HIGH",
    "v2SellerPostcode": scores.seller_postcode || scores.seller_city || "HIGH",
    "v2BuyerName": scores.buyer_name || "HIGH",
    "v2BuyerVat": scores.buyer_vat || "HIGH",
    "v2BuyerStreet": scores.buyer_street || "HIGH",
    "v2BuyerCity": scores.buyer_city || "HIGH",
    "v2BuyerPostcode": scores.buyer_city || "HIGH",
    "v2PayIban": scores.iban || scores.payment_iban || "HIGH",
    "v2PayBic": scores.bic || scores.payment_bic || "HIGH"
  };

  Object.entries(fieldMapping).forEach(([inputId, rawConfidence]) => {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    const parentField = inputEl.closest(".v2-field");
    if (!parentField) return;

    const labelEl = parentField.querySelector("label");
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
      inputEl.title = "AI Confidence is LOW - Please check uploaded document to verify this value";
    } else if (conf === "MEDIUM") {
      inputEl.classList.add("input-conf-medium");
      inputEl.title = "AI Confidence is MEDIUM - Review suggested";
    } else {
      inputEl.title = "AI Confidence is HIGH";
    }
  });
}
window.applyV2ConfidenceScores = applyV2ConfidenceScores;

// ================= SAVED PARTIES MANAGEMENT IN V2 =================
function loadV2SavedPartiesDropdowns() {
  const settings = window.cachedCompanySettings || {};
  const parties = settings.saved_parties || { sellers: [], buyers: [] };
  const sellers = parties.sellers || [];
  const buyers = parties.buyers || [];

  const sellerSelect = document.getElementById("v2SavedSellerSelect");
  if (sellerSelect) {
    sellerSelect.innerHTML = `<option value="">-- Select saved company --</option>`;
    sellers.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.vat_id || s.city || 'Saved'})`;
      sellerSelect.appendChild(opt);
    });
  }

  const buyerSelect = document.getElementById("v2SavedBuyerSelect");
  if (buyerSelect) {
    buyerSelect.innerHTML = `<option value="">-- Select saved customer --</option>`;
    buyers.forEach(b => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = `${b.name} (${b.vat_id || b.city || 'Saved'})`;
      buyerSelect.appendChild(opt);
    });
  }
}
window.loadV2SavedPartiesDropdowns = loadV2SavedPartiesDropdowns;

async function saveV2Party(type) {
  const isSeller = type === "seller";
  const nameEl = document.getElementById(isSeller ? "v2SellerName" : "v2BuyerName");
  const name = nameEl?.value.trim();

  if (!name) {
    alert(`Please enter a ${isSeller ? "Seller" : "Buyer"} Company Name before saving.`);
    return;
  }

  const partyData = {
    id: "party_" + Date.now().toString(36),
    name: name,
    vat_id: document.getElementById(isSeller ? "v2SellerVat" : "v2BuyerVat")?.value.trim() || "",
    street: document.getElementById(isSeller ? "v2SellerStreet" : "v2BuyerStreet")?.value.trim() || "",
    city: document.getElementById(isSeller ? "v2SellerCity" : "v2BuyerCity")?.value.trim() || "",
    postcode: document.getElementById(isSeller ? "v2SellerPostcode" : "v2BuyerPostcode")?.value.trim() || "",
    country_code: document.getElementById(isSeller ? "v2SellerCountry" : "v2BuyerCountry")?.value || "DE"
  };

  if (isSeller) {
    partyData.phone = document.getElementById("v2SellerPhone")?.value.trim() || "";
    partyData.email = document.getElementById("v2SellerEmail")?.value.trim() || "";
    partyData.tax_number = document.getElementById("v2SellerTaxNumber")?.value.trim() || "";
    partyData.iban = document.getElementById("v2PayIban")?.value.trim() || "";
    partyData.bic = document.getElementById("v2PayBic")?.value.trim() || "";
  }

  const settings = window.cachedCompanySettings || {};
  if (!settings.saved_parties) settings.saved_parties = { sellers: [], buyers: [] };

  const listKey = isSeller ? "sellers" : "buyers";
  if (!settings.saved_parties[listKey]) settings.saved_parties[listKey] = [];

  // Check if already exists by name or vat_id and update or append
  const existingIdx = settings.saved_parties[listKey].findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  if (existingIdx >= 0) {
    partyData.id = settings.saved_parties[listKey][existingIdx].id;
    settings.saved_parties[listKey][existingIdx] = partyData;
  } else {
    settings.saved_parties[listKey].push(partyData);
  }

  window.cachedCompanySettings = settings;
  localStorage.setItem("ZUGFERD_COMPANY_SETTINGS", JSON.stringify(settings));

  try {
    await fetch("/api/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: settings })
    });
  } catch (err) {
    console.warn("Could not save party to server:", err);
  }

  loadV2SavedPartiesDropdowns();
  if (typeof renderSavedPartiesConfig === "function") {
    renderSavedPartiesConfig();
  }

  alert(`✅ Saved "${name}" into ${isSeller ? "Sellers" : "Buyers"} directory! You can manage it anytime in Configuration.`);
}
window.saveV2Party = saveV2Party;

function selectV2SavedParty(type, partyId) {
  if (!partyId) return;
  const settings = window.cachedCompanySettings || {};
  const parties = settings.saved_parties || { sellers: [], buyers: [] };
  const list = type === "seller" ? (parties.sellers || []) : (parties.buyers || []);
  const party = list.find(p => p.id === partyId);
  if (!party) return;

  const isSeller = type === "seller";
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };

  setVal(isSeller ? "v2SellerName" : "v2BuyerName", party.name);
  setVal(isSeller ? "v2SellerVat" : "v2BuyerVat", party.vat_id);
  setVal(isSeller ? "v2SellerStreet" : "v2BuyerStreet", party.street);
  setVal(isSeller ? "v2SellerCity" : "v2BuyerCity", party.city);
  setVal(isSeller ? "v2SellerPostcode" : "v2BuyerPostcode", party.postcode);
  setVal(isSeller ? "v2SellerCountry" : "v2BuyerCountry", party.country_code || "DE");

  if (isSeller) {
    if (party.phone) setVal("v2SellerPhone", party.phone);
    if (party.email) setVal("v2SellerEmail", party.email);
    if (party.tax_number) setVal("v2SellerTaxNumber", party.tax_number);
    if (party.iban) setVal("v2PayIban", party.iban);
    if (party.bic) setVal("v2PayBic", party.bic);
  }
}
window.selectV2SavedParty = selectV2SavedParty;

// 6. AI Prefill Upload (Dropzone at top)
async function handleV2PrefillUpload(file) {
  if (!file) return;
  const banner = document.getElementById("v2PrefillBanner");
  const bannerTitle = document.getElementById("v2PrefillTitle");
  const bannerDesc = document.getElementById("v2PrefillDesc");

  if (banner) {
    banner.style.opacity = "0.7";
    banner.style.pointerEvents = "none";
    banner.style.borderStyle = "solid";
    banner.style.borderColor = "var(--accent)";
  }
  if (bannerTitle) bannerTitle.textContent = `⏳ Extracting ${file.name} with AI...`;
  if (bannerDesc) bannerDesc.textContent = "Uploading document and contacting GPT-4o parser (may take 5-10s)...";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const upRes = await fetch("/api/upload", { method: "POST", body: formData });
    const upData = await upRes.json();
    if (!upRes.ok) throw new Error(upData.detail || "Upload failed");

    v2UploadedFileId = upData.file_id;
    v2UploadedFileName = file.name;

    const apiKey = (typeof getStoredApiKey === "function" ? getStoredApiKey() : "") || undefined;
    const promptId = window.cachedCompanySettings?.active_prompt_id || undefined;
    const extRes = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: upData.file_id, api_key: apiKey, prompt_id: promptId })
    });
    const extData = await extRes.json();
    if (!extRes.ok) throw new Error(extData.detail || "Extraction failed");

    // Populate v2 form
    const inv = extData.invoice_data;
    v2TokenUsage = extData.usage || null;
    const rawNotes = inv.invoice_notes || inv.notes || [];
    v2ExtractedNotes = Array.isArray(rawNotes) ? rawNotes.filter(n => n && String(n).trim().length > 0) : [];
    renderV2InvoiceNotes();

    if (inv.invoice_number) document.getElementById("v2InvNumber").value = inv.invoice_number;
    if (inv.issue_date) document.getElementById("v2IssueDate").value = inv.issue_date;
    if (inv.due_date) document.getElementById("v2DueDate").value = inv.due_date;
    if (inv.currency) document.getElementById("v2Currency").value = inv.currency;
    if (inv.buyer_reference) document.getElementById("v2BuyerRef").value = inv.buyer_reference;
    if (inv.purchase_order_number) {
      const poEl = document.getElementById("v2PurchaseOrder");
      if (poEl) poEl.value = inv.purchase_order_number;
    }
    if (inv.preceding_invoice_number) {
      const precEl = document.getElementById("v2PrecedingInvNumber");
      if (precEl) precEl.value = inv.preceding_invoice_number;
      const precDateEl = document.getElementById("v2PrecedingInvDate");
      if (precDateEl && inv.preceding_invoice_date) precDateEl.value = inv.preceding_invoice_date;
    }
    if (inv.prepaid_amount) {
      const prepEl = document.getElementById("v2PrepaidAmount");
      if (prepEl) prepEl.value = inv.prepaid_amount;
    }
    if (inv.invoice_type_code) {
      const dtEl = document.getElementById("v2DocTypeSelect");
      if (dtEl) {
        dtEl.value = inv.invoice_type_code;
        if (typeof handleV2DocTypeChange === "function") handleV2DocTypeChange(inv.invoice_type_code);
      }
    }

    // Seller details: AI recognised by default from document extraction; fallback to saved config only if absent
    const cfg = window.cachedCompanySettings || {};
    const seller = inv.seller || {};
    document.getElementById("v2SellerName").value = seller.name || cfg.seller_name || "";
    document.getElementById("v2SellerVat").value = seller.vat_id || cfg.seller_vat || "";
    document.getElementById("v2SellerTaxNumber").value = seller.tax_number || seller.tax_registration_id || cfg.seller_tax_number || "";
    document.getElementById("v2SellerStreet").value = seller.street || cfg.seller_street || "";
    document.getElementById("v2SellerCity").value = seller.city || cfg.seller_city || "";
    document.getElementById("v2SellerPostcode").value = seller.postcode || cfg.seller_postcode || "";
    document.getElementById("v2SellerCountry").value = seller.country_code || cfg.seller_country || "DE";
    if (seller.contact_phone || cfg.seller_phone) {
      document.getElementById("v2SellerPhone").value = seller.contact_phone || cfg.seller_phone || "";
    }
    if (seller.contact_email || cfg.seller_email) {
      const emailEl = document.getElementById("v2SellerEmail");
      if (emailEl) emailEl.value = seller.contact_email || cfg.seller_email || "";
    }

    // Payment details & IBAN (BT-84): AI extracted from document by default
    const extractedIban = inv.payment?.iban || inv.iban || "";
    const extractedBic = inv.payment?.bic || inv.bic || "";
    if (extractedIban) {
      document.getElementById("v2PayIban").value = extractedIban;
    } else if (cfg.seller_bank1_iban) {
      document.getElementById("v2PayIban").value = cfg.seller_bank1_iban;
    }

    if (extractedBic) {
      document.getElementById("v2PayBic").value = extractedBic;
      const bicWrapper = document.getElementById("v2BicFieldWrapper");
      if (bicWrapper) bicWrapper.style.display = "block";
    } else if (cfg.seller_bank1_bic) {
      document.getElementById("v2PayBic").value = cfg.seller_bank1_bic;
    }

    // Payment terms note
    if (inv.payment?.payment_terms) {
      const payTermsEl = document.getElementById("v2PayTerms");
      if (payTermsEl) payTermsEl.value = inv.payment.payment_terms;
    }

    // Buyer details: Dynamic from extraction payload
    if (inv.buyer?.name) document.getElementById("v2BuyerName").value = inv.buyer.name;
    if (inv.buyer?.vat_id) document.getElementById("v2BuyerVat").value = inv.buyer.vat_id;
    if (inv.buyer?.street) document.getElementById("v2BuyerStreet").value = inv.buyer.street;
    if (inv.buyer?.city) document.getElementById("v2BuyerCity").value = inv.buyer.city;
    if (inv.buyer?.postcode) document.getElementById("v2BuyerPostcode").value = inv.buyer.postcode;
    if (inv.buyer?.country_code) document.getElementById("v2BuyerCountry").value = inv.buyer.country_code;

    // Delivery & Logistics (BG-13): Auto-populate and expand section if present
    if (inv.delivery) {
      if (inv.delivery.recipient_name) document.getElementById("v2DelivName").value = inv.delivery.recipient_name;
      
      let locId = inv.delivery.location_id || "";
      if (!locId && inv.delivery.recipient_name) {
        const mLoc = inv.delivery.recipient_name.match(/Abladestelle(?:\s+Nr\.?)?\s*([A-Za-z0-9\-_]+)/i);
        if (mLoc) locId = mLoc[1];
      }
      if (locId) {
        // Strip non-identifier text if present (e.g., 'Abladestelle Nr. 960' -> '960')
        const cleanLoc = locId.replace(/^.*?(?:Abladestelle|Tor|Gate|Dock)(?:\s+Nr\.?)?\s*/i, "").trim();
        document.getElementById("v2DelivLocationId").value = cleanLoc || locId;
      }

      if (inv.delivery.delivery_date) document.getElementById("v2DelivDate").value = inv.delivery.delivery_date;
      
      const rawDespatch = inv.delivery.despatch_advice_reference || inv.delivery.despatch_advice_id || "";
      const cleanedDespatch = rawDespatch.trim().replace(/^[-:\s]+/, "").trim();
      const bannedLabels = [
        "lieferdatum", "lieferschein", "lieferschein-nr", "nr", "-nr", "bestell-nr", 
        "kundennummer", "kontakt", "lieferanten-nr", "datum", "none", "null", ""
      ];
      const hasDigit = /\d/.test(cleanedDespatch);
      const isBogusDespatch = bannedLabels.includes(cleanedDespatch.toLowerCase()) || !hasDigit || cleanedDespatch.length < 3;
      if (!isBogusDespatch) {
        document.getElementById("v2DelivDespatchRef").value = cleanedDespatch;
      } else {
        document.getElementById("v2DelivDespatchRef").value = "";
      }

      
      if (inv.delivery.street) document.getElementById("v2DelivStreet").value = inv.delivery.street;
      if (inv.delivery.postcode) document.getElementById("v2DelivPostcode").value = inv.delivery.postcode;
      if (inv.delivery.city) document.getElementById("v2DelivCity").value = inv.delivery.city;
      if (inv.delivery.country_code) document.getElementById("v2DelivCountry").value = inv.delivery.country_code;

      const delivSection = document.getElementById("v2DeliverySection");
      if (delivSection && (inv.delivery.recipient_name || inv.delivery.delivery_date || locId || despatchRef)) {
        delivSection.style.display = "block";
      }
    }

    // Line items
    if (inv.items && inv.items.length > 0) {
      v2LineItems = inv.items.map(it => ({
        name: it.name || "Item",
        quantity: it.quantity || 1,
        unit_code: it.unit_code || "C62",
        unit_price: it.unit_price || 0,
        tax_category_code: it.tax_category_code || "S",
        tax_percent: it.tax_percent !== undefined ? it.tax_percent : 19.0,
        discount_amount: it.discount_amount || 0.0,
        discount_percent: it.discount_percent || null
      }));
      renderV2LineItems();
    }

    // Discounts & Charges
    if (inv.discounts && inv.discounts.length > 0) {
      v2DocumentDiscounts = inv.discounts.map(d => ({
        reason: d.reason || (d.charge_indicator ? "Packaging / Charge" : "Document Discount"),
        percentage: d.percentage || null,
        amount: d.amount || 0.0,
        charge_indicator: Boolean(d.charge_indicator)
      }));
      renderV2DocumentDiscounts();
    } else {
      v2DocumentDiscounts = [];
      renderV2DocumentDiscounts();
    }

    // Apply confidence badges like in v1
    if (inv.confidence_scores) {
      applyV2ConfidenceScores(inv.confidence_scores);
    }

    if (bannerTitle) bannerTitle.textContent = `✅ Prefilled from ${file.name}!`;
    if (bannerDesc) bannerDesc.textContent = "Values have been populated into the fields below with AI confidence indicators.";

    // If XML viewer is open or cached, update live XML
    if (typeof updateV2LiveXml === "function") {
      updateV2LiveXml();
    }
  } catch (err) {
    alert("Prefill error: " + err.message);
    if (bannerTitle) bannerTitle.textContent = "Have an existing invoice or XML document?";
    if (bannerDesc) bannerDesc.textContent = "Upload a PDF, Word, or e-SLOG XML file to prefill the form";
  } finally {
    if (banner) {
      banner.style.opacity = "1";
      banner.style.pointerEvents = "auto";
      banner.style.borderStyle = "dashed";
      banner.style.borderColor = "";
    }
  }
}
window.handleV2PrefillUpload = handleV2PrefillUpload;

// 7. Validate & Generate Invoice
function harvestV2InvoiceData() {
  const docType = document.getElementById("v2DocTypeSelect")?.value || "380";
  const isOrderX = docType === "orderx";

  let lineNetTotal = 0;
  const taxBreakdownMap = {};

  const items = v2LineItems.map((it, idx) => {
    const lineNet = Math.max(0, (it.quantity * it.unit_price) - (it.discount_amount || 0));
    lineNetTotal += lineNet;

    const rateKey = `${it.tax_category_code}_${it.tax_percent}`;
    if (!taxBreakdownMap[rateKey]) {
      taxBreakdownMap[rateKey] = {
        tax_category_code: it.tax_category_code,
        tax_percent: it.tax_percent,
        basis_amount: 0,
        tax_amount: 0,
        exemption_reason: it.tax_category_code === "E" ? (document.getElementById("v2ExemptionReason")?.value || "Small business exemption") : null
      };
    }
    taxBreakdownMap[rateKey].basis_amount += lineNet;

    return {
      line_id: String(idx + 1),
      name: it.name,
      quantity: it.quantity,
      unit_code: it.unit_code,
      unit_price: it.unit_price,
      line_total_amount: lineNet,
      tax_category_code: it.tax_category_code,
      tax_percent: it.tax_percent,
      discount_amount: it.discount_amount || 0.0
    };
  });

  // Calculate allowances and charges & adjusted tax
  let totalDocAllowance = 0;
  let totalDocCharge = 0;
  const docDiscounts = v2DocumentDiscounts
    .filter(d => (parseFloat(d.amount) || 0) > 0)
    .map(d => {
      const isCharge = Boolean(d.charge_indicator);
      const amt = parseFloat(d.amount) || 0.0;
      if (isCharge) {
        totalDocCharge += amt;
      } else {
        totalDocAllowance += amt;
      }
      return {
        reason: d.reason || (isCharge ? "Packaging / Charge" : "Document Discount"),
        percentage: d.percentage !== null && d.percentage !== undefined ? parseFloat(d.percentage) : null,
        amount: amt,
        charge_indicator: isCharge
      };
    });

  const netAdjustment = totalDocCharge - totalDocAllowance;
  let taxTotal = 0;
  Object.values(taxBreakdownMap).forEach(grp => {
    const groupRatio = lineNetTotal > 0 ? (grp.basis_amount / lineNetTotal) : 0;
    const effectiveBasis = Math.max(0, grp.basis_amount + (netAdjustment * groupRatio));
    const effectiveTax = Math.round(effectiveBasis * (grp.tax_percent / 100) * 100) / 100;
    grp.basis_amount = effectiveBasis;
    grp.tax_amount = effectiveTax;
    taxTotal += effectiveTax;
  });

  const taxableNet = Math.max(0, lineNetTotal + netAdjustment);
  const prepaidAmount = parseFloat(document.getElementById("v2PrepaidAmount")?.value) || 0.0;
  const grandTotal = Math.round((taxableNet + taxTotal) * 100) / 100;
  const dueAmount = Math.max(0, Math.round((grandTotal - prepaidAmount) * 100) / 100);

  // Harvest clean invoice notes from user input rows
  const cleanNotes = (v2ExtractedNotes || [])
    .map(n => (typeof n === "string" ? n.trim() : String(n || "").trim()))
    .filter(n => n.length > 0 && !n.includes("ZUGFeRD PDF/A-3 Generator"));

  return {
    invoice_number: document.getElementById("v2InvNumber")?.value.trim() || "",
    issue_date: document.getElementById("v2IssueDate")?.value || "",
    due_date: document.getElementById("v2DueDate")?.value || null,
    currency: document.getElementById("v2Currency")?.value || "EUR",
    invoice_type_code: isOrderX ? "220" : docType,
    document_format: isOrderX ? "orderx" : "zugferd",
    buyer_reference: document.getElementById("v2BuyerRef")?.value.trim() || "",
    purchase_order_number: document.getElementById("v2PurchaseOrder")?.value.trim() || null,
    preceding_invoice_number: document.getElementById("v2PrecedingInvNumber")?.value.trim() || null,
    preceding_invoice_date: document.getElementById("v2PrecedingInvDate")?.value || null,
    service_period_start: document.getElementById("v2ServiceStart")?.value || null,
    service_period_end: document.getElementById("v2ServiceEnd")?.value || null,
    prepaid_amount: prepaidAmount,
    discounts: docDiscounts,
    vat_exemption_reason: document.getElementById("v2ExemptionReason")?.value || null,
    seller: {
      name: document.getElementById("v2SellerName")?.value.trim() || "",
      vat_id: document.getElementById("v2SellerVat")?.value.trim() || "",
      tax_number: document.getElementById("v2SellerTaxNumber")?.value.trim() || "",
      tax_registration_id: document.getElementById("v2SellerTaxNumber")?.value.trim() || "",
      street: document.getElementById("v2SellerStreet")?.value.trim() || "",
      city: document.getElementById("v2SellerCity")?.value.trim() || "",
      postcode: document.getElementById("v2SellerPostcode")?.value.trim() || "",
      country_code: document.getElementById("v2SellerCountry")?.value || "DE",
      contact_name: document.getElementById("v2SellerContactName")?.value.trim() || null,
      contact_phone: document.getElementById("v2SellerPhone")?.value.trim() || null,
      contact_email: document.getElementById("v2SellerEmail")?.value.trim() || null
    },
    buyer: {
      name: document.getElementById("v2BuyerName")?.value.trim() || "",
      vat_id: document.getElementById("v2BuyerVat")?.value.trim() || "",
      street: document.getElementById("v2BuyerStreet")?.value.trim() || "",
      city: document.getElementById("v2BuyerCity")?.value.trim() || "",
      postcode: document.getElementById("v2BuyerPostcode")?.value.trim() || "",
      country_code: document.getElementById("v2BuyerCountry")?.value || "DE",
      contact_name: document.getElementById("v2BuyerContactName")?.value.trim() || null,
      contact_phone: document.getElementById("v2BuyerPhone")?.value.trim() || null,
      contact_email: document.getElementById("v2BuyerEmail")?.value.trim() || null
    },
    delivery: {
      recipient_name: document.getElementById("v2DelivName")?.value.trim() || null,
      location_id: document.getElementById("v2DelivLocationId")?.value.trim() || null,
      delivery_date: document.getElementById("v2DelivDate")?.value || null,
      despatch_advice_id: document.getElementById("v2DelivDespatchRef")?.value.trim() || null,
      street: document.getElementById("v2DelivStreet")?.value.trim() || null,
      city: document.getElementById("v2DelivCity")?.value.trim() || null,
      postcode: document.getElementById("v2DelivPostcode")?.value.trim() || null,
      country_code: document.getElementById("v2DelivCountry")?.value || "DE"
    },
    payment: {
      iban: document.getElementById("v2PayIban")?.value.trim() || "",
      bic: document.getElementById("v2PayBic")?.value.trim() || "",
      payment_means_code: document.getElementById("v2PayMethod")?.value || "58",
      payment_terms: document.getElementById("v2PayTerms")?.value.trim() || ""
    },
    notes: cleanNotes,
    invoice_notes: cleanNotes,
    items: items,
    tax_breakdown: Object.values(taxBreakdownMap),
    line_net_total: lineNetTotal,
    tax_total: taxTotal,
    grand_total: grandTotal,
    due_payable_amount: dueAmount
  };
}

async function validateV2Invoice() {
  const invData = harvestV2InvoiceData();
  const alertEl = document.getElementById("v2AlertBanner");
  const alertMsg = document.getElementById("v2AlertMessage");

  // Basic client checks
  const errors = [];
  if (!invData.invoice_number) errors.push("Invoice / Document Number is required.");
  if (!invData.issue_date) errors.push("Issue Date is required.");
  if (!invData.seller.name) errors.push("Seller Company Name is required.");
  if (!invData.buyer.name) errors.push("Buyer Company Name is required.");
  if (invData.items.length === 0) errors.push("At least one line item is required.");

  if ((invData.invoice_type_code === "381" || invData.invoice_type_code === "384") && !invData.preceding_invoice_number) {
    errors.push("Credit Notes (381) and Corrected Invoices (384) require a Preceding Invoice Number.");
  }

  if (errors.length > 0) {
    if (alertEl && alertMsg) {
      alertEl.className = "v2-alert-banner";
      alertEl.style.display = "flex";
      alertMsg.innerHTML = `<strong>Validation Issues:</strong><ul style="margin: 4px 0 0 16px;">${errors.map(e => `<li>${e}</li>`).join("")}</ul>`;
      alertEl.scrollIntoView({ behavior: "smooth" });
    } else {
      alert("Validation Issues:\n" + errors.join("\n"));
    }
    return false;
  }

  if (alertEl && alertMsg) {
    alertEl.className = "v2-alert-banner success";
    alertEl.style.display = "flex";
    alertMsg.innerHTML = `<strong>✅ Document Data Valid:</strong> Ready for compliant PDF/A-3 & XML generation.`;
  }
  return true;
}
window.validateV2Invoice = validateV2Invoice;

async function handleV2GenerateSubmit() {
  const isValid = await validateV2Invoice();
  if (!isValid) return;

  const btn = document.getElementById("v2GenerateBtn");
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div><span>Generating Document...</span>`;

  try {
    const invData = harvestV2InvoiceData();
    const layout = document.getElementById("v2LayoutSelect")?.value || "original";
    const lang = document.getElementById("v2LangSelect")?.value || "multi";

    let apiProfile = "EN16931";
    if (invData.document_format === "orderx") apiProfile = "BASIC";
    else if (typeof v2ActiveTargetFormat !== "undefined") {
      if (v2ActiveTargetFormat === "eslog") apiProfile = "ESLOG2";
      else if (v2ActiveTargetFormat === "ubl") apiProfile = "UBL";
      else if (v2ActiveTargetFormat === "peppol") apiProfile = "PEPPOL";
    }

    const res = await fetch("/api/create-invoice-pdfa3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice_data: invData,
        layout: layout,
        lang: lang,
        file_id: v2UploadedFileId,
        generator: "v2",
        source_type: "v2",
        profile: apiProfile,
        token_usage: v2TokenUsage
      })
    });

    const result = await res.json();
    if (!result.success) throw new Error(result.error || "Generation failed");

    // Populate XML viewer with the generated XML
    const xmlViewer = document.getElementById("v2XmlViewer");
    if (xmlViewer && result.xml_content) {
      xmlViewer.dataset.rawXml = result.xml_content;
      xmlViewer.textContent = result.xml_content;
      v2CurrentXml = result.xml_content;
    }

    // Success dialog or auto-download
    const alertEl = document.getElementById("v2AlertBanner");
    const alertMsg = document.getElementById("v2AlertMessage");
    if (alertEl && alertMsg) {
      alertEl.className = "v2-alert-banner success";
      alertEl.style.display = "flex";
      alertMsg.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div>
            <strong>🎉 Successfully Created!</strong> ${result.output_filename}
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button type="button" class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.78rem;" onclick="toggleV2XmlPreview()">
              📄 View XML
            </button>
            <button type="button" class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.78rem;" onclick="openPdfPreview('${result.output_filename}', '${escapeHtml(invData.invoice_number)}')">
              👁️ View Preview
            </button>
            <a href="/api/download/${result.output_filename}" download class="btn btn-primary" style="padding: 0.35rem 0.75rem; font-size: 0.78rem;">
              ⬇️ Download PDF/A-3
            </a>
          </div>
        </div>
      `;
      alertEl.scrollIntoView({ behavior: "smooth" });
    }

    // Direct download trigger
    window.location.href = `/api/download/${result.output_filename}`;
  } catch (err) {
    alert("Generation failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
}
// 8. Prefill Studio v2 from History Record
function populateV2FromHistory(inv, layout, lang) {
  if (!inv) return;

  // Set document type
  let docType = "380";
  if (inv.document_format === "orderx" || inv.invoice_type_code === "220") {
    docType = "orderx";
  } else if (inv.invoice_type_code) {
    docType = String(inv.invoice_type_code);
  }
  const docTypeSelect = document.getElementById("v2DocTypeSelect");
  if (docTypeSelect) {
    docTypeSelect.value = docType;
    handleV2DocTypeChange(docType);
  }

  // Layout & Language select
  if (layout) {
    const layoutEl = document.getElementById("v2LayoutSelect");
    if (layoutEl) layoutEl.value = layout;
  }
  if (lang) {
    const langEl = document.getElementById("v2LangSelect");
    if (langEl) langEl.value = lang;
  }

  // Header Details
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val !== undefined && val !== null ? val : "";
  };

  setVal("v2InvNumber", inv.invoice_number);
  setVal("v2IssueDate", inv.issue_date);
  setVal("v2DueDate", inv.due_date);
  setVal("v2Currency", inv.currency || "EUR");
  setVal("v2BuyerRef", inv.buyer_reference);
  setVal("v2PurchaseOrder", inv.purchase_order_number);
  setVal("v2PrecedingInvNumber", inv.preceding_invoice_number);
  setVal("v2PrecedingInvDate", inv.preceding_invoice_date);
  setVal("v2ServiceStart", inv.service_period_start);
  setVal("v2ServiceEnd", inv.service_period_end);
  setVal("v2PrepaidAmount", inv.prepaid_amount || 0);

  // Seller
  const seller = inv.seller || {};
  setVal("v2SellerName", seller.name);
  setVal("v2SellerVat", seller.vat_id);
  setVal("v2SellerTaxNumber", seller.tax_number || seller.tax_registration_id);
  setVal("v2SellerStreet", seller.street);
  setVal("v2SellerCity", seller.city);
  setVal("v2SellerPostcode", seller.postcode);
  setVal("v2SellerCountry", seller.country_code || "DE");
  setVal("v2SellerPhone", seller.contact_phone);
  setVal("v2SellerEmail", seller.contact_email);

  // Buyer
  const buyer = inv.buyer || {};
  setVal("v2BuyerName", buyer.name);
  setVal("v2BuyerVat", buyer.vat_id);
  setVal("v2BuyerStreet", buyer.street);
  setVal("v2BuyerCity", buyer.city);
  setVal("v2BuyerPostcode", buyer.postcode);
  setVal("v2BuyerCountry", buyer.country_code || "DE");
  setVal("v2BuyerContactName", buyer.contact_name);
  setVal("v2BuyerPhone", buyer.contact_phone);
  setVal("v2BuyerEmail", buyer.contact_email);
  if (buyer.contact_name || buyer.contact_phone || buyer.contact_email) {
    const bSec = document.getElementById("v2BuyerContactSec");
    if (bSec) bSec.style.display = "block";
  }

  // Delivery
  const deliv = inv.delivery || {};
  setVal("v2DelivName", deliv.recipient_name);
  setVal("v2DelivLocationId", deliv.location_id);
  setVal("v2DelivDate", deliv.delivery_date);
  setVal("v2DelivDespatchRef", deliv.despatch_advice_reference || deliv.despatch_advice_id);
  setVal("v2DelivStreet", deliv.street);
  setVal("v2DelivCity", deliv.city);
  setVal("v2DelivPostcode", deliv.postcode);
  setVal("v2DelivCountry", deliv.country_code || "DE");
  if (deliv.recipient_name || deliv.delivery_date || deliv.street || deliv.location_id || deliv.despatch_advice_reference) {
    const delivSec = document.getElementById("v2DeliverySection");
    if (delivSec) delivSec.style.display = "block";
  }

  // Payment
  const pay = inv.payment || {};
  setVal("v2PayIban", pay.iban);
  setVal("v2PayBic", pay.bic);
  if (pay.bic) {
    const bicWrapper = document.getElementById("v2BicFieldWrapper");
    if (bicWrapper) bicWrapper.style.display = "block";
  }
  setVal("v2PayMethod", pay.payment_means_code || "58");
  setVal("v2PayTerms", pay.payment_terms || "");

  // Line items
  const items = inv.items || inv.line_items || [];
  if (items.length > 0) {
    v2LineItems = items.map(it => ({
      name: it.name || it.item_name || "Item",
      quantity: Number(it.quantity) || 1,
      unit_code: it.unit_code || "C62",
      unit_price: Number(it.unit_price) || 0,
      tax_category_code: it.tax_category_code || "S",
      tax_percent: it.tax_percent !== undefined ? Number(it.tax_percent) : 19.0,
      discount_amount: Number(it.discount_amount) || 0.0,
      discount_percent: it.discount_percent || null
    }));
  } else {
    initV2LineItems();
  }
  renderV2LineItems();

  // Discounts & Charges
  if (inv.discounts && inv.discounts.length > 0) {
    v2DocumentDiscounts = inv.discounts.map(d => ({
      reason: d.reason || (d.charge_indicator ? "Packaging / Charge" : "Document Discount"),
      percentage: d.percentage || null,
      amount: Number(d.amount) || 0.0,
      charge_indicator: Boolean(d.charge_indicator)
    }));
  } else {
    v2DocumentDiscounts = [];
  }
  renderV2DocumentDiscounts();

  // Notes
  const historyNotes = inv.invoice_notes || inv.notes || [];
  v2ExtractedNotes = Array.isArray(historyNotes) ? historyNotes.filter(n => n && String(n).trim().length > 0) : [];
  renderV2InvoiceNotes();

  // Confidence indicators if saved
  if (inv.confidence_scores) {
    applyV2ConfidenceScores(inv.confidence_scores);
  }

  recalcV2Totals();
}
window.populateV2FromHistory = populateV2FromHistory;

// =========================================================================
// STUDIO V2 LIVE XML PREVIEW & HIGHLIGHT INTEGRATION
// =========================================================================

let v2CurrentXml = "";

async function updateV2LiveXml() {
  const viewer = document.getElementById("v2XmlViewer");
  const badge = document.getElementById("v2XmlProfileBadge");
  if (!viewer) return;

  try {
    const invData = harvestV2InvoiceData();
    const isOrderX = invData.document_format === "orderx";

    let apiProfile = "EN16931";
    let badgeText = "EN 16931";

    if (isOrderX) {
      apiProfile = "BASIC";
      badgeText = "Order-X BASIC";
    } else if (typeof v2ActiveTargetFormat !== "undefined") {
      if (v2ActiveTargetFormat === "eslog") {
        apiProfile = "ESLOG2";
        badgeText = "🇸🇮 e-SLOG 2.0 (CII)";
      } else if (v2ActiveTargetFormat === "ubl") {
        apiProfile = "UBL";
        badgeText = "🟠 UBL 2.1 (EN 16931)";
      } else if (v2ActiveTargetFormat === "peppol") {
        apiProfile = "PEPPOL";
        badgeText = "🔵 Peppol BIS 3.0 (UBL)";
      } else if (v2ActiveTargetFormat === "xrechnung") {
        apiProfile = "EN16931";
        badgeText = "🟢 XRechnung (CII)";
      } else {
        apiProfile = "EN16931";
        badgeText = "🟣 ZUGFeRD / Factur-X 2.3";
      }
    }

    if (badge) {
      badge.textContent = badgeText;
    }

    const res = await fetch("/api/generate-xml", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice_data: invData,
        profile: apiProfile
      })
    });

    const data = await res.json();
    if (data.xml_content) {
      v2CurrentXml = data.xml_content;
      viewer.dataset.rawXml = data.xml_content;
      viewer.textContent = data.xml_content;
    }
  } catch (err) {
    console.warn("Could not generate live XML in Studio v2:", err);
  }
}
window.updateV2LiveXml = updateV2LiveXml;

async function downloadV2RawXml() {
  const isValid = await validateV2Invoice();
  if (!isValid) return;

  const btn = document.getElementById("v2DownloadXmlBtn");
  const origText = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner"></div><span>Exporting XML...</span>`;
  }

  try {
    const invData = harvestV2InvoiceData();
    const isOrderX = invData.document_format === "orderx";

    let apiProfile = "EN16931";
    if (isOrderX) {
      apiProfile = "BASIC";
    } else if (typeof v2ActiveTargetFormat !== "undefined") {
      if (v2ActiveTargetFormat === "eslog") apiProfile = "ESLOG2";
      else if (v2ActiveTargetFormat === "ubl") apiProfile = "UBL";
      else if (v2ActiveTargetFormat === "peppol") apiProfile = "PEPPOL";
      else if (v2ActiveTargetFormat === "xrechnung") apiProfile = "EN16931";
      else apiProfile = "EN16931";
    }

    const res = await fetch("/api/export-xml", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice_data: invData,
        profile: apiProfile
      })
    });

    const result = await res.json();
    if (!result.success) throw new Error(result.error || "XML export failed");

    // Update XML preview viewer with raw content
    const xmlViewer = document.getElementById("v2XmlViewer");
    if (xmlViewer && result.xml_content) {
      xmlViewer.dataset.rawXml = result.xml_content;
      xmlViewer.textContent = result.xml_content;
      v2CurrentXml = result.xml_content;
    }

    // Success banner notification with direct download link
    const alertEl = document.getElementById("v2AlertBanner");
    const alertMsg = document.getElementById("v2AlertMessage");
    if (alertEl && alertMsg) {
      alertEl.className = "v2-alert-banner success";
      alertEl.style.display = "flex";
      alertMsg.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div>
            <strong>📥 XML Ready!</strong> ${result.filename}
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button type="button" class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.78rem;" onclick="toggleV2XmlPreview()">
              📄 View XML
            </button>
            <a href="${result.download_url}" download class="btn btn-primary" style="padding: 0.35rem 0.75rem; font-size: 0.78rem; background: #10b981;">
              ⬇️ Download ${result.filename}
            </a>
          </div>
        </div>
      `;
      alertEl.scrollIntoView({ behavior: "smooth" });
    }

    // Trigger instant browser download
    const dlLink = document.createElement("a");
    dlLink.href = result.download_url;
    dlLink.download = result.filename;
    document.body.appendChild(dlLink);
    dlLink.click();
    document.body.removeChild(dlLink);

  } catch (err) {
    alert("XML export failed: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }
}
window.downloadV2RawXml = downloadV2RawXml;

function toggleV2XmlPreview() {
  const card = document.getElementById("v2XmlCard");
  if (!card) return;
  const isHidden = card.style.display === "none" || card.classList.contains("hidden");
  card.style.display = isHidden ? "block" : "none";
  card.classList.remove("hidden");

  if (isHidden) {
    updateV2LiveXml();
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
window.toggleV2XmlPreview = toggleV2XmlPreview;

function copyV2XmlToClipboard() {
  const viewer = document.getElementById("v2XmlViewer");
  const xml = (viewer && viewer.dataset.rawXml) || v2CurrentXml || (viewer ? viewer.textContent : "");
  if (!xml) return;
  navigator.clipboard.writeText(xml).then(() => {
    alert("✅ XML copied to clipboard!");
  }).catch(e => {
    alert("Could not copy XML: " + e.message);
  });
}
window.copyV2XmlToClipboard = copyV2XmlToClipboard;

// Run on load
document.addEventListener("DOMContentLoaded", () => {
  initV2Studio();
});

