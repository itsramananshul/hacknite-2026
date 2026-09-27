create table public.video_jobs (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 run_id text,
 object_path text not null,
 status text not null default 'rendering' check(status in ('rendering','ready','error')),
 message text not null default 'Preparing cloud renderer.',
 narration boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.video_jobs enable row level security;
create policy "Owners manage video jobs" on public.video_jobs for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update on public.video_jobs to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('chalk-videos','chalk-videos',false,52428800,array['video/mp4']) on conflict(id) do nothing;
create policy "Owners upload videos" on storage.objects for insert to authenticated with check (bucket_id='chalk-videos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Owners read videos" on storage.objects for select to authenticated using (bucket_id='chalk-videos' and (storage.foldername(name))[1]=(select auth.uid())::text);
