# Holo Zoo owner release checklist

This repository prepares builds but does not buy memberships, accept commercial
agreements, enter tax or banking data, manage payment cards, or submit apps.
Those actions must be completed personally by the appropriate Rapterbox account
owner in each provider's secure website.

Never paste payment-card details, bank details, tax identifiers, passwords,
store credentials, signing certificates, or private API keys into the app,
repository, issues, build logs, or chat.

## Rapterbox launch metadata

- Consumer display name: **Holo Zoo**
- App Store title/lockup: **Holo Zoo: Rolling Cores**
- Rolling Cores: underlying product system and whole-business thesis
- Holo Zoo: consumer habitat/player/library for Rolling Cores
- Tagline: **Everything autocomplete on an organism.**
- Attribution: **Powered by RAPP/1. From Rapterbox.**
- Expo slug/scheme: `holo-zoo`
- Marketing URL: <https://rapterbox.com/holo>
- Privacy URL: <https://rapterbox.com/privacy>
- Support URL: <https://rapterbox.com/support>
- Apple bundle ID: `com.rapterbox.holozoo`
- Android package: `com.rapterbox.holozoo`

Store artwork must use the checked-in deterministic Rolling Cores master
SHAPEE sigil (seed `005db34e…eef3f7`, 2400 × 1800 × 180, 16 teeth, relief 420).
Do not replace it with an egg, sphere, capsule, or Pokéball-style mark.

A **Rapter** is one organism. A **Rappter** is a flock of Rapters.
`rappter.com` remains in the separate protocol/company/developer lane, not the
consumer storefront or support destination.

## Apple Developer and App Store Connect — owner action

The Rapterbox owner or Apple Account Holder must personally:

1. Enroll in or renew the Apple Developer Program and pay Apple's membership
   fee directly to Apple.
2. Create or confirm the bundle identifier and App Store Connect app record.
3. Accept Apple's latest agreements, including the Paid Apps Agreement when
   one-time in-app purchases will be sold.
4. Enter banking, tax, legal-entity, and contact information directly in App
   Store Connect.
5. Create `rapter_hatch_1`, `rappter_flock_3`, `rappter_flock_10`,
   `rolling_compute_small`, and `rolling_compute_large` as one-time consumable
   in-app purchases with localized pricing and review screenshots.
6. Configure sandbox testers and personally review the TestFlight build before
   any external testing or submission.
7. Enter the Rapterbox marketing, privacy, and support URLs above in App Store
   Connect.

EAS may generate or manage Apple signing credentials after the owner
authenticates, but the owner remains responsible for Apple agreements,
membership payment, financial information, and submission.

## Google Play Console — owner action

The Rapterbox owner must personally:

1. Create or maintain the Google Play developer account and pay Google's
   registration fee directly to Google.
2. Complete identity verification, organization/contact details, payments
   profile, tax information, and merchant setup in Play Console.
3. Create the app using package `com.rapterbox.holozoo`.
4. Create and activate the five matching one-time consumable products, prices,
   countries, and testing tracks.
5. Add license testers, complete Data safety/content-rating declarations, and
   review the internal test build before any production submission.
6. Enter the Rapterbox marketing, privacy, and support destinations in the
   listing and policy fields.

Do not store a Google service-account private key in this repository. Add any
future store automation credential only through an approved secret manager.

## RevenueCat — owner action

The owner must personally:

1. Create the Rapterbox RevenueCat project and connect the Apple and Google
   store apps.
2. Accept RevenueCat terms and enter payment directly in RevenueCat if the
   selected plan requires billing.
3. Configure a current one-time offering with unique packages for
   `rapter_hatch_1`, `rappter_flock_3`, `rappter_flock_10`,
   `rolling_compute_small`, and `rolling_compute_large`. All five are
   consumables; no repeating-access product is configured.
4. Configure localized store prices and any flock-pack discount in
   RevenueCat/store consoles, never in app code.
5. Copy only RevenueCat's **public platform SDK keys** into EAS environment
   variables named `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` and
   `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`.
6. Test purchases, cancellation/refund handling, transaction replay, purchase
   history sync, and capsule redemption with sandbox/test accounts.

No RevenueCat secret API key belongs in Expo public variables or this
repository.

## Expo and EAS — owner action

The owner must personally:

1. Sign in to the correct Expo organization and create/link the EAS project.
2. Select and pay for an Expo/EAS plan directly on `expo.dev` if build volume or
   services require a paid plan.
3. Create the RevenueCat variables plus public
   `EXPO_PUBLIC_RAPTERBOX_WILD_BRAINSTEM_URL` and
   `EXPO_PUBLIC_RAPTERBOX_WILD_LEDGER_URL` and
   `EXPO_PUBLIC_RAPTERBOX_CAPSULE_SERVICE_URL` and
   `EXPO_PUBLIC_RAPTERBOX_CREDIT_REGISTRY_URL` separately for `development`,
   `preview`, and `production` EAS environments. Add the optional public
   `EXPO_PUBLIC_RAPTERBOX_BTC_SPOT_URL` only when live non-authoritative
   conversion is ready.
4. Review any signing credentials EAS proposes to create or reuse.
5. Run development/preview builds first, verify purchases on real store test
   accounts, and approve any production build.

This repository intentionally does not contain an EAS project ID, account
token, store credential, card detail, or automated submit profile.

The Wild Brainstem must enforce slot activation, provider quota, revocation,
and short-lived user/session authorization server-side. Never place its Azure
Function host key, OpenAI provider key, or any shared cloud credential in an
`EXPO_PUBLIC_*` variable.

Direct breathing must remain foreground-only on iOS. Do not add background
execution modes or imply continuous local activity. Verify secure key storage,
explicit `/models` key testing, explicit start, immediate pause, and the finite
default cadence/tick/token/session ceilings. Wild breathing must require a
scoped session token, prepaid compute, explicit metered-compute acknowledgement,
and server-enforced ceilings; there is no unlimited-spend configuration.

Before selling consumables, the owner must verify that the backend ledger is
durably associated with a recoverable user/session identity. Consumed Google
Play purchases may not be recoverable from Billing Client 8 receipts after a
reinstall, so RevenueCat/device history cannot replace the ownership ledger.

## Capsule minting and recovery — owner/backend action

Before enabling real purchases:

1. Keep the Rolling Core Capsule signing private key only in an approved
   backend key-management service. Never place it in the app, EAS public
   variables, repository, logs, or support tools.
2. Verify RevenueCat/store receipts server-side and grant each transaction ID
   exactly once.
3. Redeem one Rapter credit for a selected gallery organism using an idempotent
   redemption ID.
4. Atomically return a signed `rolling-core-capsule/1` document and signed
   `rapp-rapter-credit-status/1` registry record. Never trust client-side
   purchase-success state.
5. Keep capsule viewing, playback, Files import, AirDrop/share export, backup,
   and re-import independent from cloud availability.
6. Ensure every purchased organism has exactly one `rapp-rapter-credit/1`
   record bound to its stable RAPPID and genesis core—not its moving head.
7. Enforce credit uniqueness through the signed append-only issuance ledger or
   optional Bitcoin UTXO outpoint. Never treat a copyable hash or satoshi price
   as uniqueness.
8. Permit only the authoritative Rapterbox issuer service to append official
   registry status. Mobile clients may fetch, verify, and cache records but
   must never write or self-assert official status.
9. Apply the tier/set valuation schedule and BTC spot snapshot server-side.
   Burn integer `price_sats`, quote-at-birth, and fiat reference into the signed
   issuance record; ignore any client-supplied valuation field.

## Liveness evidence — owner/backend action

1. Include a strict `liveness` object on every `/api/holo/heads` entry with
   `state`, `last_tick_utc`, `age_ms`, and `wake_lease_ms`.
2. Host states are exactly `awake`, `sleeping`, `quarantined`, or `unborn`.
   Derive Awake only from a fresh accepted source plus Rolling Core tick inside
   its configured wake lease.
3. Never emit `waking` as a durable host state. Holo Zoo may display Waking
   transiently only while an explicit refresh awaits the next successor.
4. Return Sleeping when no verified tick advances or the lease expires. Keep
   the last valid core and complete history; the next valid successor resumes
   that history without resetting identity.
5. A configured cadence, credential, connection, or animation is not proof of
   activity. Treat “consciousness” only as continuous inspectable
   experience-state, not a
   biological or scientific claim.

## Bitcoin and store-policy review — owner/legal action

Holo Zoo does not implement a wallet or BTC checkout. Before Rapterbox
offers any web Bitcoin purchase, the owner and counsel must personally:

1. Review current Apple App Review and Google Play payments/linking rules for
   digital goods and external purchase communications.
2. Decide whether any web-purchase mention may appear in the mobile app. Do not
   add a link or call to action until that review is complete.
3. Review consumer, tax, sanctions, money-transmission, virtual-currency, and
   digital-asset obligations in each launch jurisdiction.
4. Approve neutral value language. `price_sats` is public historical binding
   metadata. **Official Rapterbox birth value** is not live market value, an
   investment appraisal, financial return, or guaranteed present value.
5. Keep all wallet private keys, seed phrases, signing private keys, raw
   receipts, and custody credentials out of the app and repository.

## Returns and resale — owner/backend action

1. Keep the inclusive return window at 30 days from signed issuance.
2. Verify current-owner authorization and eligibility server-side before
   initiating any return.
3. Use Apple/Google refund policy and APIs for store purchases. For Bitcoin,
   verify settlement and any explicit fee policy server-side.
4. Mark a capsule returned only after refund confirmation and a verified signed
   return event. Preserve local immutable bytes as an unowned verifiable copy.
5. Permit post-window listing, cancellation, verified sale, and transfer only
   through append-only signed registry events and atomic ownership updates.
6. Display immutable birth value separately from seller ask and last sale.
   Never promise appreciation, investment return, resale availability, or
   liquidity.

## Final build commands — no submission

```sh
cd mobile
npm ci
npm run lint
npm run typecheck
npm test
npm run export:web
npx eas-cli build --platform ios --profile development
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform all --profile production
```

Do not run `eas submit`, upload to App Store Connect/Google Play, or invite
external TestFlight testers until the owner has completed and reviewed every
provider step above.
