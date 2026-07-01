create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists projects_created_at_idx on public.projects(created_at);

alter table public.projects enable row level security;

create policy "Users manage own projects" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- LeftSide PRD: 미팅이 프로젝트에 속할 수 있다 (없으면 독립 미팅).
alter table public.meeting_rooms
  add column if not exists project_id uuid references public.projects(id);

create index if not exists meeting_rooms_project_id_idx on public.meeting_rooms(project_id);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  title text not null,
  file_url text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists documents_user_id_idx on public.documents(user_id);
create index if not exists documents_created_at_idx on public.documents(created_at);

alter table public.documents enable row level security;

create policy "Users manage own documents" on public.documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
