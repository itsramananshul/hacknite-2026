begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.notebooks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  name text not null check (char_length(trim(name)) between 1 and 80),
  subject text not null check (subject in ('physics','chemistry','mathematics')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,id)
);
create table public.question_pages (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  notebook_id text not null,
  title text not null check (char_length(title) between 1 and 160),
  status text not null check (status in ('solving','building','ready','error','answer-only')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,id),
  foreign key (user_id,notebook_id) references public.notebooks(user_id,id) on delete cascade
);
create index question_pages_notebook_updated on public.question_pages(user_id,notebook_id,updated_at desc);

alter table public.profiles enable row level security;
alter table public.notebooks enable row level security;
alter table public.question_pages enable row level security;
revoke all on public.profiles,public.notebooks,public.question_pages from anon,authenticated;
grant select,insert,update on public.profiles to authenticated;
grant select,insert,update,delete on public.notebooks,public.question_pages to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid())=id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);

create policy notebooks_select_own on public.notebooks for select to authenticated using ((select auth.uid())=user_id);
create policy notebooks_insert_own on public.notebooks for insert to authenticated with check ((select auth.uid())=user_id);
create policy notebooks_update_own on public.notebooks for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy notebooks_delete_own on public.notebooks for delete to authenticated using ((select auth.uid())=user_id);

create policy pages_select_own on public.question_pages for select to authenticated using ((select auth.uid())=user_id);
create policy pages_insert_own on public.question_pages for insert to authenticated with check ((select auth.uid())=user_id);
create policy pages_update_own on public.question_pages for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy pages_delete_own on public.question_pages for delete to authenticated using ((select auth.uid())=user_id);

commit;
