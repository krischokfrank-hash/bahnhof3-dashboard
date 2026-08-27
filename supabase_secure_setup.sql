-- Sichere Tenant-Struktur fuer Bahnhof3
-- Tabelle: public.energy_simulation_2025_15min
-- Ziel: Jeder Nutzer sieht nur seine Wohnung, Admin optional alle Wohnungen.

begin;

create table if not exists public.apartments (
  code text primary key check (code in ('apt1', 'apt2', 'apt3', 'apt4')),
  address text not null,
  floor text not null,
  position text not null,
  label text generated always as (address || ' - ' || floor || ' ' || position) stored,
  created_at timestamptz not null default now()
);

-- Zentrale Wohnungszuordnung (Adresse + Geschoss + Lage)
-- Bei Bedarf die Werte hier anpassen und Script erneut ausfuehren.
insert into public.apartments (code, address, floor, position) values
('apt1', 'Bahnhofstr. 3', 'EG', 'links'),
('apt2', 'Bahnhofstr. 3', 'EG', 'rechts'),
('apt3', 'Bahnhofstr. 3', '1. OG', 'links'),
('apt4', 'Bahnhofstr. 3', '1. OG', 'rechts')
on conflict (code) do update
set address = excluded.address,
    floor = excluded.floor,
    position = excluded.position;

create table if not exists public.tenant_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  apartment text not null check (apartment in ('apt1', 'apt2', 'apt3', 'apt4')),
  role text not null default 'tenant' check (role in ('tenant', 'admin')),
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_profiles_apartment_fkey'
  ) then
    alter table public.tenant_profiles
      add constraint tenant_profiles_apartment_fkey
      foreign key (apartment) references public.apartments (code);
  end if;
end $$;

alter table public.apartments enable row level security;
alter table public.tenant_profiles enable row level security;

-- Alle angemeldeten Nutzer duerfen den Wohnungskatalog lesen.
drop policy if exists "apartments_select" on public.apartments;
create policy "apartments_select"
on public.apartments
for select
to authenticated
using (true);

-- Nutzer darf nur eigenes Profil lesen.
drop policy if exists "tenant_profiles_select" on public.tenant_profiles;
create policy "tenant_profiles_select"
on public.tenant_profiles
for select
to authenticated
using (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select on table public.apartments to authenticated;
grant select on table public.tenant_profiles to authenticated;

-- Direkten Zugriff auf Energietabelle fuer anon/authenticated entziehen.
revoke all on table public.energy_simulation_2025_15min from anon, authenticated;
alter table public.energy_simulation_2025_15min enable row level security;

-- Sichere RPC: gibt nur die zur Wohnung passenden Spalten zurueck.
drop function if exists public.get_my_energy_15min(timestamp, timestamp, integer, text);
create or replace function public.get_my_energy_15min(
  p_from timestamp default null,
  p_to timestamp default null,
  p_limit integer default 2000,
  p_apartment text default null
)
returns table (
  reading_at timestamp,
  apartment text,
  apt_value double precision,
  general double precision,
  vanteil double precision,
  pvanteil double precision,
  netzb double precision,
  wpvanteil double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apartment text;
  v_role text;
  v_limit integer;
begin
  select tp.apartment, tp.role
  into v_apartment, v_role
  from public.tenant_profiles tp
  where tp.user_id = auth.uid();

  if v_apartment is null then
    raise exception 'Kein tenant_profiles Eintrag fuer diesen User vorhanden.';
  end if;

  if v_role = 'admin' and p_apartment in ('apt1', 'apt2', 'apt3', 'apt4') then
    v_apartment := p_apartment;
  end if;

  v_limit := least(greatest(coalesce(p_limit, 2000), 1), 10000);

  return query
  select
    e.timestamp as reading_at,
    v_apartment as apartment,
    case v_apartment
      when 'apt1' then e.apt1
      when 'apt2' then e.apt2
      when 'apt3' then e.apt3
      when 'apt4' then e.apt4
    end as apt_value,
    e.general,
    case v_apartment
      when 'apt1' then e.vanteilapt1
      when 'apt2' then e.vanteilapt2
      when 'apt3' then e.vanteilapt3
      when 'apt4' then e.vanteilapt4
    end as vanteil,
    case v_apartment
      when 'apt1' then e.pvanteilapt1
      when 'apt2' then e.pvanteilapt2
      when 'apt3' then e.pvanteilapt3
      when 'apt4' then e.pvanteilapt4
    end as pvanteil,
    case v_apartment
      when 'apt1' then e.netzbapt1
      when 'apt2' then e.netzbapt2
      when 'apt3' then e.netzbapt3
      when 'apt4' then e.netzbapt4
    end as netzb,
    case v_apartment
      when 'apt1' then e.wpvanteilapt1
      when 'apt2' then e.wpvanteilapt2
      when 'apt3' then e.wpvanteilapt3
      when 'apt4' then e.wpvanteilapt4
    end as wpvanteil
  from public.energy_simulation_2025_15min e
  where (p_from is null or e.timestamp >= p_from)
    and (p_to is null or e.timestamp <= p_to)
  order by e.timestamp asc
  limit v_limit;
end;
$$;

revoke all on function public.get_my_energy_15min(timestamp, timestamp, integer, text) from public;
grant execute on function public.get_my_energy_15min(timestamp, timestamp, integer, text) to authenticated;

commit;

-- Beispiel: Profile anlegen (UUIDs durch echte auth.users IDs ersetzen)
-- insert into public.tenant_profiles (user_id, apartment, role) values
-- ('00000000-0000-0000-0000-000000000001', 'apt1', 'tenant'),
-- ('00000000-0000-0000-0000-000000000002', 'apt2', 'tenant');
-- insert into public.tenant_profiles (user_id, apartment, role) values
-- ('00000000-0000-0000-0000-000000000099', 'apt1', 'admin');

-- Kontrolle
select code, address, floor, position, label
from public.apartments
order by code;
