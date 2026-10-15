import os
from backend.xml_parser import parse_any_invoice_xml
from backend.pdf_generator import generate_invoice_pdf_from_data

xml_path = "uploads/test_user_eslog_input.xml"
with open(xml_path, "r", encoding="utf-8") as f:
    xml_text = f.read()

inv = parse_any_invoice_xml(xml_text)
print("Parsed:", inv.invoice_number, "Seller:", inv.seller.name, "Items:", len(inv.items))
out_pdf = "outputs/test_user_eslog_rendered.pdf"
generate_invoice_pdf_from_data(inv, out_pdf, layout="layout3")
print("PDF generated successfully:", os.path.exists(out_pdf))
