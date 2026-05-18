import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  FileText,
  Gauge,
  Landmark,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  PauseCircle,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { formatUnits, type Address } from 'viem'
import './App.css'
import { appConfig, setupProblems } from './config'
import { useBondMirrorState } from './hooks/useBondMirrorState'
import { useWalletSession } from './hooks/useWalletSession'
import { claimCompensation, createLeaderStrategy, stakeBond, subscribeFollower } from './services/wallet'
import { supabaseStatus } from './services/supabase'
import type { ArcTransactionView, AttestationView, RiskDecision, SlashRisk, StrategyView, WalletSession } from './types'

const appNav = [
  ['Command', '/app', LayoutDashboard],
  ['Leaders', '/app/leaders', ShieldCheck],
  ['Publish', '/app/publish', FileText],
  ['Follow', '/app/follow', SlidersHorizontal],
  ['Attestations', '/app/attestations', Sparkles],
  ['Transactions', '/app/transactions', Activity],
] as const

const shellNav = [
  ['Home', '/', true],
  ['App', '/app', true],
  ['Leaders', '/app/leaders', false],
  ['Publish', '/app/publish', false],
  ['Follow', '/app/follow', false],
  ['Attestations', '/app/attestations', false],
  ['Arc Tape', '/app/transactions', false],
] as const

function formatAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function formatMaybePercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'live n/a'
  }
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function statusLabel(status: RiskDecision['status']) {
  return {
    copy_with_limits: 'Copy with limits',
    healthy: 'Healthy',
    paused: 'Paused',
    slash_pending: 'Slash pending',
  }[status]
}

function riskTone(risk: SlashRisk) {
  return risk === 'Low' ? 'good' : risk === 'Medium' ? 'warn' : 'bad'
}

function Metric({ label, value, trend }: { label: string; value: string; trend?: 'up' | 'down' }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={trend ? `trend ${trend}` : undefined}>{value}</strong>
    </div>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <AlertTriangle size={18} />
      <div>
        <b>{title}</b>
        <p>{detail}</p>
      </div>
    </div>
  )
}

function LoadingPanel({ title = 'Loading live data', detail = 'Reading Arc, mandate, Hyperliquid, and Polymarket state.' }: { title?: string; detail?: string }) {
  return (
    <div className="loading-panel" aria-live="polite">
      <div className="loading-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <b>{title}</b>
        <p>{detail}</p>
      </div>
    </div>
  )
}

function LoadingMetric({ label }: { label: string }) {
  return (
    <div className="metric loading-metric">
      <span>{label}</span>
      <strong>Loading</strong>
    </div>
  )
}

function WalletButton({ wallet, onConnect, onDisconnect }: { wallet: WalletSession; onConnect: () => void; onDisconnect: () => void }) {
  if (wallet.status === 'connected' && wallet.address) {
    return (
      <button className="wallet-button connected" type="button" onClick={onDisconnect}>
        <Wallet size={16} />
        {formatAddress(wallet.address)}
      </button>
    )
  }

  return (
    <button className="wallet-button" type="button" onClick={onConnect} disabled={wallet.status === 'connecting'}>
      <Wallet size={16} />
      {wallet.status === 'connecting' ? 'Connecting' : 'Connect wallet'}
    </button>
  )
}

function Shell({
  children,
  wallet,
  connectWallet,
  disconnectWallet,
}: {
  children: ReactNode
  wallet: WalletSession
  connectWallet: () => void
  disconnectWallet: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  const close = () => setMenuOpen(false)

  return (
    <main>
      <header className="topbar">
        <Link className="brand" to="/" onClick={close}>
          <span>
            <strong>BondMirror</strong>
            <small>Accountable alpha on Arc</small>
          </span>
        </Link>
        <nav className="topnav">
          {shellNav.map(([label, path, end]) => (
            <NavLink key={path} to={path} end={end}>
              {label}
            </NavLink>
          ))}
          <WalletButton wallet={wallet} onConnect={connectWallet} onDisconnect={disconnectWallet} />
        </nav>
        <button
          className="hamburger"
          type="button"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen(v => !v)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {/* Full-screen mobile overlay */}
      <div className={`mobile-nav-overlay${menuOpen ? ' open' : ''}`} aria-hidden={!menuOpen}>
        <div className="mobile-nav-header">
          <Link className="mobile-nav-brand" to="/" onClick={close}>
            <strong>BondMirror</strong>
          </Link>
          <button className="mobile-nav-close" type="button" onClick={close} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>
        <nav className="mobile-nav-links">
          {shellNav.map(([label, path, end]) => (
            <NavLink key={path} to={path} end={end} onClick={close}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mobile-nav-footer">
          <WalletButton wallet={wallet} onConnect={connectWallet} onDisconnect={disconnectWallet} />
        </div>
      </div>

      {wallet.message && <div className={`wallet-message ${wallet.status}`}>{wallet.message}</div>}
      {children}
    </main>
  )
}

function LandingPage({ wallet }: { wallet: WalletSession }) {
  const navigate = useNavigate()
  const isConnected = wallet.status === 'connected'

  return (
    <>
      <section className="landing-hero">
        {/* Brand display text + CSS reflection directly below */}
        <div className="hero-display-wrap">
          <div className="hero-display">bondmirror.</div>
        </div>

        {/* Bottom row: copy | terminal card | year */}
        <div className="hero-footer">
          <div className="hero-copy">
            <p className="hero-tagline">Slashable bonds that keep both leaders and followers honest.</p>
            <h1>No More Bad Signals.<br />No More Hidden Risks.</h1>
            <div className="hero-actions">
              <button
                className="primary-action"
                type="button"
                disabled={!isConnected}
                title={isConnected ? 'Open BondMirror app' : 'Connect wallet from the top bar to unlock Launch App'}
                aria-describedby={!isConnected ? 'launch-wallet-hint' : undefined}
                onClick={() => navigate('/app')}
              >
                <ArrowRight size={18} />
                Launch App
              </button>
              <a className="secondary-action" href="#how-it-works">
                <FileText size={18} />
                How it works
              </a>
            </div>
            {!isConnected && (
              <p className="launch-hint" id="launch-wallet-hint">
                Connect wallet from the top bar to unlock Launch App.
              </p>
            )}
          </div>
          <div className="hero-terminal" aria-label="BondMirror accountability preview">
            <div className="terminal-row">
              <span>Leader bond</span>
              <b>4.5 USDC live</b>
            </div>
            <div className="terminal-row">
              <span>Mandate</span>
              <b>Max 3x leverage</b>
            </div>
            <div className="terminal-row danger">
              <span>Observed</span>
              <b>20x Hyperliquid</b>
            </div>
            <div className="terminal-row">
              <span>Arc action</span>
              <b>0.5 USDC slashed</b>
            </div>
          </div>
          <span className="hero-year">2025</span>
        </div>
      </section>

      <section className="landing-section" id="how-it-works">
        <div className="section-title">
          <span className="eyebrow">How to use BondMirror</span>
          <h2>Four steps, all verifiable.</h2>
        </div>
        <div className="info-grid">
          {[
            ['Connect wallet', 'Use an Arc Testnet wallet so subscriptions, claims, and bond actions can be signed.'],
            ['Review a leader', 'Check live Hyperliquid exposure, Polymarket activity, mandate limits, bond size, and slash risk.'],
            ['Follow with caps', 'Set capital, max daily loss, copy mode, and market permissions before subscribing on Arc.'],
            ['Watch accountability', 'When the risk agent records evidence, the contract can slash the bond and pay followers.'],
          ].map(([title, detail]) => (
            <article className="info-panel" key={title}>
              <b>{title}</b>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section split">
        <div>
          <span className="eyebrow">What makes it different</span>
          <h2>The signal publisher has skin in the game.</h2>
        </div>
        <div className="comparison-table">
          <div>
            <span>Old copy trading</span>
            <p>Leaders monetize attention while followers absorb downside.</p>
          </div>
          <div>
            <span>BondMirror</span>
            <p>Leaders post USDC. Broken mandates trigger attestations, slashing, and follower payouts.</p>
          </div>
        </div>
      </section>
    </>
  )
}

function SetupPanel({ errors }: { errors: string[] }) {
  if (!errors.length) {
    return null
  }

  return (
    <section className="setup-panel">
      <AlertTriangle size={20} />
      <div>
        <strong>Live configuration check</strong>
        {errors.map((error) => (
          <p key={error}>{error}</p>
        ))}
      </div>
    </section>
  )
}

function AppLayout({
  children,
  live,
}: {
  children: ReactNode
  live: ReturnType<typeof useBondMirrorState>
}) {
  const data = live.data
  const errors = [...setupProblems(), ...(data?.errors ?? []), ...(live.status === 'error' && live.error ? [live.error] : [])]

  return (
    <section className="app-shell">
      <aside className="side-nav">
        <span className="eyebrow">Interface</span>
        {appNav.map(([label, path, Icon]) => (
          <NavLink key={path} to={path} end={path === '/app'}>
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
        <button className="refresh-button" type="button" onClick={() => void live.refresh()}>
          <RefreshCw size={16} />
          {live.status === 'loading' ? 'Loading' : 'Refresh live data'}
        </button>
      </aside>
      <div className="app-content">
        <SetupPanel errors={[...new Set(errors)]} />
        {children}
      </div>
    </section>
  )
}

function LeaderCard({ strategy, selected, onSelect }: { strategy: StrategyView; selected?: boolean; onSelect?: (strategy: StrategyView) => void }) {
  const name = strategy.mandate?.displayName ?? formatAddress(strategy.leader)
  const returnWindow = strategy.hyperliquid?.returnWindowPercent ?? strategy.polymarket?.realizedPnl
  const platforms = [
    strategy.mandate?.hyperliquidUser ? 'Hyperliquid' : undefined,
    strategy.mandate?.polymarketProxy ? 'Polymarket' : undefined,
    'Arc',
  ]
    .filter(Boolean)
    .join(' / ')

  return (
    <button className={`leader-row ${selected ? 'selected' : ''}`} type="button" onClick={() => onSelect?.(strategy)}>
      <div className="leader-main">
        <span className="rank-badge">
          <ShieldCheck size={18} />
        </span>
        <div>
          <div className="row-title">
            <strong>{name}</strong>
            <span className={`pill ${riskTone(strategy.risk.slashRisk)}`}>{strategy.risk.slashRisk} slash risk</span>
          </div>
          <p>{strategy.mandate?.strategy ?? `Mandate: ${strategy.mandateURI}`}</p>
          <span className="source-line">{platforms}</span>
        </div>
      </div>
      <div className="leader-stats">
        <Metric label="Bond" value={`${strategy.bondUsdc.toLocaleString()} USDC`} />
        <Metric label="Live return/PnL" value={formatMaybePercent(returnWindow)} trend={returnWindow && returnWindow > 0 ? 'up' : undefined} />
        <Metric label="Violations" value={strategy.risk.violations.length.toString()} />
        <Metric label="Copy Weight" value={`${strategy.risk.copyWeight}%`} />
      </div>
      <div className="live-score">
        <strong>{strategy.risk.riskScore}</strong>
        <span>copy score</span>
      </div>
    </button>
  )
}

function DashboardPage({
  strategies,
  transactions,
  selectedStrategy,
  isLoading,
}: {
  strategies: StrategyView[]
  transactions: ArcTransactionView[]
  selectedStrategy?: StrategyView
  isLoading: boolean
}) {
  const totalBond = strategies.reduce((sum, strategy) => sum + strategy.bondUsdc, 0)
  const followers = strategies.reduce((sum, strategy) => sum + Number(strategy.followerCount), 0)
  const slashes = transactions.filter((tx) => tx.type === 'slash').length

  return (
    <>
      <section className="page-head">
        <div>
          <span className="eyebrow">Command center</span>
          <h1>Live accountable-alpha console</h1>
          <p>Arc settlement, Hyperliquid risk, Polymarket activity, and Supabase readiness in one interface.</p>
        </div>
        <div className="contract-box">
          <span>Contract</span>
          <b>{appConfig.bondContract ? formatAddress(appConfig.bondContract) : 'Not configured'}</b>
        </div>
      </section>
      <section className="stats-strip">
        {isLoading ? (
          <>
            <LoadingMetric label="Listed leaders" />
            <LoadingMetric label="Total bonded" />
            <LoadingMetric label="Follower subscriptions" />
            <LoadingMetric label="Slash events" />
          </>
        ) : (
          <>
            <Metric label="Listed leaders" value={strategies.length.toString()} />
            <Metric label="Total bonded" value={`${totalBond.toLocaleString()} USDC`} />
            <Metric label="Follower subscriptions" value={followers.toString()} />
            <Metric label="Slash events" value={slashes.toString()} />
          </>
        )}
      </section>
      {isLoading ? (
        <>
          <section className="grid-area">
            <section className="panel agent-panel">
              <LoadingPanel title="Loading risk agent" />
            </section>
            <section className="panel portfolio-panel">
              <LoadingPanel title="Loading copy engine" />
            </section>
            <section className="panel">
              <LoadingPanel title="Checking backend status" detail="Reading local Supabase env configuration." />
            </section>
          </section>
          <section className="grid-area lower">
            <section className="panel mandate-panel">
              <LoadingPanel title="Loading mandate" />
            </section>
            <section className="panel flow-panel">
              <LoadingPanel title="Loading settlement state" />
            </section>
          </section>
        </>
      ) : (
        <>
          <section className="grid-area">
            <RiskAgent strategy={selectedStrategy} />
            <CopyEngine strategy={selectedStrategy} />
            <BackendPanel />
          </section>
          <section className="grid-area lower">
            <MandateBlock strategy={selectedStrategy} />
            <ArcFlow />
          </section>
        </>
      )}
    </>
  )
}

function BackendPanel() {
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Backend</span>
          <h2>Supabase live version</h2>
        </div>
        <Database size={20} />
      </div>
      <div className="agent-json">
        <p>{supabaseStatus()}</p>
        <p>SQL file: <b>supabase/schema.sql</b></p>
        <p>Tables cover wallets, leaders, strategies, mandates, subscriptions, signals, attestations, transactions, and tester feedback.</p>
      </div>
    </section>
  )
}

function LeadersPage({
  strategies,
  selectedStrategy,
  setSelectedId,
  isLoading,
}: {
  strategies: StrategyView[]
  selectedStrategy?: StrategyView
  setSelectedId: (id: string) => void
  isLoading: boolean
}) {
  return (
    <section className="workspace">
      <div className="leaderboard">
        <div className="section-head">
          <div>
            <span className="eyebrow">Bonded leaderboard</span>
            <h2>Ranked from live performance and mandate integrity</h2>
          </div>
          <ShieldCheck size={20} />
        </div>
        {isLoading ? (
          <LoadingPanel title="Loading bonded leaderboard" detail="Fetching onchain strategies and public market summaries." />
        ) : strategies.length ? (
          <div className="leader-list">
            {strategies.map((strategy) => (
              <LeaderCard key={strategy.id.toString()} strategy={strategy} selected={strategy.id === selectedStrategy?.id} onSelect={(item) => setSelectedId(item.id.toString())} />
            ))}
          </div>
        ) : (
          <EmptyState title="No leaders on Arc yet" detail="Use createStrategy(), stakeBond(), and a mandateURI to make the first real leader visible." />
        )}
      </div>
      {isLoading ? (
        <aside className="profile-panel">
          <LoadingPanel title="Loading leader profile" />
        </aside>
      ) : (
        <LeaderProfile strategy={selectedStrategy} />
      )}
    </section>
  )
}

function LeaderProfile({ strategy }: { strategy?: StrategyView }) {
  return (
    <aside className="profile-panel">
      <div className="profile-head">
        <div>
          <span className="eyebrow">Leader profile</span>
          <h2>{strategy?.mandate?.displayName ?? (strategy ? formatAddress(strategy.leader) : 'No live leader')}</h2>
          <p>{strategy?.leader ?? 'Deploy and create a strategy to populate this page.'}</p>
        </div>
        {strategy && <span className={`pill ${riskTone(strategy.risk.slashRisk)}`}>{statusLabel(strategy.risk.status)}</span>}
      </div>
      <div className="profile-metrics">
        <Metric label="Hyperliquid return" value={formatMaybePercent(strategy?.hyperliquid?.returnWindowPercent)} />
        <Metric label="Max drawdown" value={formatMaybePercent(strategy?.hyperliquid?.maxDrawdownPercent)} trend="down" />
        <Metric label="Open HL positions" value={(strategy?.hyperliquid?.openPositions ?? 0).toString()} />
        <Metric label="Win rate" value={strategy?.hyperliquid?.winRate ? `${strategy.hyperliquid.winRate}%` : 'live n/a'} />
        <Metric label="Polymarket trades" value={(strategy?.polymarket?.tradesAnalyzed ?? 0).toString()} />
        <Metric label="Prediction accuracy" value={strategy?.polymarket?.predictionAccuracy ? `${strategy.polymarket.predictionAccuracy}%` : 'live n/a'} />
      </div>
      <div className="mandate-summary">
        <div>
          <span>Max leverage</span>
          <b>{strategy?.mandate ? `${(strategy.hyperliquid?.maxObservedLeverage ?? 0).toFixed(2)}x / ${strategy.mandate.maxLeverage}x` : 'live n/a'}</b>
        </div>
        <div>
          <span>Allowed markets</span>
          <b>{strategy?.mandate?.markets.join(', ') || 'No live mandate loaded'}</b>
        </div>
        <div>
          <span>Benchmark</span>
          <b>{strategy?.mandate?.benchmark ?? strategy?.benchmark ?? 'No benchmark loaded'}</b>
        </div>
      </div>
    </aside>
  )
}

function RiskAgent({ strategy }: { strategy?: StrategyView }) {
  if (!strategy) {
    return (
      <section className="panel agent-panel">
        <EmptyState title="No live strategy selected" detail="Deploy the Arc contract and create a strategy to run the risk agent." />
      </section>
    )
  }

  return (
    <section className="panel agent-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">AI risk agent</span>
          <h2>Decision output from live data</h2>
        </div>
        <Bot size={20} />
      </div>
      <div className="score-ring" style={{ '--score': strategy.risk.riskScore } as CSSProperties}>
        <strong>{strategy.risk.riskScore}</strong>
        <span>copy score</span>
      </div>
      <div className="agent-json">
        <p>
          <b>Status:</b> {statusLabel(strategy.risk.status)}
        </p>
        <p>
          <b>Reason:</b> {strategy.risk.reason}
        </p>
        <p>
          <b>Action:</b> {strategy.risk.action}
        </p>
      </div>
    </section>
  )
}

function PublishLeaderPage({ account, onRefresh }: { account?: Address; onRefresh: () => void }) {
  const [displayName, setDisplayName] = useState('Arc Bonded Crypto Leader')
  const [strategy, setStrategy] = useState('BTC/ETH momentum with Polymarket event hedges')
  const [hyperliquidUser, setHyperliquidUser] = useState('')
  const [polymarketProxy, setPolymarketProxy] = useState('')
  const [markets, setMarkets] = useState('BTC-PERP, ETH-PERP, Polymarket crypto events')
  const [maxLeverage, setMaxLeverage] = useState(3)
  const [maxDrawdown, setMaxDrawdown] = useState(12)
  const [maxPositionSize, setMaxPositionSize] = useState(20)
  const [cooldownHours, setCooldownHours] = useState(24)
  const [benchmark, setBenchmark] = useState('50% BTC + 50% USDC')
  const [bondAmount, setBondAmount] = useState(5)
  const [leverageSlash, setLeverageSlash] = useState(10)
  const [drawdownSlash, setDrawdownSlash] = useState(20)
  const [shiftSlash, setShiftSlash] = useState(15)
  const [externalMandateURI, setExternalMandateURI] = useState('')
  const [message, setMessage] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)

  const mandate = useMemo(() => {
    const marketList = markets
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    return {
      displayName,
      strategy,
      ...(hyperliquidUser.trim() ? { hyperliquidUser: hyperliquidUser.trim() } : {}),
      ...(polymarketProxy.trim() ? { polymarketProxy: polymarketProxy.trim() } : {}),
      markets: marketList,
      maxLeverage,
      maxDrawdown: maxDrawdown / 100,
      maxPositionSize: maxPositionSize / 100,
      cooldownHours,
      benchmark,
      slashRules: [
        { condition: 'leverage_above_max', slashPercent: leverageSlash / 100 },
        { condition: 'drawdown_above_max', slashPercent: drawdownSlash / 100 },
        { condition: 'unannounced_strategy_shift', slashPercent: shiftSlash / 100 },
      ],
    }
  }, [
    benchmark,
    cooldownHours,
    displayName,
    drawdownSlash,
    hyperliquidUser,
    leverageSlash,
    markets,
    maxDrawdown,
    maxLeverage,
    maxPositionSize,
    polymarketProxy,
    shiftSlash,
    strategy,
  ])

  const generatedMandateURI = useMemo(() => `data:application/json,${encodeURIComponent(JSON.stringify(mandate))}`, [mandate])
  const activeMandateURI = externalMandateURI.trim() || generatedMandateURI

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!account) {
      setMessage('Connect a leader wallet from the top bar before publishing.')
      return
    }

    try {
      setIsPublishing(true)
      setMessage('Submitting createStrategy() to Arc...')
      const result = await createLeaderStrategy(account, {
        mandateURI: activeMandateURI,
        benchmark,
        slashRules: mandate.slashRules,
        stakeAmountUsdc: bondAmount,
      })
      setMessage(
        [
          `Strategy ${result.strategyId.toString()} published.`,
          `createStrategy: ${result.createHash}`,
          result.stakeHash ? `stakeBond: ${result.stakeHash}` : undefined,
        ]
          .filter(Boolean)
          .join(' '),
      )
      onRefresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Leader publish failed.')
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <section className="leader-publish-layout">
      <form className="panel leader-publish-panel" onSubmit={publish}>
        <div className="section-head">
          <div>
            <span className="eyebrow">Leader publish</span>
            <h2>Create a slash-bonded strategy</h2>
          </div>
          <ShieldCheck size={20} />
        </div>
        {!account && (
          <EmptyState title="Connect leader wallet" detail="The connected wallet becomes the onchain leader for this strategy." />
        )}
        <div className="field-grid">
          <label>
            <span>Leader display name</span>
            <input value={displayName} type="text" onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            <span>Benchmark</span>
            <input value={benchmark} type="text" onChange={(event) => setBenchmark(event.target.value)} />
          </label>
        </div>
        <label>
          <span>Strategy mandate</span>
          <textarea value={strategy} rows={3} onChange={(event) => setStrategy(event.target.value)} />
        </label>
        <div className="field-grid">
          <label>
            <span>Hyperliquid wallet</span>
            <input value={hyperliquidUser} type="text" placeholder="0x..." onChange={(event) => setHyperliquidUser(event.target.value)} />
          </label>
          <label>
            <span>Polymarket proxy</span>
            <input value={polymarketProxy} type="text" placeholder="0x..." onChange={(event) => setPolymarketProxy(event.target.value)} />
          </label>
        </div>
        <label>
          <span>Allowed markets</span>
          <input value={markets} type="text" onChange={(event) => setMarkets(event.target.value)} />
        </label>
        <div className="field-grid compact">
          <label>
            <span>Max leverage</span>
            <input value={maxLeverage} min={1} max={50} step={0.5} type="number" onChange={(event) => setMaxLeverage(Number(event.target.value))} />
          </label>
          <label>
            <span>Max drawdown %</span>
            <input value={maxDrawdown} min={1} max={90} step={1} type="number" onChange={(event) => setMaxDrawdown(Number(event.target.value))} />
          </label>
          <label>
            <span>Max position %</span>
            <input value={maxPositionSize} min={1} max={100} step={1} type="number" onChange={(event) => setMaxPositionSize(Number(event.target.value))} />
          </label>
          <label>
            <span>Cooldown hours</span>
            <input value={cooldownHours} min={0} max={720} step={1} type="number" onChange={(event) => setCooldownHours(Number(event.target.value))} />
          </label>
        </div>
        <div className="rule-grid">
          <label>
            <span>Leverage slash %</span>
            <input value={leverageSlash} min={1} max={50} step={1} type="number" onChange={(event) => setLeverageSlash(Number(event.target.value))} />
          </label>
          <label>
            <span>Drawdown slash %</span>
            <input value={drawdownSlash} min={1} max={50} step={1} type="number" onChange={(event) => setDrawdownSlash(Number(event.target.value))} />
          </label>
          <label>
            <span>Strategy shift slash %</span>
            <input value={shiftSlash} min={1} max={50} step={1} type="number" onChange={(event) => setShiftSlash(Number(event.target.value))} />
          </label>
        </div>
        <div className="field-grid">
          <label>
            <span>Stake bond now</span>
            <input value={bondAmount} min={0} max={100000} step={1} type="number" onChange={(event) => setBondAmount(Number(event.target.value))} />
          </label>
          <label>
            <span>External mandate URI optional</span>
            <input value={externalMandateURI} type="text" placeholder="https://... or ipfs://..." onChange={(event) => setExternalMandateURI(event.target.value)} />
          </label>
        </div>
        <button className="wide-action" type="submit" disabled={!account || isPublishing}>
          <ShieldCheck size={16} />
          {isPublishing ? 'Publishing on Arc' : 'Publish bonded strategy'}
        </button>
        {message && <p className="action-message">{message}</p>}
      </form>

      <aside className="profile-panel publish-preview">
        <div className="profile-head">
          <div>
            <span className="eyebrow">Mandate preview</span>
            <h2>{displayName || 'New leader'}</h2>
            <p>{account ?? 'Connect wallet to assign the onchain leader.'}</p>
          </div>
          <span className="pill warn">{bondAmount.toLocaleString()} USDC bond</span>
        </div>
        <div className="profile-metrics">
          <Metric label="Max leverage" value={`${maxLeverage}x`} />
          <Metric label="Max drawdown" value={`${maxDrawdown}%`} trend="down" />
          <Metric label="Position cap" value={`${maxPositionSize}%`} />
          <Metric label="Cooldown" value={`${cooldownHours}h`} />
        </div>
        <div className="mandate-summary">
          <div>
            <span>Mandate URI mode</span>
            <b>{externalMandateURI.trim() ? 'External URI' : 'Generated data URI'}</b>
          </div>
          <div>
            <span>Allowed markets</span>
            <b>{mandate.markets.join(', ') || 'No markets set'}</b>
          </div>
        </div>
        <pre className="mandate-preview-json">{JSON.stringify(mandate, null, 2)}</pre>
      </aside>
    </section>
  )
}

function FollowPage({ strategy, account, onRefresh, isLoading }: { strategy?: StrategyView; account?: Address; onRefresh: () => void; isLoading: boolean }) {
  const [capital, setCapital] = useState(500)
  const [maxLoss, setMaxLoss] = useState(5)
  const [mode, setMode] = useState<'manual' | 'assisted' | 'auto'>('assisted')
  const [stakeAmount, setStakeAmount] = useState(100)
  const [actionMessage, setActionMessage] = useState('')
  const suggestedWeight = strategy ? Math.round((capital * strategy.risk.copyWeight) / 100) : 0

  async function runAction(action: () => Promise<unknown>, label: string) {
    try {
      setActionMessage(`${label} submitted...`)
      const result = await action()
      setActionMessage(typeof result === 'string' ? `${label}: ${result}` : `${label} submitted on Arc.`)
      onRefresh()
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : `${label} failed`)
    }
  }

  return (
    <section className="follow-layout">
      <section className="panel follow-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Follower setup</span>
            <h2>Copy with hard limits</h2>
          </div>
          <SlidersHorizontal size={20} />
        </div>
        {isLoading ? (
          <LoadingPanel title="Loading follower setup" detail="Preparing live mandate and copy limits." />
        ) : (
          <>
        <label>
          <span>Capital cap</span>
          <input value={capital} min={100} max={10000} step={50} type="range" onChange={(event) => setCapital(Number(event.target.value))} />
          <strong>{capital.toLocaleString()} USDC</strong>
        </label>
        <label>
          <span>Max daily loss</span>
          <input value={maxLoss} min={1} max={12} step={1} type="range" onChange={(event) => setMaxLoss(Number(event.target.value))} />
          <strong>{maxLoss}%</strong>
        </label>
        <div className="segmented" aria-label="Copy mode">
          {(['manual', 'assisted', 'auto'] as const).map((item) => (
            <button className={mode === item ? 'active' : ''} key={item} type="button" onClick={() => setMode(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="copy-ticket">
          <ClipboardCheck size={19} />
          <div>
            <b>{strategy ? `${suggestedWeight.toLocaleString()} USDC live suggested allocation` : 'No live allocation yet'}</b>
            <span>
              {strategy?.mandate
                ? `${strategy.mandate.maxLeverage}x mandate cap, ${maxLoss}% follower stop, ${strategy.mandate.markets.slice(0, 2).join(' / ')}`
                : 'A live mandate is required before copy rules can execute.'}
            </span>
          </div>
        </div>
        <div className="action-grid">
          <button
            type="button"
            disabled={!strategy || !account}
            onClick={() => strategy && account && runAction(() => subscribeFollower(account, strategy.id, BigInt(Math.max(strategy.risk.copyWeight, 1))), 'Subscribe')}
          >
            <ClipboardCheck size={16} />
            Subscribe on Arc
          </button>
          <button type="button" disabled={!strategy || !account} onClick={() => strategy && account && runAction(() => claimCompensation(account, strategy.id), 'Claim')}>
            <CircleDollarSign size={16} />
            Claim compensation
          </button>
        </div>
        <label>
          <span>Leader bond stake amount</span>
          <input value={stakeAmount} min={1} max={10000} step={1} type="number" onChange={(event) => setStakeAmount(Number(event.target.value))} />
        </label>
        <button
          className="wide-action"
          type="button"
          disabled={!strategy || !account}
          onClick={() => strategy && account && runAction(() => stakeBond(account, strategy.id, stakeAmount), 'Stake bond')}
        >
          <ShieldCheck size={16} />
          Approve USDC and stake bond
        </button>
        {actionMessage && <p className="action-message">{actionMessage}</p>}
          </>
        )}
      </section>
      {isLoading ? (
        <section className="panel portfolio-panel">
          <LoadingPanel title="Loading copy engine" />
        </section>
      ) : (
        <CopyEngine strategy={strategy} />
      )}
    </section>
  )
}

function CopyEngine({ strategy }: { strategy?: StrategyView }) {
  const checks = strategy
    ? [
        ['Mandate loaded', Boolean(strategy.mandate)],
        ['Bond staked', strategy.bondUsdc > 0],
        ['No slash-pending breach', strategy.risk.status !== 'slash_pending'],
        ['Hyperliquid source healthy', !strategy.hyperliquid?.sourceError],
        ['Polymarket source healthy', !strategy.polymarket?.sourceError],
      ]
    : []

  return (
    <section className="panel portfolio-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Copy engine</span>
          <h2>Live execution guardrails</h2>
        </div>
        <Gauge size={20} />
      </div>
      {strategy ? (
        <>
          <div className="portfolio-grid">
            <Metric label="Selected strategy" value={strategy.id.toString()} />
            <Metric label="Followers" value={strategy.followerCount.toString()} />
            <Metric label="Total follower weight" value={strategy.totalFollowerWeight.toString()} />
            <Metric label="Total slashed pool" value={`${Number(formatUnits(strategy.totalClaimable, 6)).toLocaleString()} USDC`} />
          </div>
          <div className="rejection-log">
            {checks.map(([label, ok]) => (
              <div className={ok ? 'pass' : undefined} key={label as string}>
                {ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                {label as string}
              </div>
            ))}
          </div>
        </>
      ) : (
        <EmptyState title="No live strategy selected" detail="The copy engine will not show fabricated positions; it waits for contract and market data." />
      )}
    </section>
  )
}

function MandateBlock({ strategy }: { strategy?: StrategyView }) {
  return (
    <section className="panel mandate-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Machine-readable mandate</span>
          <h2>Contract terms followers can verify</h2>
        </div>
        <LockKeyhole size={20} />
      </div>
      {strategy?.mandate ? (
        <pre>{JSON.stringify(strategy.mandate, null, 2)}</pre>
      ) : (
        <EmptyState title="No mandate JSON loaded" detail="Create a strategy with an HTTPS, IPFS, or data:application/json mandateURI." />
      )}
    </section>
  )
}

function ArcFlow() {
  return (
    <section className="panel flow-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Settlement primitive</span>
          <h2>Arc USDC accountability flow</h2>
        </div>
        <Landmark size={20} />
      </div>
      <div className="flow-steps">
        {[
          ['Stake', 'Leader posts USDC performance bond', Wallet],
          ['Subscribe', 'Follower joins with risk caps', ClipboardCheck],
          ['Attest', 'Agent records structured evidence', Database],
          ['Slash', 'Contract releases bond to followers', CircleDollarSign],
        ].map(([title, detail, Icon]) => (
          <div className="flow-step" key={title as string}>
            <Icon size={18} />
            <b>{title as string}</b>
            <span>{detail as string}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function AttestationsPage({ attestations, isLoading }: { attestations: AttestationView[]; isLoading: boolean }) {
  return (
    <section className="panel attest-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Agent attestations</span>
          <h2>Objective triggers first, AI evidence second</h2>
        </div>
        <Sparkles size={20} />
      </div>
      {isLoading ? (
        <LoadingPanel title="Loading attestations" detail="Reading risk-agent evidence recorded on Arc." />
      ) : attestations.length ? (
        <div className="attestation-list">
          {attestations.map((item) => (
            <article className={`attestation ${item.slashPercent ? 'violation' : 'success'}`} key={`${item.strategyId.toString()}-${item.createdAt.toISOString()}`}>
              <div className="attestation-icon">{item.slashPercent ? <PauseCircle size={18} /> : <CheckCircle2 size={18} />}</div>
              <div>
                <div className="row-title">
                  <strong>Strategy {item.strategyId.toString()}</strong>
                  <span>{item.createdAt.toLocaleString()}</span>
                </div>
                <p>{item.condition}</p>
                <span>{item.evidenceURI}</span>
              </div>
              <b>{item.slashPercent ? `${item.slashPercent}% slash` : 'No slash'}</b>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No attestations on Arc yet" detail="Run the risk agent script with a deployed contract to record real evidence." />
      )}
    </section>
  )
}

function TransactionsPage({ transactions, isLoading }: { transactions: ArcTransactionView[]; isLoading: boolean }) {
  return (
    <section className="panel transaction-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Arc transaction tape</span>
          <h2>Live bond, slash, payout evidence</h2>
        </div>
        <Activity size={20} />
      </div>
      {isLoading ? (
        <LoadingPanel title="Loading Arc transaction tape" detail="Fetching strategy, bond, subscription, slash, and claim events." />
      ) : transactions.length ? (
        <div className="tx-list">
          {transactions.map((tx) => (
            <div className="tx-row" key={`${tx.hash}-${tx.type}-${tx.blockNumber.toString()}`}>
              <span className={`tx-type ${tx.type}`}>{tx.type}</span>
              <div>
                <b>{tx.hash}</b>
                <p>{tx.detail}</p>
              </div>
              <strong>{tx.amount}</strong>
              <span className="tx-status">block {tx.blockNumber.toString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No Arc events found" detail="Deploy the contract, set VITE_BONDMIRROR_FROM_BLOCK, then stake/subscribe/attest/slash to populate this tape." />
      )}
    </section>
  )
}

function NotFoundPage() {
  return (
    <section className="not-found">
      <div>
        <span className="eyebrow">404</span>
        <h1>Route not found</h1>
        <p>This page does not exist in BondMirror. Jump back to the live app or the landing page.</p>
        <div className="hero-actions">
          <Link className="primary-action" to="/app">
            <ArrowRight size={18} />
            Open App
          </Link>
          <Link className="secondary-action" to="/">
            Home
          </Link>
        </div>
      </div>
    </section>
  )
}

function App() {
  const live = useBondMirrorState()
  const { wallet, connect, disconnect } = useWalletSession()
  const [selectedId, setSelectedId] = useState<string>()
  const data = live.data
  const strategies = data?.strategies ?? []
  const selectedStrategy = strategies.find((strategy) => strategy.id.toString() === selectedId) ?? strategies[0]
  const isInitialLoading = live.status === 'loading' && !data

  return (
    <Shell wallet={wallet} connectWallet={() => void connect()} disconnectWallet={disconnect}>
      <Routes>
        <Route path="/" element={<LandingPage wallet={wallet} />} />
        <Route
          path="/app"
          element={
            <AppLayout live={live}>
              <DashboardPage strategies={strategies} transactions={data?.transactions ?? []} selectedStrategy={selectedStrategy} isLoading={isInitialLoading} />
            </AppLayout>
          }
        />
        <Route
          path="/app/leaders"
          element={
            <AppLayout live={live}>
              <LeadersPage strategies={strategies} selectedStrategy={selectedStrategy} setSelectedId={setSelectedId} isLoading={isInitialLoading} />
            </AppLayout>
          }
        />
        <Route
          path="/app/publish"
          element={
            <AppLayout live={live}>
              <PublishLeaderPage account={wallet.address} onRefresh={live.refresh} />
            </AppLayout>
          }
        />
        <Route
          path="/app/follow"
          element={
            <AppLayout live={live}>
              <FollowPage strategy={selectedStrategy} account={wallet.address} onRefresh={live.refresh} isLoading={isInitialLoading} />
            </AppLayout>
          }
        />
        <Route
          path="/app/attestations"
          element={
            <AppLayout live={live}>
              <AttestationsPage attestations={data?.attestations ?? []} isLoading={isInitialLoading} />
            </AppLayout>
          }
        />
        <Route
          path="/app/transactions"
          element={
            <AppLayout live={live}>
              <TransactionsPage transactions={data?.transactions ?? []} isLoading={isInitialLoading} />
            </AppLayout>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Shell>
  )
}

export default App
