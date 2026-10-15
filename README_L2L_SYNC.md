# L2L sync (optional)

If your plant uses Leading2Lean (L2L), a small Python job copies each day's
**OEE, Downtime, Code Red and Code Yellow** into `l2l-data.json`. The dashboard
and the Weekly KPIs page read that file. L2L owns those four numbers: Data Entry
shows them read-only so nobody types over them.

If you don't use L2L, set `sources.l2l.enabled` to `false` in `plant-config.js`
and ignore this file.

## Files

- `plant-config.js` holds the L2L settings: `sources.l2l` (company, site number,
  Code Red / Code Yellow ids) and, for each entry in `lines`, its `l2lCode`.
- `write_l2l_config.py` builds a temporary `config.py` from `plant-config.js`.
  The API key comes only from the `L2L_API_KEY` environment variable.
- `l2l_client.py` makes the L2L API calls.
- `sync_l2l_to_dashboard.py` writes `l2l-data.json`. It matches rows by date and
  line, so re-running it updates rows in place and never duplicates them.
- `.github/workflows/l2l-sync.yml` runs the sync every 3 hours on GitHub Actions
  and commits the changed `l2l-data.json`.

## Turn on the automatic sync

1. In the repo go to Settings > Secrets and variables > Actions > New repository
   secret. Name it `L2L_API_KEY` and paste your key.
2. Fill in `sources.l2l` and each line's `l2lCode` in `plant-config.js`.
3. Open the Actions tab, pick "Sync L2L data" and press Run workflow once to test.

## Running it by hand

```
pip install -r l2l_sync_requirements.txt
export L2L_API_KEY=your-key        # Windows PowerShell: $env:L2L_API_KEY="your-key"
python write_l2l_config.py
python sync_l2l_to_dashboard.py                        # last 7 days through today
python sync_l2l_to_dashboard.py 2026-09-05             # one date
python sync_l2l_to_dashboard.py 2026-09-02 2026-09-07  # backfill a range
```

## Security

GitHub Pages sites are public, so the repo usually is too. Never commit the L2L
key. `config.py` is listed in `.gitignore` and the workflow creates it at run
time from the secret. If a key was ever committed, rotate it in L2L.
