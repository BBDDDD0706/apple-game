-- 오늘의 판 랭킹
-- 테이블은 직접 읽기/쓰기 불가(RLS + 권한 회수). 등록과 조회는 아래 함수로만 가능하다.

create table if not exists public.daily_scores (
  id bigint generated always as identity primary key,
  day date not null,
  device text not null,
  name text not null,
  score int not null check (score between 0 and 170),
  created_at timestamptz not null default now(),
  unique (day, device)
);
create index if not exists daily_scores_rank on public.daily_scores (day, score desc);
alter table public.daily_scores enable row level security;
revoke all on table public.daily_scores from anon, authenticated;

-- 점수 등록: 한 기기당 하루 첫 기록만 저장되고, 내 순위를 돌려준다
create or replace function public.submit_daily(p_device text, p_name text, p_score int)
returns table (my_rank int, my_score int, total int)
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Asia/Seoul')::date;
  s int;
begin
  if p_score is null or p_score < 0 or p_score > 170 then raise exception 'invalid score'; end if;
  if p_device is null or length(p_device) < 8 or length(p_device) > 40 then raise exception 'invalid device'; end if;
  p_name := left(btrim(coalesce(p_name, '')), 10);
  if p_name = '' then p_name := '플레이어'; end if;
  insert into daily_scores (day, device, name, score) values (d, p_device, p_name, p_score)
  on conflict (day, device) do nothing;
  select ds.score into s from daily_scores ds where ds.day = d and ds.device = p_device;
  return query select
    (select count(*)::int + 1 from daily_scores x where x.day = d and x.score > s),
    s,
    (select count(*)::int from daily_scores x where x.day = d);
end $$;

-- 순위표 조회 (기기 식별값은 돌려주지 않는다)
create or replace function public.daily_top(p_day date, p_limit int)
returns table (rank int, name text, score int)
language sql security definer set search_path = public stable as $$
  select (rank() over (order by ds.score desc))::int, ds.name, ds.score
  from daily_scores ds
  where ds.day = p_day
  order by ds.score desc, ds.created_at asc
  limit least(greatest(p_limit, 1), 100)
$$;

revoke all on function public.submit_daily(text, text, int) from public;
revoke all on function public.daily_top(date, int) from public;
grant execute on function public.submit_daily(text, text, int) to anon, authenticated;
grant execute on function public.daily_top(date, int) to anon, authenticated;
