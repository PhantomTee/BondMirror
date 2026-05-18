-- BondMirror Supabase schema
-- Paste this whole file into Supabase SQL Editor, then add the anon URL/key
-- to Vercel as VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null check (wallet_address ~* '^0x[0-9a-f]{40}$'),
  display_name text,
  role text not null default 'follower' check (role in ('follower', 'leader', 'agent', 'admin')),
  reputation_score numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists app_users_wallet_address_lc_key
  on public.app_users (lower(wallet_address));

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete cascade,
  address text not null check (address ~* '^0x[0-9a-f]{40}$'),
  chain_id integer not null default 5042002,
  wallet_type text not null default 'evm' check (wallet_type in ('evm', 'circle_wallet', 'agent_wallet')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists wallets_chain_address_lc_key
  on public.wallets (chain_id, lower(address));

create table if not exists public.leader_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete set null,
  display_name text not null,
  slug text not null,
  leader_address text not null check (leader_address ~* '^0x[0-9a-f]{40}$'),
  hyperliquid_user text check (hyperliquid_user is null or hyperliquid_user ~* '^0x[0-9a-f]{40}$'),
  polymarket_proxy text check (polymarket_proxy is null or polymarket_proxy ~* '^0x[0-9a-f]{40}$'),
  bio text,
  avatar_url text,
  platforms text[] not null default array['Arc']::text[],
  status text not null default 'active' check (status in ('active', 'paused', 'slashed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leader_profiles_slug_key
  on public.leader_profiles (slug);

create unique index if not exists leader_profiles_leader_address_lc_key
  on public.leader_profiles (lower(leader_address));

create table if not exists public.strategy_mandates (
  id uuid primary key default gen_random_uuid(),
  contract_strategy_id bigint not null,
  contract_address text not null check (contract_address ~* '^0x[0-9a-f]{40}$'),
  chain_id integer not null default 5042002,
  leader_profile_id uuid references public.leader_profiles(id) on delete set null,
  leader_address text not null check (leader_address ~* '^0x[0-9a-f]{40}$'),
  mandate_uri text not null,
  strategy_name text not null,
  strategy_summary text,
  markets text[] not null default '{}'::text[],
  max_leverage numeric(12, 4) not null check (max_leverage >= 0),
  max_drawdown numeric(12, 6) not null check (max_drawdown >= 0 and max_drawdown <= 1),
  max_position_size numeric(12, 6) check (max_position_size is null or (max_position_size >= 0 and max_position_size <= 1)),
  cooldown_hours integer not null default 24 check (cooldown_hours >= 0),
  benchmark text not null,
  slash_rules jsonb not null default '[]'::jsonb,
  current_bond_usdc numeric(20, 6) not null default 0,
  follower_count integer not null default 0,
  total_follower_weight numeric(20, 6) not null default 0,
  mandate_integrity integer not null default 100 check (mandate_integrity between 0 and 100),
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  copy_weight numeric(8, 4) not null default 0 check (copy_weight >= 0),
  slash_risk text not null default 'Low' check (slash_risk in ('Low', 'Medium', 'High')),
  status text not null default 'active' check (status in ('active', 'paused', 'slash_pending', 'slashed', 'withdrawn')),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, contract_address, contract_strategy_id)
);

create index if not exists strategy_mandates_leader_idx
  on public.strategy_mandates (lower(leader_address));

create index if not exists strategy_mandates_status_idx
  on public.strategy_mandates (status, slash_risk, risk_score desc);

create table if not exists public.strategy_sources (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategy_mandates(id) on delete cascade,
  source_type text not null check (source_type in ('hyperliquid', 'polymarket', 'arc', 'manual', 'agent')),
  external_id text,
  source_url text,
  last_synced_at timestamptz,
  latest_snapshot jsonb not null default '{}'::jsonb,
  source_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists strategy_sources_unique_source
  on public.strategy_sources (strategy_id, source_type, coalesce(external_id, ''));

create table if not exists public.follower_subscriptions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategy_mandates(id) on delete cascade,
  follower_address text not null check (follower_address ~* '^0x[0-9a-f]{40}$'),
  chain_id integer not null default 5042002,
  capital_cap_usdc numeric(20, 6) not null default 0 check (capital_cap_usdc >= 0),
  follower_weight numeric(20, 6) not null default 0 check (follower_weight >= 0),
  copy_mode text not null default 'assisted' check (copy_mode in ('manual', 'assisted', 'auto')),
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  subscribed_tx_hash text check (subscribed_tx_hash is null or subscribed_tx_hash ~* '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (strategy_id, follower_address)
);

create index if not exists follower_subscriptions_follower_idx
  on public.follower_subscriptions (lower(follower_address), status);

create table if not exists public.copy_rules (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.follower_subscriptions(id) on delete cascade,
  max_daily_loss_percent numeric(8, 4) not null default 5 check (max_daily_loss_percent >= 0 and max_daily_loss_percent <= 100),
  max_position_size_percent numeric(8, 4) not null default 20 check (max_position_size_percent >= 0 and max_position_size_percent <= 100),
  max_leverage numeric(12, 4) not null default 1 check (max_leverage >= 0),
  allowed_markets text[] not null default '{}'::text[],
  allow_hyperliquid boolean not null default true,
  allow_polymarket boolean not null default true,
  allow_near_resolution_markets boolean not null default false,
  slippage_bps integer not null default 50 check (slippage_bps >= 0 and slippage_bps <= 10000),
  auto_deleverage boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists copy_rules_subscription_key
  on public.copy_rules (subscription_id);

create table if not exists public.trade_signals (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategy_mandates(id) on delete cascade,
  leader_address text not null check (leader_address ~* '^0x[0-9a-f]{40}$'),
  platform text not null check (platform in ('Hyperliquid', 'Polymarket', 'Arc', 'Manual')),
  market text not null,
  side text not null check (side in ('long', 'short', 'buy_yes', 'buy_no', 'sell_yes', 'sell_no', 'close', 'hedge')),
  confidence numeric(8, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  size_hint_usdc numeric(20, 6) check (size_hint_usdc is null or size_hint_usdc >= 0),
  leverage numeric(12, 4) check (leverage is null or leverage >= 0),
  limit_price numeric(20, 8),
  reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  signal_status text not null default 'open' check (signal_status in ('open', 'copied', 'rejected', 'closed', 'expired')),
  emitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists trade_signals_strategy_time_idx
  on public.trade_signals (strategy_id, emitted_at desc);

create table if not exists public.copied_trades (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.trade_signals(id) on delete set null,
  subscription_id uuid not null references public.follower_subscriptions(id) on delete cascade,
  follower_address text not null check (follower_address ~* '^0x[0-9a-f]{40}$'),
  platform text not null check (platform in ('Hyperliquid', 'Polymarket', 'Arc', 'Manual')),
  market text not null,
  copied_size_usdc numeric(20, 6) not null default 0 check (copied_size_usdc >= 0),
  execution_price numeric(20, 8),
  tx_hash text check (tx_hash is null or tx_hash ~* '^0x[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'executed', 'rejected', 'paused', 'failed')),
  rejection_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists copied_trades_subscription_time_idx
  on public.copied_trades (subscription_id, created_at desc);

create table if not exists public.risk_attestations (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategy_mandates(id) on delete cascade,
  contract_strategy_id bigint not null,
  attester_address text not null check (attester_address ~* '^0x[0-9a-f]{40}$'),
  condition text not null,
  evidence_uri text not null,
  evidence_hash text,
  slash_percent_bps integer not null default 0 check (slash_percent_bps >= 0 and slash_percent_bps <= 10000),
  severity text not null default 'info' check (severity in ('info', 'warning', 'violation', 'critical')),
  decision_status text not null default 'recorded' check (decision_status in ('recorded', 'challenged', 'executed', 'dismissed')),
  agent_output jsonb not null default '{}'::jsonb,
  tx_hash text check (tx_hash is null or tx_hash ~* '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index if not exists risk_attestations_strategy_time_idx
  on public.risk_attestations (strategy_id, created_at desc);

create table if not exists public.arc_transactions (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 5042002,
  contract_address text check (contract_address is null or contract_address ~* '^0x[0-9a-f]{40}$'),
  tx_hash text not null check (tx_hash ~* '^0x[0-9a-f]{64}$'),
  block_number bigint not null,
  log_index integer,
  event_type text not null check (event_type in ('strategy', 'bond', 'subscription', 'attestation', 'slash', 'claim', 'withdrawal', 'agent_run')),
  actor_address text check (actor_address is null or actor_address ~* '^0x[0-9a-f]{40}$'),
  strategy_id uuid references public.strategy_mandates(id) on delete set null,
  contract_strategy_id bigint,
  amount_usdc numeric(20, 6) not null default 0,
  detail text,
  raw_event jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists arc_transactions_event_time_idx
  on public.arc_transactions (event_type, block_number desc);

create unique index if not exists arc_transactions_unique_event
  on public.arc_transactions (chain_id, tx_hash, coalesce(log_index, -1), event_type);

create table if not exists public.slash_events (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategy_mandates(id) on delete cascade,
  attestation_id uuid references public.risk_attestations(id) on delete set null,
  contract_strategy_id bigint not null,
  slash_tx_hash text not null check (slash_tx_hash ~* '^0x[0-9a-f]{64}$'),
  slashed_amount_usdc numeric(20, 6) not null check (slashed_amount_usdc >= 0),
  slash_percent_bps integer not null check (slash_percent_bps >= 0 and slash_percent_bps <= 10000),
  affected_followers text[] not null default '{}'::text[],
  distribution_status text not null default 'claimable' check (distribution_status in ('claimable', 'claimed', 'reconciled')),
  created_at timestamptz not null default now()
);

create index if not exists slash_events_strategy_time_idx
  on public.slash_events (strategy_id, created_at desc);

create table if not exists public.compensation_claims (
  id uuid primary key default gen_random_uuid(),
  slash_event_id uuid references public.slash_events(id) on delete set null,
  strategy_id uuid not null references public.strategy_mandates(id) on delete cascade,
  follower_address text not null check (follower_address ~* '^0x[0-9a-f]{40}$'),
  claimable_usdc numeric(20, 6) not null default 0 check (claimable_usdc >= 0),
  claimed_usdc numeric(20, 6) not null default 0 check (claimed_usdc >= 0),
  claim_tx_hash text check (claim_tx_hash is null or claim_tx_hash ~* '^0x[0-9a-f]{64}$'),
  status text not null default 'claimable' check (status in ('claimable', 'claimed', 'expired')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index if not exists compensation_claims_follower_idx
  on public.compensation_claims (lower(follower_address), status);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid references public.strategy_mandates(id) on delete set null,
  run_type text not null check (run_type in ('risk_score', 'copy_weight', 'mandate_check', 'attestation', 'sync')),
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_runs_strategy_time_idx
  on public.agent_runs (strategy_id, started_at desc);

create table if not exists public.tester_feedback (
  id uuid primary key default gen_random_uuid(),
  wallet_address text check (wallet_address is null or wallet_address ~* '^0x[0-9a-f]{40}$'),
  question text not null,
  answer text not null,
  rating integer check (rating is null or rating between 1 and 5),
  source text not null default 'hackathon_demo',
  created_at timestamptz not null default now()
);

create or replace view public.leaderboard_live as
select
  sm.id,
  sm.contract_strategy_id,
  sm.contract_address,
  sm.chain_id,
  coalesce(lp.display_name, sm.strategy_name) as display_name,
  sm.leader_address,
  lp.hyperliquid_user,
  lp.polymarket_proxy,
  sm.strategy_summary,
  sm.markets,
  sm.current_bond_usdc,
  sm.follower_count,
  sm.total_follower_weight,
  sm.mandate_integrity,
  sm.risk_score,
  sm.copy_weight,
  sm.slash_risk,
  sm.status,
  sm.updated_at
from public.strategy_mandates sm
left join public.leader_profiles lp on lp.id = sm.leader_profile_id;

create or replace view public.follower_claims_live as
select
  cc.id,
  cc.strategy_id,
  sm.contract_strategy_id,
  cc.follower_address,
  cc.claimable_usdc,
  cc.claimed_usdc,
  cc.status,
  cc.claim_tx_hash,
  cc.created_at,
  cc.claimed_at
from public.compensation_claims cc
join public.strategy_mandates sm on sm.id = cc.strategy_id;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_users',
    'wallets',
    'leader_profiles',
    'strategy_mandates',
    'strategy_sources',
    'follower_subscriptions',
    'copy_rules'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || table_name || '_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      'set_' || table_name || '_updated_at',
      table_name
    );
  end loop;
end;
$$;

alter table public.app_users enable row level security;
alter table public.wallets enable row level security;
alter table public.leader_profiles enable row level security;
alter table public.strategy_mandates enable row level security;
alter table public.strategy_sources enable row level security;
alter table public.follower_subscriptions enable row level security;
alter table public.copy_rules enable row level security;
alter table public.trade_signals enable row level security;
alter table public.copied_trades enable row level security;
alter table public.risk_attestations enable row level security;
alter table public.arc_transactions enable row level security;
alter table public.slash_events enable row level security;
alter table public.compensation_claims enable row level security;
alter table public.agent_runs enable row level security;
alter table public.tester_feedback enable row level security;

drop policy if exists "Public leaderboard read" on public.leader_profiles;
create policy "Public leaderboard read"
on public.leader_profiles
for select
to anon, authenticated
using (true);

drop policy if exists "Public strategy read" on public.strategy_mandates;
create policy "Public strategy read"
on public.strategy_mandates
for select
to anon, authenticated
using (true);

drop policy if exists "Public source read" on public.strategy_sources;
create policy "Public source read"
on public.strategy_sources
for select
to anon, authenticated
using (true);

drop policy if exists "Public signal read" on public.trade_signals;
create policy "Public signal read"
on public.trade_signals
for select
to anon, authenticated
using (true);

drop policy if exists "Public attestation read" on public.risk_attestations;
create policy "Public attestation read"
on public.risk_attestations
for select
to anon, authenticated
using (true);

drop policy if exists "Public arc transaction read" on public.arc_transactions;
create policy "Public arc transaction read"
on public.arc_transactions
for select
to anon, authenticated
using (true);

drop policy if exists "Public slash read" on public.slash_events;
create policy "Public slash read"
on public.slash_events
for select
to anon, authenticated
using (true);

drop policy if exists "Public claim read" on public.compensation_claims;
create policy "Public claim read"
on public.compensation_claims
for select
to anon, authenticated
using (true);

drop policy if exists "Public subscription read" on public.follower_subscriptions;
create policy "Public subscription read"
on public.follower_subscriptions
for select
to anon, authenticated
using (true);

drop policy if exists "Public copy rule read" on public.copy_rules;
create policy "Public copy rule read"
on public.copy_rules
for select
to anon, authenticated
using (true);

drop policy if exists "Public copied trade read" on public.copied_trades;
create policy "Public copied trade read"
on public.copied_trades
for select
to anon, authenticated
using (true);

drop policy if exists "Public feedback insert" on public.tester_feedback;
create policy "Public feedback insert"
on public.tester_feedback
for insert
to anon, authenticated
with check (true);

drop policy if exists "Public feedback read" on public.tester_feedback;
create policy "Public feedback read"
on public.tester_feedback
for select
to anon, authenticated
using (true);

-- Use the Supabase service role key, direct URI, or pooler URI from your backend
-- for inserts/updates into protected tables. The frontend anon key can read
-- public leaderboard/transaction data and submit tester feedback.
