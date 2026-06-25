-- Doc Detail PRD — 빈 자료 생성 + AI 분석 채팅 메시지 + 통역 맥락 저장.

-- 자료는 이제 "제목없음" 빈 상태로 생성되고, 파일은 메시지 단위로 첨부된다.
alter table public.documents alter column file_url drop not null;

create table if not exists public.document_messages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  type text not null check (type in ('file', 'text')),
  content text,
  file_url text,
  file_name text,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  analysis_result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.document_contexts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  message_id uuid references public.document_messages(id) on delete set null,
  analysis_points jsonb not null,
  technical_terms jsonb,
  language_hint text,
  priority text,
  created_at timestamptz not null default now()
);

create index if not exists document_messages_document_id_created_at_idx
  on public.document_messages(document_id, created_at);

create index if not exists document_contexts_document_id_created_at_idx
  on public.document_contexts(document_id, created_at desc);
