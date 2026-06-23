-- 웹 어드민(sqladmin) 운영자 권한 플래그.
-- Supabase Auth 자체엔 "스태프" 개념이 없어서, public.users에 플래그를 둬서
-- 어드민 로그인 시 이 값으로 운영자 여부를 가린다.

alter table public.users
  add column if not exists is_admin boolean not null default false;

create index if not exists idx_users_is_admin on public.users(is_admin) where is_admin = true;
