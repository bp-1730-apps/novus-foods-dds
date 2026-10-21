-- integrations.sql  (per-plant connections to Leading2Lean / Redzone)
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Run data_entries.sql FIRST (v4 or later). Then deploy the "integrations-run" function (PLANT_SETUP.md).
--
-- What this gives each plant's admins: a Connection page where they type their OWN API key and settings.
--   * Settings (company, site, line matching, on/off) are saved in plant_integrations. Not secret.
--   * The API key is saved in Supabase Vault. The website cannot read it back, not even the admin who
--     typed it; only the server-side function (service role) can, to make the L2L calls.
--   * An admin only ever sees and changes their own plant's connection. Super-admins do not see keys.

do $$
begin
  if to_regprocedure('public.dds_apply_policies(text,text,text,text,text)') is null then
    raise exception 'Run data_entries.sql first (v4 or later), then run this file.';
  end if;
  if to_regnamespace('vault') is null then
    raise exception 'Supabase Vault is not enabled. In the Supabase dashboard open Database > Extensions, turn on "supabase_vault", then run this file again.';
  end if;
end $$;

create table if not exists public.plant_integrations (
  plant_id      text        primary key references public.plants(id) on delete cascade,
  provider      text        not null check (provider in ('l2l','redzone')),
  enabled       boolean     not null default false,
  settings      jsonb       not null default '{}'::jsonb,   -- company, site number, Code Red/Yellow ids, time zone... never the key
  key_hint      text        not null default '',            -- last 4 characters of the saved key, for "is this the right one?"
  last_run_at   timestamptz,                                -- last time numbers were pulled
  last_status   text        not null default '' check (last_status in ('','ok','error')),
  last_message  text        not null default '',
  updated_by    text        not null default '',
  updated_at    timestamptz not null default now(),
  constraint plant_integrations_settings_size check (pg_column_size(settings) < 4000)
);

-- Where the Vault id of each plant's key is remembered. No policies and no grants: the browser can never read it.
create table if not exists public.plant_integration_secrets (
  plant_id   text primary key references public.plants(id) on delete cascade,
  vault_id   uuid not null
);
alter table public.plant_integration_secrets enable row level security;
revoke all on public.plant_integration_secrets from anon, authenticated;

-- When a plant's secret row goes (key removed, or the whole plant deleted), remove the key from Vault too.
create or replace function public.plant_integration_secret_cleanup() returns trigger
  language plpgsql security definer set search_path = public, vault as $$
begin
  delete from vault.secrets where id = old.vault_id;
  return old;
end $$;
drop trigger if exists plant_integration_secret_cleanup on public.plant_integration_secrets;
create trigger plant_integration_secret_cleanup after delete on public.plant_integration_secrets
  for each row execute function public.plant_integration_secret_cleanup();

-- Everyone in the plant may see THAT a connection exists and its status (the dashboard needs it to know
-- which numbers are filled automatically). Nobody writes the table directly: save_integration() does it.
select public.dds_apply_policies('plant_integrations', 'member', null, null, null);

-- Save or change a plant's connection. p_key is optional: leave it null to keep the key already saved.
create or replace function public.save_integration(
  p_plant text, p_provider text, p_enabled boolean, p_settings jsonb, p_key text default null)
  returns void language plpgsql security definer set search_path = public, vault as $$
declare k text := nullif(trim(coalesce(p_key, '')), ''); sid uuid; hint text; have boolean;
begin
  if not public.dds_is_admin(p_plant) then raise exception 'Only an admin of this plant can change its connection'; end if;
  if p_provider not in ('l2l','redzone') then raise exception 'Unknown provider'; end if;
  if p_provider = 'redzone' and p_enabled then raise exception 'Redzone connections are not available yet'; end if;
  if jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) <> 'object' then raise exception 'Settings must be an object'; end if;
  if k is not null and (length(k) < 8 or length(k) > 200) then raise exception 'That does not look like an API key (8 to 200 characters)'; end if;

  if k is not null then
    select vault_id into sid from public.plant_integration_secrets where plant_id = p_plant;
    if sid is null then
      sid := vault.create_secret(k, 'plant_integration:' || p_plant, 'API key for plant ' || p_plant);
      insert into public.plant_integration_secrets(plant_id, vault_id) values (p_plant, sid);
    else
      perform vault.update_secret(sid, k);
    end if;
    hint := right(k, 4);
  end if;

  select exists (select 1 from public.plant_integration_secrets where plant_id = p_plant) into have;
  if p_enabled and not have then raise exception 'Add the API key before turning the connection on'; end if;

  insert into public.plant_integrations(plant_id, provider, enabled, settings, key_hint, updated_by, updated_at)
    values (p_plant, p_provider, p_enabled, coalesce(p_settings, '{}'::jsonb), coalesce(hint, ''),
            coalesce((select email from auth.users where id = auth.uid()), ''), now())
  on conflict (plant_id) do update set provider = excluded.provider, enabled = excluded.enabled,
      settings = excluded.settings, key_hint = case when hint is not null then hint else public.plant_integrations.key_hint end,
      updated_by = excluded.updated_by, updated_at = now();
end $$;

-- Forget the saved key and switch the connection off.
create or replace function public.clear_integration_key(p_plant text)
  returns void language plpgsql security definer set search_path = public, vault as $$
begin
  if not public.dds_is_admin(p_plant) then raise exception 'Only an admin of this plant can change its connection'; end if;
  delete from public.plant_integration_secrets where plant_id = p_plant;   -- trigger removes it from Vault
  update public.plant_integrations set enabled = false, key_hint = '', last_status = '', last_message = '', updated_at = now() where plant_id = p_plant;
end $$;

-- The ONLY way to read a key, and only the server-side function (service role) may call it.
create or replace function public.integration_key(p_plant text) returns text
  language sql stable security definer set search_path = public, vault as
  $$ select ds.decrypted_secret from public.plant_integration_secrets s
       join vault.decrypted_secrets ds on ds.id = s.vault_id where s.plant_id = p_plant $$;

revoke all on function public.save_integration(text,text,boolean,jsonb,text) from public, anon;
revoke all on function public.clear_integration_key(text) from public, anon;
revoke all on function public.integration_key(text) from public, anon, authenticated;
grant execute on function public.save_integration(text,text,boolean,jsonb,text) to authenticated;
grant execute on function public.clear_integration_key(text) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.integration_key(text) to service_role;
  end if;
end $$;
