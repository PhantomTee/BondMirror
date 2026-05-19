$secrets = @{
    BONDMIRROR_CONTRACT_ADDRESS  = "0x5027d79086a32d8462b499fb8e0e4d959497c966"
    SUPABASE_URL                 = "https://zadlmgfxmfxeqjpuwzgv.supabase.co"
    SUPABASE_SERVICE_ROLE_KEY    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphZGxtZ2Z4bWZ4ZXFqcHV3emd2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTA3NDQwMCwiZXhwIjoyMDk0NjUwNDAwfQ.uaG0n_TOo3-qVDKC659zOapJuKFavJfEkcX0EWZbwE8"
    RISK_AGENT_ADDRESS           = "0x8eA4D085C19dEA44C5Ae54022AaBffFcE7Ca93D3"
    RISK_AGENT_PRIVATE_KEY       = "0x86360894348028c1490ba4d7dd0dffbaf0c09cde3307e5cf38ecb00b7aade4d3"
    POLYMARKET_BUILDER_CODE      = "0x252144110aada39bba1fa4e5531f483ab5fb8013501ecbab39547fcc2d16093d"
    CRON_SECRET                  = "41f5d2b7dcd6d660e63000fd68e72d93c0a359effbb21a41d42be446ea9ef5ac"
}

foreach ($name in $secrets.Keys) {
    $value = $secrets[$name].Trim()
    Write-Host "Setting $name ..."
    gh secret set $name --body $value --repo PhantomTee/BondMirror
}

Write-Host ""
Write-Host "All secrets set. Verify at: https://github.com/PhantomTee/BondMirror/settings/secrets/actions"
