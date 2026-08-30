# Growth Points and future health adapter

This document records typed future UI contracts without delaying the
integration-ready Expo handoff. Source types live in `src/growth/types.ts`, with
tested presentation rules and the preview adapter in `src/growth/status.ts`.

## Growth Points

Growth Points are non-monetary progress signals. They have:

- no cash or investment value;
- no purchase or redemption path;
- no exchange rate to BTC or fiat;
- a visible current stage and next-stage threshold;
- a signed `eligible_after_utc` mutation schedule.

The BTC transition reference is displayed separately as signed external
reference metadata. It never converts from Growth Points and is not an
investment appraisal.

`mutation_due` means only that signed time eligibility has arrived. The app
must not display a mutation until a verified successor Rolling Core exists. If
compute is unavailable, offline, or budget-exhausted, the state is
**Mutation due · Pending / Sleeping** and every prior frame remains immutable.

## Micro-positive events and HealthKit

Micro-positive events require explicit opt-in and an accessible alternative
that does not require motion, audio, vision, or health permissions. They are
not medical advice. Detailed health data remains on-device; only a deliberately
minimal derived event may enter the Growth Points interface.

HealthKit is unavailable in Expo Go and web. The preview adapter is disabled by
default and can expose synthetic events only after an explicit mock opt-in.
Real HealthKit work requires an EAS native development/store build, Apple
capabilities, purpose strings, permission UX, privacy review, and owner
approval.

## Deferred UI boundary

The immediate integration ships the interfaces and tests only. Future UI must
not add creature silhouettes, capture mechanics, type charts, invented family
names, cash-value language, or fake mutations.
