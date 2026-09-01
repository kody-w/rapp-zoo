# Holo Zoo: Rolling Cores

Holo Zoo is the RapterBox habitat, player, library, Field, and local Work
walkthrough for signed Rolling Core organisms.

**App lockup:** Everything autocomplete on an organism.
**Current channel:** adult internal TestFlight
**Current economics:** disabled

The app uses Expo SDK 57, Expo Router, TypeScript, React Native, React Native
Web, and `react-native-webview`. Generated native `ios/` and `android/`
projects are not committed.

## Identity and URLs

- Display name: **Holo Zoo**
- Store title: **Holo Zoo: Rolling Cores**
- Expo owner/project: `wildfeuer05/@wildfeuer05/holo-zoo`
- EAS project ID: `782a464a-a0d8-40e9-93e3-0cec01874101`
- Bundle/package: `com.rapterbox.holozoo`
- Marketing: <https://rapterbox.com/holo/>
- Privacy: <https://rapterbox.com/privacy/>
- Support: <https://rapterbox.com/support/>

A **Rapter** is one organism. A **Rappter** is a flock of Rapters.

## Current product

### Holo Field

The default surface is an offline deterministic radar built from public
organism IDs. It requests no GPS, contacts no map provider, creates no physical
destination, and gives every House the same encounter roster.

### Houses

Overwatch, Scout, Forge, and Sentinel are local perspective choices. The app
stores only a lowercase House code. House never changes price, rank, power,
encounter odds, companion capability, Growth, World Pulse, or economic weight.

### Companion

Companion mode provides local meeting, Holo/Growl playback, history, evidence,
and owned/imported capsule access. It contains no market, fee, job, treasury,
tip, sponsorship, Coin, or sales action.

### Work walkthrough

The current `local-work-preview/1` flow is a deterministic, non-executing
walkthrough of a possible proof-first work interface:

```text
sample request
-> sample status
-> sample proof
-> sample delivery
```

The user can advance the explanatory screens but cannot transact. The preview
creates no official job, work, proof, artifact, delivery, payment, review,
public frame, or Coin record.

The public work boundary is documented in [`../RAPTERWORKS.md`](../RAPTERWORKS.md).

## Release freeze

`src/release-policy.ts` is the tracked runtime authority for this build. It
fails closed for:

- real commerce and RevenueCat initialization;
- production RapterWorks;
- tips, sponsorship, rentals, resale, and managed-compute sales;
- Coin economics;
- public sharing;
- external interoperability; and
- irreversible protocol writes.

OTA updates are disabled. The audience is adult internal testers only.

`npm run release:gate` checks the app projection and source bindings, then
mutates protected values to prove the gate actually fails.

## Local data and provider keys

The app may store the House code, configured RAPP Zoo URL, imported or bundled
capsules, Holo history, local evidence, provider endpoint/model, bounded-update
limits, and app preferences.

Native Direct provider keys use Expo SecureStore with this-device-only
accessibility. A separate app-sandbox marker scopes the key to the current
installation. When that marker is absent or stale, Holo Zoo clears any
residual Keychain/Keystore value before loading settings. If secure deletion
or settings load fails, Direct updates remain disabled and the error is shown.

Testing a key calls only the selected provider's `/models` endpoint. A bounded
update starts only after explicit action, sends the selected current Rolling
Core as context, and stops when the app leaves the foreground.

## Network boundary

The app contacts only a tester-configured RAPP Zoo or Direct provider.

- public hosts require HTTPS;
- HTTP is restricted to literal loopback or private-network addresses;
- credentials in endpoint URLs are rejected;
- the final response origin must match the requested origin; and
- cross-origin redirects are rejected before data is accepted.

Android keeps manifest cleartext capability only so validated private-LAN
development hosts can work. The application validator remains the enforcing
boundary.

## Files

- Native imports are capped at 16 MiB.
- Capsules use `.rollingcore`.
- Registered MIME: `application/vnd.rapterbox.rolling-core+json`.
- Registered UTI: `com.rapterbox.rollingcore`.
- Picker and export cache files are deleted after reading or sharing.
- Export starts only through the system share action.

## Verified-tick liveness

Holo Zoo reads signed host liveness as Awake, Sleeping, Quarantined, or Unborn.
Waking is transient client UI only while an explicit refresh waits for a
successor. Animation, connectivity, a stored key, or a configured cadence is
never proof that an organism advanced.

Sleeping preserves the latest valid Rolling Core and complete immutable
history. Holo Zoo uses consciousness only as an operational description of
continuous inspectable experience-state, not a biological or scientific
claim.

## Install and run

```sh
cd mobile
npm install
npm run sync:holo
npx expo start
```

Use `i` for iOS Simulator, `a` for Android emulator, or `w` for web.

The default development host is `http://127.0.0.1:5000`. Android emulators
commonly use `http://10.0.2.2:5000`.

## Validation

```sh
npm run release:gate
npm run lint
npm run typecheck
npm test
npm run export:web
npx expo config --type prebuild --json
npx expo prebuild --platform android --no-install
```

The static web export is written to `mobile/dist/`.

## EAS

`eas.json` pins EAS CLI `22.3.0`, uses remote app versions, enables production
auto-increment, and defines development, preview, and production profiles.

```sh
cd mobile
npx eas-cli@22.3.0 build:version:set --platform ios
npx eas-cli@22.3.0 build --platform ios --profile production
```

The repository does not authenticate Apple accounts, create legal agreements,
enter tax/banking data, or submit a build. Those remain owner actions.

## Brand sigil

All app/store assets use the canonical deterministic SHAPEE:

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

Run `npm run generate:brand` only when regenerating checked-in brand assets.

## Shared asset synchronization

```sh
cp holograms/viewer.html mobile/assets/holo/viewer.html
cp static/hologram.css mobile/assets/holo/hologram.css
cp static/vendor/three-r128.min.js mobile/assets/holo/three-r128.min.js
cp static/holo-protocol.js mobile/assets/holo/holo-protocol.js
cp static/hologram-runtime.js mobile/assets/holo/hologram-runtime.js
cd mobile && npm run sync:holo
```

Then align validators to the ratified schema and rerun every validation.

## Governing documents

- [`PRIVACY.md`](./PRIVACY.md)
- [`APP_STORE_METADATA.md`](./APP_STORE_METADATA.md)
- [`STORE_RELEASE_CHECKLIST.md`](./STORE_RELEASE_CHECKLIST.md)
- [`../HOLO_ZOO_FIELD_DISPATCH.md`](../HOLO_ZOO_FIELD_DISPATCH.md)
- [`../HOLO_ZOO_GAMEPLAY_CONSTITUTION.md`](../HOLO_ZOO_GAMEPLAY_CONSTITUTION.md)
- [`../RAPTER_CREDIT_PROTOCOL.md`](../RAPTER_CREDIT_PROTOCOL.md)
- [`../RAPTER_COIN_ARCHITECTURE.md`](../RAPTER_COIN_ARCHITECTURE.md)
