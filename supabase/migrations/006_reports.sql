create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  category text not null check (category in ('audio', 'connection', 'ui', 'other')),
  body text not null,
  device_info jsonb,
  app_version text,
  created_at timestamptz not null default now()
);

create index if not exists reports_user_id_idx on public.reports(user_id);
create index if not exists reports_created_at_idx on public.reports(created_at);

alter table public.reports enable row level security;

create policy "Users can insert own reports" on public.reports
  for insert with check (auth.uid() = user_id);

create policy "Users can view own reports" on public.reports
  for select using (auth.uid() = user_id);
