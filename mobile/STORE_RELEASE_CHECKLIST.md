# Holo Zoo internal TestFlight release checklist

This checklist is for the current adult internal, no-commerce build. It does
not authorize a public App Store release or any marketplace transaction.

Never place passwords, tokens, provider keys, payment-card data, banking/tax
details, signing private keys, certificates, private capsules, customer data,
or legal records in source, issues, build logs, public forms, or chat.

## Locked release identity

- Display name: **Holo Zoo**
- Store title: **Holo Zoo: Rolling Cores**
- App lockup: **Everything autocomplete on an organism.**
- Expo project: `@wildfeuer05/holo-zoo`
- EAS project ID: `782a464a-a0d8-40e9-93e3-0cec01874101`
- Bundle/package: `com.rapterbox.holozoo`
- Version: `1.0.0`
- Initial local iOS build: `1`
- Initial Android version code: `1`
- Marketing: <https://rapterbox.com/holo/>
- Privacy: <https://rapterbox.com/privacy/>
- Support: <https://rapterbox.com/support/>

## Build boundary

Confirm all of these remain false in `src/release-policy.ts` and `app.json`:

- real commerce;
- production RapterWorks;
- tips and sponsorship;
- rentals and resale;
- managed-compute sales;
- Coin economics;
- public sharing;
- external interoperability; and
- irreversible protocol writes.

Also confirm:

- audience is `adult-internal-testers`;
- OTA updates are disabled;
- current RAPP migration remains required;
- RevenueCat initialization fails closed;
- no public TestFlight link is created; and
- no minor is invited.

## Required local validation

From `mobile/`:

```sh
npm run release:gate
npm run lint
npm run typecheck
npm test
npm run export:web
npm run gate:simulator-bundle
npx expo config --type prebuild --json
npx expo prebuild --platform android --no-install
```

Verify generated Android manifest behavior:

- `android:usesCleartextTraffic="true"` exists only to permit
  application-validated loopback/private-LAN hosts;
- `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`,
  `SYSTEM_ALERT_WINDOW`, and `VIBRATE` appear with
  `tools:node="remove"`.

From the repository root, run the existing integrated Python, official RAPP
artifact, desktop, and package checks.

## Apple owner actions

The RapterBox Apple Account Holder must personally:

1. Confirm Apple Developer Program membership is active.
2. Sign in to the intended Apple account in Xcode and/or EAS.
3. Accept current Apple agreements.
4. Create or reuse Apple Distribution signing and an App Store provisioning
   profile for `com.rapterbox.holozoo`.
5. Create or confirm the App Store Connect app record.
6. Complete export-compliance answers for this build.
7. Enter the marketing, privacy, and support URLs.
8. Upload only the commerce-frozen production archive.
9. Add only named adult internal testers.
10. Review TestFlight diagnostics, privacy text, and the exact build before
    enabling testing.

The repository cannot complete membership, legal agreements, tax/banking
details, identity verification, or final submission.

## EAS

`eas.json` pins EAS CLI `22.3.0`, uses remote app versions, and auto-increments
production builds.

After the release branch is committed:

```sh
cd mobile
npx eas-cli@22.3.0 build:version:set --platform ios
npx eas-cli@22.3.0 build --platform ios --profile production
```

Review every credential EAS proposes to create or reuse. Do not add an
automated submit profile for this internal gate.

## Real-device acceptance

Connect a supported iPhone, trust the development Mac, and enable Developer
Mode. Verify:

1. cold launch and local error containment;
2. House selection and House changes;
3. offline Field use with location permission absent;
4. Companion mode with no commerce;
5. Work walkthrough labels and no transaction;
6. House cards show the four starting occupants without creating title;
7. capsule import/export using `.rollingcore`;
8. 16 MiB import rejection;
9. picker/export cache cleanup;
10. provider key save, clear, key test, and foreground-only update;
11. fresh reinstall does not recover an earlier provider key;
12. private-LAN host acceptance and public-cleartext rejection;
13. cross-origin redirect rejection;
14. airplane-mode local playback;
15. Dynamic Type, VoiceOver order, reduced motion, and contrast; and
16. TestFlight feedback without private capsule or credential attachment.

No physical-device release claim is allowed until these pass.

The simulator bundle gate proves only the local Release simulator artifact. It
does not certify a TestFlight upload. After Xcode or EAS produces the exact
distribution-signed iPhoneOS app that will be exported, run:

```sh
npm run gate:testflight-app -- /path/to/HoloZoo.xcarchive/Products/Applications/HoloZoo.app
```

That gate requires the `iPhoneOS` platform, Apple Distribution signature,
TeamIdentifier, signed entitlements, embedded provisioning profile, bundle ID,
and the same private-term/disabled-UI scan used for the simulator and web
artifacts.

## Website gate

Before inviting testers, confirm these return the reviewed content:

- <https://rapterbox.com/holo/>
- <https://rapterbox.com/privacy/>
- <https://rapterbox.com/support/>
- <https://rapterbox.com/agent.json>
- <https://rapterbox.com/.well-known/agent.json>

The Holo page must describe the current adult internal, no-commerce build and
must not imply that production work, payment, public sharing, or continuous
managed processing is live.

## Privacy gate

Confirm:

- no account or automatic RapterBox telemetry;
- no GPS/map provider;
- Direct provider disclosure names the data sent and provider-controlled
  processing;
- Keychain uninstall persistence and fresh-install purge are explained;
- website Formspree collection is separate from app data;
- a private website correction/deletion request exists; and
- public GitHub issues warn against private content.

## Final stop conditions

Do not upload or invite testers if:

- any release-gate mutation unexpectedly passes;
- lint, typecheck, tests, export, prebuild, integrated tests, or packaging fail;
- the tracked release policy is missing;
- an Apple signing/provisioning state is unresolved;
- export compliance is unanswered;
- a physical iPhone has not completed acceptance;
- website privacy/support routes are not live; or
- the archive differs from the reviewed commit.
