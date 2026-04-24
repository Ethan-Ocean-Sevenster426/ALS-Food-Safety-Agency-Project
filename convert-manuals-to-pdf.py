"""
Convert every EPVS user manual .docx to PDF side-by-side in the repo root.
Uses MS Word through docx2pdf. Close Word if any file is already open.
"""
import os
import sys
from docx2pdf import convert

REPO = os.path.dirname(os.path.abspath(__file__))
MANUALS = [
    "EPVS Super Admin User Manual.docx",
    "EPVS Admin User Manual.docx",
    "EPVS Inspector User Manual.docx",
    "EPVS Company Admin User Manual.docx",
    "EPVS User Manual.docx",
    "EPVS Process Flow Documentation.docx",
]

failed = []
for name in MANUALS:
    src = os.path.join(REPO, name)
    dst = os.path.join(REPO, name[:-5] + ".pdf")
    if not os.path.exists(src):
        print("missing:", name)
        failed.append(name)
        continue
    try:
        convert(src, dst)
        size_kb = os.path.getsize(dst) // 1024
        print(f"wrote: {os.path.basename(dst)} ({size_kb} KB)")
    except Exception as e:
        print("FAILED:", name, "->", e)
        failed.append(name)

if failed:
    print("\nFailed:", failed)
    sys.exit(1)
