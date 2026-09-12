-- Apex cloud sync — run this once in Supabase: SQL Editor → New query → Run
create table if not exists public.apex_state (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  value      text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.apex_state enable row level security;
create policy "own rows: read"   on public.apex_state for select using (auth.uid() = user_id);
create policy "own rows: insert" on public.apex_state for insert with check (auth.uid() = user_id);
create policy "own rows: update" on public.apex_state for update using (auth.uid() = user_id);
create policy "own rows: delete" on public.apex_state for delete using (auth.uid() = user_id);
-- live updates between devices
alter publication supabase_realtime add table public.apex_state;
