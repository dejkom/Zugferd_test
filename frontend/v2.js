// =========================================================================
// ZUGFeRD Studio v2 Client Engine
// Matches GetZUGFeRD.com Guided Flow with 6 Document Types
// =========================================================================

let v2LineItems = [];
let v2DocumentDiscounts = [];
let v2TokenUsage = null;

// Initialize on script load
function initV2Studio() {
  initV2LineItems();
  initV2DocumentDiscounts();
  populateV2SellerDefaults();
  updateV2DocumentTypeFields();
  loadV2SavedPartiesDropdowns();
  recalcV2Totals();
}

// 1. Populate Seller from Configuration
function populateV2SellerDefaults() {
  const settings = window.cachedCompanySettings || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && (!el.value || el.value.trim() === "")) el.value = val || "";
  };

  setVal("v2SellerName", settings.seller_name || "Acme Solutions Ltd");
  setVal("v2SellerVat", settings.seller_vat || "DE123456789");
  setVal("v2SellerStreet", settings.seller_street || "Bahnhofstrasse 10");
  setVal("v2SellerCity", settings.seller_city || "Berlin");
  setVal("v2SellerPostcode", "10115");
  setVal("v2SellerCountry", settings.seller_country || "DE");
  setVal("v2SellerPhone", settings.seller_phone || "");
  setVal("v2SellerFax", settings.seller_fax || "");
  setVal("v2PayIban", settings.seller_bank1_iban || "DE89370400440532013000");
  setVal("v2PayBic", settings.seller_bank1_bic || "DBBADEFFXXX");
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
  v2LineItems = [
    {
      name: "Software Consulting & Implementation",
      quantity: 10,
      unit_code: "HUR",
      unit_price: 120.0,
      tax_category_code: "S",
      tax_percent: 19.0,
      discount_amount: 0.0,
      discount_percent: null
    },
    {
      name: "Cloud Server Infrastructure Hosting",
      quantity: 1,
      unit_code: "MON",
      unit_price: 150.0,
      tax_category_code: "S",
      tax_percent: 19.0,
      discount_amount: 0.0,
      discount_percent: null
    }
  ];
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
          <label class="v2-label">Description *</label>
          <input type="text" class="v2-input" value="${escapeHtml(item.name)}" oninput="updateV2ItemField(${idx}, 'name', this.value)" placeholder="Product or consulting deliverable">
        </div>
        <div class="v2-grid-4">
          <div class="v2-field">
            <label class="v2-label">Qty</label>
            <input type="number" step="0.01" min="0.01" class="v2-input" value="${item.quantity}" oninput="updateV2ItemField(${idx}, 'quantity', parseFloat(this.value)||0)">
          </div>
          <div class="v2-field">
            <label class="v2-label">Unit</label>
            <select class="v2-select" onchange="updateV2ItemField(${idx}, 'unit_code', this.value)">
              <option value="C62" ${item.unit_code === "C62" ? "selected" : ""}>Piece (C62)</option>
              <option value="HUR" ${item.unit_code === "HUR" ? "selected" : ""}>Hour (HUR)</option>
              <option value="DAY" ${item.unit_code === "DAY" ? "selected" : ""}>Day (DAY)</option>
              <option value="MON" ${item.unit_code === "MON" ? "selected" : ""}>Month (MON)</option>
              <option value="KGM" ${item.unit_code === "KGM" ? "selected" : ""}>Kilogram (KGM)</option>
            </select>
          </div>
          <div class="v2-field">
            <label class="v2-label">Unit Price (€)</label>
            <input type="number" step="0.01" class="v2-input" value="${item.unit_price}" oninput="updateV2ItemField(${idx}, 'unit_price', parseFloat(this.value)||0)">
          </div>
          <div class="v2-field">
            <label class="v2-label">Tax Rate</label>
            <select class="v2-select" onchange="handleV2ItemTaxChange(${idx}, this.value)">
              <option value="19.0:S" ${item.tax_percent === 19 ? "selected" : ""}>19% Standard (S)</option>
              <option value="7.0:S" ${item.tax_percent === 7 ? "selected" : ""}>7% Reduced (S)</option>
              <option value="0.0:AE" ${item.tax_category_code === "AE" ? "selected" : ""}>0% Reverse Charge (AE)</option>
              <option value="0.0:E" ${item.tax_category_code === "E" ? "selected" : ""}>0% Exempt (E)</option>
              <option value="0.0:Z" ${item.tax_category_code === "Z" ? "selected" : ""}>0% Zero Rated (Z)</option>
            </select>
          </div>
        </div>
        <div style="display: flex; justify-content: flex-end; align-items: center; gap: 1rem; border-top: 1px dashed var(--bg-card-border); padding-top: 0.5rem; margin-top: 0.25rem;">
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            Line Net Total: <strong style="color: var(--text-main); font-size: 0.95rem;">€${lineTotal.toFixed(2)}</strong>
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
  const parts = valStr.split(":");
  if (v2LineItems[idx] && parts.length === 2) {
    v2LineItems[idx].tax_percent = parseFloat(parts[0]) || 0.0;
    v2LineItems[idx].tax_category_code = parts[1] || "S";
    renderV2LineItems();
  }
}
window.handleV2ItemTaxChange = handleV2ItemTaxChange;

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
        No document-level discounts applied. Click "+ Add Discount" to add an early payment rebate or percentage discount.
      </div>
    `;
    recalcV2Totals();
    return;
  }

  container.innerHTML = "";
  v2DocumentDiscounts.forEach((disc, idx) => {
    const card = document.createElement("div");
    card.className = "v2-discount-card";
    card.innerHTML = `
      <div class="v2-discount-topbar">
        <div class="v2-discount-title">
          <span>🏷️ Discount #${idx + 1}</span>
        </div>
        <button type="button" class="v2-item-trash" onclick="removeV2DocumentDiscount(${idx})" title="Remove Discount">🗑️</button>
      </div>
      <div class="v2-grid-3">
        <div class="v2-field" style="grid-column: span 1;">
          <label class="v2-label">Reason / Description</label>
          <input type="text" class="v2-input" value="${escapeHtml(disc.reason || "")}" placeholder="e.g. Early payment rebate or Loyalty" oninput="updateV2DiscountField(${idx}, 'reason', this.value)">
        </div>
        <div class="v2-field">
          <label class="v2-label">Discount % (Optional)</label>
          <input type="number" step="0.1" min="0" max="100" class="v2-input" value="${disc.percentage !== null && disc.percentage !== undefined ? disc.percentage : ''}" placeholder="e.g. 5" oninput="handleV2DiscountPercentChange(${idx}, this.value)">
        </div>
        <div class="v2-field">
          <label class="v2-label">Discount Amount (€) *</label>
          <input type="number" step="0.01" min="0" class="v2-input" value="${disc.amount || 0}" placeholder="0.00" oninput="updateV2DiscountField(${idx}, 'amount', parseFloat(this.value)||0)">
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  recalcV2Totals();
}

function addV2DocumentDiscount() {
  v2DocumentDiscounts.push({
    reason: "Document Discount",
    percentage: null,
    amount: 0.0
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
    recalcV2Totals();
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

  // Deduct document-level discounts
  let totalDocDiscount = 0;
  v2DocumentDiscounts.forEach(d => {
    totalDocDiscount += Math.max(0, parseFloat(d.amount) || 0);
  });

  const discountedNet = Math.max(0, lineNetTotal - totalDocDiscount);

  // If there is a document discount, adjust tax proportionally across groups
  let totalTax = 0;
  const matrixContainer = document.getElementById("v2TaxMatrixContainer");
  if (matrixContainer) {
    matrixContainer.innerHTML = "";
    Object.values(taxGroups).forEach(grp => {
      // Pro-rate basis if document discount exists
      const groupRatio = lineNetTotal > 0 ? (grp.basis / lineNetTotal) : 0;
      const effectiveGroupBasis = Math.max(0, grp.basis - (totalDocDiscount * groupRatio));
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

  const grandTotal = Math.round((discountedNet + totalTax) * 100) / 100;
  const dueAmount = Math.max(0, Math.round((grandTotal - prepaidAmount) * 100) / 100);

  // Update KPI strip
  const setTxt = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setTxt("v2TotalNet", `€${lineNetTotal.toFixed(2)}`);
  
  const discountWrapper = document.getElementById("v2TotalDiscountWrapper");
  if (discountWrapper) {
    if (totalDocDiscount > 0) {
      discountWrapper.style.display = "block";
      setTxt("v2TotalDiscount", `-€${totalDocDiscount.toFixed(2)}`);
    } else {
      discountWrapper.style.display = "none";
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

  const fieldMapping = {
    "v2InvNumber": scores.invoice_number || "HIGH",
    "v2IssueDate": scores.issue_date || "HIGH",
    "v2DueDate": scores.due_date || (document.getElementById("v2DueDate")?.value ? "HIGH" : "MEDIUM"),
    "v2Currency": scores.currency || "HIGH",
    "v2BuyerRef": scores.buyer_reference || (document.getElementById("v2BuyerRef")?.value ? "MEDIUM" : "LOW"),
    "v2SellerName": scores.seller_name || "HIGH",
    "v2SellerVat": scores.seller_vat || "HIGH",
    "v2SellerStreet": scores.seller_street || "HIGH",
    "v2SellerCity": scores.seller_city || "HIGH",
    "v2SellerPostcode": scores.seller_city || "HIGH",
    "v2BuyerName": scores.buyer_name || "HIGH",
    "v2BuyerVat": scores.buyer_vat || "HIGH",
    "v2BuyerStreet": scores.buyer_street || "HIGH",
    "v2BuyerCity": scores.buyer_city || "HIGH",
    "v2BuyerPostcode": scores.buyer_city || "HIGH",
    "v2PayIban": scores.iban || "HIGH",
    "v2PayBic": scores.bic || "HIGH"
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

  if (bannerTitle) bannerTitle.textContent = `Extracting ${file.name} with AI...`;
  if (bannerDesc) bannerDesc.textContent = "Parsing parties, line items, discounts, and totals...";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const upRes = await fetch("/api/upload", { method: "POST", body: formData });
    const upData = await upRes.json();
    if (!upRes.ok) throw new Error(upData.detail || "Upload failed");

    const apiKey = (typeof getStoredApiKey === "function" ? getStoredApiKey() : "") || undefined;
    const extRes = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: upData.file_id, api_key: apiKey })
    });
    const extData = await extRes.json();
    if (!extRes.ok) throw new Error(extData.detail || "Extraction failed");

    // Populate v2 form
    const inv = extData.invoice_data;
    v2TokenUsage = extData.usage || null;

    if (inv.invoice_number) document.getElementById("v2InvNumber").value = inv.invoice_number;
    if (inv.issue_date) document.getElementById("v2IssueDate").value = inv.issue_date;
    if (inv.due_date) document.getElementById("v2DueDate").value = inv.due_date;
    if (inv.currency) document.getElementById("v2Currency").value = inv.currency;
    if (inv.buyer_reference) document.getElementById("v2BuyerRef").value = inv.buyer_reference;

    if (inv.seller?.name) document.getElementById("v2SellerName").value = inv.seller.name;
    if (inv.seller?.vat_id) document.getElementById("v2SellerVat").value = inv.seller.vat_id;
    if (inv.seller?.street) document.getElementById("v2SellerStreet").value = inv.seller.street;
    if (inv.seller?.city) document.getElementById("v2SellerCity").value = inv.seller.city;
    if (inv.seller?.postcode) document.getElementById("v2SellerPostcode").value = inv.seller.postcode;

    if (inv.buyer?.name) document.getElementById("v2BuyerName").value = inv.buyer.name;
    if (inv.buyer?.vat_id) document.getElementById("v2BuyerVat").value = inv.buyer.vat_id;
    if (inv.buyer?.street) document.getElementById("v2BuyerStreet").value = inv.buyer.street;
    if (inv.buyer?.city) document.getElementById("v2BuyerCity").value = inv.buyer.city;
    if (inv.buyer?.postcode) document.getElementById("v2BuyerPostcode").value = inv.buyer.postcode;

    if (inv.payment?.iban) document.getElementById("v2PayIban").value = inv.payment.iban;
    if (inv.payment?.bic) document.getElementById("v2PayBic").value = inv.payment.bic;

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

    // Discounts
    if (inv.discounts && inv.discounts.length > 0) {
      v2DocumentDiscounts = inv.discounts.map(d => ({
        reason: d.reason || "Document Discount",
        percentage: d.percentage || null,
        amount: d.amount || 0.0
      }));
      renderV2DocumentDiscounts();
    }

    // Apply confidence badges like in v1
    if (inv.confidence_scores) {
      applyV2ConfidenceScores(inv.confidence_scores);
    }

    if (bannerTitle) bannerTitle.textContent = `✅ Prefilled from ${file.name}!`;
    if (bannerDesc) bannerDesc.textContent = "Values have been populated into the fields below with AI confidence indicators.";
  } catch (err) {
    alert("Prefill error: " + err.message);
    if (bannerTitle) bannerTitle.textContent = "Have an existing invoice?";
    if (bannerDesc) bannerDesc.textContent = "Upload a PDF or Word file and AI will prefill the form";
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

  // Calculate discounts & adjusted tax
  let totalDocDiscount = 0;
  const docDiscounts = v2DocumentDiscounts
    .filter(d => (parseFloat(d.amount) || 0) > 0)
    .map(d => ({
      reason: d.reason || "Document Discount",
      percentage: d.percentage !== null && d.percentage !== undefined ? parseFloat(d.percentage) : null,
      amount: parseFloat(d.amount) || 0.0
    }));

  docDiscounts.forEach(d => { totalDocDiscount += d.amount; });

  let taxTotal = 0;
  Object.values(taxBreakdownMap).forEach(grp => {
    const groupRatio = lineNetTotal > 0 ? (grp.basis_amount / lineNetTotal) : 0;
    const effectiveBasis = Math.max(0, grp.basis_amount - (totalDocDiscount * groupRatio));
    const effectiveTax = Math.round(effectiveBasis * (grp.tax_percent / 100) * 100) / 100;
    grp.basis_amount = effectiveBasis;
    grp.tax_amount = effectiveTax;
    taxTotal += effectiveTax;
  });

  const discountedNet = Math.max(0, lineNetTotal - totalDocDiscount);
  const prepaidAmount = parseFloat(document.getElementById("v2PrepaidAmount")?.value) || 0.0;
  const grandTotal = Math.round((discountedNet + taxTotal) * 100) / 100;
  const dueAmount = Math.max(0, Math.round((grandTotal - prepaidAmount) * 100) / 100);

  return {
    invoice_number: document.getElementById("v2InvNumber")?.value.trim() || `INV-${Date.now().toString().slice(-6)}`,
    issue_date: document.getElementById("v2IssueDate")?.value || new Date().toISOString().split("T")[0],
    due_date: document.getElementById("v2DueDate")?.value || null,
    currency: document.getElementById("v2Currency")?.value || "EUR",
    invoice_type_code: isOrderX ? "220" : docType,
    document_format: isOrderX ? "orderx" : "zugferd",
    buyer_reference: document.getElementById("v2BuyerRef")?.value.trim() || "N/A",
    purchase_order_number: document.getElementById("v2PurchaseOrder")?.value.trim() || null,
    preceding_invoice_number: document.getElementById("v2PrecedingInvNumber")?.value.trim() || null,
    preceding_invoice_date: document.getElementById("v2PrecedingInvDate")?.value || null,
    service_period_start: document.getElementById("v2ServiceStart")?.value || null,
    service_period_end: document.getElementById("v2ServiceEnd")?.value || null,
    prepaid_amount: prepaidAmount,
    discounts: docDiscounts,
    vat_exemption_reason: document.getElementById("v2ExemptionReason")?.value || null,
    seller: {
      name: document.getElementById("v2SellerName")?.value.trim() || "Seller Company",
      vat_id: document.getElementById("v2SellerVat")?.value.trim() || "",
      street: document.getElementById("v2SellerStreet")?.value.trim() || "",
      city: document.getElementById("v2SellerCity")?.value.trim() || "",
      postcode: document.getElementById("v2SellerPostcode")?.value.trim() || "",
      country_code: document.getElementById("v2SellerCountry")?.value || "DE",
      contact_phone: document.getElementById("v2SellerPhone")?.value.trim() || null,
      contact_email: document.getElementById("v2SellerEmail")?.value.trim() || null
    },
    buyer: {
      name: document.getElementById("v2BuyerName")?.value.trim() || "Buyer Client",
      vat_id: document.getElementById("v2BuyerVat")?.value.trim() || "",
      street: document.getElementById("v2BuyerStreet")?.value.trim() || "",
      city: document.getElementById("v2BuyerCity")?.value.trim() || "",
      postcode: document.getElementById("v2BuyerPostcode")?.value.trim() || "",
      country_code: document.getElementById("v2BuyerCountry")?.value || "DE"
    },
    delivery: {
      recipient_name: document.getElementById("v2DelivName")?.value.trim() || null,
      delivery_date: document.getElementById("v2DelivDate")?.value || null,
      street: document.getElementById("v2DelivStreet")?.value.trim() || null,
      city: document.getElementById("v2DelivCity")?.value.trim() || null,
      postcode: document.getElementById("v2DelivPostcode")?.value.trim() || null,
      country_code: document.getElementById("v2DelivCountry")?.value || "DE"
    },
    payment: {
      iban: document.getElementById("v2PayIban")?.value.trim() || "",
      bic: document.getElementById("v2PayBic")?.value.trim() || "",
      payment_means_code: document.getElementById("v2PayMethod")?.value || "58",
      payment_terms: document.getElementById("v2PayTerms")?.value || "Payment due as agreed."
    },
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
    const layout = document.getElementById("v2LayoutSelect")?.value || "layout1";

    const res = await fetch("/api/create-invoice-pdfa3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice_data: invData,
        layout: layout,
        generator: "v2",
        source_type: "v2",
        profile: invData.document_format === "orderx" ? "BASIC" : "EN16931",
        token_usage: v2TokenUsage
      })
    });

    const result = await res.json();
    if (!result.success) throw new Error(result.error || "Generation failed");

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
          <div style="display: flex; gap: 0.5rem;">
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
function populateV2FromHistory(inv, layout) {
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

  // Layout select
  if (layout) {
    const layoutEl = document.getElementById("v2LayoutSelect");
    if (layoutEl) layoutEl.value = layout;
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

  // Delivery
  const deliv = inv.delivery || {};
  setVal("v2DelivName", deliv.recipient_name);
  setVal("v2DelivDate", deliv.delivery_date);
  setVal("v2DelivStreet", deliv.street);
  setVal("v2DelivCity", deliv.city);
  setVal("v2DelivPostcode", deliv.postcode);
  setVal("v2DelivCountry", deliv.country_code || "DE");
  if (deliv.recipient_name || deliv.delivery_date || deliv.street) {
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

  // Discounts
  if (inv.discounts && inv.discounts.length > 0) {
    v2DocumentDiscounts = inv.discounts.map(d => ({
      reason: d.reason || "Document Discount",
      percentage: d.percentage || null,
      amount: Number(d.amount) || 0.0
    }));
  } else {
    v2DocumentDiscounts = [];
  }
  renderV2DocumentDiscounts();

  // Confidence indicators if saved
  if (inv.confidence_scores) {
    applyV2ConfidenceScores(inv.confidence_scores);
  }

  recalcV2Totals();
}
window.populateV2FromHistory = populateV2FromHistory;

// Run on load
document.addEventListener("DOMContentLoaded", () => {
  initV2Studio();
});
