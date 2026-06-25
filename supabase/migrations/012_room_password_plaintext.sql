-- 미팅룸 비밀번호는 최대 6자리 숫자라 경우의 수가 적어 bcrypt 해시의 실익이 낮고,
-- 호스트가 참가자 사이드바에서 비밀번호를 다시 조회해서 보여줘야 하는 요구사항과 충돌한다
-- (해시는 원문 복원이 불가능). 평문 컬럼으로 전환한다.
alter table public.meeting_rooms
  rename column password_hash to password;
