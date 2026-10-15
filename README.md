# Plant Ops Hub (DDS)

A daily direction-setting dashboard for a manufacturing plant. Plain HTML, CSS and
JavaScript on GitHub Pages, with Supabase for sign-in and data. No build step.

Each plant owns its own copy: its own GitHub repo, its own Supabase project, its
own admins and its own layout.

**Setting up a plant? Start with [PLANT_SETUP.md](PLANT_SETUP.md).**

## What's in it

- **Dashboard** (`dds-dashboard.html`): the daily meeting board. Admins and editors
  press **Edit dashboard** to drag sections, resize, rename, add numbers and cards, and
  hide what they don't use. Unsaved work is kept on that device until saved. Layouts
  can be exported, imported, or started from a ready-made one.
- **Data Entry** (`data-entry.html`): where the daily numbers are typed.
- **Weekly KPIs** (`kpi-boards.html`): weekly numbers rolled up from the daily ones,
  on boards each person can arrange. Admins choose how each KPI rolls up.
- **Announcements, Play Call, Team**: shared messages, the day's plan, and who can
  sign in and with what role.

## Everything about one plant is in `plant-config.js`

Name, logo, production lines, optional cities, core values, data sources, Supabase
URL and public key, and the Weekly KPI list. Nothing else needs editing to adopt the
site for another plant.

## Data sources (all optional)

| Source | What it supplies |
|---|---|
| Data Entry | Everything typed in the site. Always available. |
| L2L | OEE, Downtime, Code Red, Code Yellow. See [README_L2L_SYNC.md](README_L2L_SYNC.md). |
| Power Automate file | `dashboard-data.json`, other daily numbers from Excel/SharePoint. |
| Redzone | Planned. Switch is in the config; not built yet. |

## Roles

Admin can change anything and manage people. Editor can enter data and edit the
dashboard layout. Viewer can look. These are enforced by the database (row-level
security), not just hidden buttons.

## Files

`index.html` sign-in, `hub.html` home, the pages above, `novus-core.js` /
`novus-interactions.js` / `novus-styles.css` shared code and styling,
`dds-editor.js/.css` the edit-in-place tools, `kpi-source.js` weekly roll-ups,
`supabase-config.js` database access, `data_entries.sql` the database setup,
`layouts/` ready-made dashboard layouts, `.github/workflows/` optional automations,
`archive/` retired pages kept for reference.
