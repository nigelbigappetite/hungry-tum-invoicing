-- Brands table: canonical brand registry with fee ownership
create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_external boolean not null default false,
  -- 'ht' = fees go to Hungry Tum; anything else = fees go to that brand (e.g. 'SMSH BN')
  fee_beneficiary text not null default 'ht',
  color text not null default '#f97316', -- tailwind orange-500 default
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed core brands
insert into brands (name, is_external, fee_beneficiary, color) values
  ('Wing Shack',   false, 'ht',      '#f97316'),
  ('Eggs n Stuff', false, 'ht',      '#eab308'),
  ('SMSH BN',      true,  'SMSH BN', '#8b5cf6')
on conflict (name) do nothing;

-- RLS: authenticated users can read; service role manages
alter table brands enable row level security;

create policy "authenticated read brands"
  on brands for select
  to authenticated
  using (true);
