-- PRD: Preter Register & Authentication v1.0.0, 5장 데이터베이스 스키마
-- auth.users(Supabase Auth 내장)를 확장하는 구조.

create extension if not exists pgcrypto;

-- 5.2 public.users ---------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  phone text,
  country_code text not null default '+82',
  company_email text,
  position text,
  company_name text,
  primary_language text not null default 'ko',
  avatar_url text,
  signup_method text not null default 'email' check (signup_method in ('email', 'google', 'apple')),
  is_onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_primary_language on public.users(primary_language);
create index if not exists idx_users_created_at on public.users(created_at desc);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- auth.users 생성 시 public.users 행을 자동 생성하는 트리거
create or replace function public.handle_new_auth_user()
returns trigger as $$
begin
  insert into public.users (id, email, name, signup_method)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_app_meta_data->>'provider', 'email')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

alter table public.users enable row level security;

create policy "본인 프로필만 조회"
  on public.users for select
  using (auth.uid() = id);

create policy "본인 프로필만 수정"
  on public.users for update
  using (auth.uid() = id);

-- 5.3 public.user_plans -----------------------------------------------------
create table if not exists public.user_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
  status text not null default 'active' check (status in ('active', 'cancelled', 'expired')),
  minutes_total integer not null default 60,
  minutes_used integer not null default 0,
  overage_rate numeric(5, 2) not null default 0.20,
  period_start date not null default current_date,
  period_end date not null default (current_date + interval '1 month'),
  stripe_sub_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_plans_updated_at on public.user_plans;
create trigger trg_user_plans_updated_at
  before update on public.user_plans
  for each row execute function public.set_updated_at();

-- 회원가입 완료 시 기본 free 플랜 자동 생성
create or replace function public.handle_new_user_plan()
returns trigger as $$
begin
  insert into public.user_plans (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_on_user_created_plan on public.users;
create trigger trg_on_user_created_plan
  after insert on public.users
  for each row execute function public.handle_new_user_plan();

alter table public.user_plans enable row level security;

create policy "본인 플랜만 조회"
  on public.user_plans for select
  using (auth.uid() = user_id);

-- 5.4 public.business_cards -------------------------------------------------
create table if not exists public.business_cards (
  id uuid primary key default gen_random_uuid(),
  session_token text not null,
  raw_text text,
  name text,
  company_email text,
  phone text,
  company_name text,
  position text,
  image_url text,
  ocr_provider text not null default 'gcv',
  confidence numeric(4, 3),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  created_at timestamptz not null default now()
);

create index if not exists idx_business_cards_session_token on public.business_cards(session_token);

alter table public.business_cards enable row level security;

create policy "session_token 일치하는 명함만 조회"
  on public.business_cards for select
  using (session_token = current_setting('request.jwt.claims', true)::json->>'session_token');

-- pg_cron으로 매 시간 만료 데이터 삭제 (pg_cron 확장이 활성화된 프로젝트에서만 동작)
-- select cron.schedule('delete-expired-business-cards', '0 * * * *',
--   $$ delete from public.business_cards where expires_at < now() $$);

-- 5.5 public.oauth_providers -------------------------------------------------
-- TODO: PRD 7장은 access_token/refresh_token을 pgcrypto로 암호화 저장하라고 명시.
-- OAuth 연동(P1~P2) 구현 시점에 pgp_sym_encrypt/decrypt 적용 예정. 지금은 평문 컬럼만 정의.
create table if not exists public.oauth_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'apple')),
  provider_uid text not null,
  email text,
  access_token text,
  refresh_token text,
  token_expires timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_oauth_providers_provider_uid on public.oauth_providers(provider, provider_uid);
create index if not exists idx_oauth_providers_user_id on public.oauth_providers(user_id);

drop trigger if exists trg_oauth_providers_updated_at on public.oauth_providers;
create trigger trg_oauth_providers_updated_at
  before update on public.oauth_providers
  for each row execute function public.set_updated_at();

alter table public.oauth_providers enable row level security;

create policy "본인 OAuth 연결만 조회"
  on public.oauth_providers for select
  using (auth.uid() = user_id);
