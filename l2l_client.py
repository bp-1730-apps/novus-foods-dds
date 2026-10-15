"""
L2L API client functions — same tested code from your dashboard project
(call_l2l_api, get_daily_oee, get_dispatches), pointed at config.py.
"""

import requests

import config

BASE_URL = f"https://{config.COMPANY}.leading2lean.com/api/1.0"


def call_l2l_api(path, extra_params):
    url = BASE_URL + "/" + path + "/"
    params = {"auth": config.API_KEY}
    for item in extra_params:
        params[item] = extra_params[item]

    try:
        response = requests.get(url, params=params, timeout=30)
    except requests.exceptions.RequestException as exc:
        raise RuntimeError(f"Could not reach L2L: {exc}") from exc

    try:
        reply = response.json()
    except ValueError as exc:
        raise RuntimeError("L2L did not return valid JSON.") from exc

    if reply['success'] == False:
        raise RuntimeError(reply.get('error') or "L2L reported the request failed.")
    return reply['data']


def get_daily_oee(site_number, start_date, end_date, line_codes):
    line_codes_text = ",".join(line_codes)
    params = {"site": site_number, "start": start_date, "end": end_date, "linecode": line_codes_text}
    report_path = "reporting/production/daily_summary_data_by_line"
    return call_l2l_api(report_path, params)


def get_dispatches(site_number, start_date, end_date, line_codes):
    # Convert "2026-09-01 00:00" -> "2026-09-01T00:00:00" — the plain
    # /dispatches/ record area needs ISO 8601 with a "T", unlike the
    # reporting endpoints above.
    start_iso = start_date.replace(" ", "T") + ":00"
    end_iso = end_date.replace(" ", "T") + ":00"

    params = {
        "site": site_number,
        "dispatched__gte": start_iso,
        "dispatched__lte": end_iso,
        "limit": 1000,  # Dispatches' documented max record limit is 1000
    }
    all_dispatches = call_l2l_api("dispatches", params)

    if not all_dispatches:
        return all_dispatches

    matching_dispatches = []
    for dispatch in all_dispatches:
        if dispatch.get('linecode') in line_codes:
            matching_dispatches.append(dispatch)
    return matching_dispatches
