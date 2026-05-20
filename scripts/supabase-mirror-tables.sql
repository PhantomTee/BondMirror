-- Run this in your Supabase SQL editor
-- Adds tables for position tracking and mirror signals

-- ── hl_positions ─────────────────────────────────────────────────────────────
-- Snapshot of each registered leader's current open positions on Hyperliquid.
-- Updated every agent cycle (hourly). Used to detect position changes.

create table if not exists hl_positions (
  id                   uuid primary key default gen_random_uuid(),
  strategy_id          uuid references strategy_mandates(id) on delete cascade,
  contract_strategy_id integer not null,
  coin                 text not null,
  size_signed          numeric not null,   -- positive = long, negative = short
  entry_price          numeric,
  leverage             numeric,
  notional_value       numeric,
  updated_at           timestamptz default now(),
  unique (strategy_id, coin)
);

alter table hl_positions enable row level security;
create policy "service role full access" on hl_positions
  using (true) with check (true);

-- ── mirror_signals ────────────────────────────────────────────────────────────
-- Trade signals emitted when the agent detects a position change in a leader's
-- Hyperliquid account. Followers read these to copy or auto-execute.

create table if not exists mirror_signals (
  id                   uuid primary key default gen_random_uuid(),
  strategy_id          uuid references strategy_mandates(id) on delete cascade,
  contract_strategy_id integer not null,
  coin                 text not null,
  action               text not null check (action in (
    'open_long','open_short','close_long','close_short','size_change'
  )),
  size                 numeric not null,        -- absolute position size (coins)
  price_estimate       numeric,                 -- approximate entry price
  leverage             numeric,
  raw_evidence         jsonb,                   -- full position object for audit
  created_at           timestamptz default now()
);

create index if not exists mirror_signals_strategy_id_idx
  on mirror_signals (strategy_id, created_at desc);

alter table mirror_signals enable row level security;
create policy "anon read" on mirror_signals for select using (true);
create policy "service role write" on mirror_signals
  for insert with check (true);

-- ── score_snapshots ───────────────────────────────────────────────────────────
-- Historical risk score per strategy used by the decay detector.
-- The agent inserts one row per hourly cycle.

create table if not exists score_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  strategy_id          uuid references strategy_mandates(id) on delete cascade,
  contract_strategy_id integer not null,
  risk_score           integer not null,
  violations           text[] not null default '{}',
  copy_weight          integer not null default 0,
  created_at           timestamptz default now()
);

create index if not exists score_snapshots_strategy_created_idx
  on score_snapshots (strategy_id, created_at desc);

alter table score_snapshots enable row level security;
create policy "anon read" on score_snapshots for select using (true);
create policy "service role write" on score_snapshots
  for insert with check (true);

-- ── follower_hl_addresses ─────────────────────────────────────────────────────
-- Optional: followers register their Hyperliquid address so the agent can
-- execute mirror trades on their behalf (requires HL agent approval).

create table if not exists follower_hl_addresses (
  id               uuid primary key default gen_random_uuid(),
  strategy_id      uuid references strategy_mandates(id) on delete cascade,
  follower_address text not null,   -- Arc/EVM address
  hl_address       text not null,   -- Hyperliquid address (may differ)
  agent_approved   boolean not null default false,
  registered_at    timestamptz default now(),
  unique (strategy_id, follower_address)
);

alter table follower_hl_addresses enable row level security;
create policy "anon read" on follower_hl_addresses for select using (true);
create policy "service role write" on follower_hl_addresses
  for all using (true) with check (true);
