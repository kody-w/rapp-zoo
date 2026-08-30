# Deployment evidence

- Verified: 2026-08-30T04:09:23+00:00
- Function app: `rappter-rolling-cores-3d0e6986`
- Endpoint: `https://rappter-rolling-cores-3d0e6986.azurewebsites.net`
- Credit table: `rapprolling3d0e6986` / `RapterCreditRegistry`
- Signing key: `rappter-credit-3d0e6986` / `credit-registry-signing-v1`
- `GET /health`: HTTP 200, status `ok`
- Unauthenticated `GET /v1/models`: HTTP 401 (refused)
- Desktop provider profile test: HTTP 200, configured model available
- Direct breath key: eligible, bounded, and `paused` until explicit opt-in
- Authenticated `POST /v1/chat/completions`: HTTP 200
- Hosting: Linux Consumption (`Y1` Dynamic)
- Public valuation schedules: HTTP 200, 0 published schedules
- Birth valuation quote without a schedule: HTTP 404 (refused)
- Public issuer key: HTTP 200, `ES256` / `P-256`, signing ready
- Public append-only registry: HTTP 200, 0 issued credits
- Unauthenticated purchase redemption: HTTP 401 (refused)
- Unauthenticated capsule authorization: HTTP 401 (refused)
- Unauthenticated valuation publication: HTTP 401 (refused)
- Unauthenticated Wild breathing status: HTTP 401 (refused)
- Wild breath eligibility: HTTP 200, disabled until scoped token + prepaid ledger + worker
- Wild start without scoped token: HTTP 403 (refused)
- Explicit Wild pause: HTTP 200, state `Sleeping`
- Return/resale lifecycle: HTTP 200, 30-day window, immutable birth valuation
- Unauthenticated return/listing: HTTP 401/401 (refused)
- Return/listing without scoped owner token: HTTP 403/403 (refused)
- Artifact delivery policy: HTTP 200, commit pin required, entitlement adapter disabled
- Artifact release without Function/scoped token: HTTP 401/403 (refused)
- Subscription policy: HTTP 200, 151 families (3 free / 148 premium), one free Companion/account, exclusive premium lessee
- Companion claim without Function/account token: HTTP 401/403 (refused)
- Lease Capsule access without Function token: HTTP 401 (refused)
- Client-declared payment success: HTTP 400 (rejected)
- Completion shape: `chat.completion`
- Completion model: `gpt-5.4-2026-03-05`
- Completion finish reason: `stop`
- Sanitized completion content: `OK`
- Keychain service/account: `com.rapterbox.rollingcores.openai-compatible` / `wild-rappter-gpt-5-4`

No credential value is recorded in this file.
