// =========================================================================
// ZUGFeRD Studio v2 Client Engine
// Matches GetZUGFeRD.com Guided Flow with 6 Document Types
// =========================================================================

let v2LineItems = [];
let v2DocumentDiscounts = [];
let v2ExtractedNotes = [];
let v2BankAccounts = [];
let v2TokenUsage = null;
let v2UploadedFileId = null;
let v2UploadedFileName = null;

// Initialize on script load
function initV2Studio() {
  populateV2CountryDropdowns();
  initV2LineItems();
  initV2BankAccounts();
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
  setVal("v2SellerIdentifier", settings.seller_identifier || "");
  setVal("v2SellerStreet", settings.seller_street || "");
  setVal("v2SellerCity", cityStr);
  setVal("v2SellerPostcode", postcodeStr);
  setVal("v2SellerCountry", settings.seller_country || "");
  setVal("v2SellerPhone", settings.seller_phone || "");
  setVal("v2SellerFax", settings.seller_fax || "");
  setVal("v2PayIban", settings.seller_bank1_iban || "");
  setVal("v2PayBic", settings.seller_bank1_bic || "");

  // Auto-populate BG-17 payment accounts with configured corporate banks
  if (typeof populateV2DefaultBankAccounts === "function") {
    populateV2DefaultBankAccounts();
  }
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
    "381": "Credit Note (Gutschrift / Dobropis)",
    "384": "Corrected Invoice (Lastschrift / Rechnungskorrektur)",
    "389": "Prepayment Invoice (Anzahlungsrechnung)",
    "326": "Partial Invoice (Teilrechnung)",
    "orderx": "Order-X Purchase Order"
  };

  const titleEl = document.getElementById("v2DocTypeLabel");
  if (titleEl) titleEl.textContent = labelMap[docType] || "Invoice";

  // Due Date (BT-9): optional for 381, mandatory for 380 and 384
  const dueDateInput = document.getElementById("v2DueDate");
  if (dueDateInput) {
    const dueDateLabel = dueDateInput.closest(".v2-field")?.querySelector("label");
    if (dueDateLabel) {
      if (docType === "381") {
        dueDateLabel.innerHTML = `Payment Due Date / Fälligkeitsdatum <span class="v2-bt-badge" data-bt="BT-9">BT-9</span> <span style="font-size: 0.72rem; color: var(--text-muted);">(Optional for Credit Notes)</span>`;
      } else {
        dueDateLabel.innerHTML = `Payment Due Date / Fälligkeitsdatum <span class="v2-req-star">*</span> <span class="v2-bt-badge" data-bt="BT-9">BT-9</span>`;
      }
    }
  }
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

    const baseQty = item.price_base_quantity || 1.0;
    // Calculate line net total taking allowances and charges into account
    let lineAllowances = 0;
    let lineCharges = 0;
    if (item.allowances_charges && Array.isArray(item.allowances_charges)) {
      item.allowances_charges.forEach(ac => {
        const amt = parseFloat(ac.amount) || 0;
        if (ac.charge_indicator) lineCharges += amt;
        else lineAllowances += amt;
      });
    } else {
      lineAllowances = item.discount_amount || 0;
    }
    const itemNetSub = (item.quantity * item.unit_price) / (baseQty > 0 ? baseQty : 1.0);
    const lineTotal = Math.max(0, itemNetSub - lineAllowances + lineCharges);

    card.innerHTML = `
      <div class="v2-item-topbar">
        <span class="v2-item-number">Line #${idx + 1}</span>
        <button type="button" class="v2-item-trash" onclick="removeV2LineItem(${idx})" title="Remove Line">🗑️</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <!-- BT-153: Item Name (Strictly product name) -->
        <div class="v2-field">
          <label class="v2-label">
            <span class="v2-label-left">
              Item Name / Produktname <span class="v2-req-star">*</span>
              <span class="v2-bt-badge" data-bt="BT-153">BT-153
                <div class="v2-bt-tooltip">
                  <span class="v2-bt-tooltip-title">BT-153: Artikelname (Item name)</span>
                  <div>Full name of the good or deliverable service.</div>
                  <span class="v2-bt-tooltip-xml">XML: .../ram:SpecifiedTradeProduct/ram:Name</span>
                  <span class="v2-bt-tooltip-status req">● Mandatory Standard Field</span>
                </div>
              </span>
            </span>
            <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2ItemName_${idx}')" title="Jump to BT-153 in factur-x.xml">?</button>
          </label>
          <input type="text" id="v2ItemName_${idx}" class="v2-input" value="${escapeHtml(item.name || '')}" oninput="updateV2ItemField(${idx}, 'name', this.value)" placeholder="e.g. Development costs / ECU Module">
        </div>

        <div class="v2-grid-4">
          <div class="v2-field">
            <label class="v2-label">
              <span class="v2-label-left">
                Qty / Menge <span class="v2-req-star">*</span>
                <span class="v2-bt-badge" data-bt="BT-129">BT-129
                  <div class="v2-bt-tooltip">
                    <span class="v2-bt-tooltip-title">BT-129: Menge der Rechnungsposition (Invoiced quantity)</span>
                    <div>Quantity of items, hours, or units invoiced.</div>
                    <span class="v2-bt-tooltip-xml">XML: .../ram:BilledQuantity</span>
                    <span class="v2-bt-tooltip-status req">● Mandatory Standard Field</span>
                  </div>
                </span>
              </span>
              <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2ItemQty_${idx}')" title="Jump to BT-129 in factur-x.xml">?</button>
            </label>
            <input type="number" id="v2ItemQty_${idx}" step="0.01" min="0.0001" class="v2-input" value="${item.quantity}" oninput="updateV2ItemField(${idx}, 'quantity', parseFloat(this.value)||0)">
          </div>
          <div class="v2-field">
            <label class="v2-label">
              <span class="v2-label-left">
                Unit / Einheit <span class="v2-req-star">*</span>
                <span class="v2-bt-badge" data-bt="BT-130">BT-130
                  <div class="v2-bt-tooltip">
                    <span class="v2-bt-tooltip-title">BT-130: Mengeneinheitencode (Unit code)</span>
                    <div>UN/ECE Rec 20 unit code (C62 = pcs, HUR = hours, KGM = kg).</div>
                    <span class="v2-bt-tooltip-xml">XML: @unitCode</span>
                    <span class="v2-bt-tooltip-status req">● Mandatory Standard Field</span>
                  </div>
                </span>
              </span>
              <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2ItemUnit_${idx}')" title="Jump to BT-130 in factur-x.xml">?</button>
            </label>
            <select id="v2ItemUnit_${idx}" class="v2-select" onchange="updateV2ItemField(${idx}, 'unit_code', this.value)">
              <option value="C62" ${item.unit_code === "C62" ? "selected" : ""}>Piece / Stück (C62)</option>
              <option value="H87" ${item.unit_code === "H87" ? "selected" : ""}>Piece / Stück (H87)</option>
              <option value="HUR" ${item.unit_code === "HUR" ? "selected" : ""}>Hour / Stunde (HUR)</option>
              <option value="DAY" ${item.unit_code === "DAY" ? "selected" : ""}>Day / Tag (DAY)</option>
              <option value="MON" ${item.unit_code === "MON" ? "selected" : ""}>Month / Monat (MON)</option>
              <option value="KGM" ${item.unit_code === "KGM" ? "selected" : ""}>Kilogram / Kilogramm (KGM)</option>
              <option value="MTR" ${item.unit_code === "MTR" ? "selected" : ""}>Meter / Meter (MTR)</option>
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
                    <span class="v2-bt-tooltip-status req">● Mandatory Standard Field</span>
                  </div>
                </span>
              </span>
              <button type="button" class="v2-xml-help-btn" onclick="jumpToXmlForField('v2ItemPrice_${idx}')" title="Jump to BT-146 in factur-x.xml">?</button>
            </label>
            <input type="number" id="v2ItemPrice_${idx}" step="0.0001" class="v2-input" value="${item.unit_price}" oninput="updateV2ItemField(${idx}, 'unit_price', parseFloat(this.value)||0)">
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
                    <span class="v2-bt-tooltip-status req">● Mandatory Standard Field</span>
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

        <!-- Advanced Item Details Drawer: Part numbers, PO line, base quantity, description -->
        <div style="margin-top: 0.25rem;">
          <button type="button" class="v2-accordion-btn" onclick="toggleV2Section('v2ItemAdv_${idx}', 'v2ItemAdvChev_${idx}')" style="font-size: 0.74rem; padding: 0.25rem 0.4rem;">
            <span id="v2ItemAdvChev_${idx}">▼</span>
            <span>🔧 Advanced Item Details (Seller/Buyer/Standard Identifiers, PO Line, Base Qty, Description)</span>
          </button>
          <div id="v2ItemAdv_${idx}" style="display: none; margin-top: 0.5rem; background: var(--bg-input); padding: 0.65rem; border-radius: 6px; border: 1px dashed var(--bg-card-border); display: flex; flex-direction: column; gap: 0.5rem;">
            <div class="v2-field">
              <label class="v2-label">
                <span class="v2-label-left">
                  Item Description / Technische Beschreibung
                  <span class="v2-bt-badge" data-bt="BT-154">BT-154</span>
                </span>
              </label>
              <textarea class="v2-input" rows="2" style="resize: vertical; font-size: 0.76rem;" placeholder="Secondary detailed technical specifications..." oninput="updateV2ItemField(${idx}, 'description', this.value)">${escapeHtml(item.description || '')}</textarea>
            </div>
            <div class="v2-grid-4">
              <div class="v2-field">
                <label class="v2-label">
                  <span class="v2-label-left">
                    Seller's Item ID / Artikelnr.
                    <span class="v2-bt-badge" data-bt="BT-155">BT-155</span>
                  </span>
                </label>
                <input type="text" class="v2-input" value="${escapeHtml(item.seller_item_id || '')}" placeholder="e.g. 930000006" oninput="updateV2ItemField(${idx}, 'seller_item_id', this.value)">
              </div>
              <div class="v2-field">
                <label class="v2-label">
                  <span class="v2-label-left">
                    Buyer's Part No. / Kunden-Artikelnr.
                    <span class="v2-bt-badge" data-bt="BT-156">BT-156</span>
                  </span>
                </label>
                <input type="text" class="v2-input" value="${escapeHtml(item.buyer_item_id || '')}" placeholder="e.g. ACK688 FATEV G45" oninput="updateV2ItemField(${idx}, 'buyer_item_id', this.value)">
              </div>
              <div class="v2-field">
                <label class="v2-label">
                  <span class="v2-label-left">
                    Standard ID / GTIN
                    <span class="v2-bt-badge" data-bt="BT-157">BT-157</span>
                  </span>
                </label>
                <div style="display: flex; gap: 0.25rem;">
                  <input type="text" style="width: 4rem;" class="v2-input" value="${escapeHtml(item.standard_item_id_scheme || '0160')}" title="Scheme ID (BT-157-1, default 0160 for GTIN)" placeholder="0160" oninput="updateV2ItemField(${idx}, 'standard_item_id_scheme', this.value)">
                  <input type="text" style="flex: 1;" class="v2-input" value="${escapeHtml(item.standard_item_id || '')}" placeholder="e.g. 4012345678901" oninput="updateV2ItemField(${idx}, 'standard_item_id', this.value)">
                </div>
              </div>
              <div class="v2-field">
                <label class="v2-label">
                  <span class="v2-label-left">
                    PO Line Ref / Bestellposition
                    <span class="v2-bt-badge" data-bt="BT-132">BT-132</span>
                  </span>
                </label>
                <input type="text" class="v2-input" value="${escapeHtml(item.order_line_reference || '')}" placeholder="e.g. 1 or 2" oninput="updateV2ItemField(${idx}, 'order_line_reference', this.value)">
              </div>
            </div>
            <div class="v2-grid-3" style="margin-top: 0.25rem;">
              <div class="v2-field">
                <label class="v2-label">
                  <span class="v2-label-left">
                    Price Base Quantity
                    <span class="v2-bt-badge" data-bt="BT-149">BT-149</span>
                  </span>
                </label>
                <input type="number" step="1" min="0.0001" class="v2-input" value="${item.price_base_quantity || 1}" placeholder="e.g. 100 for €150/100pcs" oninput="updateV2ItemField(${idx}, 'price_base_quantity', parseFloat(this.value)||1)">
              </div>
              <div class="v2-field">
                <label class="v2-label">
                  <span class="v2-label-left">
                    Price Base Unit
                    <span class="v2-bt-badge" data-bt="BT-150">BT-150</span>
                  </span>
                </label>
                <input type="text" class="v2-input" value="${escapeHtml(item.price_base_unit || item.unit_code || 'C62')}" placeholder="C62" oninput="updateV2ItemField(${idx}, 'price_base_unit', this.value)">
              </div>
              <div class="v2-field">
                <label class="v2-label">
                  <span class="v2-label-left">
                    Item Serial / Lot
                    <span class="v2-bt-badge" data-bt="BT-128">BT-128</span>
                  </span>
                </label>
                <input type="text" class="v2-input" value="${escapeHtml(item.item_serial_number || '')}" placeholder="e.g. SN-883921" oninput="updateV2ItemField(${idx}, 'item_serial_number', this.value)">
              </div>
            </div>

            <!-- Item-Level Allowances & Charges (BG-27 & BG-28) -->
            <div style="margin-top: 0.5rem; border-top: 1px dashed var(--bg-card-border); padding-top: 0.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                <span style="font-size: 0.72rem; font-weight: 600;">🏷️ Item Allowances &amp; Charges (BG-27 / BG-28):</span>
                <div style="display: flex; gap: 0.3rem;">
                  <button type="button" class="btn btn-secondary" onclick="addV2ItemAllowanceCharge(${idx}, false)" style="padding: 0.15rem 0.4rem; font-size: 0.68rem;">+ Discount (BT-136)</button>
                  <button type="button" class="btn btn-secondary" onclick="addV2ItemAllowanceCharge(${idx}, true)" style="padding: 0.15rem 0.4rem; font-size: 0.68rem;">+ Surcharge (BT-141)</button>
                </div>
              </div>
              <div id="v2ItemACContainer_${idx}" style="display: flex; flex-direction: column; gap: 0.35rem;">
                ${renderV2ItemAllowancesChargesHtml(item, idx)}
              </div>
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; align-items: center; gap: 1rem; border-top: 1px dashed var(--bg-card-border); padding-top: 0.5rem; margin-top: 0.25rem;">
          <div style="font-size: 0.78rem; color: var(--text-muted); display: inline-flex; align-items: center; gap: 0.4rem;">
            Line Net Total / Positions-Nettobetrag: 
            <span class="v2-bt-badge" data-bt="BT-131">BT-131
              <div class="v2-bt-tooltip">
                <span class="v2-bt-tooltip-title">BT-131: Nettobetrag der Rechnungsposition (Line net amount)</span>
                <div>Total net amount = (Qty × Unit Price / Base Qty) - Allowances + Charges.</div>
                <span class="v2-bt-tooltip-xml">XML: .../ram:LineTotalAmount</span>
                <span class="v2-bt-tooltip-status req">● Mandatory Standard Field</span>
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

function renderV2ItemAllowancesChargesHtml(item, itemIdx) {
  const acList = item.allowances_charges || [];
  if (acList.length === 0) {
    return `<div style="font-size: 0.7rem; color: var(--text-muted); font-style: italic;">No item-level discount or charge. Click buttons above to add.</div>`;
  }
  const baseQty = item.price_base_quantity || 1.0;
  const itemGrossBase = (item.quantity * item.unit_price) / (baseQty > 0 ? baseQty : 1.0);

  return acList.map((ac, acIdx) => {
    const isChg = Boolean(ac.charge_indicator);
    const amt = ac.amount !== undefined && ac.amount !== null ? ac.amount : 0;
    const pct = ac.percentage !== undefined && ac.percentage !== null ? ac.percentage : '';
    const baseAmt = ac.base_amount !== undefined && ac.base_amount !== null ? ac.base_amount : itemGrossBase;

    return `
      <div style="display: flex; flex-direction: column; gap: 0.25rem; background: var(--bg-card); padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid var(--bg-card-border);">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 0.68rem; font-weight: 700; color: ${isChg ? '#10b981' : '#3b82f6'};">
            ${isChg ? '➕ Charge (BG-28)' : '➖ Discount (BG-27)'}
          </span>
          <span style="font-size: 0.65rem; color: var(--text-muted);">
            Base (${isChg ? 'BT-142' : 'BT-137'}): €${baseAmt.toFixed(2)}
          </span>
          <button type="button" class="v2-item-trash" style="padding: 0.1rem 0.3rem;" onclick="removeV2ItemAllowanceCharge(${itemIdx}, ${acIdx})" title="Remove">🗑️</button>
        </div>
        <div style="display: flex; align-items: center; gap: 0.35rem;">
          <input type="text" class="v2-input" style="flex: 2; padding: 0.2rem 0.4rem; font-size: 0.72rem;" value="${escapeHtml(ac.reason || '')}" placeholder="${isChg ? 'Reason (BT-144, e.g. Hazardous surcharge)' : 'Reason (BT-139, e.g. Volume discount)'}" oninput="updateV2ItemAllowanceCharge(${itemIdx}, ${acIdx}, 'reason', this.value)">
          <div style="display: flex; align-items: center; gap: 2px;">
            <input type="number" step="0.01" min="0" max="100" class="v2-input" style="width: 4.2rem; padding: 0.2rem 0.3rem; font-size: 0.72rem;" value="${pct}" placeholder="% (${isChg ? 'BT-143' : 'BT-138'})" oninput="handleV2ItemAllowancePercentInput(${itemIdx}, ${acIdx}, this.value)">
            <span style="font-size: 0.7rem; color: var(--text-muted);">%</span>
          </div>
          <div style="display: flex; align-items: center; gap: 2px;">
            <input type="number" step="0.01" min="0" class="v2-input" style="width: 5rem; padding: 0.2rem 0.3rem; font-size: 0.72rem;" value="${amt}" placeholder="€ (${isChg ? 'BT-141' : 'BT-136'})" oninput="handleV2ItemAllowanceAmountInput(${itemIdx}, ${acIdx}, this.value)">
            <span style="font-size: 0.7rem; color: var(--text-muted);">€</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}
window.renderV2ItemAllowancesChargesHtml = renderV2ItemAllowancesChargesHtml;

function getItemGrossBaseAmount(itemIdx) {
  const item = v2LineItems[itemIdx];
  if (!item) return 0.0;
  const baseQty = item.price_base_quantity || 1.0;
  return (item.quantity * item.unit_price) / (baseQty > 0 ? baseQty : 1.0);
}

function handleV2ItemAllowancePercentInput(itemIdx, acIdx, pctStr) {
  if (!v2LineItems[itemIdx] || !v2LineItems[itemIdx].allowances_charges) return;
  const ac = v2LineItems[itemIdx].allowances_charges[acIdx];
  if (!ac) return;

  const baseAmt = getItemGrossBaseAmount(itemIdx);
  ac.base_amount = baseAmt;

  const pct = parseFloat(pctStr);
  if (!isNaN(pct) && pct >= 0) {
    ac.percentage = pct;
    ac.amount = Math.round(baseAmt * (pct / 100) * 100) / 100;
  } else {
    ac.percentage = null;
  }
  renderV2LineItems();
}
window.handleV2ItemAllowancePercentInput = handleV2ItemAllowancePercentInput;

function handleV2ItemAllowanceAmountInput(itemIdx, acIdx, amtStr) {
  if (!v2LineItems[itemIdx] || !v2LineItems[itemIdx].allowances_charges) return;
  const ac = v2LineItems[itemIdx].allowances_charges[acIdx];
  if (!ac) return;

  const baseAmt = getItemGrossBaseAmount(itemIdx);
  ac.base_amount = baseAmt;

  const amt = parseFloat(amtStr);
  if (!isNaN(amt) && amt >= 0) {
    ac.amount = amt;
    if (baseAmt > 0) {
      ac.percentage = Math.round((amt / baseAmt) * 10000) / 100;
    } else {
      ac.percentage = null;
    }
  } else {
    ac.amount = 0.0;
    ac.percentage = null;
  }
  renderV2LineItems();
}
window.handleV2ItemAllowanceAmountInput = handleV2ItemAllowanceAmountInput;

function addV2ItemAllowanceCharge(itemIdx, isCharge) {
  if (!v2LineItems[itemIdx]) return;
  if (!v2LineItems[itemIdx].allowances_charges) v2LineItems[itemIdx].allowances_charges = [];
  const baseAmt = getItemGrossBaseAmount(itemIdx);
  v2LineItems[itemIdx].allowances_charges.push({
    charge_indicator: Boolean(isCharge),
    amount: 0.0,
    percentage: null,
    base_amount: baseAmt,
    reason: isCharge ? "Item Surcharge" : "Item Discount"
  });
  renderV2LineItems();
}
window.addV2ItemAllowanceCharge = addV2ItemAllowanceCharge;

function removeV2ItemAllowanceCharge(itemIdx, acIdx) {
  if (!v2LineItems[itemIdx] || !v2LineItems[itemIdx].allowances_charges) return;
  v2LineItems[itemIdx].allowances_charges.splice(acIdx, 1);
  renderV2LineItems();
}
window.removeV2ItemAllowanceCharge = removeV2ItemAllowanceCharge;

function updateV2ItemAllowanceCharge(itemIdx, acIdx, field, val) {
  if (!v2LineItems[itemIdx] || !v2LineItems[itemIdx].allowances_charges) return;
  if (v2LineItems[itemIdx].allowances_charges[acIdx]) {
    v2LineItems[itemIdx].allowances_charges[acIdx][field] = val;
    recalcV2Totals();
  }
}
window.updateV2ItemAllowanceCharge = updateV2ItemAllowanceCharge;

function addV2LineItem() {
  v2LineItems.push({
    name: "New Line Item",
    quantity: 1,
    unit_code: "C62",
    unit_price: 100.0,
    price_base_quantity: 1.0,
    price_base_unit: "C62",
    tax_category_code: "S",
    tax_percent: 19.0,
    discount_amount: 0.0,
    discount_percent: null,
    seller_item_id: "",
    buyer_item_id: "",
    standard_item_id: "",
    standard_item_id_scheme: "0160",
    order_line_reference: "",
    description: "",
    allowances_charges: []
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

// ================= MULTIPLE BANK ACCOUNTS (BG-17) =================
function getV2ConfiguredBankPresets() {
  const settings = window.cachedCompanySettings || {};
  let localSettings = {};
  try {
    const raw = localStorage.getItem("ZUGFERD_COMPANY_SETTINGS");
    if (raw) localSettings = JSON.parse(raw);
  } catch (e) {}

  const merged = Object.assign({}, localSettings, settings);

  // Also check live DOM inputs from Configuration page if present
  const domBank1Iban = document.getElementById("cfgBank1Iban")?.value?.trim();
  const domBank1Name = document.getElementById("cfgBank1Name")?.value?.trim();
  const domBank1Bic = document.getElementById("cfgBank1Bic")?.value?.trim();

  const domBank2Iban = document.getElementById("cfgBank2Iban")?.value?.trim();
  const domBank2Name = document.getElementById("cfgBank2Name")?.value?.trim();
  const domBank2Bic = document.getElementById("cfgBank2Bic")?.value?.trim();

  const presets = [];

  const b1Iban = domBank1Iban || (merged.seller_bank1_iban || "").trim();
  const b1Name = domBank1Name || (merged.seller_bank1_name || "").trim() || "Primary Bank";
  const b1Bic = domBank1Bic || (merged.seller_bank1_bic || "").trim();

  const b2Iban = domBank2Iban || (merged.seller_bank2_iban || "").trim();
  const b2Name = domBank2Name || (merged.seller_bank2_name || "").trim() || "Secondary Bank";
  const b2Bic = domBank2Bic || (merged.seller_bank2_bic || "").trim();

  if (b1Iban) {
    const cleanDigits = b1Iban.replace(/\s+/g, "");
    const lastDigits = cleanDigits.length >= 4 ? cleanDigits.slice(-4) : cleanDigits;
    presets.push({
      key: "primary",
      label: `Primary Bank (${b1Name} - ...${lastDigits})`,
      iban: b1Iban,
      bank_name: b1Name,
      bic: b1Bic
    });
  }

  if (b2Iban) {
    const cleanDigits = b2Iban.replace(/\s+/g, "");
    const lastDigits = cleanDigits.length >= 4 ? cleanDigits.slice(-4) : cleanDigits;
    presets.push({
      key: "secondary",
      label: `Secondary Bank (${b2Name} - ...${lastDigits})`,
      iban: b2Iban,
      bank_name: b2Name,
      bic: b2Bic
    });
  }

  return presets;
}
window.getV2ConfiguredBankPresets = getV2ConfiguredBankPresets;

function updateV2BankPresetDropdown() {
  const select = document.getElementById("v2BankPresetSelect");
  if (!select) return;
  const presets = getV2ConfiguredBankPresets();
  let html = `<option value="">-- Insert Configured Bank --</option>`;
  presets.forEach(p => {
    html += `<option value="${escapeHtml(p.key)}">${escapeHtml(p.label)}</option>`;
  });
  select.innerHTML = html;
  select.value = "";
}
window.updateV2BankPresetDropdown = updateV2BankPresetDropdown;

function populateV2DefaultBankAccounts() {
  const presets = getV2ConfiguredBankPresets();
  if (presets.length > 0) {
    v2BankAccounts = presets.map(p => ({
      iban: p.iban,
      bank_name: p.bank_name,
      bic: p.bic
    }));
  } else {
    // Fallback if no corporate banks are configured yet
    const primaryIban = document.getElementById("v2PayIban")?.value || "";
    const primaryBic = document.getElementById("v2PayBic")?.value || "";
    v2BankAccounts = [
      { iban: primaryIban || "DE89370400440532013000", bank_name: "Primary Bank", bic: primaryBic || "DBBADEFFXXX" }
    ];
  }
  renderV2BankAccounts();
  updateV2BankPresetDropdown();
}
window.populateV2DefaultBankAccounts = populateV2DefaultBankAccounts;

function insertV2BankPreset(key) {
  if (!key) return;
  const presets = getV2ConfiguredBankPresets();
  const selected = presets.find(p => p.key === key);
  if (selected) {
    v2BankAccounts.push({
      iban: selected.iban,
      bank_name: selected.bank_name,
      bic: selected.bic
    });
    renderV2BankAccounts();
  }
  const select = document.getElementById("v2BankPresetSelect");
  if (select) select.value = "";
}
window.insertV2BankPreset = insertV2BankPreset;

function initV2BankAccounts() {
  if (v2BankAccounts.length === 0) {
    populateV2DefaultBankAccounts();
  } else {
    renderV2BankAccounts();
    updateV2BankPresetDropdown();
  }
}
window.initV2BankAccounts = initV2BankAccounts;

function renderV2BankAccounts() {
  const container = document.getElementById("v2BankAccountsContainer");
  if (!container) return;
  container.innerHTML = "";

  v2BankAccounts.forEach((acc, idx) => {
    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; gap: 0.5rem; background: var(--bg-card); padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid var(--bg-card-border);";
    row.innerHTML = `
      <span style="font-size: 0.72rem; font-weight: 600; color: var(--text-muted); width: 1.6rem;">#${idx + 1}</span>
      <div style="flex: 2;">
        <input type="text" class="v2-input" style="padding: 0.25rem 0.5rem; font-size: 0.76rem;" value="${escapeHtml(acc.iban || '')}" placeholder="IBAN (BT-84)" oninput="updateV2BankAccount(${idx}, 'iban', this.value)">
      </div>
      <div style="flex: 1.5;">
        <input type="text" class="v2-input" style="padding: 0.25rem 0.5rem; font-size: 0.76rem;" value="${escapeHtml(acc.bank_name || '')}" placeholder="Bank Name (BT-85)" oninput="updateV2BankAccount(${idx}, 'bank_name', this.value)">
      </div>
      <div style="flex: 1;">
        <input type="text" class="v2-input" style="padding: 0.25rem 0.5rem; font-size: 0.76rem;" value="${escapeHtml(acc.bic || '')}" placeholder="BIC / SWIFT (BT-86)" oninput="updateV2BankAccount(${idx}, 'bic', this.value)">
      </div>
      <button type="button" class="v2-item-trash" onclick="removeV2BankAccount(${idx})" title="Remove Bank Account">🗑️</button>
    `;
    container.appendChild(row);
  });
}
window.renderV2BankAccounts = renderV2BankAccounts;

function addV2BankAccount() {
  v2BankAccounts.push({ iban: "", bank_name: "", bic: "" });
  renderV2BankAccounts();
}
window.addV2BankAccount = addV2BankAccount;

function removeV2BankAccount(idx) {
  if (v2BankAccounts.length <= 1) {
    alert("At least one payment account is required.");
    return;
  }
  v2BankAccounts.splice(idx, 1);
  renderV2BankAccounts();
}
window.removeV2BankAccount = removeV2BankAccount;

function updateV2BankAccount(idx, field, val) {
  if (v2BankAccounts[idx]) {
    v2BankAccounts[idx][field] = val;
  }
}
window.updateV2BankAccount = updateV2BankAccount;

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
    const badgeLabel = isCharge ? `📈 Charge #${idx + 1} (Zuschlag)` : `🏷️ Discount #${idx + 1} (Nachlass)`;
    const reasonBt = isCharge ? "BT-104" : "BT-97";
    const reasonTitle = isCharge ? "BT-104: Grund für den Zuschlag (Document level charge reason)" : "BT-97: Grund für den Nachlass (Document level allowance reason)";
    const pctBt = isCharge ? "BT-101" : "BT-94";
    const pctTitle = isCharge ? "BT-101: Zuschlagsprozentsatz (Document level charge percentage)" : "BT-94: Nachlassprozentsatz (Document level allowance percentage)";
    const amtBt = isCharge ? "BT-99" : "BT-92";
    const amtTitle = isCharge ? "BT-99: Zuschlagsbetrag auf Dokumentenebene (Document level charge amount)" : "BT-92: Nachlassbetrag auf Dokumentenebene (Document level allowance amount)";

    const catBt = isCharge ? "BT-102" : "BT-95";
    const rateBt = isCharge ? "BT-103" : "BT-96";
    const baseAmtBt = isCharge ? "BT-100" : "BT-93";
    const taxCat = disc.tax_category_code || "S";
    const taxPct = disc.tax_percent !== undefined && disc.tax_percent !== null ? disc.tax_percent : 19.0;

    let itemsNetTotal = 0;
    v2LineItems.forEach(it => {
      const bq = it.price_base_quantity || 1.0;
      let lineDiscounts = 0;
      let lineCharges = 0;
      (it.allowances_charges || []).forEach(ac => {
        const a = parseFloat(ac.amount) || 0;
        if (ac.charge_indicator) lineCharges += a;
        else lineDiscounts += a;
      });
      itemsNetTotal += Math.max(0, ((it.quantity * it.unit_price) / (bq > 0 ? bq : 1.0)) - lineDiscounts + lineCharges);
    });
    const docBaseAmt = disc.base_amount !== undefined && disc.base_amount !== null ? disc.base_amount : itemsNetTotal;

    card.innerHTML = `
      <div class="v2-discount-topbar">
        <div class="v2-discount-title" style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="${isCharge ? 'color: #10b981; font-weight: 600;' : ''}">${badgeLabel}</span>
          <span class="v2-bt-badge" data-bt="${amtBt}">${amtBt}</span>
          <select class="v2-select" style="width: auto; padding: 0.2rem 0.5rem; font-size: 0.75rem;" onchange="updateV2DiscountField(${idx}, 'charge_indicator', this.value === 'charge')">
            <option value="allowance" ${!isCharge ? 'selected' : ''}>Allowance / Discount (-)</option>
            <option value="charge" ${isCharge ? 'selected' : ''}>Charge / Surcharge (+)</option>
          </select>
        </div>
        <div style="font-size: 0.72rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.35rem;">
          <span>Base: €${docBaseAmt.toFixed(2)}</span>
          <span class="v2-bt-badge" data-bt="${baseAmtBt}">${baseAmtBt}</span>
        </div>
        <button type="button" class="v2-item-trash" onclick="removeV2DocumentDiscount(${idx})" title="Remove">🗑️</button>
      </div>
      <div class="v2-grid-4">
        <div class="v2-field" style="grid-column: span 1;">
          <label class="v2-label">
            <span class="v2-label-left">
              Reason / Grund
              <span class="v2-bt-badge" data-bt="${reasonBt}">${reasonBt}</span>
            </span>
          </label>
          <input type="text" id="v2DiscountReason_${idx}" class="v2-input" value="${escapeHtml(disc.reason || "")}" placeholder="${isCharge ? 'e.g. Packaging, Freight, Handling' : 'e.g. Early payment rebate or Loyalty'}" oninput="updateV2DiscountField(${idx}, 'reason', this.value)">
        </div>
        <div class="v2-field">
          <label class="v2-label">
            <span class="v2-label-left">
              Tax Category / Steuersatz <span class="v2-req-star">*</span>
              <span class="v2-bt-badge" data-bt="${catBt}">${catBt}</span>
              <span class="v2-bt-badge" data-bt="${rateBt}">${rateBt}</span>
            </span>
          </label>
          <select class="v2-select" onchange="handleV2DiscountTaxCategoryChange(${idx}, this.value)">
            <option value="S_19" ${taxCat === 'S' && taxPct === 19 ? 'selected' : ''}>Standard 19% (S)</option>
            <option value="S_22" ${taxCat === 'S' && taxPct === 22 ? 'selected' : ''}>Standard 22% (S - SI)</option>
            <option value="S_7" ${taxCat === 'S' && taxPct === 7 ? 'selected' : ''}>Reduced 7% (S)</option>
            <option value="S_9.5" ${taxCat === 'S' && taxPct === 9.5 ? 'selected' : ''}>Reduced 9.5% (S - SI)</option>
            <option value="Z_0" ${taxCat === 'Z' ? 'selected' : ''}>Zero 0% (Z)</option>
            <option value="AE_0" ${taxCat === 'AE' ? 'selected' : ''}>Reverse Charge 0% (AE)</option>
            <option value="E_0" ${taxCat === 'E' ? 'selected' : ''}>Exempt 0% (E)</option>
            <option value="K_0" ${taxCat === 'K' ? 'selected' : ''}>Intra-Community 0% (K)</option>
            <option value="G_0" ${taxCat === 'G' ? 'selected' : ''}>Export 0% (G)</option>
          </select>
        </div>
        <div class="v2-field">
          <label class="v2-label">
            <span class="v2-label-left">
              ${isCharge ? 'Charge %' : 'Discount %'}
              <span class="v2-bt-badge" data-bt="${pctBt}">${pctBt}</span>
            </span>
          </label>
          <input type="number" id="v2DiscountPct_${idx}" step="0.01" min="0" max="100" class="v2-input" value="${disc.percentage !== null && disc.percentage !== undefined ? disc.percentage : ''}" placeholder="e.g. 5" oninput="handleV2DiscountPercentChange(${idx}, this.value)">
        </div>
        <div class="v2-field">
          <label class="v2-label">
            <span class="v2-label-left">
              ${isCharge ? 'Charge (€)' : 'Discount (€)'} <span class="v2-req-star">*</span>
              <span class="v2-bt-badge" data-bt="${amtBt}">${amtBt}</span>
            </span>
          </label>
          <input type="number" id="v2DiscountAmount_${idx}" step="0.01" min="0" class="v2-input" value="${disc.amount || 0}" placeholder="0.00" oninput="handleV2DiscountAmountChange(${idx}, this.value)">
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  recalcV2Totals();
}

function handleV2DiscountTaxCategoryChange(idx, catVal) {
  if (!v2DocumentDiscounts[idx]) return;
  const parts = catVal.split("_");
  v2DocumentDiscounts[idx].tax_category_code = parts[0] || "S";
  v2DocumentDiscounts[idx].tax_percent = parseFloat(parts[1]) || 0.0;
  recalcV2Totals();
}
window.handleV2DiscountTaxCategoryChange = handleV2DiscountTaxCategoryChange;

function addV2DocumentDiscount(isCharge = false) {
  let domCat = "S";
  let domPct = 19.0;
  if (v2LineItems.length > 0) {
    domCat = v2LineItems[0].tax_category_code || "S";
    domPct = v2LineItems[0].tax_percent !== undefined ? v2LineItems[0].tax_percent : 19.0;
  }
  let itemsNet = 0;
  v2LineItems.forEach(it => {
    const bq = it.price_base_quantity || 1.0;
    itemsNet += Math.max(0, (it.quantity * it.unit_price) / (bq > 0 ? bq : 1.0));
  });

  v2DocumentDiscounts.push({
    reason: isCharge ? "Packaging / Freight" : "Document Discount",
    percentage: null,
    amount: 0.0,
    base_amount: itemsNet,
    charge_indicator: Boolean(isCharge),
    tax_category_code: domCat,
    tax_percent: domPct
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

function getDocumentDiscountBaseTotal() {
  let itemsNet = 0;
  v2LineItems.forEach(it => {
    const bq = it.price_base_quantity || 1.0;
    let lineDiscounts = 0;
    let lineCharges = 0;
    (it.allowances_charges || []).forEach(ac => {
      const a = parseFloat(ac.amount) || 0;
      if (ac.charge_indicator) lineCharges += a;
      else lineDiscounts += a;
    });
    itemsNet += Math.max(0, ((it.quantity * it.unit_price) / (bq > 0 ? bq : 1.0)) - lineDiscounts + lineCharges);
  });
  return itemsNet;
}

function handleV2DiscountPercentChange(idx, pctVal) {
  if (!v2DocumentDiscounts[idx]) return;
  const baseTotal = getDocumentDiscountBaseTotal();
  v2DocumentDiscounts[idx].base_amount = baseTotal;

  const pct = parseFloat(pctVal);
  if (!isNaN(pct) && pct >= 0) {
    v2DocumentDiscounts[idx].percentage = pct;
    const calculatedAmt = Math.round(baseTotal * (pct / 100) * 100) / 100;
    v2DocumentDiscounts[idx].amount = calculatedAmt;
  } else {
    v2DocumentDiscounts[idx].percentage = null;
  }
  renderV2DocumentDiscounts();
}
window.handleV2DiscountPercentChange = handleV2DiscountPercentChange;

function handleV2DiscountAmountChange(idx, amtVal) {
  if (!v2DocumentDiscounts[idx]) return;
  const baseTotal = getDocumentDiscountBaseTotal();
  v2DocumentDiscounts[idx].base_amount = baseTotal;

  const amt = parseFloat(amtVal);
  if (!isNaN(amt) && amt >= 0) {
    v2DocumentDiscounts[idx].amount = amt;
    if (baseTotal > 0) {
      v2DocumentDiscounts[idx].percentage = Math.round((amt / baseTotal) * 10000) / 100;
    } else {
      v2DocumentDiscounts[idx].percentage = null;
    }
  } else {
    v2DocumentDiscounts[idx].amount = 0.0;
    v2DocumentDiscounts[idx].percentage = null;
  }
  recalcV2Totals();
}
window.handleV2DiscountAmountChange = handleV2DiscountAmountChange;

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
    const baseQty = it.price_base_quantity || 1.0;
    let lineAllowances = 0;
    let lineCharges = 0;
    if (it.allowances_charges && Array.isArray(it.allowances_charges)) {
      it.allowances_charges.forEach(ac => {
        const amt = parseFloat(ac.amount) || 0;
        if (ac.charge_indicator) lineCharges += amt;
        else lineAllowances += amt;
      });
    } else {
      lineAllowances = it.discount_amount || 0;
    }
    const itemNetSub = (it.quantity * it.unit_price) / (baseQty > 0 ? baseQty : 1.0);
    const lineNet = Math.max(0, itemNetSub - lineAllowances + lineCharges);
    lineNetTotal += lineNet;

    const catCode = (it.tax_category_code || "S").toUpperCase();
    const rateVal = parseFloat(it.tax_percent) || 0.0;
    const rateKey = `${catCode}_${rateVal}`;
    if (!taxGroups[rateKey]) {
      taxGroups[rateKey] = {
        category: catCode,
        rate: rateVal,
        basis: 0,
        tax: 0
      };
    }
    taxGroups[rateKey].basis += lineNet;
    taxGroups[rateKey].tax += Math.round(lineNet * (rateVal / 100) * 100) / 100;

    // Trigger exemption input if 0% or AE, E, G, K
    if (rateVal === 0 || ["E", "AE", "G", "K"].includes(catCode)) {
      hasExemption = true;
    }
  });

  // Calculate document-level allowances (BT-92) and charges (BT-99) allocated to specific tax categories (BT-95 / BT-96)
  let totalDocAllowance = 0;
  let totalDocCharge = 0;
  v2DocumentDiscounts.forEach(d => {
    const amt = Math.max(0, parseFloat(d.amount) || 0);
    if (amt <= 0) return;
    const catCode = (d.tax_category_code || "S").toUpperCase();
    const rateVal = parseFloat(d.tax_percent) || 0.0;
    const rateKey = `${catCode}_${rateVal}`;

    if (!taxGroups[rateKey]) {
      taxGroups[rateKey] = {
        category: catCode,
        rate: rateVal,
        basis: 0,
        tax: 0
      };
    }

    if (d.charge_indicator) {
      totalDocCharge += amt;
      taxGroups[rateKey].basis += amt;
    } else {
      totalDocAllowance += amt;
      taxGroups[rateKey].basis = Math.max(0, taxGroups[rateKey].basis - amt);
    }

    if (rateVal === 0 || ["E", "AE", "G", "K"].includes(catCode)) {
      hasExemption = true;
    }
  });

  const netAdjustment = totalDocCharge - totalDocAllowance;
  const taxableNet = Math.max(0, lineNetTotal + netAdjustment);

  let totalTax = 0;
  const matrixContainer = document.getElementById("v2TaxMatrixContainer");
  if (matrixContainer) {
    matrixContainer.innerHTML = "";
    Object.values(taxGroups).forEach(grp => {
      const effectiveGroupTax = Math.round(grp.basis * (grp.rate / 100) * 100) / 100;
      grp.tax = effectiveGroupTax;
      totalTax += effectiveGroupTax;

      const tile = document.createElement("div");
      tile.className = "v2-tax-tile";
      tile.innerHTML = `
        <div class="v2-tax-tile-label">${grp.rate}% (${grp.category})</div>
        <div class="v2-tax-tile-val">€${effectiveGroupTax.toFixed(2)}</div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">Base: €${grp.basis.toFixed(2)}</div>
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

  // Reveal exemption input if 0% or category E/AE/G/K present
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

  if (!isSeller) {
    partyData.buyer_reference = document.getElementById("v2BuyerRef")?.value.trim() || "";
  }

  if (isSeller) {
    partyData.seller_identifier = document.getElementById("v2SellerIdentifier")?.value.trim() || "";
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
    // Preserve existing buyer_reference & our_supplier_code if current input was blank
    if (!partyData.buyer_reference && settings.saved_parties[listKey][existingIdx].buyer_reference) {
      partyData.buyer_reference = settings.saved_parties[listKey][existingIdx].buyer_reference;
    }
    if (settings.saved_parties[listKey][existingIdx].our_supplier_code) {
      partyData.our_supplier_code = settings.saved_parties[listKey][existingIdx].our_supplier_code;
    }
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
  if (!isSeller) {
    if (party.buyer_reference) {
      setVal("v2BuyerRef", party.buyer_reference);
    }
    // Auto-fill workflow: If buyer profile contains our_supplier_code and #v2SellerIdentifier (BT-29) is empty, populate it
    if (party.our_supplier_code) {
      const sellerIdEl = document.getElementById("v2SellerIdentifier");
      if (sellerIdEl && !sellerIdEl.value.trim()) {
        sellerIdEl.value = party.our_supplier_code;
      }
    }
  }

  if (isSeller) {
    if (party.seller_identifier) setVal("v2SellerIdentifier", party.seller_identifier);
    if (party.phone) setVal("v2SellerPhone", party.phone);
    if (party.email) setVal("v2SellerEmail", party.email);
    if (party.tax_number) setVal("v2SellerTaxNumber", party.tax_number);
    if (party.iban) setVal("v2PayIban", party.iban);
    if (party.bic) setVal("v2PayBic", party.bic);

    if (party.iban) {
      v2BankAccounts = [{
        iban: party.iban,
        bank_name: party.name ? `${party.name} Bank` : "Primary Bank",
        bic: party.bic || ""
      }];
      renderV2BankAccounts();
    } else {
      populateV2DefaultBankAccounts();
    }
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
    const sellerIdentEl = document.getElementById("v2SellerIdentifier");
    if (sellerIdentEl) sellerIdentEl.value = seller.seller_identifier || cfg.seller_identifier || "";
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

    // Payment details & IBAN (BT-84): AI extracted from document or fallback to config
    const extractedIban = inv.payment?.iban || inv.iban || "";
    const extractedBic = inv.payment?.bic || inv.bic || "";
    const extractedBankName = inv.payment?.bank_name || inv.bank_name || "";
    
    if (inv.payment?.bank_accounts && Array.isArray(inv.payment.bank_accounts) && inv.payment.bank_accounts.length > 0) {
      v2BankAccounts = inv.payment.bank_accounts.map(acc => ({
        iban: acc.iban || "",
        bank_name: acc.bank_name || "",
        bic: acc.bic || ""
      }));
    } else if (extractedIban) {
      v2BankAccounts = [{
        iban: extractedIban,
        bank_name: extractedBankName || cfg.seller_bank1_name || "",
        bic: extractedBic || cfg.seller_bank1_bic || ""
      }];
    } else if (cfg.seller_bank1_iban) {
      v2BankAccounts = [{
        iban: cfg.seller_bank1_iban,
        bank_name: cfg.seller_bank1_name || "",
        bic: cfg.seller_bank1_bic || ""
      }];
      if (cfg.seller_bank2_iban) {
        v2BankAccounts.push({
          iban: cfg.seller_bank2_iban,
          bank_name: cfg.seller_bank2_name || "",
          bic: cfg.seller_bank2_bic || ""
        });
      }
    }
    renderV2BankAccounts();

    // Payment terms note & payment reference
    if (inv.payment?.payment_terms) {
      const payTermsEl = document.getElementById("v2PayTerms");
      if (payTermsEl) payTermsEl.value = inv.payment.payment_terms;
    }
    if (inv.payment?.payment_reference || inv.payment_reference) {
      const payRefEl = document.getElementById("v2PayReference");
      if (payRefEl) payRefEl.value = inv.payment?.payment_reference || inv.payment_reference;
    }

    // 1. Automated Customer Profile Matching (Fallback for Missing Address Data e.g. Großkunden-PLZ)
    const savedBuyers = (cfg.saved_parties && Array.isArray(cfg.saved_parties.buyers)) ? cfg.saved_parties.buyers : [];
    const extractedBuyerVat = (inv.buyer?.vat_id || "").trim();
    const extractedBuyerName = (inv.buyer?.name || "").trim();

    // Helper to clean party names for reliable fuzzy matching (e.g. "BMW AG", "Bayerische Motoren Werke AG", punctuation)
    const cleanCompName = (str) => (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    let matchedBuyer = null;
    if (extractedBuyerVat) {
      const cleanVat = extractedBuyerVat.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      matchedBuyer = savedBuyers.find(b => {
        const bVat = (b.vat_id || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        return bVat && bVat === cleanVat;
      });
    }

    if (!matchedBuyer && extractedBuyerName) {
      const targetClean = cleanCompName(extractedBuyerName);
      matchedBuyer = savedBuyers.find(b => {
        const bClean = cleanCompName(b.name || "");
        return bClean && (bClean === targetClean || bClean.includes(targetClean) || targetClean.includes(bClean));
      });
    }

    // Buyer details: Dynamic from extraction payload with graceful profile matching fallback
    const buyerStreetVal = (inv.buyer?.street || "").trim() || (matchedBuyer?.street || "");
    const buyerCityVal = (inv.buyer?.city || "").trim() || (matchedBuyer?.city || "");
    const buyerPostcodeVal = (inv.buyer?.postcode || "").trim() || (matchedBuyer?.postcode || "");
    const buyerCountryVal = (inv.buyer?.country_code || "").trim() || (matchedBuyer?.country_code || "DE");
    const buyerVatVal = extractedBuyerVat || (matchedBuyer?.vat_id || "");
    const buyerNameVal = extractedBuyerName || (matchedBuyer?.name || "");

    if (buyerNameVal) { const el = document.getElementById("v2BuyerName"); if (el) el.value = buyerNameVal; }
    if (buyerVatVal) { const el = document.getElementById("v2BuyerVat"); if (el) el.value = buyerVatVal; }
    if (buyerStreetVal) { const el = document.getElementById("v2BuyerStreet"); if (el) el.value = buyerStreetVal; }
    if (buyerCityVal) { const el = document.getElementById("v2BuyerCity"); if (el) el.value = buyerCityVal; }
    if (buyerPostcodeVal) { const el = document.getElementById("v2BuyerPostcode"); if (el) el.value = buyerPostcodeVal; }
    if (buyerCountryVal) { const el = document.getElementById("v2BuyerCountry"); if (el) el.value = buyerCountryVal; }

    // If extracted buyer_reference (BT-10) is empty and matched buyer profile has default routing ref, fill it
    const buyerRefEl = document.getElementById("v2BuyerRef");
    if (buyerRefEl) {
      if (inv.buyer_reference) {
        buyerRefEl.value = inv.buyer_reference;
      } else if (!buyerRefEl.value.trim() && matchedBuyer?.buyer_reference) {
        buyerRefEl.value = matchedBuyer.buyer_reference;
      }
    }

    // Auto-populate Our Supplier Code at Buyer (BT-29) from matched buyer
    const buyerSuppCodeVal = (inv.buyer?.our_supplier_code || "").trim() || (matchedBuyer?.our_supplier_code || "");
    const buyerSuppCodeEl = document.getElementById("v2BuyerSupplierCode");
    if (buyerSuppCodeEl && buyerSuppCodeVal) {
      buyerSuppCodeEl.value = buyerSuppCodeVal;
    }

    // Auto-fill workflow: If buyer profile has our_supplier_code and invoice mask's #v2SellerIdentifier (BT-29) is empty, auto-populate it
    if (matchedBuyer?.our_supplier_code) {
      const sellerIdEl = document.getElementById("v2SellerIdentifier");
      if (sellerIdEl && !sellerIdEl.value.trim()) {
        sellerIdEl.value = matchedBuyer.our_supplier_code;
      }
    }

    // Delivery & Logistics (BG-13): Auto-populate and expand section if present
    let finalDeliveryDate = inv.delivery?.delivery_date || "";
    // Config option: Auto-sync Delivery Date to Issue Date (Rechnungsdatum = Leistungsdatum)
    if (!finalDeliveryDate && cfg.auto_sync_delivery_date && inv.issue_date) {
      finalDeliveryDate = inv.issue_date;
    }

    if (inv.delivery || finalDeliveryDate) {
      if (inv.delivery?.recipient_name) {
        const el = document.getElementById("v2DelivName");
        if (el) el.value = inv.delivery.recipient_name;
      }
      
      let locId = inv.delivery?.location_id || "";
      if (!locId && inv.delivery?.recipient_name) {
        const mLoc = inv.delivery.recipient_name.match(/Abladestelle(?:\s+Nr\.?)?\s*([A-Za-z0-9\-_]+)/i);
        if (mLoc) locId = mLoc[1];
      }
      if (locId) {
        // Strip non-identifier text if present (e.g., 'Abladestelle Nr. 960' -> '960')
        const cleanLoc = locId.replace(/^.*?(?:Abladestelle|Tor|Gate|Dock)(?:\s+Nr\.?)?\s*/i, "").trim();
        const el = document.getElementById("v2DelivLocationId");
        if (el) el.value = cleanLoc || locId;
      }

      if (finalDeliveryDate) {
        const el = document.getElementById("v2DelivDate");
        if (el) el.value = finalDeliveryDate;
      }
      
      const rawDespatch = inv.delivery?.despatch_advice_reference || inv.delivery?.despatch_advice_id || "";
      const cleanedDespatch = rawDespatch.trim().replace(/^[-:\s]+/, "").trim();
      const bannedLabels = [
        "lieferdatum", "lieferschein", "lieferschein-nr", "nr", "-nr", "bestell-nr", 
        "kundennummer", "kontakt", "lieferanten-nr", "datum", "none", "null", ""
      ];
      const hasDigit = /\d/.test(cleanedDespatch);
      const isBogusDespatch = bannedLabels.includes(cleanedDespatch.toLowerCase()) || !hasDigit || cleanedDespatch.length < 3;
      const finalDespatch = !isBogusDespatch ? cleanedDespatch : "";
      const despatchEl = document.getElementById("v2DelivDespatchRef");
      if (despatchEl) despatchEl.value = finalDespatch;
      
      if (inv.delivery?.street) { const el = document.getElementById("v2DelivStreet"); if (el) el.value = inv.delivery.street; }
      if (inv.delivery?.postcode) { const el = document.getElementById("v2DelivPostcode"); if (el) el.value = inv.delivery.postcode; }
      if (inv.delivery?.city) { const el = document.getElementById("v2DelivCity"); if (el) el.value = inv.delivery.city; }
      if (inv.delivery?.country_code) { const el = document.getElementById("v2DelivCountry"); if (el) el.value = inv.delivery.country_code; }

      const delivSection = document.getElementById("v2DeliverySection");
      if (delivSection && (inv.delivery?.recipient_name || finalDeliveryDate || locId || finalDespatch)) {
        delivSection.style.display = "block";
      }
    }

    // 2. Line items decomposition & structured attribute binding
    if (inv.items && inv.items.length > 0) {
      v2LineItems = inv.items.map(it => {
        // Extract concise name vs extended technical description
        let rawTitle = (it.name || it.item_name || "Item").trim();
        let rawDesc = (it.description || "").trim();

        // If rawTitle contains multi-line text, isolate first concise line as name and rest into description
        if (rawTitle.includes("\n") && !rawDesc) {
          const lines = rawTitle.split("\n").map(l => l.trim()).filter(Boolean);
          rawTitle = lines[0] || "Item";
          rawDesc = lines.slice(1).join("\n");
        }

        return {
          name: rawTitle,
          description: rawDesc,
          seller_item_id: it.seller_item_id || "",
          buyer_item_id: it.buyer_item_id || "",
          order_line_reference: it.order_line_reference || "",
          standard_item_id: it.standard_item_id || "",
          standard_item_id_scheme: it.standard_item_id_scheme || "0160",
          quantity: Number(it.quantity) || 1,
          unit_code: it.unit_code || "C62",
          unit_price: Number(it.unit_price) || 0,
          price_base_quantity: Number(it.price_base_quantity) || 1,
          price_base_unit: it.price_base_unit || "",
          tax_category_code: it.tax_category_code || "S",
          tax_percent: it.tax_percent !== undefined ? Number(it.tax_percent) : 19.0,
          discount_amount: Number(it.discount_amount) || 0.0,
          discount_percent: it.discount_percent !== null && it.discount_percent !== undefined ? Number(it.discount_percent) : null,
          allowances_charges: Array.isArray(it.allowances_charges) ? it.allowances_charges : []
        };
      });
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
    const baseQty = it.price_base_quantity || 1.0;
    const itemGrossBase = (it.quantity * it.unit_price) / (baseQty > 0 ? baseQty : 1.0);
    let lineAllowances = 0;
    let lineCharges = 0;
    const cleanAC = (it.allowances_charges || []).filter(ac => (parseFloat(ac.amount) || 0) > 0).map(ac => ({
      charge_indicator: Boolean(ac.charge_indicator),
      amount: parseFloat(ac.amount) || 0,
      percentage: ac.percentage !== undefined && ac.percentage !== null ? parseFloat(ac.percentage) : null,
      base_amount: ac.base_amount !== undefined && ac.base_amount !== null ? parseFloat(ac.base_amount) : itemGrossBase,
      reason: ac.reason || (ac.charge_indicator ? "Item Surcharge" : "Item Discount")
    }));
    cleanAC.forEach(ac => {
      if (ac.charge_indicator) lineCharges += ac.amount;
      else lineAllowances += ac.amount;
    });

    const itemNetSub = itemGrossBase;
    const lineNet = Math.max(0, itemNetSub - lineAllowances + lineCharges);
    lineNetTotal += lineNet;

    const catCode = (it.tax_category_code || "S").toUpperCase();
    const rateVal = parseFloat(it.tax_percent) || 0.0;
    const rateKey = `${catCode}_${rateVal}`;
    if (!taxBreakdownMap[rateKey]) {
      const exReason = ["E", "AE", "G", "K"].includes(catCode) || rateVal === 0 
        ? (document.getElementById("v2ExemptionReason")?.value || "Reverse charge / Tax exempt") 
        : null;
      const exCode = ["E", "AE", "G", "K"].includes(catCode) || rateVal === 0 
        ? (document.getElementById("v2ExemptionReasonCode")?.value || null) 
        : null;

      taxBreakdownMap[rateKey] = {
        tax_category_code: catCode,
        tax_percent: rateVal,
        basis_amount: 0,
        tax_amount: 0,
        exemption_reason: exReason,
        exemption_reason_code: exCode
      };
    }
    taxBreakdownMap[rateKey].basis_amount += lineNet;

    return {
      line_id: String(idx + 1),
      name: it.name,
      description: it.description || null,
      seller_item_id: it.seller_item_id || null,
      buyer_item_id: it.buyer_item_id || null,
      standard_item_id: it.standard_item_id || null,
      standard_item_id_scheme: it.standard_item_id_scheme || "0160",
      order_line_reference: it.order_line_reference || null,
      price_base_quantity: baseQty,
      price_base_unit: it.price_base_unit || it.unit_code,
      item_serial_number: it.item_serial_number || null,
      quantity: it.quantity,
      unit_code: it.unit_code,
      unit_price: it.unit_price,
      line_total_amount: lineNet,
      tax_category_code: catCode,
      tax_percent: rateVal,
      discount_amount: lineAllowances,
      allowances_charges: cleanAC
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
      const catCode = (d.tax_category_code || "S").toUpperCase();
      const rateVal = parseFloat(d.tax_percent) || 0.0;
      const rateKey = `${catCode}_${rateVal}`;

      if (!taxBreakdownMap[rateKey]) {
        const exReason = ["E", "AE", "G", "K"].includes(catCode) || rateVal === 0 
          ? (document.getElementById("v2ExemptionReason")?.value || "Reverse charge / Tax exempt") 
          : null;
        const exCode = ["E", "AE", "G", "K"].includes(catCode) || rateVal === 0 
          ? (document.getElementById("v2ExemptionReasonCode")?.value || null) 
          : null;

        taxBreakdownMap[rateKey] = {
          tax_category_code: catCode,
          tax_percent: rateVal,
          basis_amount: 0,
          tax_amount: 0,
          exemption_reason: exReason,
          exemption_reason_code: exCode
        };
      }

      if (isCharge) {
        totalDocCharge += amt;
        taxBreakdownMap[rateKey].basis_amount += amt;
      } else {
        totalDocAllowance += amt;
        taxBreakdownMap[rateKey].basis_amount = Math.max(0, taxBreakdownMap[rateKey].basis_amount - amt);
      }

      return {
        reason: d.reason || (isCharge ? "Packaging / Charge" : "Document Discount"),
        percentage: d.percentage !== null && d.percentage !== undefined ? parseFloat(d.percentage) : null,
        amount: amt,
        charge_indicator: isCharge,
        tax_category_code: catCode,
        tax_percent: rateVal,
        base_amount: d.base_amount !== undefined && d.base_amount !== null ? parseFloat(d.base_amount) : lineNetTotal
      };
    });

  const netAdjustment = totalDocCharge - totalDocAllowance;
  let taxTotal = 0;
  Object.values(taxBreakdownMap).forEach(grp => {
    const effectiveTax = Math.round(grp.basis_amount * (grp.tax_percent / 100) * 100) / 100;
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

  // Bank accounts harvesting (BG-17)
  const cleanBankAccounts = (v2BankAccounts || [])
    .filter(a => (a.iban || "").trim().length > 0)
    .map(a => ({
      iban: (a.iban || "").replace(/\s+/g, "").toUpperCase(),
      bank_name: (a.bank_name || "").trim() || null,
      bic: (a.bic || "").replace(/\s+/g, "").toUpperCase() || null
    }));

  const primaryIban = cleanBankAccounts.length > 0 ? cleanBankAccounts[0].iban : (document.getElementById("v2PayIban")?.value.trim() || "");
  const primaryBic = cleanBankAccounts.length > 0 ? cleanBankAccounts[0].bic : (document.getElementById("v2PayBic")?.value.trim() || "");
  const primaryBankName = cleanBankAccounts.length > 0 ? cleanBankAccounts[0].bank_name : null;

  // Factoring / Payee details (BG-10)
  const factoringName = document.getElementById("v2FactoringName")?.value.trim() || null;
  const factoringId = document.getElementById("v2FactoringId")?.value.trim() || null;
  const factoringVat = document.getElementById("v2FactoringVat")?.value.trim() || null;
  const factoringPayee = (factoringName || factoringId || factoringVat) ? {
    name: factoringName,
    payee_id: factoringId,
    vat_id: factoringVat
  } : null;

  return {
    invoice_number: document.getElementById("v2InvNumber")?.value.trim() || "",
    issue_date: document.getElementById("v2IssueDate")?.value || "",
    due_date: document.getElementById("v2DueDate")?.value || null,
    currency: document.getElementById("v2Currency")?.value || "EUR",
    invoice_type_code: isOrderX ? "220" : docType,
    document_format: isOrderX ? "orderx" : "zugferd",
    buyer_reference: document.getElementById("v2BuyerRef")?.value.trim() || "",
    purchase_order_number: document.getElementById("v2PurchaseOrder")?.value.trim() || null,
    sales_order_number: document.getElementById("v2SalesOrder")?.value.trim() || null,
    contract_reference: document.getElementById("v2ContractRef")?.value.trim() || null,
    cost_center: document.getElementById("v2CostCenter")?.value.trim() || null,
    preceding_invoice_number: document.getElementById("v2PrecedingInvNumber")?.value.trim() || null,
    preceding_invoice_date: document.getElementById("v2PrecedingInvDate")?.value || null,
    service_period_start: document.getElementById("v2ServiceStart")?.value || null,
    service_period_end: document.getElementById("v2ServiceEnd")?.value || null,
    prepaid_amount: prepaidAmount,
    discounts: docDiscounts,
    vat_exemption_reason: document.getElementById("v2ExemptionReason")?.value || null,
    vat_exemption_reason_code: document.getElementById("v2ExemptionReasonCode")?.value || null,
    seller: {
      name: document.getElementById("v2SellerName")?.value.trim() || "",
      company_legal_form: document.getElementById("v2SellerRegId")?.value.trim() || null,
      legal_info: document.getElementById("v2SellerLegalInfo")?.value.trim() || null,
      endpoint_id: document.getElementById("v2SellerEndpointId")?.value.trim() || null,
      endpoint_scheme: document.getElementById("v2SellerEndpointScheme")?.value || "9930",
      vat_id: document.getElementById("v2SellerVat")?.value.trim() || "",
      tax_number: document.getElementById("v2SellerTaxNumber")?.value.trim() || "",
      tax_registration_id: document.getElementById("v2SellerTaxNumber")?.value.trim() || "",
      seller_identifier: document.getElementById("v2SellerIdentifier")?.value.trim() || null,
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
      endpoint_id: document.getElementById("v2BuyerEndpointId")?.value.trim() || null,
      endpoint_scheme: document.getElementById("v2BuyerEndpointScheme")?.value || "9930",
      vat_id: document.getElementById("v2BuyerVat")?.value.trim() || "",
      street: document.getElementById("v2BuyerStreet")?.value.trim() || "",
      city: document.getElementById("v2BuyerCity")?.value.trim() || "",
      postcode: document.getElementById("v2BuyerPostcode")?.value.trim() || "",
      country_code: document.getElementById("v2BuyerCountry")?.value || "DE",
      contact_name: document.getElementById("v2BuyerContactName")?.value.trim() || null,
      contact_phone: document.getElementById("v2BuyerPhone")?.value.trim() || null,
      contact_email: document.getElementById("v2BuyerEmail")?.value.trim() || null,
      our_supplier_code: document.getElementById("v2BuyerSupplierCode")?.value.trim() || null
    },
    delivery: {
      recipient_name: document.getElementById("v2DelivName")?.value.trim() || null,
      location_id: document.getElementById("v2DelivLocationId")?.value.trim() || null,
      location_scheme: document.getElementById("v2DelivLocationScheme")?.value || "0088",
      delivery_date: document.getElementById("v2DelivDate")?.value || null,
      despatch_advice_id: document.getElementById("v2DelivDespatchRef")?.value.trim() || null,
      street: document.getElementById("v2DelivStreet")?.value.trim() || null,
      city: document.getElementById("v2DelivCity")?.value.trim() || null,
      postcode: document.getElementById("v2DelivPostcode")?.value.trim() || null,
      country_code: document.getElementById("v2DelivCountry")?.value || "DE"
    },
    payment: {
      iban: primaryIban,
      bic: primaryBic,
      bank_name: primaryBankName,
      bank_accounts: cleanBankAccounts,
      payment_means_code: document.getElementById("v2PayMethod")?.value || "58",
      payment_terms: document.getElementById("v2PayTerms")?.value.trim() || "",
      payment_reference: document.getElementById("v2PayReference")?.value.trim() || null,
      factoring_payee: factoringPayee
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

  const docType = invData.invoice_type_code;

  // Due Date (BT-9): mandatory for 380 and 384, optional for 381 (Credit Note)
  if (docType === "380" || docType === "384") {
    if (!invData.due_date) {
      errors.push("Payment Due Date (BT-9) is mandatory for Commercial Invoices (380) and Corrected Invoices (384).");
    }
  }

  // Preceding Invoice (BG-3 / BT-25): strictly required for 381 and 384
  if (docType === "381" || docType === "384") {
    if (!invData.preceding_invoice_number) {
      errors.push("Credit Notes (381) and Corrected Invoices (384) strictly require a Preceding Invoice Number (BT-25).");
    }
  }

  // Credit Note (381) Positive Quantities rule (EN 16931 Schematron rule)
  if (docType === "381") {
    invData.items.forEach((it, idx) => {
      if (it.quantity < 0) {
        errors.push(`Line #${idx + 1}: Quantity must be positive on Credit Notes (381). The document type code already conveys the credit direction.`);
      }
      if (it.unit_price < 0) {
        errors.push(`Line #${idx + 1}: Unit price must be positive on Credit Notes (381).`);
      }
      if (it.line_total_amount < 0) {
        errors.push(`Line #${idx + 1}: Line net total must be positive on Credit Notes (381).`);
      }
    });
    if (invData.grand_total < 0) {
      errors.push("Grand total must be positive on Credit Notes (381).");
    }
  }

  // VAT Exemption Reason & Code (BT-120 & BT-121): required when 0% or categories AE, E, G, K are used
  const hasExemptItem = invData.items.some(it => {
    const cat = (it.tax_category_code || "S").toUpperCase();
    const rate = parseFloat(it.tax_percent) || 0;
    return rate === 0 || ["AE", "E", "G", "K"].includes(cat);
  });
  if (hasExemptItem) {
    if (!invData.vat_exemption_reason || !invData.vat_exemption_reason.trim()) {
      errors.push("VAT Exemption Reason Text (BT-120) is required for 0% / reverse charge / exempt lines (e.g. 'Reverse charge according to §13b UStG / Art. 194/196').");
    }
    if (!invData.vat_exemption_reason_code || !invData.vat_exemption_reason_code.trim()) {
      errors.push("VAT Exemption Reason Code (BT-121) is required for 0% / reverse charge / exempt lines (e.g. 'VATEX-EU-AE').");
    }
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
    const showBtTags = Boolean(document.getElementById("v2ShowBtTags")?.checked);

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
        show_bt_tags: showBtTags,
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
  const btTagsEl = document.getElementById("v2ShowBtTags");
  if (btTagsEl) {
    btTagsEl.checked = Boolean(inv?.show_bt_tags);
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

  setVal("v2SalesOrder", inv.sales_order_number);
  setVal("v2ContractRef", inv.contract_reference);
  setVal("v2CostCenter", inv.cost_center);

  // Seller
  const seller = inv.seller || {};
  setVal("v2SellerName", seller.name);
  setVal("v2SellerVat", seller.vat_id);
  setVal("v2SellerTaxNumber", seller.tax_number || seller.tax_registration_id);
  setVal("v2SellerIdentifier", seller.seller_identifier);
  setVal("v2SellerStreet", seller.street);
  setVal("v2SellerCity", seller.city);
  setVal("v2SellerPostcode", seller.postcode);
  setVal("v2SellerCountry", seller.country_code || "DE");
  setVal("v2SellerPhone", seller.contact_phone);
  setVal("v2SellerEmail", seller.contact_email);
  setVal("v2SellerRegId", seller.company_legal_form || seller.commercial_register_number);
  setVal("v2SellerLegalInfo", seller.legal_info);
  setVal("v2SellerEndpointId", seller.endpoint_id);
  setVal("v2SellerEndpointScheme", seller.endpoint_scheme || "0088");

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
  setVal("v2BuyerSupplierCode", buyer.our_supplier_code);
  setVal("v2BuyerEndpointId", buyer.endpoint_id);
  setVal("v2BuyerEndpointScheme", buyer.endpoint_scheme || "0088");
  if (buyer.contact_name || buyer.contact_phone || buyer.contact_email) {
    const bSec = document.getElementById("v2BuyerContactSec");
    if (bSec) bSec.style.display = "block";
  }

  // Delivery
  const deliv = inv.delivery || {};
  setVal("v2DelivName", deliv.recipient_name);
  setVal("v2DelivLocationId", deliv.location_id);
  setVal("v2DelivLocationScheme", deliv.location_scheme || "0088");
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
  setVal("v2PayReference", pay.payment_reference || inv.payment_reference || "");

  // Multiple Bank Accounts
  if (pay.bank_accounts && Array.isArray(pay.bank_accounts) && pay.bank_accounts.length > 0) {
    v2BankAccounts = pay.bank_accounts.map(acc => ({
      iban: acc.iban || "",
      bank_name: acc.bank_name || "",
      bic: acc.bic || ""
    }));
  } else if (pay.iban) {
    v2BankAccounts = [{
      iban: pay.iban || "",
      bank_name: pay.bank_name || "",
      bic: pay.bic || ""
    }];
  } else {
    v2BankAccounts = [];
  }
  renderV2BankAccounts();

  // Factoring Payee (BG-10)
  const factoringToggle = document.getElementById("v2FactoringToggle");
  const factoringSec = document.getElementById("v2FactoringSection");
  const payee = inv.factoring_payee || {};
  if (payee.name || payee.payee_id || payee.vat_id) {
    if (factoringToggle) factoringToggle.checked = true;
    if (factoringSec) factoringSec.style.display = "block";
    setVal("v2FactoringName", payee.name);
    setVal("v2FactoringId", payee.payee_id);
    setVal("v2FactoringVat", payee.vat_id);
  } else {
    if (factoringToggle) factoringToggle.checked = false;
    if (factoringSec) factoringSec.style.display = "none";
    setVal("v2FactoringName", "");
    setVal("v2FactoringId", "");
    setVal("v2FactoringVat", "");
  }

  // Exemption
  setVal("v2ExemptionReason", inv.vat_exemption_reason || "");
  setVal("v2ExemptionReasonCode", inv.vat_exemption_reason_code || "");

  // Line items
  const items = inv.items || inv.line_items || [];
  if (items.length > 0) {
    v2LineItems = items.map(it => ({
      name: it.name || it.item_name || "Item",
      description: it.description || "",
      seller_item_id: it.seller_item_id || "",
      buyer_item_id: it.buyer_item_id || "",
      standard_item_id: it.standard_item_id || "",
      standard_item_id_scheme: it.standard_item_id_scheme || "0160",
      order_line_reference: it.order_line_reference || "",
      quantity: Number(it.quantity) || 1,
      unit_code: it.unit_code || "C62",
      unit_price: Number(it.unit_price) || 0,
      price_base_quantity: Number(it.price_base_quantity) || 1,
      price_base_unit: it.price_base_unit || "",
      tax_category_code: it.tax_category_code || "S",
      tax_percent: it.tax_percent !== undefined ? Number(it.tax_percent) : 19.0,
      discount_amount: Number(it.discount_amount) || 0.0,
      discount_percent: it.discount_percent || null,
      allowances_charges: Array.isArray(it.allowances_charges) ? it.allowances_charges.map(ac => ({
        charge_indicator: Boolean(ac.charge_indicator),
        amount: Number(ac.amount) || 0.0,
        reason: ac.reason || "",
        reason_code: ac.reason_code || "",
        percentage: ac.percentage !== null && ac.percentage !== undefined ? Number(ac.percentage) : null
      })) : []
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

