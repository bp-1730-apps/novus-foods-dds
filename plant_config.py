"""
Reads plant-config.js (the single file a plant edits) so the Python scripts
use the same settings as the website. Standard library only.
"""
import json
import os
import re

_HERE = os.path.dirname(os.path.abspath(__file__))


def load(path=None):
    path = path or os.path.join(_HERE, "plant-config.js")
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    # The file is "window.PLANT_CONFIG = { ...json... };" followed by a small
    # compatibility block. Take the JSON object that starts at the first "{".
    start = text.index("{", text.index("window.PLANT_CONFIG"))
    obj, _ = json.JSONDecoder().raw_decode(text[start:])
    return obj


def l2l_settings(cfg=None):
    """Returns (settings dict, line-code map) for the L2L sync, or raises if L2L is off."""
    cfg = cfg or load()
    l2l = cfg["sources"].get("l2l", {})
    if not l2l.get("enabled"):
        raise SystemExit("L2L is not enabled in plant-config.js (sources.l2l.enabled).")
    linecode = {ln["l2lCode"]: ln["code"] for ln in cfg["lines"] if ln.get("l2lCode")}
    return l2l, linecode
