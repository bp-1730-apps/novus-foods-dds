"""
Builds a clean, plant-neutral copy of this site for a new plant.

    python make_template.py OUTPUT_DIR

Leaves out: archive/, the Novus logos, layouts/plant-1730.json, .git, this script.
Empties dashboard-data.json / l2l-data.json and writes a generic plant-config.js.
"""
import json, os, shutil, sys

SRC = os.path.dirname(os.path.abspath(__file__))
SKIP_DIRS = {".git", "archive", "node_modules", "__pycache__"}
SKIP_FILES = {"novus-logo.png", "novus-logo-white.png", "make_template.py", "config.py"}

def main(out):
    if os.path.exists(out) and os.listdir(out):
        raise SystemExit("Output folder must be empty: " + out)
    for root, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel = os.path.relpath(root, SRC)
        for f in files:
            if f in SKIP_FILES or (rel == "layouts" and f == "plant-1730.json"):
                continue
            dst = os.path.join(out, "" if rel == "." else rel)
            os.makedirs(dst, exist_ok=True)
            shutil.copy2(os.path.join(root, f), os.path.join(dst, f))

    # layouts index without the Novus-only layout
    p = os.path.join(out, "layouts", "index.json")
    idx = json.load(open(p, encoding="utf-8"))
    idx["layouts"] = [l for l in idx["layouts"] if l["file"] != "plant-1730.json"]
    json.dump(idx, open(p, "w", encoding="utf-8"), indent=2)

    # empty data files
    json.dump({k: [] for k in ["HR | Training", "QA", "Production", "Finance", "SAP",
                               "Warehouse", "Inventory Control", "Maintenance"]} | {"synced_at": None},
              open(os.path.join(out, "dashboard-data.json"), "w"))
    json.dump({"Production": [], "Maintenance": []}, open(os.path.join(out, "l2l-data.json"), "w"))

    # generic config; keep the original's help text and weekly-KPI documentation
    src = open(os.path.join(SRC, "plant-config.js"), encoding="utf-8").read()
    tail = src[src.index("/* Compatibility shim"):]
    head = src[:src.index("{")]
    cfg = json.loads(src[src.index("{"):src.index("};\n\n/* Compatibility")+1])
    cfg["plant"] = {"id": "myplant", "name": "My Plant", "shortLabel": "My Plant",
                    "location": "City, State", "contact": "", "org": "",
                    "logo": "logo-placeholder.svg", "logoWhite": "logo-placeholder-white.svg"}
    cfg["branding"] = {"showProductStrip": False, "showBrandsBar": False, "heroTag": "", "tiles": []}
    cfg["supabase"] = {"url": "https://YOUR-PROJECT.supabase.co", "anonKey": "YOUR-ANON-PUBLIC-KEY"}
    cfg["lines"] = [{"code": "Line 1", "label": "Line 1", "l2lCode": ""},
                    {"code": "Line 2", "label": "Line 2", "l2lCode": ""}]
    cfg["cities"] = []
    cfg["coreValues"] = []
    cfg["sources"] = {
        "dataEntry": {"enabled": True},
        "powerAutomate": {"enabled": False, "dataUrl": "dashboard-data.json"},
        "l2l": {"enabled": False, "dataUrl": "l2l-data.json", "company": "", "siteNumber": 1,
                "codeRedId": 0, "codeYellowId": 0},
        "sharepoint": {"enabled": False, "clientId": "", "tenantId": "", "fileOwner": "",
                       "fileId": "", "sharingUrl": ""},
        "redzone": {"enabled": False},
    }
    cfg["weeklyKpis"]["kpis"] = []
    body = json.dumps(cfg, indent=2, ensure_ascii=False)
    open(os.path.join(out, "plant-config.js"), "w", encoding="utf-8").write(head + body + ";\n\n" + tail)
    print("Template written to", out)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
