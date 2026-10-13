-- 굿즈샵 DB 스키마. Supabase SQL Editor 또는 Management API로 한 번에 실행한다.
-- 다시 실행해도 안전하도록 작성 (create ... if not exists / or replace / drop ... if exists).

-- ───────── 상품 ─────────
create table if not exists public.products (
  id          bigint generated always as identity primary key,
  name        text    not null,
  description text    not null default '',
  price       integer not null check (price > 0),
  emoji       text    not null default '🎁',
  color       text    not null default '#ff7a1a',   -- 카드 배경색
  created_at  timestamptz not null default now()
);

-- ───────── 회원 프로필 (auth.users 와 1:1) ─────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- 가입하면 profiles 행을 자동으로 만든다
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 현재 로그인한 사람이 관리자인지
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ───────── 주문 ─────────
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),   -- 토스 orderId 로 그대로 사용
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  product_id  bigint not null references public.products(id),
  quantity    integer not null check (quantity between 1 and 99),
  amount      integer not null default 0,
  order_name  text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  payment_key text,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create index if not exists orders_user_id_idx on public.orders(user_id);

-- 주문 생성 시 금액·상품명·상태를 DB가 직접 채운다 (브라우저에서 보낸 값은 무시)
create or replace function public.prepare_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.products;
begin
  select * into p from public.products where id = new.product_id;
  if not found then raise exception '존재하지 않는 상품입니다'; end if;
  if auth.uid() is not null then new.user_id := auth.uid(); end if;
  new.amount      := p.price * new.quantity;
  new.order_name  := p.name || case when new.quantity > 1 then ' x' || new.quantity else '' end;
  new.status      := 'pending';
  new.payment_key := null;
  new.paid_at     := null;
  new.created_at  := now();
  return new;
end $$;

drop trigger if exists orders_prepare on public.orders;
create trigger orders_prepare
  before insert on public.orders
  for each row execute function public.prepare_order();

-- ───────── 보안 규칙 (RLS) ─────────
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.orders   enable row level security;

drop policy if exists "products: 누구나 조회" on public.products;
create policy "products: 누구나 조회" on public.products
  for select to anon, authenticated using (true);

drop policy if exists "profiles: 본인 또는 관리자 조회" on public.profiles;
create policy "profiles: 본인 또는 관리자 조회" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "orders: 본인 또는 관리자 조회" on public.orders;
create policy "orders: 본인 또는 관리자 조회" on public.orders
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "orders: 본인 주문 생성" on public.orders;
create policy "orders: 본인 주문 생성" on public.orders
  for insert to authenticated with check (user_id = auth.uid());

-- update/delete 정책은 일부러 없음 → 결제 상태 변경은 Edge Function(service role)만 가능

-- ───────── 예시 상품 ─────────
insert into public.products (name, description, price, emoji, color)
select * from (values
  ('로고 머그컵',     '매일 아침 커피를 담는 350ml 세라믹 머그',  12000, '☕', '#ff9f43'),
  ('스티커 팩',       '노트북에 붙이기 좋은 방수 스티커 8종',      4500, '🌟', '#feca57'),
  ('오버핏 티셔츠',   '부드러운 코튼 100% 반팔 티셔츠',           29000, '👕', '#54a0ff'),
  ('에코백',          '노트북도 들어가는 튼튼한 캔버스 가방',      18000, '👜', '#1dd1a1'),
  ('키링',            '가방에 달기 좋은 아크릴 키링',              7000, '🔑', '#ff6b6b'),
  ('스프링 노트',     '아이디어를 적는 A5 도트 노트',              6500, '📒', '#a29bfe')
) as v(name, description, price, emoji, color)
where not exists (select 1 from public.products);
