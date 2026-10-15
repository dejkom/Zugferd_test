import os
from backend.xml_parser import parse_any_invoice_xml
from backend.app import app
from fastapi.testclient import TestClient

fpath = 'uploads/65c3ad6e437e46d18dd26b0795cd27c0_sample_eSLOG20_INVOIC_v200_with_BT.xml'
with open(fpath, 'r', encoding='utf-8') as f:
    txt = f.read()

# Add xml-stylesheet and xsi:noNamespaceSchemaLocation exactly as user provided
user_header = '<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="http://www.bizbox.eu/XSL/2019/06/visualization_eSlog20_bizBox_SL.xslt"?><Invoice xmlns="urn:eslog:2.00" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="eSLOG20_INVOIC_v200.xsd">'
txt_user = user_header + txt[txt.find('<M_INVOIC'):]

client = TestClient(app)
res = client.post('/api/visualize-xml', json={'xml_content': txt_user, 'layout': 'layout3', 'lang': 'sl'})
print('Status code:', res.status_code)
if res.status_code == 200:
    print('SUCCESS! Output filename:', res.json()['output_filename'])
else:
    print('Error response:', res.text)
