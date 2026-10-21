# Plant Ops Hub (DDS)

A daily direction-setting dashboard for a manufacturing plant. Plain HTML, CSS and
JavaScript on GitHub Pages, with Supabase for sign-in and data. No build step.

A site can serve one plant or many. Every plant has its own data, layout and
people; one Supabase project holds them all, and a super-admin adds and deletes
plants inside the app (Plants page). Another company or site can also take its
own copy: its own GitHub repo and Supabase project.

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

## Per-plant Leading2Lean connection

`integrations.html` (the **Connection** link, admins only) lets each plant enter its own L2L key and settings. `integrations.sql` stores the key in Supabase Vault (write-only) and `supabase/functions/integrations-run/` pulls the numbers into Data Entry. Setup is in PLANT_SETUP.md. Redzone is a placeholder.

## Roles

Roles are per plant. Admin can change the dashboard layout, Data Entry columns and tabs, KPIs and people of that plant. A super-admin is an admin of every plant and can also create and delete plants and assign people to them. Editor can type Data Entry values, fill in the highlight cards, and post announcements and play calls. Viewer can look. These are enforced by the database (row-level security), not just hidden buttons.

## Files

`index.html` sign-in, `hub.html` home, `team.html` people of the current plant, `plants.html` add/delete plants (super-admins), `plant-context.js` points every page at the plant being shown, the pages above, `novus-core.js` /
`novus-interactions.js` / `novus-styles.css` shared code and styling,
`dds-editor.js/.css` the edit-in-place tools, `kpi-source.js` weekly roll-ups,
`supabase-config.js` database access, `data_entries.sql` and `startup_actions.sql` the database setup,
`layouts/` ready-made dashboard layouts, `.github/workflows/` optional automations,
`archive/` retired pages kept for reference.
