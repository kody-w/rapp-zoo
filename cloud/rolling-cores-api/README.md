# Rolling Cores OpenAI-compatible gateway

This Python v2 Azure Functions app hosts two separate services:

- the optional Wild-mode OpenAI-compatible model gateway; and
- the authoritative, purchase-backed Rapter Credit registry.

It does not store organisms or replace signed local Rolling Core Capsules.
Cloud computation and credit-backed download authorization remain separate from
local capsule ownership.

## API

- `GET /health` is anonymous and reports configuration-only liveness.
- `GET /v1/models` and `POST /v1/chat/completions` require matching
  function-scoped private-test key values and return OpenAI-compatible shapes.

The gateway accepts no upstream URL. It pins every request to the configured
Azure AI deployment, rejects unknown request fields, limits request/message
sizes, disables streaming, and caps output tokens. Prompt and body content are
never intentionally logged.

## Official Rapter Credits

A successfully verified purchase is the only issuance event. A client cannot
declare that payment succeeded, choose a payment reference, choose a price, or
request an unsigned official record.

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/credit-registry/quote?set_id=...` | Public | Quote current official issuer birth values from the active signed schedule and fresh BTC/USD evidence. |
| `GET` | `/v1/credit-registry/issuer` | Public | Publish the current ES256 issuer JWK; `key_id` can select an older version. |
| `GET` | `/v1/credit-registry/schedules` | Public | Mirror signed schedules in publication order, or select the current schedule with `set_id`. |
| `GET` | `/v1/credit-registry/credits` | Public | Read/mirror signed records in issuance order using `after` and `limit`. |
| `GET` | `/v1/credit-registry/lookup` | Public | Look up by `credit_id` or `organism_rappid`. |
| `POST` | `/v1/credit-registry/verify` | Public | Verify a complete signed record against its Key Vault key version. |
| `POST` | `/v1/issuer/valuation-schedules` | Function | Append and activate an issuer-controlled set/tier valuation schedule. |
| `POST` | `/v1/purchases/redeem` | Function | Verify a receipt through a server adapter and atomically issue one credit. |
| `POST` | `/v1/capsules/authorize-download` | Function | Issue a five-minute signed authorization for the bound local capsule. |
| `GET` | `/v1/breathing/status` | Function | Report Wild breath eligibility and hard ceilings without exposing a token or balance. |
| `POST` | `/v1/breathing/start` | Function | Request an explicitly acknowledged, bounded Wild breathing lease. |
| `POST` | `/v1/breathing/pause` | Function | Explicitly stop Wild breathing while preserving the last core. |
| `GET` | `/v1/credit-registry/lifecycle/status` | Public | Report return-window rules, adapter readiness, and no-guarantee policy. |
| `GET` | `/v1/credit-registry/ownership?credit_id=...` | Public | Read the current official owner hash, state, and transfer head. |
| `GET` | `/v1/credit-registry/lifecycle?credit_id=...` | Public | Mirror signed lifecycle `body.pulse` events in sequence order. |
| `POST` | `/v1/credits/return` | Function | Verify owner/refund eligibility and atomically return ownership to inventory. |
| `POST` | `/v1/resale/listings` | Function | Append a post-window resale listing with a separate ask price. |
| `POST` | `/v1/resale/listings/cancel` | Function | Cancel the current owner's active listing. |
| `POST` | `/v1/resale/sales` | Function | Verify settlement and atomically append sale plus ownership-transfer events. |
| `GET` | `/v1/artifacts/status` | Public | Report delivery limits and entitlement-adapter readiness. |
| `POST` | `/v1/artifacts/release-key` | Function + scoped token | Validate entitlement, manifest, ciphertext, recipient, expiry, and replay before releasing a recipient-wrapped DEK. |

Every server-side `rappter-credit-registry-entry/1` binds:

```text
hashed verified payment reference
  -> deterministic credit_id
  -> organism_rappid
  -> genesis_core_id
  -> core_manifest_hash
```

It also records a monotonic issuance index, immutable issuance cap, product ID,
set, tier, exact BTC fraction, fixed integer sat price, conception time, BTC/USD
quote evidence, birth value in integer USD micros, optional verified Bitcoin
outpoint, active status, issuer, Key Vault key version, and ES256 signature.
The registry signature is official validity; a Bitcoin outpoint is settlement
evidence only.

This service record is the persistence/API envelope. The canonical portable
RAPP carrier remains `rapp-rapter-credit/1` in
[`RAPTER_CREDIT_PROTOCOL.md`](../../RAPTER_CREDIT_PROTOCOL.md); integration must
project and validate that strict payload before publishing a capsule sidecar.

### Signed valuation schedules

Rapterbox publishes append-only `rappter-valuation-schedule/1` records per set.
Each schedule contains all six tiers (`common`, `uncommon`, `rare`, `holo`,
`ultra`, `secret`) as reduced rational fractions of one BTC, a sequence number,
the previous schedule hash, a content hash, and an ES256 issuer signature.

At conception the backend reads the current signed schedule, verifies it, and
fetches BTC/USD from Coinbase's public spot endpoint with Kraken's public ticker
as fallback. It records source, observation time, SHA-256 of the raw response,
and integer `btc_usd_micros`. Quotes older than the configured freshness window
or unavailable from both providers are refused.

All valuation arithmetic is integer-only:

```text
price_sats = ceil(100_000_000 * numerator / denominator)
birth_value_usd_micros =
  round_half_up(price_sats * btc_usd_micros / 100_000_000)
```

This is the **official issuer value** fixed at birth, not an independent
investment appraisal or promise of returns. Later BTC prices and schedule heads
never rewrite the signed birth valuation. Resale is a separate future
transfer/settlement event.

Azure Table Storage uses one `official` partition. Issuance is one transactional
batch containing an ETag-protected counter update plus credit, organism lookup,
hashed-payment lookup, issuance-index, and active-schedule guard rows. Purchase
and quote verification happen before this batch; any failure writes nothing.
Create-only rows enforce unique payments, unique credit IDs, and one active
official credit per organism. Schedule publication is a separate ETag-protected
batch containing its append-only record, global index, and current-set pointer.
No raw receipt, payment reference, quote body, or credential is persisted or
intentionally logged.

### Return and resale lifecycle

The return window is inclusive through 30 days after the signed original
purchase time. Return requires a scoped current-owner claim, a still-valid
original issuance, no prior listing or transfer event, and a successful
idempotent refund adapter for the original rail. Bitcoin defaults to refunding
the recorded `price_sats`; `BITCOIN_REFUND_FEE_SATS` is the only explicit fee
override. App Store and Play Store adapters must use the applicable store APIs
and policy rather than client-declared success. Refund adapter idempotency is
keyed from the original signed payment-reference hash, not a client operation.

The Table transaction updates the ETag-protected ownership head and creates the
signed return event, lifecycle index, operation-idempotency row, unique refund
row, and Rapterbox inventory row together. The
`rapp-rapter-credit-return/1` `body.pulse` links the original issuance, current
transfer head, hashed refund reference, prior owner, and inventory owner.

After return, local bytes remain a verifiable `unowned-verifiable-copy`; the
registry reports that they are no longer officially owned. After the return
window, signed listing, cancellation, verified sale, and transfer pulses form a
linear ownership history. Birth valuation is immutable. Ask and sale satoshi
amounts are separate market facts with no appreciation or liquidity guarantee.

## Authentication boundaries

Production upstream authentication uses the Function App's system-assigned
managed identity and the `Cognitive Services OpenAI User` role at the existing
AI account scope. There is no Azure OpenAI key in app settings.
`DefaultAzureCredential` is used only outside Azure for local development.

The same managed identity has `Storage Table Data Contributor` on the Function
storage account and `Key Vault Crypto User` on the signing vault. The issuer
uses a versioned P-256 Key Vault key for ES256 signatures; no private key is
exported. If signing is unavailable, issuance and capsule authorization fail
closed and no unsigned official record is written.

The `private-test` Azure Functions key is only a temporary private gateway
credential. Released mobile clients must use a future short-lived token scoped
to user, device, organism, and operation; never ship a Function master or
function key in Expo, EAS, source, or application logs.

Wild breathing fails closed until three server-side adapters exist: scoped
Rapterbox token verification, prepaid-compute reservation/debit, and a bounded
worker scheduler. The deployed ceilings are a five-minute minimum interval,
12 ticks per lease, 512 output tokens per tick, 6,144 total output tokens, and a
24-hour maximum lease. A start request must acknowledge metered compute and
cannot exceed any ceiling. Explicit pause remains safe when a token is expired
or revoked. Tokens, provider credentials, receipts, and balances are never
logged.


## Test and deploy

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
./scripts/provision.sh
./scripts/deploy.sh
./scripts/smoke-private.sh
```

Defaults target subscription
`3d0e6986-1b31-4189-a394-b3289d54efb0`, resource group `rappter_ai`,
the existing `rappter` account, and deployment `gpt-5.4`. Override resource
names through the environment variables declared at the top of each script.
The smoke script never prints the key: it stores it in macOS Keychain and writes
only non-secret provider metadata to `~/.rapp/config/openai-providers.json`.
The provisioner uses the lowest-cost practical Linux Consumption plan. Flex
Consumption can be substituted when its One Deploy path is available in the
target subscription and CLI.

## Purchase verifier owner actions

`PURCHASE_VERIFIER_MODE` is deployed as `disabled`, `CREDIT_PRODUCTS_JSON` is
`{}`, and no valuation schedule has been published. This intentionally prevents
issuance until an owner:

1. implements and selects the RevenueCat, App Store, or Bitcoin verification
   adapter in `credits/purchases.py`;
2. stores any verifier credential in Key Vault and grants the Function managed
   identity access, rather than placing it in source or a mobile build;
3. configures products as `{"rapter_hatch_1":{"credits":1}}`;
4. chooses the exact reduced BTC fractions for every tier and publishes the
   first schedule through the authenticated issuer endpoint;
5. confirms `CREDIT_ISSUANCE_CAP` before the first issuance (the Table counter
   keeps that initial cap immutable); and
6. replaces private Function-key testing with short-lived user/device/organism
   authorization, quota, revocation, and receipt-replay policy.

Until those actions are complete, public registry verification works, but
receipt redemption cannot create an official credit.

Return and resale writes also remain disabled until an official-owner token
verifier, App Store/Play/Bitcoin refund adapters, and a resale-settlement
verifier are implemented. All adapter references are hashed before persistence.

## Restricted global artifact delivery

GitHub raw may host only public ciphertext and a signed, content-addressed
`rappter-encrypted-artifact-manifest/1`. Both manifest and ciphertext URLs must
use `raw.githubusercontent.com` with a full commit SHA; branch names, redirects,
query-string passwords, and client-embedded master keys are refused.

Each artifact uses a random 256-bit AES-GCM data-encryption key and 96-bit nonce.
The DEK is wrapped by the versioned Key Vault RSA key
`artifact-dek-wrapping-v1` using RSA-OAEP-256. The public manifest contains only
the ciphertext hash/size/URL, nonce, wrapped DEK, AAD, wrapping-key version, and
issuer signature.

`POST /v1/artifacts/release-key` requires a server-verified token scoped to the
artifact and device recipient-key thumbprint. The Function verifies token
expiry/revocation, exact manifest bytes, issuer signature, pinned ciphertext
bytes, and recipient binding before unwrapping the DEK with managed identity.
It returns only a new RSA-OAEP-256 envelope for that recipient. One-time token
IDs are hashed into Table Storage to reject replay.

Create publishable files after the ciphertext has a commit-pinned destination:

```bash
export ARTIFACT_KEY_VAULT_URL=https://rappter-credit-3d0e6986.vault.azure.net
export ARTIFACT_WRAPPING_KEY_NAME=artifact-dek-wrapping-v1
.venv/bin/python ./scripts/package-artifact.py \
  --input ./capsule.rapp \
  --ciphertext-output ./public/rapter.ciphertext \
  --manifest-output ./public/rapter.manifest.json \
  --ciphertext-url https://raw.githubusercontent.com/OWNER/REPO/FULL_COMMIT_SHA/public/rapter.ciphertext \
  --logical-name rapter.rapp \
  --content-type application/vnd.rapterbox.capsule
```

The entitlement verifier is deployed disabled until a scoped device-token
issuer is configured. Revocation prevents future DEK releases. It cannot erase
or claw back plaintext that an authorized recipient previously decrypted.
Bytecode obfuscation and passwords embedded in URLs or clients are never
treated as access control.

## Cost controls and next ledger boundary

Current controls are a fixed model allowlist, 64 KiB body limit, bounded message
count and length, a 256-token output ceiling, explicit upstream timeouts, and no
arbitrary upstream routing. Before public Wild mode, place scoped-token
validation ahead of the function key and atomically reserve prepaid compute
credits before inference. Finalize the debit from provider usage, release the
reservation on failure, enforce per-user/device/organism rate limits and
revocation, and retain only non-prompt audit fields. Immutable cached results
should be keyed by content address so playback never incurs inference spend.
