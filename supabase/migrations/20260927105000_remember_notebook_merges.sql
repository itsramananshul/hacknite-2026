create table public.notebook_merges (
 user_id uuid not null references auth.users(id) on delete cascade,
 source_id text not null,
 destination_id text not null,
 primary key(user_id,source_id),
 foreign key(user_id,destination_id) references public.notebooks(user_id,id) on delete cascade,
 check(source_id<>destination_id)
);
alter table public.notebook_merges enable row level security;
create policy "Owners read notebook merges" on public.notebook_merges for select to authenticated using ((select auth.uid())=user_id);
grant select on public.notebook_merges to authenticated;
create function public.redirect_merged_notebook() returns trigger language plpgsql security definer set search_path='' as $$
declare destination text;
begin
 if TG_TABLE_NAME='notebooks' then
  if exists(select 1 from public.notebook_merges where user_id=NEW.user_id and source_id=NEW.id) then return null; end if;
 else
  select destination_id into destination from public.notebook_merges where user_id=NEW.user_id and source_id=NEW.notebook_id;
  if destination is not null then NEW.notebook_id=destination; NEW.payload=jsonb_set(NEW.payload,'{questionPage,notebookId}',to_jsonb(destination),true); end if;
 end if;
 return NEW;
end; $$;
create trigger redirect_notebook_before_write before insert or update on public.notebooks for each row execute function public.redirect_merged_notebook();
create trigger redirect_question_before_write before insert or update on public.question_pages for each row execute function public.redirect_merged_notebook();
