$ErrorActionPreference = 'Stop'
$env:DEMO_MODE = 'true'
$env:DATABASE_URL = 'postgresql://koeki:koeki@127.0.0.1:5432/koeki?schema=public'
$env:AUTH_SECRET = 'development-only-secret-at-least-32-characters'
$env:AUTH_URL = 'http://localhost:3000'
$env:AUTH_TRUST_HOST = 'true'
$env:DISCORD_CLIENT_ID = 'development-client'
$env:DISCORD_CLIENT_SECRET = 'development-secret'
$env:DISCORD_GUILD_ID = 'development-guild'
$env:INVITE_TOKEN_PEPPER = 'development-invite-pepper-value'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..\apps\web')
& '.\node_modules\.bin\next.CMD' dev
