# Holo Zoo privacy

Holo Zoo contains no telemetry, analytics, advertising SDK, tracking, or
account system. It stores only the user-selected, non-secret RAPP Zoo base URL
and validated immutable Holo JSON in the app sandbox. It does not persist host
tokens, passwords, cookies, or API credentials.

Network requests go only to the host explicitly configured by the user. The
embedded Holo player has `connect-src 'none'`, cannot navigate to arbitrary
remote pages, and uses only bundled renderer code and authored data.

When connected, Holo Zoo reads liveness from the configured host's
`/api/holo/heads` response. Awake, Sleeping, Quarantined, and Unborn are derived
from verified source/Rolling Core tick cadence and lease timestamps. Waking is
only a transient client label during an explicit successor check; the app does
not fabricate activity from animation, credentials, or connectivity.

Imported files remain local unless the user explicitly exports one through the
system share sheet or browser download.

An owned organism is represented by a signed local Rolling Core Capsule.
Capsules are verified before import and stored in app document storage. They
remain usable offline and may be exported, AirDropped, backed up, or re-imported
by the user. Cloud availability and credit balance do not control access to an
already-owned capsule.

A capsule may include a public `rapp-rapter-credit/1` proof with an integer
satoshi amount and, optionally, a public Bitcoin transaction outpoint. Rolling
Holo Zoo does not create or store wallet private keys, seed phrases, raw store
receipts, or custody credentials. It does not provide Bitcoin checkout,
transfer, exchange, or spending.

The proof may include immutable public birth-valuation metadata: Rapterbox
tier/set schedule, fixed sats, conception BTC/USD quote, and fiat reference.
Any separately fetched current BTC conversion is optional, live,
non-authoritative, and is not stored as the official birth value.

The app may mirror a signed public ownership-status record from Rapterbox's
authoritative registry. The registry controls official ownership claims,
redownload, and transfer status. The app cannot write registry status. When
offline, Holo Zoo shows the last successfully verified record and its
verification time. Missing, transferred, or revoked status never prevents the
local capsule bytes from rendering.

When a user opens a real EAS development or store build with RevenueCat
configured, RevenueCat and Apple or Google process product, purchase, receipt,
and one-time transaction information needed to grant credits. Holo Zoo
never receives or stores payment-card credentials. Expo Go and web use clearly
labeled, session-only mock billing and create no store transaction.

The backend-owned account ledger records store transaction IDs, unused Rapter
credits, compute credits, and capsule recovery/redownload rights. It does not
replace the signed local capsule as the durable owned object. Protocol
validation, local playback, access to owned local data, and export remain
available in both Direct and Wild modes.

Return and resale actions use public ownership/lifecycle records and future
short-lived official-owner authorization. The app does not store raw store
receipts, refund credentials, Bitcoin settlement secrets, or buyer payment
proofs. Apple and Google handle their refund flows; Rapterbox verifies BTC
settlement server-side. A returned or sold capsule remains on-device as an
unowned verifiable copy unless the user explicitly deletes or exports it.

In free Direct mode, the user supplies their own OpenAI-compatible endpoint,
model, and API key. Native builds store that key through Expo SecureStore in
the device Keychain/Keystore. Web preview keeps it only in session storage.
The key is sent only to the endpoint chosen by the user and is never included
in this repository or shared with other Holo Zoo users.

Testing a Direct breath key calls only the chosen provider's `/models`
endpoint. A breathing session starts only after explicit opt-in and is bounded
by cadence, tick, output-token, total-token, and time ceilings. Provider output
is refused unless it materializes as a valid successor source/Holo pair. Each
attempt sends the selected current Rolling Core record to that user-chosen
provider as successor context.
Holo Zoo pauses and aborts Direct breathing when the app leaves the foreground.
It does not claim or simulate continuous iOS background execution.

Paid Wild mode contacts the configured Rapterbox Azure Function Brainstem for
managed autocomplete, provider routing, quota, revocation, and remote Rapter
access. The app contains no shared Azure Function host key or cloud-provider
API key. Future Wild authentication must use short-lived user/session
credentials issued and enforced by the managed service. Continuous
away-from-device breathing requires an explicit bounded Wild lease and prepaid
compute; it is separate from local capsule ownership.

Consumer privacy information is published through Rapterbox at
<https://rapterbox.com/privacy>. Product information is at
<https://rapterbox.com/holo>, and support is at
<https://rapterbox.com/support>. A Rapter is one organism; a Rappter is a flock
of Rapters. RAPP/1 remains the separate protocol and developer lane.
