create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_key text not null unique,
  name text not null,
  category text not null check (category in ('Photos', 'Musique', 'Vidéos', 'Documents')),
  mime_type text not null,
  size bigint not null check (size >= 0),
  created_at timestamptz not null default now()
);

alter table public.files enable row level security;

revoke all on public.files from anon;
grant select, insert, delete on public.files to authenticated;

drop policy if exists "Users can read their own files" on public.files;
create policy "Users can read their own files"
  on public.files for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own files" on public.files;
create policy "Users can add their own files"
  on public.files for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own files" on public.files;
create policy "Users can delete their own files"
  on public.files for delete to authenticated
  using ((select auth.uid()) = user_id);
