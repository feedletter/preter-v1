-- PRD: Preter Guest Entry v1.0.0, 6장 데이터베이스 스키마
-- Guest 참가자는 Preter 계정이 없으므로 별도 테이블로 임시 관리한다.

-- 6.2 public.meeting_rooms --------------------------------------------------
create table if not exists public.meeting_rooms (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references public.users(id),
  room_code char(6) not null,
  title text,
  password_hash text,
  max_participants integer not null default 10,
  primary_language text not null default 'ko',
  status text not null default 'waiting' check (status in ('waiting', 'active', 'ended')),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists idx_meeting_rooms_room_code
  on public.meeting_rooms(room_code) where deleted_at is null;
create index if not exists idx_meeting_rooms_host_user_id on public.meeting_rooms(host_user_id);
create index if not exists idx_meeting_rooms_status on public.meeting_rooms(status);
create index if not exists idx_meeting_rooms_scheduled_at on public.meeting_rooms(scheduled_at);
create index if not exists idx_meeting_rooms_expires_at on public.meeting_rooms(expires_at);

alter table public.meeting_rooms enable row level security;

create policy "본인이 호스트인 미팅룸만 조회"
  on public.meeting_rooms for select
  using (auth.uid() = host_user_id);

create policy "본인이 호스트인 미팅룸만 수정"
  on public.meeting_rooms for update
  using (auth.uid() = host_user_id);

-- 6.3 public.meeting_participants -------------------------------------------
create table if not exists public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.meeting_rooms(id) on delete cascade,
  user_id uuid references public.users(id),
  guest_session_id uuid,  -- FK는 guest_sessions 테이블 생성 후 추가
  display_name text not null,
  role text not null default 'guest' check (role in ('host', 'member', 'guest')),
  language text not null default 'ko',
  audio_enabled boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  is_kicked boolean not null default false
);

create index if not exists idx_meeting_participants_room_id on public.meeting_participants(room_id);
create index if not exists idx_meeting_participants_user_id on public.meeting_participants(user_id);

alter table public.meeting_participants enable row level security;

create policy "본인이 호스트인 미팅룸의 참가자만 조회"
  on public.meeting_participants for select
  using (
    room_id in (select id from public.meeting_rooms where host_user_id = auth.uid())
    or user_id = auth.uid()
  );

-- 6.4 public.guest_sessions ---------------------------------------------------
create table if not exists public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  session_token text not null,
  room_id uuid not null references public.meeting_rooms(id) on delete cascade,
  display_name text not null,
  email text,
  language text not null default 'ko',
  audio_enabled boolean not null default true,
  device_info jsonb,
  ip_address inet,
  summary_sent boolean not null default false,
  joined_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create index if not exists idx_guest_sessions_room_id on public.guest_sessions(room_id);
create index if not exists idx_guest_sessions_expires_at on public.guest_sessions(expires_at);

alter table public.guest_sessions enable row level security;

-- Guest는 Supabase Auth 계정이 없어 auth.uid()를 못 쓴다. 검증은 백엔드가
-- service-role 키로 session_token(RS256 JWT) 서명을 직접 확인한 뒤 접근하므로,
-- 이 테이블은 RLS로 본인 row 식별이 불가능 — service-role 경유만 허용한다.
create policy "service_role만 접근 (Guest JWT는 백엔드가 검증)"
  on public.guest_sessions for all
  using (false);

alter table public.meeting_participants
  add constraint fk_meeting_participants_guest_session
  foreign key (guest_session_id) references public.guest_sessions(id) on delete set null;

-- 6.5 public.meeting_summaries -------------------------------------------------
create table if not exists public.meeting_summaries (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references public.meeting_rooms(id) on delete cascade,
  summary_text text,
  action_items jsonb not null default '[]',
  script_url text,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  ai_model text,
  processing_sec integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz
);

alter table public.meeting_summaries enable row level security;

create policy "본인이 호스트인 미팅룸의 요약만 조회"
  on public.meeting_summaries for select
  using (room_id in (select id from public.meeting_rooms where host_user_id = auth.uid()));

-- 만료된 Guest 세션/이메일 정리 (pg_cron 활성화된 프로젝트에서만 동작)
-- select cron.schedule('delete-expired-guest-sessions', '0 * * * *',
--   $$ delete from public.guest_sessions where expires_at < now() $$);
-- select cron.schedule('gdpr-null-guest-email', '0 3 * * *',
--   $$ update public.guest_sessions set email = null
--      where summary_sent = true and created_at < now() - interval '30 days' and email is not null $$);
