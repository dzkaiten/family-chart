-- ============================================================================
-- Family Tree — ONE-PASTE first-time setup
-- ============================================================================
-- Convenience file: this is supabase/schema.sql (canonical) + the seed from
-- app/README.md steps 2 & 3, combined so you can paste it ONCE into the
-- Supabase SQL Editor and run it.
--
--   1. Supabase dashboard -> SQL Editor -> New query
--   2. Paste this whole file -> Run
--   3. Read VITE_TREE_ID from the result grid (bottom) -> put it in app/.env
--
-- ►►► ONLY THING TO EDIT: set OWNER_EMAIL below to the email you will log in
--     with (this becomes the tree owner / allowlisted account).
--
-- Safe to re-run: the schema is idempotent, and the seed only creates a tree
-- if none exists yet (re-running just re-prints the existing VITE_TREE_ID).
-- ============================================================================

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists trees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_language text not null default 'en',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists allowed_emails (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees(id) on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (tree_id, email)
);

create index if not exists allowed_emails_email_idx on allowed_emails (lower(email));

create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees(id) on delete cascade,
  name text not null,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_role text not null default 'editor',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create index if not exists access_requests_tree_status_idx on access_requests (tree_id, status);

create table if not exists tree_data (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees(id) on delete cascade unique,
  data jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  data_version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists snapshots (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees(id) on delete cascade,
  data jsonb not null,
  change_summary text,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users(id)
);

create index if not exists snapshots_tree_saved_idx on snapshots (tree_id, saved_at desc);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees(id) on delete cascade,
  actor uuid references auth.users(id),
  action text not null,
  target jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_tree_idx on audit_log (tree_id, created_at desc);

-- ============================================================================
-- Helper functions
-- ============================================================================

-- Returns the JWT's email claim for the current request (lowercased).
create or replace function current_user_email()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- True if the current user's email is in allowed_emails for this tree.
create or replace function is_allowlisted(p_tree_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from allowed_emails
    where tree_id = p_tree_id
      and lower(email) = current_user_email()
  );
$$;

-- True if the current user is an owner of this tree.
create or replace function is_owner(p_tree_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from allowed_emails
    where tree_id = p_tree_id
      and lower(email) = current_user_email()
      and role = 'owner'
  );
$$;

-- ============================================================================
-- Snapshot trigger (capture previous state before every tree_data update)
-- ============================================================================

create or replace function snapshot_tree_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  retention_count constant integer := 20;
begin
  -- Only snapshot if data actually changed
  if old.data is distinct from new.data then
    insert into snapshots (tree_id, data, saved_by)
    values (old.tree_id, old.data, old.updated_by);

    -- Prune older snapshots beyond retention_count for this tree
    delete from snapshots
    where id in (
      select id from snapshots
      where tree_id = old.tree_id
      order by saved_at desc
      offset retention_count
    );
  end if;

  return new;
end;
$$;

drop trigger if exists tree_data_snapshot on tree_data;
create trigger tree_data_snapshot
  before update on tree_data
  for each row
  execute function snapshot_tree_data();

-- ============================================================================
-- Bump version on every tree_data update (concurrency control)
-- ============================================================================

create or replace function bump_tree_data_version()
returns trigger
language plpgsql
as $$
begin
  -- If the client didn't bump version themselves, ensure it advances anyway
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tree_data_bump_version on tree_data;
create trigger tree_data_bump_version
  before update on tree_data
  for each row
  execute function bump_tree_data_version();

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table trees enable row level security;
alter table allowed_emails enable row level security;
alter table access_requests enable row level security;
alter table tree_data enable row level security;
alter table snapshots enable row level security;
alter table audit_log enable row level security;

-- ----- trees: allowlisted may read; only owner may update -----
drop policy if exists trees_select on trees;
create policy trees_select on trees
  for select
  using (is_allowlisted(id));

drop policy if exists trees_update on trees;
create policy trees_update on trees
  for update
  using (is_owner(id))
  with check (is_owner(id));

-- (no insert/delete policies; seeded via SQL editor only)

-- ----- allowed_emails: owner-only for everything -----
drop policy if exists allowed_emails_select on allowed_emails;
create policy allowed_emails_select on allowed_emails
  for select
  using (is_owner(tree_id));

drop policy if exists allowed_emails_insert on allowed_emails;
create policy allowed_emails_insert on allowed_emails
  for insert
  with check (is_owner(tree_id));

drop policy if exists allowed_emails_update on allowed_emails;
create policy allowed_emails_update on allowed_emails
  for update
  using (is_owner(tree_id))
  with check (is_owner(tree_id));

drop policy if exists allowed_emails_delete on allowed_emails;
create policy allowed_emails_delete on allowed_emails
  for delete
  using (is_owner(tree_id));

-- ----- access_requests: owner reads; ANYONE (even anon) can submit -----
drop policy if exists access_requests_select on access_requests;
create policy access_requests_select on access_requests
  for select
  using (is_owner(tree_id));

drop policy if exists access_requests_insert on access_requests;
create policy access_requests_insert on access_requests
  for insert
  with check (true);

drop policy if exists access_requests_update on access_requests;
create policy access_requests_update on access_requests
  for update
  using (is_owner(tree_id))
  with check (is_owner(tree_id));

-- ----- tree_data: allowlisted may read; editor/owner may update -----
drop policy if exists tree_data_select on tree_data;
create policy tree_data_select on tree_data
  for select
  using (is_allowlisted(tree_id));

drop policy if exists tree_data_update on tree_data;
create policy tree_data_update on tree_data
  for update
  using (is_allowlisted(tree_id))
  with check (is_allowlisted(tree_id));

-- (no insert/delete policies; one row per tree seeded via SQL editor)

-- ----- snapshots: owner reads; trigger writes (security definer bypasses RLS) -----
drop policy if exists snapshots_select on snapshots;
create policy snapshots_select on snapshots
  for select
  using (is_owner(tree_id));

-- ----- audit_log: owner reads; app writes (we'll allow editor+ inserts) -----
drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log
  for select
  using (is_owner(tree_id));

drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log
  for insert
  with check (is_allowlisted(tree_id));

-- ============================================================================
-- Storage bucket for avatars (private)
-- ============================================================================

-- Run this once. The bucket itself is created here; RLS policies on
-- storage.objects below restrict who can read/write.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- Helper: extract tree_id (first path segment) from a storage object name
create or replace function avatar_tree_id(name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(name, '/', 1), '')::uuid;
$$;

drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects
  for select
  using (
    bucket_id = 'avatars'
    and is_allowlisted(avatar_tree_id(name))
  );

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert
  with check (
    bucket_id = 'avatars'
    and is_allowlisted(avatar_tree_id(name))
  );

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update
  using (
    bucket_id = 'avatars'
    and is_allowlisted(avatar_tree_id(name))
  );

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete
  using (
    bucket_id = 'avatars'
    and is_allowlisted(avatar_tree_id(name))
  );

-- ============================================================================
-- SEED: your tree + you as owner + an empty data row  (README steps 2 & 3)
-- ============================================================================
-- Creates exactly one tree the first time it runs. The data-modifying CTEs
-- below all execute to completion; the final SELECT prints VITE_TREE_ID.

with new_tree as (
  insert into trees (name, default_language)
  select 'My Family', 'en'
  where not exists (select 1 from trees)   -- don't create a duplicate on re-run
  returning id
),
ins_owner as (
  insert into allowed_emails (tree_id, email, role)
  select id,
         'you@example.com',   -- ►►► OWNER_EMAIL: set to the email you log in with
         'owner'
  from new_tree
  returning tree_id
),
ins_data as (
  insert into tree_data (tree_id, data, version, data_version)
  select id, '[]'::jsonb, 1, 1 from new_tree
  returning tree_id
)
select id as "VITE_TREE_ID", name, default_language
from trees
order by created_at;
