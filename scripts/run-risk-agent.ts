import { runRiskAgent } from '../api/cron/risk-agent.js'

console.log(`[${new Date().toISOString()}] BondMirror risk agent starting`)

try {
  const result = await runRiskAgent()
  console.log(`[${new Date().toISOString()}] Done — scanned ${result.scannedStrategies} strategies`)
  for (const s of result.processed) {
    console.log(`  Strategy ${s.contractStrategyId}: score=${s.riskScore} status=${s.status} violations=${JSON.stringify(s.violations)}`)
  }
  process.exit(0)
} catch (error) {
  console.error(`[${new Date().toISOString()}] Risk agent failed:`, error)
  process.exit(1)
}
