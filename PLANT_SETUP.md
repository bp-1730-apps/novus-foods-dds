# Setting up your plant

Plan on about an hour the first time. You need a free GitHub account and a free
Supabase account. You don't need to install anything.

## 1. Get your copy of the site

1. Create a new repository from this template (or upload these files to a new repo).
2. In the repo, open Settings > Pages. Choose "Deploy from a branch", branch `main`,
   folder `/ (root)`. After a minute GitHub shows your site address.

## 2. Create your database

1. At supabase.com create a new project. One project can hold all of your plants (see "Several plants in one project" below).
2. Open SQL Editor > New query, paste all of `data_entries.sql`, press Run. It is safe
   to run again later (after an update, run it again).
   Then run `startup_actions.sql` the same way (it needs `data_entries.sql` first). It
   adds the startup action lists described under "Safety and Production extras".
3. Open Authentication > Providers and make sure Email is on. For a first test you can
   turn off "Confirm email" under Authentication > Sign In / Providers.
4. Open Project Settings > API. Copy the **Project URL** and the **anon public** key.
   Never copy the service_role key into any file.

## 3. Fill in `plant-config.js`

Edit it on GitHub (pencil icon). Keep it valid: quoted names, commas between items,
and the first line stays `window.PLANT_CONFIG = `.

- `plant`: `id` (short, no spaces), `name`, `shortLabel`, `location`, `contact`, `org`,
  `logo` and `logoWhite` (upload your logo files to the repo and use their names).
- `supabase`: paste the URL and anon key.
- `lines`: your production lines. `code` is what people see in Data Entry.
  `l2lCode` is only needed if you use L2L.
- `cities`: leave `[]` unless one plant reports for several sites.
- `coreValues`: leave `[]` to hide the Core Values pages.
- `sources`: turn on only what you have. Data Entry is always on.

## 4. Become the first super-admin

1. Open your site and choose "New here? Request an account" with your work email (confirm it if asked).
2. In Supabase SQL Editor run:

   `select public.bootstrap_admin('you@company.com');`

   This works only while there is no super-admin yet.
3. Sign in. Because the project has no plants yet, you land on the **Plants** page. Click **Create plant** (name, ID, location, production lines). You are automatically an admin of every plant.

The plant ID you choose is stored on every row of that plant's data and can never change. Use something short and permanent, like the plant number.

## 5. Add your people

On the Team page of a plant, people who created an account appear under "Waiting for approval". Pick a role
(viewer, editor, admin) and approve. Anyone not approved can't read any plant's data. Viewers can look, editors can type Data Entry values and post announcements, and only admins can change the dashboard layout, columns, KPIs and people.

### Several plants in one project

One Supabase project can hold any number of plants. Each plant has its own data, layout, columns, announcements and people, and a person can have a different role in each.

- **Super-admins** (the Plants page) create and delete plants, edit a plant's name, location and lines, assign people to any plant, and make other super-admins. A super-admin is an admin of every plant.
- **Plant admins** manage only their own plant: its layout, columns and people.
- People who belong to more than one plant get a plant switcher in the top menu. A plant remembers nothing of the others: switching reloads the page on that plant.
- "Start from" when creating a plant copies another plant's setup (Data Entry columns and departments, dashboard layout, panel settings). Entered numbers, announcements, people and custom panels are never copied.
- **Deleting a plant is permanent and immediate.** You must type its ID. Everything that belongs to it is erased; people's accounts stay. The last remaining plant cannot be deleted.
- Power Automate and L2L feeds are configured in `plant-config.js` and belong to the plant whose ID is in that file. Other plants start with those feeds off and use Data Entry. The L2L sync script writes one plant's file.
- Upgrading from the one-plant version: re-run `data_entries.sql`. Existing admins become super-admins, and existing people and data are attached to the plant that already holds your data. Fill in its name on the Plants page (until then the site keeps using the name from `plant-config.js`).

## Safety and Production extras

- **Near misses by department** (Safety panel): a table of near misses opened and closed per
  department over the last 30 days counting today, with a Total. Rows: Production, QA,
  Maintenance, Warehouse, Inventory Control, SAP and Office (Finance and HR | Training
  added together). Every department's Data Entry sheet has **Near Miss Open** and **Near
  Miss Closed** columns: type one count per day (Production per line, Warehouse and
  Inventory Control per site; they are added up). An admin gets the two columns on a
  department the first time they open it in Data Entry after updating. Counts on a
  day with no entry are zero.
- **Startup action lists** (Production Summary): click STARTUP on a line to open that line's
  action list. It is shared by everyone in the plant. Admins add, tick off and remove
  actions; everyone else can read. An amber ⚠ beside STARTUP means the line still has open
  actions. Needs `startup_actions.sql`. Turned off while you are editing the dashboard.

## Connect Leading2Lean (each plant's own key)

Every plant's admins can connect their own Leading2Lean (L2L) account, so OEE, downtime, Code Red and Code Yellow fill in by themselves. Nobody has to hand their API key to anyone else: the admin types it into the **Connection** page for their own plant, and it is stored in Supabase Vault where the website cannot read it back.

One-time setup by whoever owns the Supabase project:

1. Run `data_entries.sql` (the latest version), then `integrations.sql`. If it stops with a Vault message, open **Database > Extensions**, turn on `supabase_vault`, and run it again.
2. Deploy the pull service (the `supabase/functions/integrations-run` folder), from a computer with the Supabase CLI: `supabase functions deploy integrations-run --no-verify-jwt`. The function checks who is calling itself.
3. Make up a long random password and store it as a secret: `supabase secrets set CRON_SECRET=your-long-random-text`.
4. Optional, for an automatic pull every three hours: turn on the `pg_cron` and `pg_net` extensions, then run in the SQL editor (put your project reference and the same CRON_SECRET in):

```sql
select cron.schedule('plant-integrations-sync', '23 */3 * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/integrations-run',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','your-long-random-text'),
    body := '{"action":"cron"}'::jsonb) $$);
```

Then each plant's admin opens **Connection** (top menu or Home), enters the L2L company name, site number, the Code Red / Code Yellow dispatch type ids, matches each dashboard line to its L2L line code, pastes the API key, ticks "Turn the connection on", presses **Save**, then **Test connection** and **Pull the last 7 days now**.

Good to know:

- Connected numbers are written into Data Entry for each day, so the dashboard, Weekly KPIs and exports all see them. They show as "from L2L" and are read-only there. Other fields people type are never overwritten.
- Remove key and disconnect deletes the key from Vault. Numbers already pulled stay.
- Super-admins and the project owner do not see keys on any page, but the person who owns the Supabase project can technically reach Vault with the project's master key. Treat that account accordingly.
- Plant 1730's older GitHub-based L2L sync (`sync_l2l_to_dashboard.py`) is separate. If a plant uses the Connection, leave its "l2l" source switched off in `plant-config.js`.
- Redzone shows as "coming soon". It needs Redzone's API documentation or a sample response before it can be built.
- Never put the service-role key in any file of the site. The function gets it from Supabase itself.

## 6. Make the dashboard yours

Open the dashboard, press **Edit dashboard**, then the menu on the bottom bar >
**Ready-made layouts** (over twenty: SQDC stand-up, production floor, maintenance, quality, warehouse, safety, scoreboard, weekly review, lean huddle and more). Drag sections by the
grip, resize from the corner, press the pencil on a number to rename it or choose where
its value comes from, and **Save**. Save keeps a history you can restore.
The Production Summary is the most flexible section: in edit mode each tile, table column and chart has its own ⚙ and ◂ ▸ buttons, each block has ▲ ▼ to reorder, and the strip at the bottom adds tiles, columns, charts and totals. Any number or column can have goal colours (red/amber/green), columns can have different goals per line, and viewers can click a line name to see its detail and recent history.
**Export** gives you a layout file to share with another plant; **Import** loads one.

## 7. Daily numbers and Weekly KPIs

Daily numbers come from Data Entry (and any optional source you turned on). The Weekly
KPIs page rolls them up by week (week ends on the day set in `weeklyKpis.weekEndsOn`;
the unfinished current week is left out). New numeric columns appear automatically.
Admins use **Manage KPIs** to rename, hide, choose sum/average/last/min/max, unit,
target and better direction, or add a KPI.

## Optional sources

**L2L**: follow [README_L2L_SYNC.md](README_L2L_SYNC.md). The key goes in the repo
secret `L2L_API_KEY`, never in a file.

**Power Automate / SharePoint**: have your flow write `dashboard-data.json` into the
repo, and set the SharePoint ids in `sources.sharepoint` if you use the workbook link.

**Redzone**: not built yet; the config switch is reserved.

**Entry export** (`.github/workflows/export-entries.yml`): off by default. It would copy
entries into the repo, which is public unless the repo is private. Leave it off.

## Security notes

- The anon key in `plant-config.js` is meant to be public. The database rules protect
  the data, so keep the SQL applied.
- The old version of this site had plaintext passwords in a public repo. If you came
  from it, treat those passwords as compromised and change them everywhere they're used.
- Anything that wrote to the database with the anon key (for example a flow) will be
  refused now. Give it a signed-in service user or use the service key as a repo secret
  in a server-side job, never in the files.

## Updating from the template later

Copy new versions of the code files, but keep your own `plant-config.js`, logos and
`dashboard-data.json`/`l2l-data.json`. Then re-run `data_entries.sql`.

## Troubleshooting

- Blank page or "config" error: `plant-config.js` has a typo. Paste it into a JSON
  checker (without the first `window.PLANT_CONFIG = ` and the final `;`).
- Can't sign in: confirm the email, or check Authentication > Users in Supabase.
- Signed in but no data or can't save: you aren't approved yet, or your role is viewer.
- Save says someone else changed the dashboard: reload to see theirs, then redo yours.
- Weekly KPIs empty: enter a few days of data first; this week doesn't show until it ends.
