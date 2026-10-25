-- Im Supabase-Dashboard unter "SQL Editor" einmal komplett ausführen.
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text, note text,
  approved boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz default now()
);
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, name, note) values (new.id, new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'note');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create function is_member() returns boolean language sql security definer stable set search_path = public as
$$ select exists(select 1 from profiles where id = auth.uid() and approved) $$;
create function is_admin() returns boolean language sql security definer stable set search_path = public as
$$ select exists(select 1 from profiles where id = auth.uid() and approved and is_admin) $$;

create table spots (
  id uuid primary key default gen_random_uuid(),
  name text not null, address text, notes text,
  lat double precision, lng double precision,
  created_by uuid default auth.uid(), created_at timestamptz default now()
);
create table plans (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references spots on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  time text, person text, food text
);

alter table profiles enable row level security;
alter table spots enable row level security;
alter table plans enable row level security;

create policy "profil lesen" on profiles for select using (id = auth.uid() or is_admin());
create policy "profil freigeben" on profiles for update using (is_admin());
create policy "profil loeschen" on profiles for delete using (is_admin());

create policy "spots lesen" on spots for select using (is_member());
create policy "spots anlegen" on spots for insert with check (is_member());
create policy "spots aendern" on spots for update using (is_member());
create policy "spots loeschen" on spots for delete using (is_admin() or created_by = auth.uid());

create policy "plans lesen" on plans for select using (is_member());
create policy "plans anlegen" on plans for insert with check (is_member());
create policy "plans aendern" on plans for update using (is_member());
create policy "plans loeschen" on plans for delete using (is_member());

insert into storage.buckets (id, name, public) values ('spot-photos', 'spot-photos', false);
create policy "fotos lesen" on storage.objects for select using (bucket_id = 'spot-photos' and is_member());
create policy "fotos hochladen" on storage.objects for insert with check (bucket_id = 'spot-photos' and is_member());
create policy "fotos loeschen" on storage.objects for delete using (bucket_id = 'spot-photos' and (is_admin() or owner = auth.uid()));

-- Ersten Admin festlegen: erst in der App registrieren, dann (E-Mail anpassen):
-- update profiles set approved = true, is_admin = true where id = (select id from auth.users where email = 'DEINE@MAIL.DE');
