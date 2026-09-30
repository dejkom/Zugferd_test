# ZUGFeRD & Factur-X Studio 🚀

A modern web application and backend pipeline to transform arbitrary, non-compliant PDF invoices into fully conformant **ZUGFeRD 2.x / Factur-X PDF/A-3** electronic invoices with embedded `factur-x.xml`.

---

## 🌟 Features

1. **Intuitive Web GUI**:
   - Modern dark-mode interface with glassmorphism design.
   - Drag-and-drop PDF upload or one-click sample loader.
   - Stepper indicator showing the transformation progress.
2. **AI-Powered Structured Extraction**:
   - Powered by OpenAI Structured Outputs (`gpt-4o`).
   - Automatically parses Invoice Number, Issue/Due Dates, Seller & Buyer details (VAT IDs, addresses, commercial register), Line Items, Tax breakdown (standard, reverse charge, exempt), Bank Details (IBAN, BIC), and Monetary Totals.
   - Interactive Human-in-the-Loop review: You can review and adjust extracted values before embedding.
3. **CII / Factur-X 16B XML Generator**:
   - Generates compliant `factur-x.xml` matching **EN 16931** (Comfort) or **BASIC** profiles.
   - Formatted strictly according to UN/CEFACT Cross Industry Invoice standard (`urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100#`).
   - Live editable XML preview.
4. **PDF/A-3b Combination & Attachment**:
   - Conforms strictly to ISO 19005-3 rules:
     - `/AF` dictionary in Document Catalog pointing to `factur-x.xml`.
     - `/AFRelationship /Alternative` with `text/xml` MIME type.
     - PDF/A-3 Identification and Factur-X XMP extension schema (`urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#`).
     - Standard sRGB OutputIntent color profile (`/GTS_PDFA1`).
     - Automated page normalization to ensure 100% font embedding compliance.
5. **Mustangproject CLI Validation**:
   - Official reference implementation (`Mustang-CLI.jar`) validates the resulting PDF/A-3 document and XML against official Schematron business rules.

---

## 🚀 How to Run

### 1. Start the Application

The web server runs locally with:
```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```
Open your browser at: **[http://127.0.0.1:8000/](http://127.0.0.1:8000/)**

### 2. Set your OpenAI API Key
You can enter your OpenAI API key directly in the top header input box of the GUI (it is safely stored in your browser's `localStorage` and sent with extraction requests), or set it in your environment:
```powershell
$env:OPENAI_API_KEY="sk-..."
```

### 3. Convert an Invoice
1. **Upload**: Drag and drop any non-compliant PDF (or click *"Load documentsforconversion/C2025012_zig.pdf"*).
2. **AI Extract**: Click **"Extract with AI"** to extract all invoice line items and business partner metadata.
3. **Review & XML Preview**: Review or edit the values on the left panel, and inspect the syntax-highlighted `factur-x.xml` on the right panel.
4. **Embed & Validate**: Click **"Embed to PDF/A-3 & Validate"**. The system embeds the XML, creates a valid PDF/A-3, and runs Mustangproject Schematron validation.
5. **Download**: Download your compliant ZUGFeRD PDF/A-3 invoice!
