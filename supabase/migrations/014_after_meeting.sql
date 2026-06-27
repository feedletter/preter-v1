-- After Meeting PRD v1.0 — 미팅 종료 후 AI 요약/원본 대화 내역.
-- speaker_blocks는 미팅 중 DB 쓰기 없이 FastAPI 프로세스 메모리에 누적했다가
-- 미팅 종료 시점에 한 번에 bulk INSERT한다(서버 과부하 방지, CLAUDE.md 세션 캐시 방침과 동일 결).

create table if not exists public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  meeting_room_id uuid not null references public.meeting_rooms(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'completed', 'error')),
  base_lang varchar(5) not null,
  one_liner jsonb not null default '{}'::jsonb,
  decisions jsonb not null default '{}'::jsonb,
  action_items jsonb not null default '{}'::jsonb,
  follow_up_schedule jsonb not null default '{}'::jsonb,
  translated_langs jsonb not null default '[]'::jsonb,
  raw_prompt_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists meeting_notes_meeting_room_id_key on public.meeting_notes(meeting_room_id);

create table if not exists public.speaker_blocks (
  id uuid primary key default gen_random_uuid(),
  meeting_room_id uuid not null references public.meeting_rooms(id) on delete cascade,
  speaker_user_id uuid,
  speaker_name text not null,
  country_code varchar(2),
  original_language varchar(5) not null,
  original_text text not null,
  translations jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  sequence integer not null,
  created_at timestamptz not null default now()
);

-- 커서 기반 페이지네이션(before_sequence) 필수 인덱스 — PRD 10장, offset 방식 금지 이유 동일.
create index if not exists idx_speaker_blocks_meeting_sequence
  on public.speaker_blocks (meeting_room_id, sequence desc);

alter table public.meeting_notes enable row level security;
alter table public.speaker_blocks enable row level security;

create policy "미팅 참가자만 meeting_notes 조회"
  on public.meeting_notes for select
  using (
    meeting_room_id in (
      select room_id from public.meeting_participants where user_id = auth.uid()
    )
    or meeting_room_id in (
      select id from public.meeting_rooms where host_user_id = auth.uid()
    )
  );

create policy "미팅 참가자만 speaker_blocks 조회"
  on public.speaker_blocks for select
  using (
    meeting_room_id in (
      select room_id from public.meeting_participants where user_id = auth.uid()
    )
    or meeting_room_id in (
      select id from public.meeting_rooms where host_user_id = auth.uid()
    )
  );
