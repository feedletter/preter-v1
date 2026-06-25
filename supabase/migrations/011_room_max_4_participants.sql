-- CLAUDE.md "미팅룸 멀티파티 아키텍처" — 룸당 최대 4인(호스트 포함)으로 인원 상한을 확정.
-- 발화자 1명당 다른 언어 청자 수만큼 Gemini Live 세션이 동시에 뜨는 구조라(N-1 팬아웃),
-- 인원이 늘어나면 비용/지연이 선형으로 늘어남 — 4인을 worst-case 상한으로 고정.

alter table public.meeting_rooms
  alter column max_participants set default 4;

alter table public.meeting_rooms drop constraint if exists meeting_rooms_max_participants_check;
alter table public.meeting_rooms
  add constraint meeting_rooms_max_participants_check check (max_participants <= 4);
