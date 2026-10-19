-- Run in Supabase SQL Editor. Do not expose service-role credentials in frontend code.
create extension if not exists pgcrypto;

create table if not exists public.event_settings (
  id boolean primary key default true check (id = true),
  booking_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.event_settings (id, booking_enabled) values (true, true)
on conflict (id) do nothing;

create table if not exists public.event_passes (
  id uuid primary key default gen_random_uuid(),
  booking_id text not null unique,
  name text not null,
  mobile text,
  amount integer not null default 0 check (amount >= 0),
  utr text,
  screenshot_path text,
  qr_token text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  allowed_members integer not null default 1 check (allowed_members between 1 and 4),
  entered_members integer not null default 0 check (entered_members between 0 and 4),
  is_manual boolean not null default false,
  admin_note text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  last_entry_at timestamptz
);
create unique index if not exists event_passes_utr_unique on public.event_passes (lower(utr)) where utr is not null and utr <> '';
create index if not exists event_passes_created_idx on public.event_passes (created_at desc);
create index if not exists event_passes_status_idx on public.event_passes (status);

-- All direct client access is denied. Only Edge Functions using the service role may read/write.
alter table public.event_passes enable row level security;
alter table public.event_settings enable row level security;
drop policy if exists "deny client access passes" on public.event_passes;
drop policy if exists "deny client access settings" on public.event_settings;
create policy "deny client access passes" on public.event_passes for all using (false) with check (false);
create policy "deny client access settings" on public.event_settings for all using (false) with check (false);

-- In Supabase Dashboard > Storage, create a PRIVATE bucket named: payment-screenshots
-- Do not create public read policies for this bucket.
