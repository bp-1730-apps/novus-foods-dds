-- data_entries.sql  (v4: several plants in one Supabase project)
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to re-run, and safe to run on top of v1 or v2 of this script.
-- **Re-run it every time you get a new copy of this file.**
--
-- WHAT CHANGED IN v4 (several plants in ONE Supabase project)
--   * New tables: plants, super_admins. plant_members now has a plant_id, so one
--     person can be Admin at one plant and Viewer at another.
--   * Every plant only ever sees its own rows: all permission checks now look at
--     the row's plant_id.
--   * A "super-admin" can create and delete plants and assign people to any plant.
--     Plant admins still manage only their own plant.
--   * Rules and Needs Action got a plant_id column (they used to be shared).
--   * Upgrading from v3: every existing admin becomes a super-admin, and existing
--     people and data are attached to the plant that already holds your data.
--     Demote anyone you do not want as a super-admin on the Plants page.
--
-- WHAT CHANGED IN v3
--   * Sign-in is now Supabase Auth (email + password). The old shared-password
--     list is gone, and the database itself now refuses anyone who is not an
--     approved team member (before, the page only HID the buttons).
--   * Three roles, kept in plant_members:
--       admin  = everything, plus approving people and changing the layout
--       editor = enter data, type the Level 1 highlight names
--       viewer = read only
--   * dds_highlights is now scoped by plant_id like every other table.
--   * New tables: plant_members, dashboard_layout_history, dashboard_panel_config.
--
-- AFTER RUNNING THIS FILE (first time only), make yourself the first admin:
--   1. In the app, click "Request an account" and sign up (or add yourself in
--      Supabase > Authentication > Users > Add user).
--   2. Run this in the SQL Editor:   select public.bootstrap_admin('you@company.com');
--      (this makes you the first super-admin)
--   3. Sign in, open Plants, create your first plant, then use the Team page to
--      approve everyone else. (Upgrading from v3? You are already set up.)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Who is allowed in
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.plants (
  id           text        primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  name         text        not null default '',
  short_label  text        not null default '',
  location     text        not null default '',
  config       jsonb       not null default '{}'::jsonb,   -- {"lines":[{"code":"2A","label":"2A"}], ...}
  created_at   timestamptz not null default now()
);

create table if not exists public.super_admins (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.plant_members (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  plant_id      text        not null,
  email         text        not null default '',
  display_name  text        not null default '',
  role          text        not null default 'viewer' check (role in ('admin','editor','viewer')),
  created_at    timestamptz not null default now(),
  primary key (user_id, plant_id)
);
-- A v3 table has no plant_id yet; the migration in section 4c fills it in.
alter table public.plant_members add column if not exists plant_id text;

-- A plant's ID can never change (every row of its data points at it).
create or replace function public.plants_lock_id() returns trigger language plpgsql as $$
begin
  if new.id <> old.id then raise exception 'A plant ID cannot be changed'; end if;
  return new;
end $$;
drop trigger if exists plants_lock_id on public.plants;
create trigger plants_lock_id before update on public.plants for each row execute function public.plants_lock_id();

-- Helper checks used by every policy below. They always return true or false (never NULL), so
-- "if not dds_is_admin(...)" in the functions below is safe for people with no access at all. SECURITY DEFINER so they can read
-- plant_members without the policies on it recursing. A super-admin counts as
-- an admin of every plant.
create or replace function public.dds_is_super() returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.super_admins where user_id = auth.uid()) $$;
create or replace function public.dds_role(p text) returns text
  language sql stable security definer set search_path = public as
  $$ select case when public.dds_is_super() then 'admin'
                 else (select role from public.plant_members where user_id = auth.uid() and plant_id = p) end $$;
create or replace function public.dds_is_member(p text) returns boolean
  language sql stable security definer set search_path = public as
  $$ select public.dds_role(p) is not null $$;
create or replace function public.dds_is_editor(p text) returns boolean
  language sql stable security definer set search_path = public as
  $$ select coalesce(public.dds_role(p) in ('admin','editor'), false) $$;
create or replace function public.dds_is_admin(p text) returns boolean
  language sql stable security definer set search_path = public as
  $$ select coalesce(public.dds_role(p) = 'admin', false) $$;

-- "Anywhere" versions, for the few old tables that have no plant_id column.
create or replace function public.dds_role() returns text
  language sql stable security definer set search_path = public as
  $$ select case when public.dds_is_super() then 'admin'
                 else (select role from public.plant_members where user_id = auth.uid()
                       order by case role when 'admin' then 1 when 'editor' then 2 else 3 end limit 1) end $$;
create or replace function public.dds_is_member() returns boolean
  language sql stable security definer set search_path = public as
  $$ select public.dds_role() is not null $$;
create or replace function public.dds_is_editor() returns boolean
  language sql stable security definer set search_path = public as
  $$ select coalesce(public.dds_role() in ('admin','editor'), false) $$;
create or replace function public.dds_is_admin() returns boolean
  language sql stable security definer set search_path = public as
  $$ select coalesce(public.dds_role() = 'admin', false) $$;

-- A plant admin (or super-admin) approves someone who has already created an
-- account, for ONE plant. The same person can be added to several plants.
drop function if exists public.add_plant_member(text,text,text);
create or replace function public.add_plant_member(p_plant text, p_email text, p_role text default 'viewer', p_name text default '')
  returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.dds_is_admin(p_plant) then raise exception 'Only an admin of this plant can add people'; end if;
  if not exists (select 1 from public.plants where id = p_plant) then raise exception 'There is no plant %', p_plant; end if;
  if p_role not in ('admin','editor','viewer') then raise exception 'Role must be admin, editor or viewer'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No account for % yet. Ask them to click "Request an account" on the login page first.', p_email; end if;
  insert into public.plant_members(user_id, plant_id, email, display_name, role)
    values (uid, p_plant, lower(trim(p_email)), coalesce(nullif(trim(p_name),''), split_part(lower(trim(p_email)),'@',1)), p_role)
    on conflict (user_id, plant_id) do update set role = excluded.role,
      display_name = case when trim(p_name) <> '' then trim(p_name) else public.plant_members.display_name end;
end $$;

-- Sign-ups that have no plant yet (and are not super-admins), so Team can list them.
create or replace function public.pending_accounts()
  returns table(email text, requested_at timestamptz) language sql stable security definer set search_path = public, auth as $$
  select u.email::text, u.created_at from auth.users u
  where (public.dds_is_super() or exists (select 1 from public.plant_members a where a.user_id = auth.uid() and a.role = 'admin'))
    and not exists (select 1 from public.plant_members m where m.user_id = u.id)
    and not exists (select 1 from public.super_admins s where s.user_id = u.id)
  order by u.created_at desc $$;

-- Super-admins only: make a new plant. p_copy_from (optional) copies another
-- plant's SETUP (columns, departments, dashboard layout, panel settings), never
-- its entered data, people or custom panels.
create or replace function public.create_plant(
  p_id text, p_name text, p_short text default '', p_location text default '',
  p_lines jsonb default '[]'::jsonb, p_copy_from text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare t text; idtype text; expr text;
begin
  if not public.dds_is_super() then raise exception 'Only a super-admin can create plants'; end if;
  p_id := trim(coalesce(p_id,''));
  if p_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' then raise exception 'Plant ID may use letters, numbers, - and _ (up to 32 characters, no spaces)'; end if;
  if trim(coalesce(p_name,'')) = '' then raise exception 'Give the plant a name'; end if;
  if exists (select 1 from public.plants where lower(id) = lower(p_id)) then raise exception 'A plant with ID % already exists', p_id; end if;
  insert into public.plants(id, name, short_label, location, config)
    values (p_id, trim(p_name), coalesce(nullif(trim(p_short),''), trim(p_name)), coalesce(trim(p_location),''),
            jsonb_build_object('lines', coalesce(p_lines, '[]'::jsonb)));
  if coalesce(p_copy_from,'') <> '' and exists (select 1 from public.plants where id = p_copy_from) then
    foreach t in array array['metric_definitions','entry_departments','dashboard_layout','dashboard_panel_config',
                             'dashboard_hidden_items','dashboard_metric_sources','dashboard_highlight_cards'] loop
      continue when to_regclass('public.' || t) is null;
      select data_type into idtype from information_schema.columns
        where table_schema = 'public' and table_name = t and column_name = 'id';
      expr := format('jsonb_build_object(''plant_id'', %L)', p_id);
      if idtype = 'uuid' then expr := expr || ' || jsonb_build_object(''id'', gen_random_uuid())';
      elsif idtype is not null then expr := expr || ' || jsonb_build_object(''id'', gen_random_uuid()::text)'; end if;
      execute format('insert into public.%I select (jsonb_populate_record(null::public.%I, to_jsonb(r) || %s)).* from public.%I r where r.plant_id = %L',
                     t, t, expr, t, p_copy_from);
    end loop;
  end if;
end $$;

-- Super-admins only. PERMANENT: erases the plant and every row that belongs to
-- it (entries, columns, layout, announcements, people's access to it...).
-- Accounts themselves are kept. The last remaining plant cannot be deleted.
create or replace function public.delete_plant(p_id text, p_confirm text)
  returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.dds_is_super() then raise exception 'Only a super-admin can delete plants'; end if;
  if not exists (select 1 from public.plants where id = p_id) then raise exception 'There is no plant %', p_id; end if;
  if p_confirm is distinct from p_id then raise exception 'Type the plant ID exactly to confirm'; end if;
  if (select count(*) from public.plants) <= 1 then raise exception 'This is the last plant. Create another one first.'; end if;
  for r in
    select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'plant_id'
  loop
    execute format('delete from public.%I where plant_id = %L', r.table_name, p_id);
  end loop;
  delete from public.plants where id = p_id;
end $$;

-- Super-admins only: promote or demote a super-admin (you cannot demote yourself).
create or replace function public.set_super_admin(p_email text, p_on boolean)
  returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.dds_is_super() then raise exception 'Only a super-admin can do this'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No account for % yet.', p_email; end if;
  if p_on then
    insert into public.super_admins(user_id, email) values (uid, lower(trim(p_email))) on conflict do nothing;
  else
    if uid = auth.uid() then raise exception 'You cannot remove your own super-admin access'; end if;
    delete from public.super_admins where user_id = uid;
  end if;
end $$;

-- First super-admin. Only works while there is none, and only from the SQL
-- Editor (not callable from the website).
create or replace function public.bootstrap_admin(p_email text) returns text
  language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if exists (select 1 from public.super_admins) then raise exception 'A super-admin already exists. Use the Plants page.'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No account for %. Sign up first (or add the user in Authentication > Users).', p_email; end if;
  insert into public.super_admins(user_id, email) values (uid, lower(trim(p_email)));
  return p_email || ' is now a super-admin';
end $$;

revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;
revoke all on function public.add_plant_member(text,text,text,text) from public, anon;
revoke all on function public.pending_accounts() from public, anon;
revoke all on function public.create_plant(text,text,text,text,jsonb,text) from public, anon;
revoke all on function public.delete_plant(text,text) from public, anon;
revoke all on function public.set_super_admin(text,boolean) from public, anon;
grant execute on function public.add_plant_member(text,text,text,text) to authenticated;
grant execute on function public.pending_accounts() to authenticated;
grant execute on function public.create_plant(text,text,text,text,jsonb,text) to authenticated;
grant execute on function public.delete_plant(text,text) to authenticated;
grant execute on function public.set_super_admin(text,boolean) to authenticated;
grant execute on function public.dds_is_super(), public.dds_role(text), public.dds_is_member(text),
  public.dds_is_editor(text), public.dds_is_admin(text),
  public.dds_role(), public.dds_is_member(), public.dds_is_editor(), public.dds_is_admin() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Data Entry tables
-- ═══════════════════════════════════════════════════════════════════════════
--   metric_definitions : the columns of each department's entry grid
--                        (form_type = department name, e.g. 'QA', 'Production').
--   data_entries       : one row per department + date + line/city. Values live
--                        in `data` jsonb, keyed by the metric's stable `key`.

create table if not exists public.metric_definitions (
  id          uuid        primary key default gen_random_uuid(),
  plant_id    text        not null check (length(plant_id) > 0),
  form_type   text        not null default 'shift_log',
  key         text        not null check (key ~ '^[a-z0-9_]{1,60}$'),
  label       text        not null check (length(label) between 1 and 80),
  type        text        not null default 'number',
  unit        text        not null default '',
  options     jsonb       not null default '[]'::jsonb,
  required    boolean     not null default false,
  sort        integer     not null default 0,
  active      boolean     not null default true,   -- false = "removed"; history is kept
  created_by  text        not null default '',
  created_at  timestamptz not null default now(),
  unique (plant_id, form_type, key)
);

alter table public.metric_definitions drop constraint if exists metric_definitions_type_check;
alter table public.metric_definitions
  add constraint metric_definitions_type_check check (type in ('number','percent','text','select','calc'));

create table if not exists public.data_entries (
  id          uuid        primary key default gen_random_uuid(),
  plant_id    text        not null check (length(plant_id) > 0),
  form_type   text        not null check (length(form_type) > 0),
  entry_date  date,
  data        jsonb       not null default '{}'::jsonb,
  created_by  text        not null default 'unknown',
  created_at  timestamptz not null default now(),
  constraint data_entries_size check (pg_column_size(data) < 20000)
);

alter table public.data_entries add column if not exists row_key text not null default '';
alter table public.data_entries add column if not exists updated_at timestamptz not null default now();

-- Collapse any duplicate rows from the first version (keeps the newest).
delete from public.data_entries a
  using public.data_entries b
  where a.plant_id = b.plant_id and a.form_type = b.form_type
    and a.entry_date is not distinct from b.entry_date and a.row_key = b.row_key
    and (a.created_at, a.id) < (b.created_at, b.id);

create unique index if not exists data_entries_row_unique
  on public.data_entries (plant_id, form_type, entry_date, row_key);
create index if not exists data_entries_lookup
  on public.data_entries (plant_id, form_type, entry_date desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Dashboard: notes/trend cards, hidden items, tab + tile settings,
--    sections, layout, highlight cards. All shared per plant.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.dashboard_custom_widgets (
  id           text        primary key,
  plant_id     text        not null,
  panel_id     text        not null,
  sheet        text        not null default '',
  field        text        not null default '',
  widget_type  text        not null,
  agg          text,
  range_days   integer     not null default 30,
  target       numeric,
  target_dir   text        not null default 'gte',
  full_width   boolean     not null default false,
  label        text        not null default '',
  created_by   text        not null default '',
  created_at   timestamptz not null default now()
);
alter table public.dashboard_custom_widgets add column if not exists body text;

-- Allow the 'trend' and 'text' widget types: drop any older CHECK on widget_type.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.dashboard_custom_widgets'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%widget_type%'
  loop
    execute format('alter table public.dashboard_custom_widgets drop constraint %I', c.conname);
  end loop;
end $$;

create table if not exists public.dashboard_hidden_items (
  plant_id    text        not null,
  item_key    text        not null,      -- 'panel:<id>' or 'metric:<element id>'
  hidden_by   text        not null default '',
  created_at  timestamptz not null default now(),
  primary key (plant_id, item_key)
);

create table if not exists public.entry_departments (
  id          uuid        primary key default gen_random_uuid(),
  plant_id    text        not null,
  name        text        not null check (length(name) between 1 and 40),
  row_mode    text        not null default 'none' check (row_mode in ('none','line','city','custom')),
  row_label   text        not null default '',
  row_values  jsonb       not null default '[]'::jsonb,
  panel       text        not null default 'panel-production',
  active      boolean     not null default true,
  sort        integer     not null default 0,
  created_by  text        not null default '',
  created_at  timestamptz not null default now(),
  unique (plant_id, name)
);

create table if not exists public.dashboard_metric_sources (
  plant_id    text        not null,
  item_key    text        not null,      -- 'metric:<tile element id>'
  sheet       text        not null,
  field       text        not null,
  row_key     text        not null default '',
  agg         text        not null default 'latest' check (agg in ('latest','avg7','sum7')),
  updated_by  text        not null default '',
  updated_at  timestamptz not null default now(),
  primary key (plant_id, item_key)
);

create table if not exists public.dashboard_custom_panels (
  id          text        primary key,
  plant_id    text        not null,
  title       text        not null check (length(title) between 1 and 60),
  icon        text        not null default '',
  span        integer     not null default 4 check (span between 2 and 12),
  created_by  text        not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.dashboard_layout (
  plant_id     text        primary key,
  panel_order  jsonb       not null default '[]'::jsonb,
  panel_spans  jsonb       not null default '{}'::jsonb,
  updated_by   text        not null default '',
  updated_at   timestamptz not null default now()
);

create table if not exists public.dashboard_highlight_cards (
  plant_id    text        not null,
  card_key    text        not null,
  label       text        not null,
  icon        text        not null default '',
  sort        integer     not null default 0,
  updated_by  text        not null default '',
  updated_at  timestamptz not null default now(),
  primary key (plant_id, card_key)
);

-- NEW in v3 ------------------------------------------------------------------
-- Per-panel settings for panels that are built from a config (Production Summary).
-- Whatever is saved here overrides the defaults in plant-config.js.
create table if not exists public.dashboard_panel_config (
  plant_id    text        not null,
  panel_id    text        not null,
  config      jsonb       not null default '{}'::jsonb,
  updated_by  text        not null default '',
  updated_at  timestamptz not null default now(),
  primary key (plant_id, panel_id)
);

-- Every saved layout is kept, so an admin can "restore previous layout".
create table if not exists public.dashboard_layout_history (
  id          uuid        primary key default gen_random_uuid(),
  plant_id    text        not null,
  snapshot    jsonb       not null,
  note        text        not null default '',
  saved_by    text        not null default '',
  saved_at    timestamptz not null default now()
);
create index if not exists dashboard_layout_history_lookup
  on public.dashboard_layout_history (plant_id, saved_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Level 1 DDS Highlights: scope the existing table by plant
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.dds_highlights (
  dept        text        not null,
  employee    text        not null default '',
  note        text        not null default '',
  updated_by  text        not null default '',
  updated_at  timestamptz not null default now()
);
alter table public.dds_highlights add column if not exists plant_id text;
-- Rows saved before v3 belong to this project's plant: borrow its plant_id.
update public.dds_highlights
   set plant_id = coalesce((select plant_id from public.metric_definitions limit 1),
                           (select plant_id from public.data_entries limit 1),
                           (select plant_id from public.dashboard_layout limit 1),
                           'plant')
 where plant_id is null;
alter table public.dds_highlights alter column plant_id set not null;
do $$
declare c record;
begin
  -- Replace any primary key / unique constraint that is only on (dept).
  for c in
    select conname from pg_constraint
    where conrelid = 'public.dds_highlights'::regclass and contype in ('p','u')
      and pg_get_constraintdef(oid) !~* 'plant_id'
  loop
    execute format('alter table public.dds_highlights drop constraint %I', c.conname);
  end loop;
  -- Plain unique indexes on (dept) alone (created outside a constraint).
  for c in
    select i.indexrelid::regclass::text as idx
    from pg_index i
    where i.indrelid = 'public.dds_highlights'::regclass and i.indisunique and not i.indisprimary
      and pg_get_indexdef(i.indexrelid) !~* 'plant_id'
      and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
  loop
    execute format('drop index %s', c.idx);
  end loop;
end $$;
-- (plant_id, dept) becomes the primary key. A primary key (not just a unique index)
-- is what lets Supabase live-refresh keep publishing updates for this table.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.dds_highlights'::regclass and contype = 'p') then
    alter table public.dds_highlights add primary key (plant_id, dept);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4b. Meeting boards (Announcements, Rules, Needs Action, Play Call, ...)
-- Created only if missing, so a project that already has them is left alone.
-- A brand-new project for another plant gets them here.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.announcements (
  id text primary key, plant_id text not null default '', number text default '', text text default '',
  date text default '', image text default '', color text default '', created_at timestamptz not null default now()
);
alter table public.announcements add column if not exists plant_id text not null default '';
create table if not exists public.rules (
  id text primary key, text text default '', date text default '', created_at timestamptz not null default now()
);
alter table public.rules add column if not exists plant_id text not null default '';
create table if not exists public.needs_action (
  id text primary key, date text default '', description text default '', owner text default '',
  completed_date text default '', created_at timestamptz not null default now()
);
alter table public.needs_action add column if not exists plant_id text not null default '';
create table if not exists public.play_call (
  id text primary key, plant_id text not null default '', owner text default '', text text default '',
  webhook text default '', date text default '', created_at timestamptz not null default now()
);
alter table public.play_call add column if not exists plant_id text not null default '';
-- Used only by archive/weekly-staff-meeting.html (a page that is no longer linked from the menu).
create table if not exists public.lean_initiatives (
  id text primary key, dept text default '', title text default '', owner text default '', category text default 'Process',
  status text default 'Proposed', est_hours_saved numeric default 0, actual_hours_saved numeric default 0,
  est_material_savings numeric default 0, actual_material_savings numeric default 0, notes text default '',
  week_flagged text default '', completed_date text default '', created_at timestamptz not null default now()
);
create table if not exists public.lean_dept_state (
  dept text primary key, current_state text default '', updated_at timestamptz not null default now()
);
create table if not exists public.weekly_staff_meeting (
  dept text primary key, lw_items jsonb default '[]'::jsonb, tw_items jsonb default '[]'::jsonb,
  front_tiles jsonb default '[]'::jsonb, back_tiles jsonb default '[]'::jsonb, updated_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4c. Upgrade from v3 (one plant) and tidy the plant tables
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare first_run boolean; pid text;
begin
  first_run := not exists (select 1 from public.plants);
  if first_run then
    -- Register the plant IDs that already hold data. The name is left blank so the
    -- site keeps showing the name from plant-config.js until you edit it on the Plants page.
    insert into public.plants(id, name, short_label)
    select distinct x, '', '' from (
      select plant_id x from public.metric_definitions
      union select plant_id from public.data_entries
      union select plant_id from public.dashboard_layout
      union select plant_id from public.dds_highlights
      union select plant_id from public.announcements
      union select plant_id from public.play_call
    ) u where x is not null and x ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'
    on conflict do nothing;
    select p.id into pid from public.plants p
      order by (select count(*) from public.data_entries d where d.plant_id = p.id) desc, p.id limit 1;
    if pid is null and exists (select 1 from public.plant_members where plant_id is null) then
      insert into public.plants(id, name, short_label) values ('plant', '', '');
      pid := 'plant';
    end if;
    if pid is not null then
      update public.plant_members set plant_id = pid where plant_id is null;
      update public.announcements set plant_id = pid where plant_id = '';
      update public.play_call     set plant_id = pid where plant_id = '';
      update public.rules         set plant_id = pid where plant_id = '';
      update public.needs_action  set plant_id = pid where plant_id = '';
      -- v3 admins could already do everything project-wide, so they keep that power.
      insert into public.super_admins(user_id, email)
        select user_id, email from public.plant_members where role = 'admin' on conflict do nothing;
    end if;
  end if;

  delete from public.plant_members where plant_id is null;
  alter table public.plant_members alter column plant_id set not null;
  if not exists (select 1 from pg_constraint where conrelid = 'public.plant_members'::regclass and contype = 'p'
                   and pg_get_constraintdef(oid) like '%plant_id%') then
    alter table public.plant_members drop constraint if exists plant_members_pkey;
    alter table public.plant_members add primary key (user_id, plant_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plant_members_plant_fk') then
    -- people whose plant no longer exists have nothing to point at
    delete from public.plant_members m where not exists (select 1 from public.plants p where p.id = m.plant_id);
    alter table public.plant_members add constraint plant_members_plant_fk
      foreign key (plant_id) references public.plants(id) on delete cascade;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Permissions (row-level security)
-- ═══════════════════════════════════════════════════════════════════════════
-- dds_apply_policies(table, read, insert, update, delete): removes every old
-- policy on the table (including the old "anyone can" ones), then creates one
-- policy per action. Each level is 'member' | 'editor' | 'admin' | null (= nobody).
create or replace function public.dds_apply_policies(
  tbl text, r_read text, r_insert text, r_update text, r_delete text) returns void
  language plpgsql set search_path = public as $$
declare p record; arg text;
begin
  execute format('alter table public.%I enable row level security', tbl);
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = tbl loop
    execute format('drop policy %I on public.%I', p.policyname, tbl);
  end loop;
  -- A table with a plant_id column is checked against THAT row's plant.
  -- A table without one (old archived boards) is checked against "any plant".
  arg := case when exists (select 1 from information_schema.columns
                           where table_schema = 'public' and table_name = tbl and column_name = 'plant_id')
              then 'plant_id' else '' end;
  if r_read   is not null then
    execute format('create policy "dds read" on public.%I for select to authenticated using (public.dds_is_%s(%s))', tbl, r_read, arg);
  end if;
  if r_insert is not null then
    execute format('create policy "dds insert" on public.%I for insert to authenticated with check (public.dds_is_%s(%s))', tbl, r_insert, arg);
  end if;
  if r_update is not null then
    execute format('create policy "dds update" on public.%I for update to authenticated using (public.dds_is_%s(%s)) with check (public.dds_is_%s(%s))', tbl, r_update, arg, r_update, arg);
  end if;
  if r_delete is not null then
    execute format('create policy "dds delete" on public.%I for delete to authenticated using (public.dds_is_%s(%s))', tbl, r_delete, arg);
  end if;
end $$;
revoke all on function public.dds_apply_policies(text,text,text,text,text) from public, anon, authenticated;

--                                        table                         read      insert    update    delete
select public.dds_apply_policies('data_entries',               'member', 'editor', 'editor', null);
select public.dds_apply_policies('metric_definitions',         'member', 'editor', 'admin',  null);   -- editors may only seed first-visit columns
select public.dds_apply_policies('entry_departments',          'member', 'admin',  'admin',  null);
select public.dds_apply_policies('dashboard_custom_widgets',   'member', 'admin',  'admin',  'admin');
select public.dds_apply_policies('dashboard_hidden_items',     'member', 'admin',  'admin',  'admin');
select public.dds_apply_policies('dashboard_metric_sources',   'member', 'admin',  'admin',  'admin');
select public.dds_apply_policies('dashboard_custom_panels',    'member', 'admin',  'admin',  'admin');
select public.dds_apply_policies('dashboard_layout',           'member', 'admin',  'admin',  'admin');
select public.dds_apply_policies('dashboard_highlight_cards',  'member', 'admin',  'admin',  'admin');
select public.dds_apply_policies('dashboard_panel_config',     'member', 'admin',  'admin',  'admin');
select public.dds_apply_policies('dashboard_layout_history',   'admin',  'admin',  null,     null);
select public.dds_apply_policies('dds_highlights',             'member', 'editor', 'editor', null);
select public.dds_apply_policies('announcements',              'member', 'editor', 'editor', 'editor');
select public.dds_apply_policies('rules',                      'member', 'editor', 'editor', 'editor');
select public.dds_apply_policies('needs_action',               'member', 'editor', 'editor', 'editor');
select public.dds_apply_policies('play_call',                  'member', 'editor', 'editor', 'editor');

-- plants: you see the plants you belong to (a super-admin sees all). An admin of a
-- plant may edit its name, location and lines; creating and deleting plants only
-- happens through create_plant() / delete_plant(), for super-admins.
do $$
declare p record; t text;
begin
  foreach t in array array['plants','plant_members','super_admins'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;
create policy "plants read"   on public.plants for select to authenticated using (public.dds_is_member(id));
create policy "plants update" on public.plants for update to authenticated
  using (public.dds_is_admin(id)) with check (public.dds_is_admin(id));
create policy "super read"    on public.super_admins for select to authenticated using (public.dds_is_super());
-- plant_members: you can see your own rows; a plant's admins see and manage that plant's people.
-- (New rows only come from add_plant_member() above.)
create policy "members read"   on public.plant_members for select to authenticated
  using (user_id = auth.uid() or public.dds_is_admin(plant_id));
create policy "members update" on public.plant_members for update to authenticated
  using (public.dds_is_admin(plant_id)) with check (public.dds_is_admin(plant_id));
create policy "members delete" on public.plant_members for delete to authenticated
  using (public.dds_is_admin(plant_id) and user_id <> auth.uid());   -- admins cannot remove themselves

-- Boards created by other setup scripts (announcements, play call, etc.).
-- Only tightened if the table exists in this project. Editors and admins can
-- change them; viewers can read. The weekly KPI table is written by a script
-- with the service key, which bypasses these rules. (Weekly KPIs are now worked out in the browser from Data Entry, so that table is no longer used.)
do $$
declare t text;
begin
  foreach t in array array['lean_initiatives','lean_dept_state','weekly_staff_meeting'] loop
    if to_regclass('public.' || t) is not null then
      perform public.dds_apply_policies(t, 'member', 'editor', 'editor', 'editor');
    end if;
  end loop;
  -- Old tables from the retired Excel / Power Automate-to-Supabase pipelines: read-only if they still exist.
  foreach t in array array['weekly_kpi_data','dashboard_data'] loop
    if to_regclass('public.' || t) is not null then
      perform public.dds_apply_policies(t, 'member', null, null, null);
    end if;
  end loop;
end $$;

-- Nobody who is signed out can touch anything.
revoke all on all tables in schema public from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Live refresh for open pages (skips tables already published)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['data_entries','metric_definitions','dashboard_hidden_items',
      'dashboard_custom_widgets','entry_departments','dashboard_metric_sources',
      'dashboard_custom_panels','dashboard_layout','dashboard_highlight_cards',
      'dashboard_panel_config','dds_highlights','announcements','rules','needs_action','play_call'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
