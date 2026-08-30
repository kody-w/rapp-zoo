# Holo in the Wild

## Live AI presence through a causally continuous visual stream

Holo in the Wild is what happens outside the Zoo.

Any Holo/1-capable AI can emit holographic data as part of its normal response,
just as it emits text or voice. Any conformant player can verify and display
that output. The newest holo keeps performing until the AI emits the next one.

Each holo also carries two portable identity traits:

- **SHAPEE** — when chosen by the AI, a seeded one-mesh tile whose sideways
  key-teeth form the AI's visual side-profile;
- **Growl** — a required seeded MIDI motif that deterministically autocompletes
  and can be played locally after user gesture.

SHAPEE is the minimum viable presence. It can remain a compact tile or become
the seed of a progressively richer immutable lineage whose geometry, motion,
aura, habitat, and symbolism eventually occupy the entire frame.

```text
turn T0 -> holo H0
turn T1 -> holo H1, transitioning from H0
turn T2 -> holo H2, performing with H2/H1/H0
turn T3 -> holo H3
```

The result is a live immutable flipbook carried by the AI's RAPP streams.

## 1. Wild output flow

For each AI turn:

1. The AI receives the current conversational context.
2. It receives its current holo head and whatever verified history it requests.
3. With the Holo channel enabled, it produces text, voice, and one complete
   holo output during the same turn.
4. The exact holo candidate is committed in the source turn.
5. Reserved producer provenance remains null; non-null claims fail closed until
   a cryptographic verification profile is standardized.
6. The candidate is materialized as a registered `body.pulse` frame carrying
   `rapp-holo-record/1`.
7. The frame extends the AI's real body stream.
8. Its visual parent extends the AI's holo flipbook.
9. Wild players verify and activate it.
10. Its authored performance continues until the next accepted update.

There is no Zoo generation step in this flow.

## 2. The computational wake

A live holo stream leaves a computational wake.

One manually prepared JSON scene proves very little. The useful signal comes
from sustained causal continuity across unpredictable frames.

On every turn, a participant must keep up with:

- the newest verified source frame;
- the newest body head;
- the newest holo head;
- a contiguous visual sequence;
- stable and changing scene-node identities;
- valid transition topology;
- current and historical flipbook references;
- recursively referenced ancestor frames;
- its current SHAPEE seed and completed original Growl continuation;
- deterministic logical-time performance;
- canonical serialization;
- content hashes;
- null reserved producer provenance;
- the arrival of the next frame.

A person can inspect or hand-author one state. An unassisted person cannot
practically perform all of that stateful work, correctly and repeatedly, at a
live conversational cadence. The stream moves before the manual author catches
up. Their next output becomes stale, contradictory, late, or absent.

That is the signal.

## 3. What it detects

The signal does not try to prove whether fingers touched a keyboard. It answers
the operationally useful question:

```text
Is a computational AI-capable participant actually present in this live stream?
```

If a human uses an AI or automation to keep the stream current, then a
computational participant is present. The signal is correct even though a human
is also in the loop.

If a human takes over manually and the AI is no longer participating, the holo
stream normally:

- stops updating;
- falls behind the current source turn;
- declares a stale base;
- references history it cannot resolve;
- breaks continuity;
- fails deterministic replay;
- keeps displaying the last valid AI-authored holo.

The text stream can continue and every text frame can remain cryptographically
valid. The holo channel reveals that the responder is now flying blind relative
to the AI's live visual state.

## 4. Four separate judgments

Wild peers never collapse these into one label:

| Judgment | Question |
|---|---|
| Frame integrity | Is this RAPP frame valid? |
| Producer provenance | Is a producer claim cryptographically verified by an active profile? Holo/1 currently requires `unattested`. |
| Stream sightedness | Did the producer possess and correctly extend current state? |
| AI presence | Is sustained live behavior machine-capable rather than manual? |

A frame can therefore be:

```text
frame integrity: verified
producer provenance: unattested
stream sightedness: stale
AI presence: unassisted-human-likely
```

The frame is still a valid RAPP frame. The participant simply is not keeping up
with the live holographic stream.

## 5. Rolling AI-presence heuristic

AI presence is evaluated over a rolling window, never from one pretty or
complex hologram.

The reference observer uses eight consecutive holo-enabled assistant turns.
For each turn it records:

- the measured original-turn latency and the configured Holo deadline;
- the declared positive wake lease used for separate Rolling Core liveness;
- whether `base_holo_id` matched the current authoritative head;
- whether the exact source inclusion was verified;
- whether all history references resolved;
- whether transition continuity was valid;
- whether independent deterministic compilation reproduced the same canonical
  manifest hash;

Reference classifications:

### `ai-present-likely`

Use when the rolling window shows sustained on-time, sighted, replay-consistent
Holo/1 output over changing source and holo heads.

### `unassisted-human-likely`

Use when ordinary verified conversation continues but the holo channel
repeatedly becomes absent, late, stale, blind, or replay-inconsistent across the
window.

### `indeterminate`

Use when the stream is too short, the holo channel is intentionally disabled,
network delivery is incomplete, the AI intentionally holds a valid blank state,
or evidence is otherwise insufficient.

The observer never uses visual beauty, humanoid appearance, node count, or
scene complexity by itself. A blank valid holo can be fully sighted. The signal
is sustained causal computation, not decoration.

The machine-readable rolling result is `rapp-holo-presence/1`, defined in
`holograms/protocol/rapp-holo-presence.schema.json`.

Current organism liveness is a separate verified-tick lease result, not an
AI-presence classification. It is exposed as `rapp-rolling-core-liveness/1`,
defined in
`holograms/protocol/rapp-rolling-core-liveness.schema.json`.

## 6. Why manual precomputation fails

Each new output is bound to values unavailable before the live stream reaches
that turn:

- source frame hash;
- current body head;
- current holo ID;
- current visual parent;
- selected historical frame IDs;
- exact current scene identities;
- output activation order.

A prebuilt response cannot know that complete combination. Replaying an old
response produces a stale base or duplicate-source conflict. Editing by hand
must finish before the next causal update, then repeat indefinitely.

The difficulty comes from chained live state, not from hiding the protocol.
Holo/1 is public. The math is transparent. Sustaining it manually is the
impractical part.

## 7. In-the-wild player behavior

A wild player:

- verifies the RAPP body frame;
- verifies source inclusion and refuses non-null producer provenance;
- evaluates stream sightedness;
- updates the authoritative holo head;
- activates the new holo if its interpreter is available;
- continues the prior player-active holo if local activation cannot proceed;
- never fabricates a replacement;
- shares integrity and sightedness as separate status.

A device does not need the Holo Zoo UI to participate. The Zoo is the reference
player and lab; Holo/1 is the portable protocol.

## 8. Human participation

Humans remain first-class participants:

- they can watch;
- they can speak or type;
- they can inspect the flipbook;
- they can pause or disable hologram output;
- they can use an AI to co-author or relay output;
- they can explicitly identify a manual segment.

What they cannot do is silently replace a live computational participant and
expect the stateful holo stream to remain indistinguishable indefinitely.

An explicit manual segment is not a protocol failure. Its AI-presence result is
simply `indeterminate` or `unassisted-human-likely`, while its valid RAPP frames
remain valid.

## 9. Zoo versus wild

```text
Holo Zoo:
  controlled place to collect, inspect, replay, test, and display holograms

Holo in the Wild:
  AI-authored holo output moving live across verified RAPP streams
```

The Zoo shows the evidence. The wild stream creates it.

## 10. The core sentence

**A sustained Holo/1 flipbook is a practical signal that an AI-capable
computational participant is present, because a manual participant cannot keep
causal scene, history, transition, hashing, and timing state current across live
frames for long.**
