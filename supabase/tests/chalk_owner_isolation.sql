-- Executes inside a transaction and leaves no test users or rows behind.
begin;
insert into auth.users(id,email) values
 ('8d0b414f-1dd9-48ec-b923-3b7069b37590','chalk-rls-a@example.invalid'),
 ('926f3d8a-dc46-4f56-9aa4-0796277a8481','chalk-rls-b@example.invalid');
insert into public.profiles(id,display_name) values
 ('8d0b414f-1dd9-48ec-b923-3b7069b37590','A'),
 ('926f3d8a-dc46-4f56-9aa4-0796277a8481','B');
insert into public.notebooks(user_id,id,name,subject) values
 ('8d0b414f-1dd9-48ec-b923-3b7069b37590','test','A notebook','physics'),
 ('926f3d8a-dc46-4f56-9aa4-0796277a8481','test','B notebook','chemistry');
insert into public.question_pages(user_id,id,notebook_id,title,status,payload) values
 ('8d0b414f-1dd9-48ec-b923-3b7069b37590','test-page','test','A question','ready','{}'),
 ('926f3d8a-dc46-4f56-9aa4-0796277a8481','test-page','test','B question','ready','{}');
set local role authenticated;
select set_config('request.jwt.claim.sub','8d0b414f-1dd9-48ec-b923-3b7069b37590',true);
select set_config('request.jwt.claims','{"sub":"8d0b414f-1dd9-48ec-b923-3b7069b37590","role":"authenticated"}',true);
do $$
declare table_name text; affected integer;
begin
  if (select count(*) from public.profiles)<>1 then raise exception 'Profiles leaked another owner'; end if;
  if (select count(*) from public.notebooks)<>1 then raise exception 'Notebooks leaked another owner'; end if;
  if (select count(*) from public.question_pages)<>1 then raise exception 'Question pages leaked another owner'; end if;
  update public.profiles set display_name='A updated' where id=auth.uid();
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Own profile update failed'; end if;
  update public.profiles set display_name='forbidden' where id='926f3d8a-dc46-4f56-9aa4-0796277a8481';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Other profile update allowed'; end if;
  begin
    insert into public.profiles(id,display_name) values ('926f3d8a-dc46-4f56-9aa4-0796277a8481','forbidden');
    raise exception 'Other profile insert allowed';
  exception when insufficient_privilege then null; end;
  insert into public.notebooks(id,name,subject) values ('new-own','Own created','mathematics');
  insert into public.question_pages(id,notebook_id,title,status,payload) values ('new-own','new-own','Own created','ready','{}');
  foreach table_name in array array['notebooks','question_pages'] loop
    execute format('update public.%I set updated_at=now() where user_id=auth.uid()',table_name);
    get diagnostics affected=row_count;
    if affected<>2 then raise exception 'Own % update failed',table_name; end if;
    execute format('update public.%I set user_id=$1 where user_id=$2',table_name)
      using '8d0b414f-1dd9-48ec-b923-3b7069b37590'::uuid,'926f3d8a-dc46-4f56-9aa4-0796277a8481'::uuid;
    get diagnostics affected=row_count;
    if affected<>0 then raise exception 'Other % update allowed',table_name; end if;
    begin
      execute format('update public.%I set user_id=$1 where user_id=auth.uid()',table_name)
        using '926f3d8a-dc46-4f56-9aa4-0796277a8481'::uuid;
      raise exception 'Owner transfer allowed on %',table_name;
    exception when insufficient_privilege then null; end;
    execute format('delete from public.%I where user_id=$1',table_name) using '926f3d8a-dc46-4f56-9aa4-0796277a8481'::uuid;
    get diagnostics affected=row_count;
    if affected<>0 then raise exception 'Other % delete allowed',table_name; end if;
  end loop;
  begin
    insert into public.notebooks(user_id,id,name,subject) values ('926f3d8a-dc46-4f56-9aa4-0796277a8481','foreign','Forbidden','physics');
    raise exception 'Other notebook insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.question_pages(user_id,id,notebook_id,title,status,payload) values ('926f3d8a-dc46-4f56-9aa4-0796277a8481','foreign','test','Forbidden','ready','{}');
    raise exception 'Other page insert allowed';
  exception when insufficient_privilege then null; end;
  delete from public.question_pages where id='new-own';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Own page delete failed'; end if;
  delete from public.notebooks where id='new-own';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Own notebook delete failed'; end if;
end $$;
reset role;
set local role anon;
do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','notebooks','question_pages'] loop
    begin
      execute format('select 1 from public.%I limit 1',table_name);
      raise exception 'Anonymous read allowed on %',table_name;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;
rollback;
select 'PASS: owner CRUD, cross-user isolation, owner transfer denial and anonymous read denial. Test fixtures rolled back.' as rls_verification;
