# Starter stage timeline interface

This typed future UI contract is intentionally documented without delaying the
integration-ready Expo handoff. The model and presentation helper live in
`src/growth/stage-timeline.ts`.

The starter timeline has three ordered stages:

1. **Origin** — free.
2. **Journey** — a family-specific signed issuer reference expected to be
   around USD $15 at its recorded BTC quote.
3. **Ascendant** — a family-specific signed issuer reference expected to be
   around USD $35 at its recorded BTC quote.

Journey and Ascendant references render as integer sats plus the signed quote
UTC. They are labeled **Official stage reference** and are not a price owed,
Growth Point cash value, purchase requirement, investment value, or resale
guarantee.

Stage eligibility requires both the signed Growth Point threshold and signed
`eligible_after_utc`. There is no pay-to-evolve path. Eligibility also does not
pretend a mutation occurred; a verified successor Rolling Core remains
required under the separate generation contract.

Family-specific signed schedules remain authoritative. Future UI must not
replace them with universal prices, invented creature names, type charts,
capture mechanics, or silhouettes.
