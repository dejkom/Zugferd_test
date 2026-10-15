// =========================================================================
// EN 16931 Mandatory & Business Term (BT) Validator & Overview Engine
// Inspired by invoice-portal.de / European Standard EN 16931
// =========================================================================

// Safe HTML escaping helper
window.escapeHtml = window.escapeHtml || function(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

let btActiveFilterGroup = "ALL";
let btActiveOnlyMandatory = false;
let btSearchQuery = "";

function initOverviewPage() {
  renderBtTable();
  setupBtFilters();
}

function setupBtFilters() {
  const searchInput = document.getElementById("btSearchInput");
  const onlyMandCheckbox = document.getElementById("btOnlyMandatory");
  const groupSelect = document.getElementById("btGroupSelect");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      btSearchQuery = e.target.value.toLowerCase().trim();
      renderBtTable();
    });
  }

  if (onlyMandCheckbox) {
    onlyMandCheckbox.addEventListener("change", (e) => {
      btActiveOnlyMandatory = e.target.checked;
      renderBtTable();
    });
  }

  if (groupSelect) {
    // Populate distinct groups if options are empty
    if (window.EN16931_TABLE_DATA && groupSelect.options.length <= 1) {
      const groups = Array.from(new Set(window.EN16931_TABLE_DATA.map(item => item.group))).filter(Boolean);
      groups.sort().forEach(grp => {
        const opt = document.createElement("option");
        opt.value = grp;
        opt.textContent = grp;
        groupSelect.appendChild(opt);
      });
    }

    groupSelect.addEventListener("change", (e) => {
      btActiveFilterGroup = e.target.value;
      renderBtTable();
    });
  }
}

function renderBtTable() {
  const tbody = document.getElementById("btTableBody");
  const countBadge = document.getElementById("btCounterBadge");
  if (!tbody) return;

  const data = window.EN16931_TABLE_DATA || [];
  let filtered = data.filter(item => {
    // Search query filter
    if (btSearchQuery) {
      const matchBt = item.bt.toLowerCase().includes(btSearchQuery);
      const matchName = item.name.toLowerCase().includes(btSearchQuery);
      const matchNameDe = item.name_de && item.name_de.toLowerCase().includes(btSearchQuery);
      const matchGrp = item.group.toLowerCase().includes(btSearchQuery);
      const matchMap = item.mapping && (
        item.mapping.field.toLowerCase().includes(btSearchQuery) ||
        item.mapping.desc.toLowerCase().includes(btSearchQuery) ||
        item.mapping.xml.toLowerCase().includes(btSearchQuery)
      );
      if (!matchBt && !matchName && !matchNameDe && !matchGrp && !matchMap) return false;
    }

    // Only mandatory / conditional
    if (btActiveOnlyMandatory) {
      // req === "111" means mandatory across all, or has specific footnote/requirement
      if (item.req === "000" && !item.is_mandatory) return false;
    }

    // Group filter
    if (btActiveFilterGroup !== "ALL" && item.group !== btActiveFilterGroup) {
      return false;
    }

    return true;
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} of ${data.length} fields`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="bt-empty-state">
          <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">🔍</div>
          <strong>No matching e-invoice fields found</strong>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">Try loosening your search terms or unchecking "Only mandatory fields"</div>
        </td>
      </tr>
    `;
    return;
  }

  const greenCheckSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" class="bt-check-icon" aria-hidden="true" style="flex-shrink:0"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M9 12 L11 14 L15 10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
  const blueCheckSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" class="bt-check-icon bt-check-blue" aria-hidden="true" style="flex-shrink:0"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M9 12 L11 14 L15 10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
  const dashSvg = `<span class="bt-dash-icon">—</span>`;

  tbody.innerHTML = filtered.map(item => {
    const isReq = item.req === "111" || item.is_mandatory;
    const reqBadge = isReq 
      ? `<span class="bt-mand-badge">● Mandatory</span>` 
      : `<span class="bt-opt-badge">Optional</span>`;

    // Format support badges
    const xrMark = item.req[0] === '1' ? greenCheckSvg : (item.bt === 'BT-10' ? greenCheckSvg : dashSvg);
    const peppolMark = item.req[1] === '1' ? greenCheckSvg : (item.bt === 'BT-10' ? blueCheckSvg : dashSvg);
    const zugferdMark = item.req[2] === '1' ? greenCheckSvg : (item.bt === 'BT-10' ? blueCheckSvg : dashSvg);

    // Studio v2 Field Mapping
    let mappingHtml = `<span style="color: var(--text-dim); font-size: 0.75rem;">Unmapped / Extension</span>`;
    if (item.mapping) {
      mappingHtml = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <button type="button" class="bt-map-badge" onclick="jumpToV2Field('${item.mapping.field}')" title="Click to open Studio v2 and jump to field">
            <span>⚡ ${item.mapping.field}</span>
          </button>
          <span class="bt-xml-path" title="${item.mapping.xml}">${item.mapping.xml}</span>
        </div>
      `;
    }

    return `
      <tr>
        <td class="bt-code-cell">${item.bt}</td>
        <td>
          <div class="bt-name-cell">
            <strong>${escapeHtml(item.name_de || item.name)}</strong>
            <div style="font-size: 0.76rem; color: var(--text-muted); font-weight: normal; margin-top: 1px;">EN: ${escapeHtml(item.name)}</div>
          </div>
          <span class="bt-group-badge" style="margin-top: 3px;">${escapeHtml(item.group)}</span>
        </td>
        <td>${reqBadge}</td>
        <td style="text-align: center;">${xrMark}</td>
        <td style="text-align: center;">${peppolMark}</td>
        <td style="text-align: center;">${zugferdMark}</td>
        <td>${mappingHtml}</td>
      </tr>
    `;
  }).join("");
}

function jumpToV2Field(fieldId) {
  if (typeof switchScenario === "function") {
    switchScenario("v2");
    setTimeout(() => {
      const el = document.getElementById(fieldId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
        el.style.outline = "2px solid #2563eb";
        setTimeout(() => { el.style.outline = ""; }, 2500);
      }
    }, 150);
  }
}
window.jumpToV2Field = jumpToV2Field;

// ================= UNIVERSAL XML-TO-VISUAL-PDF DROPZONE (OVERVIEW) =================
function initOverviewXmlDropzone() {
  const dropzone = document.getElementById("ovXmlDropzone");
  const fileInput = document.getElementById("ovXmlFileInput");
  if (!dropzone) return;

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.style.borderColor = "var(--accent)";
    dropzone.style.background = "rgba(37, 99, 235, 0.12)";
  });

  dropzone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dropzone.style.borderColor = "";
    dropzone.style.background = "";
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.style.borderColor = "";
    dropzone.style.background = "";
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleOverviewXmlUpload(e.dataTransfer.files[0]);
    }
  });
}

function onOverviewXmlFileChanged(input) {
  if (input && input.files && input.files.length) {
    handleOverviewXmlUpload(input.files[0]);
    input.value = "";
  }
}
window.onOverviewXmlFileChanged = onOverviewXmlFileChanged;

async function handleOverviewXmlUpload(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".xml")) {
    alert("Prosimo, naložite veljavno XML datoteko (.xml).");
    return;
  }

  const dropTitle = document.getElementById("ovXmlDropTitle");
  const dropDesc = document.getElementById("ovXmlDropDesc");
  const originalTitle = dropTitle ? dropTitle.textContent : "";
  const originalDesc = dropDesc ? dropDesc.textContent : "";

  if (dropTitle) dropTitle.textContent = `⚡ Rendering ${file.name} to Visual PDF...`;
  if (dropDesc) dropDesc.textContent = "Parsing standard e-invoice XML and synthesizing visual PDF layout (0 tokens)...";

  try {
    // 1. Upload XML to backend
    const formData = new FormData();
    formData.append("file", file);
    const upRes = await fetch("/api/upload", { method: "POST", body: formData });
    const upData = await upRes.json();
    if (!upRes.ok) throw new Error(upData.detail || "Upload failed");

    // 2. Call /api/visualize-xml with layout3 (EN 16931 Paged Media) or layout2
    const chosenLayout = (typeof getStoredLayout === "function" ? getStoredLayout() : "layout3") || "layout3";
    const effectiveLayout = chosenLayout === "original" ? "layout3" : chosenLayout;

    const visRes = await fetch("/api/visualize-xml", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: upData.file_id, layout: effectiveLayout, lang: "sl" })
    });
    const visData = await visRes.json();
    if (!visRes.ok) {
      throw new Error(visData.detail || "Neveljavna XML datoteka ali neprepoznana shema (podprti so e-SLOG 2.0, UBL 2.1 in Factur-X/CII).");
    }

    // 3. Open PDF preview modal immediately
    if (typeof openPdfPreview === "function") {
      openPdfPreview(visData.output_filename, visData.invoice_data?.invoice_number || file.name);
    }

    // 4. Switch to Studio v2 and populate the form so user can inspect or edit fields
    if (typeof switchScenario === "function") {
      switchScenario("v2");
    }

    // Trigger handleV2PrefillUpload to populate all Studio v2 fields
    if (typeof handleV2PrefillUpload === "function") {
      handleV2PrefillUpload(file);
    }

    if (dropTitle) dropTitle.textContent = `✅ Successfully rendered ${file.name}!`;
    if (dropDesc) dropDesc.textContent = "Visual invoice PDF displayed and Studio v2 form populated with 0 tokens.";
  } catch (err) {
    const errorMsg = (err && err.message) ? err.message : String(err);
    alert("Neveljavna XML datoteka ali neprepoznana shema (podprti so e-SLOG 2.0, UBL 2.1 in Factur-X/CII).");
    if (dropTitle) dropTitle.textContent = originalTitle;
    if (dropDesc) dropDesc.textContent = originalDesc;
  }
}
window.handleOverviewXmlUpload = handleOverviewXmlUpload;

document.addEventListener("DOMContentLoaded", () => {
  initOverviewPage();
  initOverviewXmlDropzone();
});
