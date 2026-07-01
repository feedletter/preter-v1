-- Profile & Settings PRD: 앱 서비스 언어(UI 표시 언어)는 통역 언어(primary_language)와
-- 별개로 관리해야 해서 컬럼을 분리한다.
alter table public.users
  add column if not exists app_language text not null default 'ko';
