-- CLAUDE.md: 세션 컨텍스트(resumption handle) 저장용. 리전 ap-northeast-2.
create table if not exists interpretation_sessions (
  session_id text primary key,
  user_id uuid not null,
  target_language_code text not null,
  resumption_handle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_interpretation_sessions_updated_at on interpretation_sessions;
create trigger trg_interpretation_sessions_updated_at
  before update on interpretation_sessions
  for each row execute function set_updated_at();

alter table interpretation_sessions enable row level security;

-- 유저는 자신의 세션만 조회 가능 (서버는 service_role 키로 RLS 우회)
create policy "사용자는 자신의 세션만 조회"
  on interpretation_sessions for select
  using (auth.uid() = user_id);
