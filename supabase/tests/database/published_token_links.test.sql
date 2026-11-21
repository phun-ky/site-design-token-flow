-- Storage policies for published token links (#143). Run with
-- `supabase test db` against the local stack.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
-- The Storage API sets this for its own deletes; storage.protect_delete
-- refuses deletes from SQL without it
select set_config('storage.allow_delete_query', 'true', true);

select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'tokens' $$,
  $$ values (true, 2097152::bigint, array['application/json']) $$,
  'the tokens bucket is public, 2 MiB at most, JSON only'
);

-- Sets the user the next statements run as; null for an anonymous client
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  end if;
end $$;

-- a and b are two users
create temp table ids as select
  '11111111-1111-4111-8111-111111111111'::uuid as a,
  '22222222-2222-4222-8222-222222222222'::uuid as b;
grant select on ids to authenticated, anon;

create function pg_temp.publish(uid uuid, file text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('tokens', uid || '/' || file, uid::text)
$$;

select pg_temp.act_as((select a from ids));

select lives_ok(
  $$ select pg_temp.publish((select a from ids), 'aaaaaaaaaaaaaaaa1.json');
     select pg_temp.publish((select a from ids), 'aaaaaaaaaaaaaaaa2.json');
     select pg_temp.publish((select a from ids), 'aaaaaaaaaaaaaaaa3.json') $$,
  'a user publishes 3 links'
);
select throws_ok(
  $$ select pg_temp.publish((select a from ids), 'aaaaaaaaaaaaaaaa4.json') $$,
  '42501', null,
  'a fourth link is refused'
);
-- Upserts at the limit go through the Storage API, which versions objects, so
-- they are checked over HTTP by scripts/check-supabase-storage.mjs
select lives_ok(
  $$ update storage.objects set metadata = '{"v":3}'
     where name = (select a from ids) || '/aaaaaaaaaaaaaaaa2.json' $$,
  'the owner updates a link'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'tokens'),
  3,
  'the owner lists their own links'
);
select throws_ok(
  $$ select pg_temp.publish((select a from ids), 'nested/aaaaaaaaaaaaaaaa5.json') $$,
  '42501', null,
  'a link in a nested folder is refused'
);
select throws_ok(
  $$ select pg_temp.publish((select a from ids), 'short.json') $$,
  '42501', null,
  'a share id shorter than 16 characters is refused'
);
select throws_ok(
  $$ select pg_temp.publish((select a from ids), 'aaaaaaaaaaaaaaaa5.html') $$,
  '42501', null,
  'a file that is not .json is refused'
);

select pg_temp.act_as((select b from ids));

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('tokens', (select a from ids) || '/bbbbbbbbbbbbbbbb1.json', (select b from ids)::text) $$,
  '42501', null,
  'another user can''t publish into the owner''s folder'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'tokens'),
  0,
  'another user can''t list the owner''s links'
);
update storage.objects set metadata = '{"v":"b"}' where bucket_id = 'tokens';
delete from storage.objects where bucket_id = 'tokens';
select lives_ok(
  $$ select pg_temp.publish((select b from ids), 'bbbbbbbbbbbbbbbb1.json') $$,
  'another user publishes in their own folder, with their own limit'
);

select pg_temp.act_as(null);

select throws_ok(
  $$ select pg_temp.publish((select a from ids), 'cccccccccccccccc1.json') $$,
  '42501', null,
  'an anonymous client can''t publish'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'tokens'),
  0,
  'an anonymous client can''t list links'
);

select pg_temp.act_as((select a from ids));

select is(
  (select count(*)::int from storage.objects where bucket_id = 'tokens' and metadata->>'v' = 'b'),
  0,
  'another user''s update changed nothing'
);
select lives_ok(
  $$ delete from storage.objects where name = (select a from ids) || '/aaaaaaaaaaaaaaaa3.json' $$,
  'the owner unpublishes a link'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'tokens'),
  2,
  'another user''s delete removed nothing, the owner''s did'
);

select * from finish();
rollback;
