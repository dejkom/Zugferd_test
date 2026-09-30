import os
import subprocess
from typing import Dict, Any

MUSTANG_JAR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Mustang-CLI.jar"))

def combine_to_zugferd(
    input_pdf_path: str,
    facturx_xml_path: str,
    output_pdf_path: str,
    version: str = "2",
    profile: str = "EN16931"
) -> Dict[str, Any]:
    """
    Executes Mustang-CLI.jar to combine an existing visual PDF and factur-x.xml into a compliant PDF/A-3 invoice.
    """
    if not os.path.exists(MUSTANG_JAR):
        raise FileNotFoundError(f"Mustang-CLI.jar not found at {MUSTANG_JAR}")
    
    cmd = [
        "java", "-jar", MUSTANG_JAR,
        "--action", "combine",
        "--source", os.path.abspath(input_pdf_path),
        "--source-xml", os.path.abspath(facturx_xml_path),
        "--out", os.path.abspath(output_pdf_path),
        "--format", "fx",
        "--version", version,
        "--profile", profile
    ]
    
    res = subprocess.run(cmd, capture_output=True, text=True)
    return {
        "success": res.returncode == 0,
        "stdout": res.stdout,
        "stderr": res.stderr,
        "output_path": output_pdf_path if res.returncode == 0 else None
    }

def validate_zugferd_pdf(pdf_path: str) -> Dict[str, Any]:
    """
    Validates a ZUGFeRD / Factur-X PDF using Mustang CLI Schematron & PDF/A validator.
    """
    if not os.path.exists(MUSTANG_JAR):
        raise FileNotFoundError(f"Mustang-CLI.jar not found at {MUSTANG_JAR}")
    
    cmd = [
        "java", "-jar", MUSTANG_JAR,
        "--action", "validate",
        "--source", os.path.abspath(pdf_path)
    ]
    
    res = subprocess.run(cmd, capture_output=True, text=True)
    # Mustang writes XML report to stdout
    is_valid = ('status="valid"' in res.stdout)
    return {
        "success": res.returncode == 0,
        "isValid": is_valid,
        "report_xml": res.stdout,
        "stderr": res.stderr
    }
