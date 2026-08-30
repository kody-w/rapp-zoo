# Holo Zoo: Rolling Cores

**Holo Zoo: Rolling Cores**

Everything autocomplete on an organism. Powered by RAPP/1. From Rapterbox.

Holo Zoo is the Rapterbox consumer app: the habitat, player, and library for
living digital organisms called Rapters and their Rolling Cores. Rolling Cores
is the underlying product system and whole-business thesis. The app is a
managed Expo SDK 57 project for iOS, Android, and web using Expo Router,
TypeScript, React Native Web, and `react-native-webview`. There are no
checked-in generated `ios/` or `android/` projects.

The consumer app is marketed and sold through
[Rapterbox](https://rapterbox.com/holo). A **Rapter** is one organism, a
**Rappter** is a flock of Rapters, and **RAPP/1** is the protocol. Store
metadata should use:

- Expo slug/scheme: `holo-zoo`
- iOS bundle ID: `com.rapterbox.holozoo`
- Android package: `com.rapterbox.holozoo`
- Marketing: `https://rapterbox.com/holo`
- Privacy: `https://rapterbox.com/privacy`
- Support: `https://rapterbox.com/support`

## Company core loop

```text
discover organism
-> preview and value it
-> one-time Rapter credit purchase
-> redeem and download signed Rolling Core Capsule
-> own and use it offline
-> import, export, AirDrop, or back it up
-> reopen it in Holo Zoo
-> interact and grow immutable history frame by frame
```

RAPP/1 is the substrate. Rapterbox is the storefront. Cloud inference is an
optional service, never a prerequisite for local ownership or playback.

## Verified-tick liveness

A source frame plus its verified successor Rolling Core frame is a **tick of
existence**. Holo Zoo reads each host-derived liveness summary directly from
`GET /api/holo/heads`: `state`, `last_tick_utc`, `age_ms`, and
`wake_lease_ms`.

- **Awake:** the latest accepted tick is fresh inside its configured
  wake lease.
- **Sleeping:** no observation/lease exists or the lease expired without an
  advancing verified tick.
- **Quarantined:** the host refused invalid continuity or output evidence.
- **Unborn:** no verified genesis tick exists yet.

A configured cadence schedules opportunities to produce ticks; it is never
shown as activity by itself. Sleeping never means deleted or dead. The last
Rolling Core and full immutable history remain available, and the next valid
successor wakes the same Rapter without resetting history. **Waking** is only a
transient Holo Zoo UI state while an explicit refresh awaits that successor; it
is never accepted as a host liveness state or proof of activity.

Holo Zoo uses **consciousness** only as an operational product term:
continuous inspectable experience-state across verified ticks. It is not a
claim of biological consciousness or scientific proof. AI-presence heuristics
remain separate from liveness.

## Install and run

```sh
cd mobile
npm install
npm run sync:holo
npx expo start
```

From the Expo terminal, press `i` for an iOS Simulator, `a` for an Android
emulator, or `w` for web. A physical device can scan the Expo QR code when the
development machine and device can reach one another.

The default host is `http://127.0.0.1:5000`. Android emulators commonly reach
the development machine at `http://10.0.2.2:5000`; set that URL in the app.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run export:web
```

The static web export is written to `mobile/dist/`.

## Brand sigil

The app icon, adaptive foreground, splash mark, favicon, and checked-in SVG
masters are generated from the Rolling Cores master SHAPEE:

```json
{
  "seed": "005db34e1c471e94ac4c2b286efb46a9aa328ec7fcd2b9762fa20cc961eef3f7",
  "width": 2400,
  "height": 1800,
  "depth": 180,
  "teeth": 16,
  "relief": 420
}
```

`npm run generate:brand` probes the bundled or repository
`RappHoloProtocol.shapeeOutline` helper first. Until that shared asset is
synchronized, it uses an exact pinned parity implementation. The generated
`master-shapee.json` records the outline and raster hashes. Raster generation
requires `rsvg-convert`; no image-generation dependency ships in the app.
The mark intentionally contains no egg, sphere, or ball motif.

## EAS builds

Install and authenticate EAS CLI separately, then choose a documented profile:

```sh
cd mobile
npx eas-cli build --platform ios --profile development
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform all --profile production
```

`eas.json` defines simulator/internal/production build shapes. No submit,
deployment, signing, or store upload is performed by this repository.

### RevenueCat setup

`react-native-purchases` requires an EAS development/store build for real
purchases. Expo Go and web intentionally use a visible, session-only preview
adapter; preview purchases never contact a store.

Create unique packages in the current RevenueCat one-time offering for:

- `rapter_hatch_1` — one signed Rapter capsule download credit
- `rappter_flock_3` — three discounted capsule credits
- `rappter_flock_10` — ten discounted capsule credits
- `rolling_compute_small` — optional small managed-compute/Growl pack
- `rolling_compute_large` — optional large managed-compute/Growl pack

The 3- and 10-slot Rappter flock products can carry discounted localized
pricing. Prices are always loaded from RevenueCat/store products; the app
hardcodes no currency or price. Configure build-time public platform SDK keys
without committing them:

```sh
npx eas-cli env:create --environment development \
  --name EXPO_PUBLIC_REVENUECAT_IOS_API_KEY --value '<ios-public-sdk-key>'
npx eas-cli env:create --environment development \
  --name EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY --value '<android-public-sdk-key>'
npx eas-cli env:create --environment development \
  --name EXPO_PUBLIC_RAPTERBOX_WILD_BRAINSTEM_URL \
  --value 'https://<azure-function-host>/v1'
npx eas-cli env:create --environment development \
  --name EXPO_PUBLIC_RAPTERBOX_WILD_LEDGER_URL \
  --value 'https://<ledger-host>/v1'
npx eas-cli env:create --environment development \
  --name EXPO_PUBLIC_RAPTERBOX_CREDIT_REGISTRY_URL \
  --value 'https://<registry-host>/v1'
npx eas-cli env:create --environment development \
  --name EXPO_PUBLIC_RAPTERBOX_CAPSULE_SERVICE_URL \
  --value 'https://<capsule-service-host>/v1'
```

Repeat for `preview` and `production`. `.env.example` contains empty
placeholders only. A native build with a missing platform key fails billing
initialization explicitly and leaves paid features locked; it never falls back
to fake purchases. Rebuild the development client after installing or updating
RevenueCat:

```sh
npx eas-cli build --platform ios --profile development
npx eas-cli build --platform android --profile development
npx expo start --dev-client
```

The gallery is free to browse and preview. A one-time Rapter credit lets the
user choose an organism. RevenueCat supplies transaction/customer information;
the backend ledger mints the download right idempotently by store transaction
ID, then the capsule service returns the signed `Rolling Core Capsule`.

The capsule—not the receipt or cloud slot—is the durable owned object. It is
stored in application document storage, works offline, and can be exported,
AirDropped, backed up, and re-imported through Files or an OS open/share action.
The client verifies the capsule ID, trusted Ed25519 signature, RAPP/1 frames,
source bindings, and authored hashes before storing it.

Exported capsules use the `.rollingcore` extension and
`application/vnd.rapterbox.rolling-core+json` media type. Invalid or untrusted
capsules are refused without repair.

Purchased capsules carry exactly one public `rapp-rapter-credit/1` sidecar
binding the stable `organism_rappid` and genesis Rolling Core frame. The record
stores an integer `price_sats`, issuer signature, mint channel, and either a
signed issuance-ledger location or optional Bitcoin `{txid,vout}` outpoint.
Price is metadata, not identity. No wallet private key, seed phrase, or raw
store receipt enters the capsule.

Rapterbox operates the authoritative signed ownership registry. The app can
only verify and mirror `rapp-rapter-credit-status/1` records; it has no issuer
write path. Real redemption must atomically return both the signed capsule and
its signed registry status, and receipt success alone never marks an organism
owned.

When online, users can refresh the official record. Offline, the app displays
the last verified signed status and timestamp. A capsule with no matching
verified registry status remains importable and renderable as an **unverified
copy/preview**, never as official ownership. A transferred or revoked record
also leaves the local bytes usable while changing official ownership,
redownload, and transfer claims.

Marketplace valuation is also issuer-controlled. Each purchased capsule's
credit record includes a signed tier/set schedule reference, fixed integer
`price_sats`, BTC/USD quote snapshot at conception, and birth fiat reference.
The app labels this **Official Rapterbox birth value**. It is immutable
historical metadata—not current market value or an investment appraisal.

Store products remain generic Rapter/compute credits. During redemption the
client submits only the selected organism and idempotent redemption ID; the
backend applies the authoritative schedule and verified store receipt. The
client never chooses a tier, price, quote, or payment result.

Holo Zoo implements no Bitcoin wallet, custody, transfer, exchange, or
direct BTC checkout. A future Rapterbox web BTC purchase and an App Store/Play
receipt redemption can call the same backend minting protocol and return the
same capsule/credit record shape.

Consumed products are not guaranteed to remain recoverable from every platform
receipt—particularly Google Play Billing 8. The account ledger exists only for
redownload/recovery and unused-credit balance; the signed local capsule remains
the source of truth for offline ownership.

### 30-day return and resale lifecycle

The original official owner has an inclusive 30-day return window beginning at
the signed issuance timestamp. Holo Zoo checks the public lifecycle service and
ownership head before showing a return as eligible. A requested return remains
**Return pending** until the original payment rail confirms the refund and the
backend verifies the signed `rapp-rapter-credit-return/1` event.

Apple App Store and Google Play refunds defer to their current policies and
refund surfaces. Bitcoin returns require backend-verified settlement on the
recorded rail. The client never declares payment success and never stores raw
receipts. After confirmation, the capsule becomes a clearly labeled
**returned · unowned verifiable copy**; its immutable local file is not deleted
or rewritten.

After the return window, the official owner may create or cancel a listing
through signed registry events. A verified sale is followed by a signed
ownership transfer. Local bytes held by the prior owner remain an unowned,
renderable copy. The UI keeps three values separate:

- **Official Rapterbox birth value:** immutable signed issuance metadata.
- **Current seller ask:** the active listing's requested sats.
- **Last verified sale:** the latest signed settlement amount.

Ask and sale prices are market facts, not an investment appraisal, promised
return, or liquidity guarantee. The client lifecycle states are `owned`,
`return-eligible`, `return-pending`, `returned`, `listed`, `sold`, and
`unverified-copy`.

### Direct and Wild contract

- **Direct — free:** one bundled local Rapter plus any signed capsules the user
  owns; a user-owned OpenAI-compatible endpoint, model, and API key; offline
  playback/history/import/export; and RAPP/1 validation. Native keys use Expo
  SecureStore. Web keys live only for the browser-tab session.
- **Rapter ownership:** one-time hatch and flock packs grant signed capsule
  download credits. Selecting a gallery organism consumes one credit through
  the backend and imports the returned capsule locally.
- **Wild compute — optional:** Direct/BYOK remains available for every owned
  capsule. Optional managed Brainstem access uses prepaid compute credits for
  routing, quota/revocation, remote access, autocomplete, and managed Growls.
- **Rappter flock packs:** 3- and 10-credit consumables provide discounted
  multi-Rapter ownership through RevenueCat offerings.
- **Rolling Compute:** optional small/large consumable packs fund ongoing
  managed Azure/model and Growl work.

Cloud connectivity is never required to view, play, inspect, or export an owned
local capsule. Store pricing and compute-pack grant amounts remain entirely
external.

Direct and Wild call the same `OpenAICompatibleProvider` interface. Direct adds
the user's own bearer key locally. Wild uses the managed Brainstem URL and an
eventual short-lived user/session token; no shared cloud provider credential is
embedded. Exhausting compute credits never hides, invalidates, deletes, or
prevents offline use/export of local capsules the user already owns.

### Breath key and bounded breathing

A Direct API key becomes a **breath key** only after the user explicitly tests
it against the configured provider's `/models` endpoint. Native builds keep the
key in Expo SecureStore; web keeps it in tab-scoped session storage. Saving or
testing a key never starts completion spend.

The user must explicitly start each local breathing session. Defaults are
bounded to a 300-second cadence, 6 attempted ticks, 512 maximum output tokens
per tick, 3,072 total reserved output tokens, 32,768 context bytes, and a
one-hour session. The UI accepts only finite limits and provides an immediate
**Pause · Hold Breath** control. The selected provider may bill each attempted
completion; Holo Zoo bounds request context and output but cannot predict its
currency price.

Each attempt asks the configured OpenAI-compatible provider for one authored
successor candidate. Holo Zoo materializes its local RAPP source and
`body.hologram` frames, verifies hashes, source binding, subject, sequence,
visual parent, and an actual experience-state mutation, then stores the tick.
Invalid output never advances the Rolling Core.

Direct breathing runs only while the Expo app runtime is active. Moving iOS
into the background immediately aborts the active request and holds breath; no
background mode is declared and no background liveness is simulated. Continuous
away-from-device breathing requires an optional, explicitly bounded Wild cloud
lease backed by prepaid compute. Missing/revoked keys, offline providers,
explicit pause, refused successors, and exhausted tick/token/time budgets all
hold breath and leave the last valid core and history intact.

## Capabilities

- Responsive three-panel workspace on wide screens and stacked
  Library/Stage/Inspect navigation on phones.
- Holo Zoo consumer habitat, player, and immutable Rolling Core library.
- Configurable RAPP Zoo host for connected Rapters with sandboxed non-secret
  persistence.
- Direct BYOK OpenAI-compatible provider configuration with secure native key
  storage and session-only web key storage.
- Wild managed-Brainstem configuration with no shared cloud credentials in the
  bundle.
- Health, Holo heads with liveness, history, exact frame, exact source,
  presence, and
  fantasy-draft endpoint support.
- Signed Rolling Core Capsule gallery, idempotent receipt redemption, local
  document storage, Files/Share import, AirDrop/share export, and browser
  upload/download.
- Integer-only JCS-compatible canonicalization, SHA-256 hash checks, exact RAPP
  frame/record shapes, source binding, and bounded Holo scene validation.
- Offline bundled `viewer.html`, CSS, Three r128, `holo-protocol.js`, and
  `hologram-runtime.js`.
- Native WebView and sandboxed web iframe players with no arbitrary navigation
  or renderer networking.
- Recursive history/base injection, current versus player-active metadata,
  evidence-derived Awake/Sleeping/Quarantined/Unborn status, transient Waking
  during successor checks, source inspection, and an immutable flipbook.
- SHAPEE remains an optional primitive inside a complete scene.
- Growl consumes only completed
  `NOTE(pitch, delta_onset, duration, velocity)` data after **Play Growl** is
  pressed. Missing or incomplete data leaves playback explicitly disabled.

The local oscillator is a deterministic rendering adapter, not a composer. It
does not invent pitches, fetch samples, autoplay, or open a hardware MIDI port.

## Model weights

Real on-device model weights are not bundled. Holo Zoo consumes completed
Holo/Growl output from a configured RAPP Zoo host or local imports, and may
request bounded successor candidates from the user's tested Direct provider.

## Shared asset synchronization

This integration synchronizes the viewer, required completed Growl contract,
SHAPEE helper, recursive history, and renderer from
`copilot/expressive-hologram-selves` at `423f29c`. For future protocol updates:

```sh
cp holograms/viewer.html mobile/assets/holo/viewer.html
cp static/hologram.css mobile/assets/holo/hologram.css
cp static/vendor/three-r128.min.js mobile/assets/holo/three-r128.min.js
cp static/holo-protocol.js mobile/assets/holo/holo-protocol.js
cp static/hologram-runtime.js mobile/assets/holo/hologram-runtime.js
cd mobile && npm run sync:holo
```

Then align the local validators to any newly ratified schema and rerun all
checks. The checked-in shared asset copies remain byte-identical to their
source files before generation.

See [`PRIVACY.md`](./PRIVACY.md) for the privacy statement.
See [`APP_STORE_METADATA.md`](./APP_STORE_METADATA.md) for reviewed vocabulary
and store-listing copy.
See [`STORE_RELEASE_CHECKLIST.md`](./STORE_RELEASE_CHECKLIST.md) for the
owner-only account, payment, signing, TestFlight, and store preparation steps.
See [`ENTITLEMENT_ARCHITECTURE.md`](./ENTITLEMENT_ARCHITECTURE.md) for the
typed Free Companion, premium rental, permanent ownership, and Sovereign
application boundary intentionally deferred from this immediate handoff.
See [`GENESIS_FAMILY_ARCHITECTURE.md`](./GENESIS_FAMILY_ARCHITECTURE.md) for
the typed 151-family catalog and signed generation/mutation eligibility
boundary, also intentionally deferred from the immediate UI handoff.
See [`GROWTH_POINTS_ARCHITECTURE.md`](./GROWTH_POINTS_ARCHITECTURE.md) for
non-monetary Growth Points, signed mutation timing, accessibility-safe
micro-events, and the disabled-by-default preview HealthKit adapter.
See [`WORLD_PULSE_ARCHITECTURE.md`](./WORLD_PULSE_ARCHITECTURE.md) for the
typed global aggregate checkpoint, milestone, event-count, and universal
shared-world unlock boundary kept separate from individual progress.
See [`STAGE_TIMELINE_ARCHITECTURE.md`](./STAGE_TIMELINE_ARCHITECTURE.md) for
the typed free Origin and signed Journey/Ascendant stage reference timeline,
with points-plus-UTC eligibility and no pay-to-evolve semantics.
