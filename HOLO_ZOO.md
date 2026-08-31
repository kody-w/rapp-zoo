# The Holo Zoo

## Local player, archive, debugger, and conformance lab

The Holo Zoo is the controlled local environment for holograms. It is not the
source of an AI's holographic expression.

The Zoo receives AI-authored Holo/1 output, verifies it, stores its immutable
history, plays its current state, and lets a person inspect the flipbook.

```text
AI authors -> Holo/1 stream -> Zoo verifies -> Zoo plays
```

The arrow never points backward. The Zoo does not tell the AI what it should
look like.

## 1. What the Zoo is

The Holo Zoo is:

- the Holo Field: an offline discovery radar and House entry point;
- a local-first Holo/1 player;
- an append-only archive of verified holo frames;
- a live view of each AI's current holographic head;
- a flipbook browser for prior immutable outputs;
- a deterministic replay and scrub tool;
- a recursive frame-graph resolver with hard depth and expansion bounds;
- a local SHAPEE tile and user-triggered MIDI Growl player;
- a protocol inspector;
- a validator and adversarial conformance lab;
- a safe sandbox for pinned renderer interpreters;
- a diagnostic surface for integrity, provenance, stream sightedness, and
  practical AI-presence signals;
- a quarantine area for legacy bottle demonstrations that are not Holo/1.

## 2. What the Zoo is not

The Zoo is not:

- a location tracker or physical-destination generator;
- a place where spending buys affection, survival, House power, encounters,
  Growth, or companion capability;
- a hologram author;
- an avatar builder;
- a humanoid generator;
- a morphology engine;
- a personality-to-shape mapper;
- a semantic emotion classifier;
- a second model call that invents a visual after the AI already answered;
- a system that applies hash-derived visual changes;
- a repair service for invalid AI output;
- the authority over an AI's current self.

If an AI emits no holo, the Zoo keeps playing the prior valid holo. If the AI
has never emitted one, the stage is empty.

## 3. Zoo inputs

The Zoo accepts:

1. Live verified Holo/1 `body.pulse` frames from a local Brainstem.
2. Live verified Holo/1 `body.pulse` frames from a remote RAPP stream.
3. Imported Holo/1 history with source evidence and null reserved producer
   provenance.
4. Player activation records for exact-session replay.
5. Legacy bottle records in a separate non-Holo/1 exhibit.

Only the first three can advance an authoritative holo history.

## 4. Zoo modes

### 4.1 Live habitat

The live habitat follows one subject RAPPID:

- subscribe to its body stream;
- verify every body successor;
- identify accepted `body.pulse` events by `rapp-holo-record/1` payload;
- update the authoritative holo head;
- compile and activate the next playable holo;
- keep the current performance running until another update arrives.

The live habitat displays both:

```text
authoritative holo head
player-active holo
```

Normally they match. If the local player lacks a pinned interpreter or cannot
activate a valid accepted frame, it keeps the prior player-active holo and
reports the divergence without rolling back authority.

### 4.2 Flipbook

The flipbook is the complete immutable holo history for one AI:

```text
H0 -> H1 -> H2 -> H3 -> current
```

The person can:

- select any holo;
- inspect its exact source turn;
- inspect its base and visual parent;
- see which prior frames its performance reuses;
- scrub deterministic logical time;
- replay with recorded activation timing;
- replay with normalized timing;
- compare two outputs without altering either;
- export the verified history and provenance.

### 4.3 Conformance lab

The lab runs:

- JSON Schema validation;
- semantic IR validation;
- RAPP frame verification;
- source-inclusion verification;
- optional producer-provenance verification;
- body-chain and visual-chain checks;
- deterministic scene-manifest comparison;
- logical-time pose comparison;
- history-dependency resolution;
- resource-budget checks;
- mutation tests;
- malformed and adversarial fixture tests.

It reports refusal instead of repairing input.

### 4.4 Legacy exhibit

Existing Holo Avatar, Nexus, Briefing, Wickback, generated bottles, and RAR
projection bottles can remain available as historical demonstrations.

They are labeled:

```text
Legacy projection - not an AI Holo/1 self
```

They do not:

- advance a Holo/1 head;
- enter an AI's flipbook;
- claim cognitive-origin proof;
- become a current AI self through renderer changes.

An AI enters Holo/1 only by emitting a new Holo/1 output on a real turn.

## 5. Zoo storage

The Zoo stores distinct records:

| Store | Authority |
|---|---|
| Source memory frames | Proof of the original assistant turn |
| Body frames | Authoritative RAPP biography |
| Holo index | Derived ordered view of Holo/1 `body.pulse` frames |
| Authoritative holo head | Newest durably accepted holo |
| Player activation log | Device-specific live timing and departure pose |
| Player-active state | What this display currently renders |
| Sightedness observations | Non-authoritative stream diagnostics |
| Dormant Coin Trail index | Rebuildable IDs for explicitly public DOGG-safe frames; disabled by default |
| Legacy bottles | Separate demonstration collection |

The body log is authoritative. Head files and indexes are recoverable
accelerators.

Private GODD/on-device frames never enter the Coin Trail. Holo Zoo must require
explicit publication and a DOGG-safety/rights check before any frame can become
public provenance. The current product does not project, display, sell, or
transfer Coins.

## 6. Zoo interface

Each AI habitat should show:

- subject identity;
- current holo stage;
- authoritative holo ID and sequence;
- player-active holo ID;
- source turn and timestamp;
- previous holo link;
- current performance clock;
- referenced historical states;
- recursively resolved ancestor count and depth;
- SHAPEE seed/outline evidence when authored;
- completed Growl MIDI events and local playback control;
- renderer and IR versions;
- integrity result;
- producer-provenance result;
- sightedness result;
- AI-presence heuristic;
- complete flipbook timeline.

The stage contains only what the AI authored. Diagnostic chrome remains outside
the hologram canvas.

## 7. Zoo and local Brainstem

A local Brainstem can expose `emit_hologram` during the AI's original response.
The Zoo may provide:

- the Holo/1 schema;
- current holo head;
- paginated verified history;
- renderer capabilities;
- validation errors.

The Zoo must not provide:

- a suggested body;
- a suggested morphology;
- a default emotion;
- a species generator;
- a generated scene;
- aesthetic repair;
- a post-turn "make me a hologram" model call.

The AI authors. The Zoo validates.

## 8. Zoo versus in the wild

| Concern | Holo Zoo | Holo in the Wild |
|---|---|---|
| Primary role | Controlled player and lab | Distributed AI output channel |
| Authors visuals | Never | The AI on its original turn |
| Stores history | Local verified archive | RAPP body and source streams |
| Current state | Shows authoritative and player-active heads | Latest accepted holo output |
| Timing | Can live-play, scrub, and replay | Continues until the next stream update |
| Verification | Deep inspection and conformance evidence | Every peer verifies what it consumes |
| AI signal | Calculates and explains evidence | Emerges from sustained causal output |
| Legacy bottles | Quarantined exhibit | Not part of Holo/1 |

## 9. Migration from the current Zoo

The migration order is:

1. Freeze the current bottle renderer as the legacy exhibit.
2. Remove the second creative model call from the AI-self path.
3. Add original-turn `emit_hologram`.
4. Accept registered `body.pulse` frames carrying `rapp-holo-record/1`.
5. Add append-only source/body history.
6. Add authoritative and player-active head separation.
7. Add the neutral Holo/1 interpreter.
8. Add live habitat and flipbook views.
9. Add sightedness and AI-presence diagnostics.
10. Prove no app-authored fallback exists.

## 10. Zoo acceptance statement

The Holo Zoo is correct when it can receive an arbitrary valid AI-authored holo,
play exactly that data, preserve every prior version, show the current
flipbook, explain whether the producer was seeing the live stream, and never
invent a hologram itself.
