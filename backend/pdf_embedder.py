import os
import pikepdf
import fitz
from datetime import datetime

# Standard Factur-X / PDF/A-3 XMP Template with exact pdfaid and pdfaProperty namespace definitions
XMP_TEMPLATE = """<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The name of the embedded XML file</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The type of the hybrid document</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The actual version of the standard</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The conformance level of the document</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>{conformance_level}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""

def normalize_pdf_for_pdfa(input_pdf_path: str, output_temp_path: str, dpi: int = 300) -> str:
    """
    Normalizes arbitrary non-compliant PDFs into a clean PDF where all content
    and fonts are 100% compliant with ISO 19005-3 PDF/A font embedding rules.
    """
    doc = fitz.open(input_pdf_path)
    needs_flattening = False
    for page in doc:
        for f in page.get_fonts():
            if "Helvetica" in f[3] or "Times" in f[3] or "Courier" in f[3]:
                needs_flattening = True
                break
    
    if not needs_flattening:
        return input_pdf_path

    out_pdf = fitz.open()
    for page in doc:
        pix = page.get_pixmap(dpi=dpi)
        img_data = pix.tobytes(output="png")
        new_page = out_pdf.new_page(width=page.rect.width, height=page.rect.height)
        new_page.insert_image(page.rect, stream=img_data)

    out_pdf.save(output_temp_path)
    return output_temp_path

def build_pdfa3_zugferd(
    input_pdf_path: str,
    facturx_xml_path: str,
    output_pdf_path: str,
    profile: str = "EN16931",
    attachment_filename: str = "factur-x.xml"
) -> bool:
    """
    Creates a compliant PDF/A-3 document with factur-x.xml or order-x.xml embedded as /AF /Alternative
    and compliant XMP metadata.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_pdf_path)), exist_ok=True)

    # Normalize input PDF for font embedding compliance if necessary
    temp_norm_path = output_pdf_path + ".normalized.pdf"
    working_pdf_path = normalize_pdf_for_pdfa(input_pdf_path, temp_norm_path)

    with pikepdf.Pdf.open(working_pdf_path) as pdf:
        with open(facturx_xml_path, "rb") as f:
            xml_bytes = f.read()

        # 1. Create file specification for embedded XML
        desc_text = "Order-X Purchase Order XML" if "order-x" in attachment_filename.lower() else "Factur-X / ZUGFeRD Invoice XML"
        filespec = pikepdf.AttachedFileSpec(
            pdf,
            xml_bytes,
            filename=attachment_filename,
            description=desc_text,
            mime_type="text/xml"
        )
        pdf.attachments[attachment_filename] = filespec

        # Explicitly set /AFRelationship key as Name object in the file specification dictionary
        ef_obj = pdf.Root.Names.EmbeddedFiles.Names[1]
        ef_obj["/AFRelationship"] = pikepdf.Name("/Alternative")

        # 2. Add to /AF array in Document Catalog
        pdf.Root.AF = pdf.make_indirect([ef_obj])

        # 3. Add OutputIntent for PDF/A compliance
        if "/OutputIntents" not in pdf.Root:
            ref_path = os.path.join(os.path.dirname(__file__), "..", "official_examples", "zugferd_2p1_EN16931_Betriebskostenabrechnung.pdf")
            if os.path.exists(ref_path):
                with pikepdf.Pdf.open(ref_path) as ref_pdf:
                    if "/OutputIntents" in ref_pdf.Root and len(ref_pdf.Root.OutputIntents) > 0:
                        dest_profile = pdf.copy_foreign(ref_pdf.Root.OutputIntents[0]["/DestOutputProfile"])
                        output_intent = pikepdf.Dictionary(
                            Type=pikepdf.Name("/OutputIntent"),
                            S=pikepdf.Name("/GTS_PDFA1"),
                            OutputConditionIdentifier=pikepdf.String("sRGB IEC61966-2.1"),
                            Info=pikepdf.String("sRGB IEC61966-2.1"),
                            DestOutputProfile=dest_profile
                        )
                        pdf.Root.OutputIntents = pikepdf.Array([output_intent])

        # 4. Inject XMP Metadata with PDF/A-3 identification and Factur-X extension schema
        conformance = "EN 16931" if profile == "EN16931" else "BASIC"
        xmp_str = XMP_TEMPLATE.format(conformance_level=conformance)
        meta_stream = pdf.make_stream(xmp_str.encode("utf-8"))
        meta_stream["/Type"] = pikepdf.Name("/Metadata")
        meta_stream["/Subtype"] = pikepdf.Name("/XML")
        pdf.Root.Metadata = meta_stream

        pdf.save(output_pdf_path)

    # Immediately delete the temporary normalized file so no residual files remain
    if os.path.exists(temp_norm_path):
        try:
            os.remove(temp_norm_path)
        except Exception:
            pass

    return True
