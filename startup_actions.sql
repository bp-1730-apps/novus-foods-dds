-- startup_actions.sql  (Production Summary: action list behind each line's STARTUP pill)
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Run data_entries.sql FIRST (this file uses its permission helpers).
--
-- One shared list per production line, per plant. Everyone who belongs to the plant
-- can read it; only that plant's admins (and super-admins) can add, complete and remove actions.

do $$
begin
  if to_regprocedure('public.dds_apply_policies(text,text,text,text,text)') is null then
    raise exception 'Run data_entries.sql first (v4 or later), then run this file.';
  end if;
end $$;

create table if not exists public.startup_actions (
  id          uuid        primary key default gen_random_uuid(),
  plant_id    text        not null check (length(plant_id) > 0),
  line        text        not null check (length(line) > 0),
  text        text        not null check (length(trim(text)) > 0 and length(text) <= 400),
  done        boolean     not null default false,
  done_at     timestamptz,
  done_by     text        not null default '',
  created_by  text        not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists startup_actions_lookup on public.startup_actions (plant_id, line, created_at);

--                                        table              read      insert   update   delete
select public.dds_apply_policies('startup_actions', 'member', 'admin', 'admin', 'admin');

-- Live refresh, so a change shows up for everyone who has the dashboard open.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'startup_actions') then
    alter publication supabase_realtime add table public.startup_actions;
  end if;
end $$;

revoke all on public.startup_actions from anon;
