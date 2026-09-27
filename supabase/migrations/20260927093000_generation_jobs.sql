create table public.generation_jobs (
 user_id uuid not null references auth.users(id) on delete cascade,
 page_id text not null,
 run_id text,
 payload jsonb not null,
 updated_at timestamptz not null default now(),
 primary key (user_id,page_id),
 foreign key (user_id,page_id) references public.question_pages(user_id,id) on delete cascade
);
alter table public.generation_jobs enable row level security;
create policy generation_jobs_owner on public.generation_jobs for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update,delete on public.generation_jobs to authenticated;
