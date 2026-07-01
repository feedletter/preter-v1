-- Create Meeting PRD v1.0.0 — 미팅룸에 자료 연결 + Draft 생성 플로우 지원.

alter table public.meeting_rooms
  add column if not exists document_id uuid references public.documents(id);

create index if not exists meeting_rooms_document_id_idx on public.meeting_rooms(document_id);

-- PRD 2.2: 화면 진입 시 임시 코드를 "draft" 상태로 발급하고, 생성 완료 시 "waiting"으로 전환.
-- 취소 시(또는 30분 미확정 방치 시) draft 미팅룸은 삭제된다.
alter table public.meeting_rooms drop constraint if exists meeting_rooms_status_check;
alter table public.meeting_rooms
  add constraint meeting_rooms_status_check check (status in ('draft', 'waiting', 'active', 'ended'));
