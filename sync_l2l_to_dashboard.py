"""
Pulls OEE/Downtime (per line) and Code Red/Code Yellow (counts) from
L2L and writes them to l2l-data.json -- a SEPARATE file from
dashboard-data.json, so Power Automate's own sync never touches or
overwrites these numbers, and this script never touches anything
Power Automate owns (HR, QA, Finance, Attainment, Start Up, CIL, etc).

"Downtime" is L2L's downtime_minutes minus nonproduction_minutes (planned
non-production time), so a line that's simply not scheduled to run doesn't
count the same as one that's actually down during scheduled time.

dds-dashboard.html merges l2l-data.json on top of dashboard-data.json
after loading both -- see the small addition in fetchFromSharePoint().

Usage:
    python sync_l2l_to_dashboard.py                          # self-healing: last 7 days through today
    python sync_l2l_to_dashboard.py 2026-09-05                # just one specific date
    python sync_l2l_to_dashboard.py 2026-09-02 2026-09-07     # backfill a range (inclusive)

Running it with no arguments re-syncs the last 7 days every time (not just
today) -- each day's data is upserted in place, so a run that already has a
day's numbers just overwrites them with the same (or updated) values. That
means if this script's scheduled run is ever missed for a day or two --
computer was off, GitHub Action didn't fire, whatever -- the very next
run automatically catches that day back up. No one has to notice a gap and
run a manual backfill.
"""

import json
import os
import sys
from datetime import date, datetime, timedelta

import config
from l2l_client import get_daily_oee, get_dispatches

L2L_DATA_PATH = "l2l-data.json"

# Matches dds-dashboard.html's own (n - 25569) Excel-serial-date formula.
EXCEL_EPOCH = date(1899, 12, 30)


def to_excel_serial(target_date):
    return str((target_date - EXCEL_EPOCH).days)


def _to_float(value):
    # L2L returns these as strings (e.g. "1415.09"); None/"" -> None rather
    # than raising, so a field L2L didn't report doesn't blow up the sync.
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def upsert_row(rows, match_fields, new_values):
    for row in rows:
        if all(str(row.get(key, "")).strip() == str(value).strip() for key, value in match_fields.items()):
            row.update(new_values)
            return
    rows.append({**match_fields, **new_values})


def sync(target_date):
    date_serial = to_excel_serial(target_date)
    start = target_date.strftime("%Y-%m-%d") + " 00:00"
    end = (target_date + timedelta(days=1)).strftime("%Y-%m-%d") + " 00:00"

    print(f"Pulling L2L data for {target_date} ({start} -> {end})...")

    if os.path.exists(L2L_DATA_PATH):
        with open(L2L_DATA_PATH, "r", encoding="utf-8") as f:
            l2l_data = json.load(f)
    else:
        l2l_data = {"Production": [], "Maintenance": []}

    daily_records = get_daily_oee(config.SITE_NUMBER, start, end, config.LINE_CODES) or []
    production_rows = l2l_data.setdefault("Production", [])
    for record in daily_records:
        line_code = config.LINECODE_DICT.get(record.get("line"))
        if not line_code:
            continue
        oee = record.get("overall_equipment_effectiveness")
        # "Downtime" here means unplanned downtime, so nonproduction_minutes
        # (planned non-production time -- e.g. scheduled off-shift, no
        # order running) gets subtracted out of L2L's raw downtime_minutes.
        # Without this, a line with a long scheduled gap looked identical
        # to one that was actually down while it should have been running.
        downtime_minutes = _to_float(record.get("downtime_minutes"))
        nonproduction_minutes = _to_float(record.get("nonproduction_minutes")) or 0
        downtime = None if downtime_minutes is None else round(downtime_minutes - nonproduction_minutes, 2)
        upsert_row(production_rows, {"Date": date_serial, "Line": line_code}, {"OEE": oee, "Downtime": downtime})
        print(f"  {line_code}: OEE={oee}  Downtime={downtime}  (raw downtime_minutes={record.get('downtime_minutes')}, nonproduction_minutes={record.get('nonproduction_minutes')})")

    dispatches = get_dispatches(config.SITE_NUMBER, start, end, config.LINE_CODES) or []
    code_red_count = sum(1 for d in dispatches if d.get("dispatchtype") == config.CODE_RED_ID)
    code_yellow_count = sum(1 for d in dispatches if d.get("dispatchtype") == config.CODE_YELLOW_ID)
    maintenance_rows = l2l_data.setdefault("Maintenance", [])
    upsert_row(maintenance_rows, {"Date": date_serial}, {"Code Red": code_red_count, "Code Yellow": code_yellow_count})
    print(f"  Code Red={code_red_count}  Code Yellow={code_yellow_count}")

    l2l_data["synced_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "0Z"

    with open(L2L_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(l2l_data, f, separators=(",", ":"))

    print(f"\nWrote {L2L_DATA_PATH}. Upload it to GitHub alongside dashboard-data.json.")


if __name__ == "__main__":
    if len(sys.argv) >= 3:
        # Backfill an inclusive date range -- e.g. for days L2L was never
        # synced for, so those days keep showing Power Automate's own
        # (older/placeholder) OEE instead of L2L's real numbers.
        start_date = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
        end_date = datetime.strptime(sys.argv[2], "%Y-%m-%d").date()
        d = start_date
        while d <= end_date:
            sync(d)
            d += timedelta(days=1)
    elif len(sys.argv) == 2:
        sync(datetime.strptime(sys.argv[1], "%Y-%m-%d").date())
    else:
        # Self-healing default: re-sync the last 7 days (oldest first), not
        # just today, so a missed run never leaves a permanent gap.
        SELF_HEAL_WINDOW_DAYS = 7
        today = date.today()
        for offset in range(SELF_HEAL_WINDOW_DAYS - 1, -1, -1):
            sync(today - timedelta(days=offset))
