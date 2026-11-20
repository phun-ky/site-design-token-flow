-- Published token links (#143): Tokens Studio JSON at
-- tokens/<user id>/<share id>.json, readable by anyone through the bucket's
-- public URL, written only by its owner, at most link_limit files per user.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tokens', 'tokens', true, 2097152, array['application/json'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 3 for everyone; a paid plan (#150) makes this read the user's plan instead
create function public.link_limit(uid uuid)
returns integer
language sql
stable
set search_path = ''
as $$ select 3 $$;

revoke execute on function public.link_limit(uuid) from public, anon;
grant execute on function public.link_limit(uuid) to authenticated;

-- The caller's links other than this one, so an upsert of an existing file at
-- the limit still passes. Security definer because a policy on storage.objects
-- can't query storage.objects; it only ever counts the caller's own folder.
create function public.other_links(except_name text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from storage.objects
  where bucket_id = 'tokens'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name <> except_name
$$;

revoke execute on function public.other_links(text) from public, anon;
grant execute on function public.other_links(text) to authenticated;

-- Public URLs don't go through these policies, so reading a published link
-- needs none. Signed in users can list and read only their own folder.
create policy "tokens: owners read their own"
on storage.objects for select to authenticated
using (
  bucket_id = 'tokens'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "tokens: owners publish within the limit"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'tokens'
  and name ~ ('^' || (select auth.uid())::text || '/[A-Za-z0-9_-]{16,64}\.json$')
  -- shortcut: two uploads at the same moment can both pass at 2 files and make
  -- 4; lock per user in a trigger if that is ever seen.
  and public.other_links(name) < public.link_limit((select auth.uid()))
);

create policy "tokens: owners update their own"
on storage.objects for update to authenticated
using (
  bucket_id = 'tokens'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'tokens'
  and name ~ ('^' || (select auth.uid())::text || '/[A-Za-z0-9_-]{16,64}\.json$')
);

create policy "tokens: owners delete their own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'tokens'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
