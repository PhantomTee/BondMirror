# BondMirror

Real slash-bonded copy trading and prediction-signal marketplace for the Agora Agents Hackathon on Arc Testnet.

BondMirror does not ship fake leaders, fake transaction hashes, or seeded performance. The app reads a deployed Arc contract, loads each strategy mandate from its `mandateURI`, fetches Hyperliquid and Polymarket data from public APIs, then lets users submit real wallet transactions for subscription, USDC bond staking, compensation claims, attestations, and slashing.

## Current Surfaces

- `/`: square-edged landing page with usage instructions, wallet connect in the top bar, and Launch App gating.
- `/app`: command center with live Arc settlement, AI risk output, copy engine checks, and backend readiness.
- `/app/leaders`: live bonded leaderboard from `BondMirrorBond.nextStrategyId()` and `strategies(id)`.
- `/app/publish`: leader publishing flow for creating a real mandate and staking a USDC bond.
- `/app/follow`: wallet actions for `subscribeFollower()`, `stakeBond()`, and `claimCompensation()`.
- `/app/attestations`: onchain `recordAttestation()` evidence.
- `/app/transactions`: onchain event tape for strategy creation, bond stake, subscription, attestation, slash, and claim.

## Configure

Copy `.env.example` to `.env.local` and fill the deployed contract values.

```bash
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_ARC_CHAIN_ID=5042002
VITE_ARC_USDC_ADDRESS=0x3600000000000000000000000000000000000000
VITE_BONDMIRROR_CONTRACT_ADDRESS=0x...
VITE_BONDMIRROR_FROM_BLOCK=123456
VITE_POLYMARKET_BUILDER_CODE=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
POLYMARKET_BUILDER_CODE=
```

The defaults above are based on the current Arc and Circle docs. Recheck the official pages before submission if Arc changes testnet endpoints or token addresses.

## Current Arc Testnet Deployment

The local `.env.local` is already pointed at the live test deployment:

- Contract: `0x5027d79086a32d8462b499fb8e0e4d959497c966`
- From block: `42695853`
- Strategy: `1`
- Public evidence file: `deployments/arc-testnet.json`

This deployment has a real strategy creation, USDC bond stake, follower subscription, risk-agent attestation, bond slash, and follower compensation claim on Arc Testnet.

## Run

```bash
npm install
npm run dev
```

Build and lint:

```bash
npm run lint
npm run build
```

## Supabase Live Backend

Paste `supabase/schema.sql` into the Supabase SQL editor. It creates the live-version backend tables for wallets, leader profiles, strategy mandates, source snapshots, follower subscriptions, copy rules, trade signals, copied trades, risk attestations, Arc transactions, slash events, compensation claims, agent runs, and tester feedback.

For Vercel/frontend deployment, add:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

For the next backend/API worker step, bring one of these from Supabase:

```bash
DATABASE_URL=
DIRECT_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## Vercel Cron Risk Agent

The production heartbeat is `api/cron/risk-agent.ts`, scheduled in `vercel.json` at `/api/cron/risk-agent`.

It reads the live Arc contract, loads each mandate URI, checks Hyperliquid leverage when a mandate includes `hyperliquidUser`, scores the strategy, upserts `strategy_mandates`, records `agent_runs`, and writes a Supabase risk attestation when the strategy is slash-pending.

Add these Vercel environment variables:

```bash
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
BONDMIRROR_CONTRACT_ADDRESS=0x5027d79086a32d8462b499fb8e0e4d959497c966
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CRON_SECRET=make-a-long-random-secret
RISK_AGENT_ADDRESS=0xYourRiskAgentAddress
POLYMARKET_BUILDER_CODE=0xYourPolymarketBuilderCode
```

Vercel calls the cron endpoint with `Authorization: Bearer $CRON_SECRET`. The service role key must stay server-side only; do not add it as a `VITE_` variable.

The current schedule is daily at 08:00 UTC:

```json
{ "path": "/api/cron/risk-agent", "schedule": "0 8 * * *" }
```

This schedule works on Vercel Hobby and Pro. For a more live production monitor, switch it back to a shorter interval on a plan that supports frequent cron jobs.

## Deploy The Arc Contract

Compile:

```bash
npm run contract:compile
```

Deploy:

```bash
$env:DEPLOYER_PRIVATE_KEY="0x..."
$env:RISK_AGENT_ADDRESS="0x..."
npm run contract:deploy:arc
```

The deploy script prints:

- `VITE_BONDMIRROR_CONTRACT_ADDRESS`
- `VITE_BONDMIRROR_FROM_BLOCK`

Put both into `.env.local`, restart `npm run dev`, and the frontend will read the deployed contract.

## Create A Real Strategy

Publish a mandate JSON file at HTTPS/IPFS, or use a `data:application/json,...` URI during testing. The required shape is in `mandates/example-mandate.json`.

```bash
$env:BONDMIRROR_CONTRACT_ADDRESS="0x..."
$env:LEADER_PRIVATE_KEY="0x..."
$env:MANDATE_URI="https://example.com/bondmirror/leader-1.json"
$env:BENCHMARK="50% BTC + 50% USDC"
$env:STAKE_USDC_AMOUNT="1000"
npm run strategy:create
```

`strategy:create` calls:

- `createStrategy(mandateURI, benchmark, conditions, slashBps)`
- `approve(USDC, BondMirrorBond, amount)`
- `stakeBond(strategyId, amount)`

## Run The Risk Agent

Dry run:

```bash
$env:BONDMIRROR_CONTRACT_ADDRESS="0x..."
$env:RISK_AGENT_PRIVATE_KEY="0x..."
npm run agent:monitor
```

Record a real attestation:

```bash
$env:EXECUTE_ATTESTATION="true"
npm run agent:monitor
```

Slash after an attestation:

```bash
$env:EXECUTE_SLASH="true"
$env:AFFECTED_FOLLOWERS="0xFollower1,0xFollower2"
npm run agent:monitor
```

## Contract Surface

`contracts/BondMirrorBond.sol` supports the required accountability flow:

- `createStrategy()`
- `stakeBond()`
- `subscribeFollower()`
- `recordAttestation()`
- `slashBond()`
- `claimCompensation()`
- `withdrawBondAfterCooldown()`

Follower compensation is distributed pro-rata by follower weight among affected followers. The contract stores the strategy mandate URI, benchmark, slash rules, bond size, follower count, total follower weight, attestations, and claimable balances.

## Live Data Sources

- Arc Testnet RPC and chain docs: https://docs.arc.io/
- Circle USDC contract addresses: https://developers.circle.com/stablecoins/usdc-contract-addresses
- Hyperliquid Info API: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- Polymarket CLOB and Data APIs: https://docs.polymarket.com/

## No Mock Behavior

If a contract address is missing, the UI shows setup errors and zero leaders. If no strategies exist onchain, the leaderboard is empty. If a mandate fails to load, the app displays the failure instead of inventing data. If Hyperliquid or Polymarket APIs fail, the source error lowers the strategy score and blocks confident copy recommendations.
