-- PVR INOX — Employee Dashboard backend schema (Supabase / Postgres)
--
-- Run this once against the Supabase project referenced by SUPABASE_URL.
-- All API routes under /api use the service-role key (api/_lib/supabaseAdmin.js),
-- so Row Level Security can stay enabled with no policies — the service key
-- bypasses RLS and the anon key is never used client-side for these tables.

create extension if not exists "pgcrypto";

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  reference_id text not null unique,
  booking_type text not null,
  customer_name text not null,
  phone text not null,
  email text,
  cinemas jsonb not null default '[]'::jsonb,
  grand_total numeric not null,
  status text not null default 'New',
  submitted_at timestamptz not null default now()
);

create index if not exists leads_submitted_at_idx on leads (submitted_at desc);
create index if not exists leads_grand_total_idx on leads (grand_total desc);

-- Adds `status` to a leads table that already existed before this feature — the
-- create table above is a no-op in that case, so these run separately and are
-- safe to re-run (drop-then-add the constraint rather than IF NOT EXISTS, which
-- Postgres doesn't support for CHECK constraints).
alter table leads add column if not exists status text not null default 'New';
alter table leads drop constraint if exists leads_status_check;
alter table leads add constraint leads_status_check
  check (status in ('New', 'Contacted', 'Negotiating', 'Won', 'Lost'));

create table if not exists performa_invoices (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references leads(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  grand_total numeric not null,
  status text not null default 'draft', -- 'draft' | 'sent'
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table employees enable row level security;
alter table leads enable row level security;
alter table performa_invoices enable row level security;

-- Seed employees — replace/add rows for real staff, then rotate these passwords.
-- Current staff:
--   ankush.mohanty@pvrinox.com
--   virender.relhan@pvrinox.com
--   rajni.choudhary@pvrinox.com
--   yash.verma@pvrinox.com
--   sachin.daniel@pvrinox.com
insert into employees (name, email, password_hash) values
  ('Ankush Mohanty', 'ankush.mohanty@pvrinox.com', '$2b$10$I5N.D350HBg6lnr68lJp/eWuys8bi8DqCAA.ywTKqxpCtoLfMsdZ.'),
  ('Virender Relhan', 'virender.relhan@pvrinox.com', '$2b$10$BR4J5XeLuMVr9.6FFMwITOon.62dyCO2CWYc54Ri.rHvDtjmfzIFW'),
  ('Rajni Choudhary', 'rajni.choudhary@pvrinox.com', '$2b$10$fAoWvGDhqYUts/kJLg5hXezUKob1LsXQoHJeOqa2H7axFN6/UyDGO'),
  ('Yash Verma', 'yash.verma@pvrinox.com', '$2b$10$QDHGjPjSs1UXKYbL1QILBuoVlVCEryB88unX6N2TtwPaO34QE6URa'),
  ('Sachin Daniel', 'sachin.daniel@pvrinox.com', '$2b$10$fuJcNerqzKCh9nRyG9i3AuRgZy40Ti/Meqsa3y8O.QBu13Nw4SktC')
on conflict (email) do nothing;
