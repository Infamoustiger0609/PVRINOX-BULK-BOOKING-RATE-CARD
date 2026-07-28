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
  submitted_at timestamptz not null default now()
);

create index if not exists leads_submitted_at_idx on leads (submitted_at desc);
create index if not exists leads_grand_total_idx on leads (grand_total desc);

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

-- Seed employees — replace/add rows for real staff, then rotate these two.
-- Passwords below match the Phase 1 mock accounts so login behavior is unchanged:
--   yash.verma@pvrinox.com   / pvr@123
--   sachin.daniel@pvrinox.com / pvr@123
insert into employees (name, email, password_hash) values
  ('Yash Verma', 'yash.verma@pvrinox.com', '$2b$10$Bnjrlkjd89myJj/fY/M.O.LVbTFhgip16f2upLa9syALX.Nm9W8Nm'),
  ('Sachin Daniel', 'sachin.daniel@pvrinox.com', '$2b$10$a.9Frzsh3TQN/01twDT62O7k0fBtR0BuNfOqlF0spVygmV0uFAAVa')
on conflict (email) do nothing;
