// Global State for Scenarios
let currentPdfFileId = null;
let currentPdfInvoiceData = null;

let currentDocxFileId = null;
let currentDocxInvoiceData = null;

// ================= THEME (Dark / Light) =================
const themeToggleBtn = document.getElementById("themeToggleBtn");
const themeIcon = document.getElementById("themeIcon");
const storedTheme = localStorage.getItem("ZUGFERD_THEME") || "dark";
applyTheme(storedTheme);

function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    if (themeIcon) themeIcon.textContent = "🌙";
  } else {
    document.documentElement.removeAttribute("data-theme");
    if (themeIcon) themeIcon.textContent = "☀️";
  }
  localStorage.setItem("ZUGFERD_THEME", theme);
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    applyTheme(isLight ? "dark" : "light");
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

function loadPreferences() {
  const storedKey = getStoredApiKey();
  if (configApiKey) configApiKey.value = storedKey;

  const defaultProfile = localStorage.getItem("ZUGFERD_PROFILE") || "EN16931";
  if (configDefaultProfile) configDefaultProfile.value = defaultProfile;
  const profileSelect = document.getElementById("profileSelect");
  if (profileSelect) profileSelect.value = defaultProfile;

  const layout = getStoredLayout();
  if (configInvoiceLayout) configInvoiceLayout.value = layout;
  if (manLayoutSelect) manLayoutSelect.value = layout;
}
loadPreferences();

function handleManualLayoutChange(val) {
  localStorage.setItem("ZUGFERD_LAYOUT", val);
  if (configInvoiceLayout) configInvoiceLayout.value = val;
}
window.handleManualLayoutChange = handleManualLayoutChange;

function saveConfiguration() {
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

  alert("Configuration saved successfully!");
}
window.saveConfiguration = saveConfiguration;

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

// ================= NAVIGATION / SCENARIO SWITCHING =================
function switchScenario(scenario) {
  const scenarios = ["pdf", "docx", "manual", "config"];
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
}
window.switchScenario = switchScenario;

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
          profile: profileSelect ? profileSelect.value : "EN16931"
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
          profile: "EN16931"
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
  document.getElementById("manInvNumber").value = "INV-" + new Date().getFullYear() + "-042";
  const today = new Date();
  document.getElementById("manIssueDate").value = today.toISOString().split("T")[0];
  const due = new Date();
  due.setDate(today.getDate() + 30);
  document.getElementById("manDueDate").value = due.toISOString().split("T")[0];
  document.getElementById("manCurrency").value = "EUR";

  document.getElementById("manSellerName").value = "Acme Solutions GmbH";
  document.getElementById("manSellerVat").value = "DE123456789";
  document.getElementById("manSellerStreet").value = "Bahnhofstrasse 10";
  document.getElementById("manSellerCity").value = "10115 Berlin";

  document.getElementById("manBuyerName").value = "Global Logistics AG";
  const buyerVatEl = document.getElementById("manBuyerVat");
  if (buyerVatEl) buyerVatEl.value = "DE987654321";
  document.getElementById("manBuyerRef").value = "PO-2026-9941";
  document.getElementById("manBuyerStreet").value = "Industriestrasse 42";
  document.getElementById("manBuyerCity").value = "80331 Munich";

  document.getElementById("manIban").value = "DE89370400440532013000";
  document.getElementById("manBic").value = "DBBADEFFXXX";

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
          country: "DE",
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
                Visual PDF layout synthesized (${chosenLayout === "layout2" ? "Layout 2: Odelo Corporate" : "Layout 1: Modern Studio"}), factur-x.xml embedded with ${lineItems.length} items, and verified via Mustangproject.
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
