# Holo Zoo privacy

This policy describes the current adult internal TestFlight. It does not
describe a future public, family, commercial, or protocol-interoperable build.

## Release boundary

Holo Zoo has no RapterBox account, automatic RapterBox telemetry, analytics,
advertising SDK, real commerce, production RapterWorks, tips, sponsorship,
rentals, resale, managed-compute sales, Coin economics, public publication, or
external protocol interoperability. RevenueCat initialization is blocked by
the release policy even if a key is present.

The local error boundary displays failures on the device and intentionally
uploads nothing. Apple may process TestFlight diagnostics and feedback under
Apple's policies.

## Information stored on the device

Holo Zoo may store these values in its app sandbox:

- the selected local House code;
- the configured RAPP Zoo URL;
- imported or bundled Rolling Core capsules;
- immutable Holo history and local source evidence;
- the selected Direct provider endpoint and model;
- bounded-update settings; and
- other app preferences.

On native builds, a Direct provider API key is stored through Expo SecureStore
in the device Keychain or Keystore with this-device-only accessibility. Holo
Zoo keeps a separate sandbox marker for the current installation. If that
marker is absent or stale, the app deletes any residual secure-store key before
loading provider settings. This prevents an iOS Keychain value left by a prior
uninstall from silently returning in a fresh installation.

Clear a saved provider key in the app before uninstalling whenever possible.
If provider settings cannot be read or the residual key cannot be deleted,
Direct updates remain disabled and the app surfaces the error.

## Location and Holo Field

Holo Field is a permissionless offline radar. It requests no GPS or location
permission, contacts no map provider, generates no physical destination, and
stores or uploads no coordinates. Sample encounter placement derives only from
public organism IDs.

## Network use

The app contacts only a RAPP Zoo or Direct AI provider endpoint explicitly
configured by the tester. Public hosts must use HTTPS. Cleartext HTTP is
limited to literal loopback or private-network addresses. Cross-origin
redirects are rejected before response data is accepted.

Testing a Direct provider key calls only the selected provider's `/models`
endpoint. An update starts only after explicit user action. The selected
current Rolling Core is then sent to that provider as successor context.
Provider processing, retention, geography, abuse monitoring, and output terms
are governed by that provider. Do not send personal or confidential
information unless those terms are acceptable.

Holo Zoo aborts Direct updates when the app leaves the foreground. The current
build does not provide managed processing or continuous background execution.

## Files and sharing

Native imports are limited to 16 MiB. Temporary picker and export cache copies
are removed after reading or sharing. Capsules use the registered
`.rollingcore` type. Export occurs only after a tester invokes the system share
action.

Signed capsules and history remain local unless the tester explicitly exports
them or starts a provider update as described above. The current build creates
no wallet, payment credential, public Coin record, ownership transfer, or
official work record.

Inspector proof summaries expose only allowlisted frame identity, ordering,
time, hash, member-count, and signature-presence fields. They do not render raw
payload values. External credit registry refresh is disabled both manually and
during automatic capsule load.

## Public and private data

Public DOGG-safe data and private GODD data are separate. Public publication is
disabled. Private prompts, relationship history, customer content,
credentials, receipts, raw location, and unpublished mutations must never
enter public frames.

## Deletion

Use in-app controls to delete imported content where available and save an
empty provider key to remove the secure-store credential. Deleting Holo Zoo
removes its app sandbox. On a later fresh installation, the missing
installation marker causes Holo Zoo to delete any residual secure-store key
before reading it. The current build has no RapterBox cloud account to delete.

## Children

The TestFlight is restricted to adult internal testers. Do not invite or
provide this build to minors. A family release requires a separate youth,
guardian, provider, household-separation, deletion, recovery, moderation, and
healthy-play review.

## Website privacy and support

The Holo Zoo app does not submit data to RapterBox website forms. Website-form
collection and private correction/deletion requests are documented at
<https://rapterbox.com/privacy/>. Product information is at
<https://rapterbox.com/holo/>, and support is at
<https://rapterbox.com/support/>.
