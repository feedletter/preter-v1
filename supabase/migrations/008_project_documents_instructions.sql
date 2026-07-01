-- Project Detail PRD 8장: 프로젝트-자료 연결(M:1, 프로젝트당 1개 자료) + 프로젝트 지시사항(1:1).
create table if not exists public.project_documents (
  project_id uuid primary key references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id),
  applied_at timestamptz not null default now()
);

create index if not exists project_documents_document_id_idx on public.project_documents(document_id);

alter table public.project_documents enable row level security;

create policy "Users manage own project documents" on public.project_documents
  for all using (
    auth.uid() = (select user_id from public.projects where id = project_id)
  ) with check (
    auth.uid() = (select user_id from public.projects where id = project_id)
  );

create table if not exists public.project_instructions (
  project_id uuid primary key references public.projects(id) on delete cascade,
  content text not null,
  updated_at timestamptz not null default now()
);

alter table public.project_instructions enable row level security;

create policy "Users manage own project instructions" on public.project_instructions
  for all using (
    auth.uid() = (select user_id from public.projects where id = project_id)
  ) with check (
    auth.uid() = (select user_id from public.projects where id = project_id)
  );
