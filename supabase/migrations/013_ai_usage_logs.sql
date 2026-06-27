-- AI API 비용 추적 — 어드민 "일별 AI 비용" 대시보드용 원장 테이블.
-- 호출 1번(재시도 포함 각 attempt)마다 1행씩 적재한다. Gemini Live는 별도 처리
-- 예정이라 일단 제외 — provider 컬럼은 향후 확장을 위해 텍스트로 둔다.

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  context text,
  document_id uuid references public.documents(id) on delete set null,
  message_id uuid references public.document_messages(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_logs_created_at_idx on public.ai_usage_logs(created_at);
create index if not exists ai_usage_logs_provider_model_idx on public.ai_usage_logs(provider, model);
