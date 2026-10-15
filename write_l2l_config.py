"""
Writes config.py for l2l_client.py / sync_l2l_to_dashboard.py from
plant-config.js. The API key is NEVER stored in the repo: it comes from the
L2L_API_KEY environment variable (a GitHub repo secret in the workflow, or
your own shell when you run the sync by hand).
"""
import os
import plant_config

l2l, linecode = plant_config.l2l_settings()
key = os.environ.get("L2L_API_KEY", "")
if not key:
    raise SystemExit("Set the L2L_API_KEY environment variable first.")

with open("config.py", "w", encoding="utf-8") as f:
    f.write(f"COMPANY = {l2l['company']!r}\n")
    f.write(f"API_KEY = {key!r}\n")
    f.write(f"SITE_NUMBER = {int(l2l['siteNumber'])}\n")
    f.write(f"LINECODE_DICT = {linecode!r}\n")
    f.write("LINE_CODES = list(LINECODE_DICT.keys())\n")
    f.write(f"CODE_RED_ID = {int(l2l['codeRedId'])}\n")
    f.write(f"CODE_YELLOW_ID = {int(l2l['codeYellowId'])}\n")
print("Wrote config.py")
