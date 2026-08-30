# World Pulse interface

This document records the typed future World Pulse UI without delaying the
integration-ready Expo handoff. The contract and presentation helpers live in
`src/growth/world-pulse.ts`.

World Pulse is the literal globally aggregated Growth Point progress available
to every account, including free Companion accounts. It displays:

- a signed aggregate checkpoint and checkpoint UTC;
- global Growth Points;
- participant and opt-in event counts;
- current milestone threshold and progress;
- signed shared-world unlocks available to all accounts.

World Pulse never contains raw health data, cash or investment value, or
pay-to-win unlocks. Shared-world access cannot require purchasing points or a
premium Rapter.

Individual Growth Points and World Pulse progress are separate UI sections and
separate typed values. The app must never combine them into one balance,
exchange rate, leaderboard wealth signal, or personal health inference.

The immediate integration ships this contract and tests only. A later UI patch
should consume verified aggregate checkpoints and signed unlock labels without
changing the local-only HealthKit boundary or the individual Growth Points
ledger.
