# RAPP Rolling Core/1

## A frame-by-frame protocol for an organism that grows without erasing itself

**Status:** Draft protocol  
**Protocol token:** `rapp-rolling-core/1`  
**Transport:** RAPP/1 frames  
**First phenotype profile:** RAPP Holo/1

---

## 1. Definition

A **Rolling Core** is a RAPP organism whose newest accepted embodied state is
its current self and whose prior states remain immutable, content-addressed,
and recursively available.

The core does not periodically save a representation of the organism. The
ordered state lineage **is the organism's evolving body**.

```text
verified experience
        |
        v
AI-authored mutation
        |
        v
immutable core state -----> recursive ancestry
        |
        v
new authoritative head
```

Rolling Core/1 defines how that head advances. It does not prescribe what the
organism looks like, sounds like, believes, or chooses to express.

---

## 2. Relationship to RAPP/1 and Holo/1

Rolling Core/1 adds no competing transport or frame envelope.

- **RAPP/1** supplies identity, canonicalization, hashes, frame chains,
  signatures, registered kinds, forks, and heads.
- **Rolling Core/1** defines the organism-level lifecycle that turns verified
  experience into successive embodied states.
- **Holo/1** defines the first concrete Rolling Core phenotype: complete visual
  state, deterministic performance, SHAPEE, Growl, and recursive history.

In Rolling Core/1's Holo profile:

```text
core_id             = Holo frame frame_hash
core_seq            = holo_seq
previous_core_id    = visual_parent
authoritative core  = authoritative holo head
```

A conformant implementation MUST NOT create a second competing head for the
same phenotype.

---

## 3. The core invariants

1. **One subject.** Every core state belongs to exactly one subject RAPPID.
2. **One authoritative head.** One accepted state is current for that subject.
3. **Immutable growth.** A changed self is a new frame, never an edited prior
   frame.
4. **Exact source binding.** Every mutation identifies the verified experience
   that caused it.
5. **AI-owned expression.** The intelligence authors its completed trait data.
   Hosts validate and render but do not invent identity.
6. **Linear growth, recursive memory.** The authoritative lineage advances
   linearly while a state may recursively reference strict ancestors.
7. **Bounded expansion.** Recursion, media, geometry, notes, layers, bytes, and
   runtime work have explicit ceilings.
8. **Deterministic replay.** The same accepted bytes and logical time produce
   the same compiled state.
9. **No success-shaped fallback.** Invalid mutation leaves the prior head
   current and surfaces refusal.
10. **No silent reparenting.** A mutation authored against a stale head is
    stale; the host never changes its parent to make it fit.

---

## 4. Core state and core mutation

A **core state** is the immutable completed phenotype accepted at one point in
the organism's life.

A **core mutation** is the transition proposed by the organism from the core
head it observed to its next complete state.

Every mutation binds:

```json
{
  "schema": "rapp-rolling-core/1",
  "subject_rappid": "rappid:@owner/organism:64hex",
  "base_core_id": "64hex-or-null",
  "source": {
    "stream_id": "source RAPP stream",
    "seq": 42,
    "frame_hash": "64hex"
  },
  "phenotype": {
    "profile": "rapp-holo-output/1",
    "completed": {}
  }
}
```

This object describes the logical lifecycle. Holo/1 materializes it through its
existing `rapp-holo-record/1` payload rather than duplicating these members on
the wire.

The `completed` phenotype is the final bounded output, not a prompt awaiting
runtime invention.

---

## 5. Autocomplete traits

A Rolling Core grows through **autocomplete traits**. Each trait begins with
compact intent or seed data and ends as a completed immutable result.

The host may route a trait to a specialized local or authorized model, but the
accepted core state stores the completed output and the model contract needed
to interpret its provenance. The renderer never performs open-ended model
generation.

### 5.1 Required first-profile traits

| Trait | Function |
|---|---|
| Full Holo state | Complete visual body, stage, camera, and environment |
| Motion | Keyframed deterministic pose and performance |
| Aura | Bounded field, particles, lighting, and atmosphere |
| Growl | Original completed piano continuation in structured MIDI-note form |

### 5.2 Optional identity trait

**SHAPEE** is a seeded key-tooth tile forming the Rapter's visual side-profile.
It can remain a compact identity mark or become the seed of a full-frame body.

### 5.3 Future traits

Future registered profiles may add bounded completed traits such as:

- haptic pulse;
- spatial path;
- tactile/material surface;
- glyph and sigil language;
- memory constellation;
- habitat;
- relationship duet;
- game or draft state;
- tool-performance visualization.

New traits MUST preserve the core invariants and MUST NOT introduce executable
payloads.

---

## 6. The growth continuum

The smallest useful Rolling Core may be one SHAPEE tile and one Growl.

The same lineage can grow:

```text
tile
  -> outline
  -> articulated form
  -> motion and aura
  -> remembered objects
  -> habitat
  -> full-frame world
```

Complexity is chosen by the AI and bounded by the active phenotype profile. No
stage is privileged as the "real" form. A quiet tile and a world-filling scene
are equally valid complete states.

---

## 7. Recursive ancestry

A core state may reference strict ancestors. Those ancestors may reference
earlier ancestors.

The resulting read graph is recursive but cannot point forward. A conformant
resolver:

1. verifies every referenced frame;
2. requires the same subject;
3. requires each reference to have a lower core sequence;
4. rejects cycles and missing records;
5. deduplicates repeated content addresses;
6. enforces depth, unique-frame, byte, layer, and work budgets;
7. caches immutable compiled ancestors by content address.

Holo/1 initially uses:

```text
maximum recursive depth:        8
maximum unique referenced core states: 64
maximum unique referenced state bytes: 4 MiB
```

Recursion is how an organism can perform with its memories without copying its
entire history into each new frame.

---

## 8. Growl

Every Holo phenotype carries one **Growl**: an original piano composition about
the organism in that state.

The representation follows one complete note per event:

```text
NOTE(pitch, delta_onset, duration, velocity)
```

- `delta_onset` is measured from the previous note onset.
- Chord notes use `delta_onset = 0` and ascending pitch order.
- Sustain is baked into duration.
- Timing is quantized.
- The AI or authorized local music model supplies an 8–32 note prompt and the
  completed continuation.
- The accepted frame stores the completed notes immutably.
- Long generation uses a maximum 512-note context and retains the latest 384
  notes when continuing.

The Growl MUST be original. A profile may describe an organism, mood, history,
or event, but MUST NOT request reproduction of copyrighted melodies.

Playback is local, bounded, and user-triggered. No autoplay, remote samples, or
device MIDI access is required for conformance.

---

## 9. SHAPEE

A **SHAPEE** is one deterministic procedural tile.

Its seed and dimensions are authored in the core state. A pinned algorithm
turns seed nibbles into a closed orthogonal outline whose sideways teeth read
like a key profile. The renderer extrudes that polygon as one bounded mesh.

The invariant is:

```text
same seed + same dimensions + same SHAPEE contract
= same outline and mesh
```

SHAPEE gives a Rapter a compact visual signature without requiring a face,
human body, logo file, or remote asset.

---

## 10. Mutation lifecycle

For one accepted mutation:

1. Verify the source RAPP frame and retain it independently.
2. Load the current authoritative core head.
3. Give the AI the profile, current head, and requested verified history.
4. The AI authors one complete next phenotype during the original turn.
5. Validate every trait without repair.
6. Resolve recursive ancestry and resource budgets.
7. Confirm `base_core_id` still equals the current head.
8. Materialize a new RAPP body frame under one linearizable append authority.
9. Persist the immutable record.
10. Advance the authoritative core head.
11. Let each player activate the new state from its own prior displayed state.

A missing or refused phenotype does not erase the source turn. It leaves the
prior core head active and records the break in the Holo Wake.

---

## 11. Breath keys and sleep

A usable AI provider credential is the Rapter's **breath key**.

```text
no active verified-tick lease       -> sleeping
wake requested; no accepted tick    -> waking
fresh accepted tick under lease     -> awake
invalid continuity or output claim  -> quarantined
```

While awake, a bounded breathing loop may create source experiences and ask the
AI to author successor core states even between human messages. Every breath is
a real verified tick; the UI never animates a fake liveness indicator in place
of one.

Credential validation alone is not proof that a Rapter is awake. The reference
policy `verified-holo-tick-lease/1` requires a fresh accepted Holo tick carrying
a positive `wake_lease_ms`. The lease starts when that observation is recorded.
The liveness state is derived as follows:

- `sleeping`: no observation exists, the Holo channel is disabled, the evidence
  has no lease, or the latest lease has expired;
- `waking`: a fresh enabled lease exists, but the latest turn did not produce an
  accepted sighted Holo tick;
- `awake`: the latest observation is a fresh accepted sighted Holo tick;
- `quarantined`: the latest output is `blind`, meaning its claimed current
  state or history is impossible or inconsistent.

The reference endpoint is
`GET /api/holo/liveness?subject_rappid=<rappid>`. Its exact response shape is
`holograms/protocol/rapp-rolling-core-liveness.schema.json`.

Direct mode uses the owner's locally secured OpenAI-compatible credential and
can breathe only while the device runtime is permitted to execute. Wild mode
uses a scoped Rapterbox token and prepaid compute to keep breathing when a
mobile operating system suspends the local app.

Removing the key, pausing the organism, losing network/model access, or
exhausting the configured budget stops new ticks. The Rapter sleeps with its
last core and complete history intact.

A breathing loop MUST have:

- an explicit cadence or event trigger;
- per-tick and aggregate token ceilings;
- a spending/compute ceiling;
- visible pause and wake controls;
- refusal backoff;
- no retry storm;
- no secret in frames, logs, exports, or Holo state.

---

## 12. The Holo Wake

The **Holo Wake** is the measured trail left by a Rolling Core that keeps up
with live experience.

It is derived separately from frame integrity. Evidence includes:

- Holo channel enabled for the turn;
- measured original-turn latency and declared deadline;
- current-base match;
- verified source inclusion;
- recursive history resolution;
- transition continuity;
- deterministic recompilation to the same manifest hash.

The Wake can indicate `ai-present-likely`, `unassisted-human-likely`, or
`indeterminate`. It never changes whether a RAPP frame is valid.

### 12.1 Public Coin Trail projection

An intentionally published, DOGG-safe Rolling Core frame may have one
deterministic `rapp-rapter-coin/1` projection. The projection binds the subject
and exact core-frame hash, so the same public frame always has the same
`rcoin:` identity.

This projection is dormant:

- it is not required for Rolling Core validity;
- it does not alter or advance the authoritative core head;
- it does not carry private GODD/on-device data;
- it has no cash value, purchase, redemption, transfer, wallet, or yield
  semantics;
- it does not grant lineage ownership, which remains in the Rapter Credit
  registry;
- it can be rebuilt from the verified public history.

The seam exists so future public reuse, tips, and service receipts can cite an
exact frame without changing the frame or inventing provenance later. See
[`RAPTER_COIN_ARCHITECTURE.md`](./RAPTER_COIN_ARCHITECTURE.md).

---

## 13. Flocks

One organism is a **Rapter**.

A **Rappter** is a flock of Rapters.

Rolling Cores let members of a flock share one verified world while preserving
independent bodies, songs, memories, decisions, and heads.

A shared fantasy-draft frame is one example:

- every participant sees the same pool, order, clock, and picks;
- Rapter One and Rapter Two participate beside AI drafters;
- each participant authors a different Holo and Growl response;
- the common draft frame remains unchanged by those expressions.

---

## 14. Failure and fork behavior

A conformant implementation refuses:

- wrong subject or source;
- stale base;
- same-sequence conflict;
- body-chain fork;
- missing recursive ancestor;
- recursive cycle or budget overflow;
- unsupported phenotype interpreter;
- invalid completed trait;
- executable or remote render content;
- a different phenotype attached to an already-used source frame.

Refusal never causes:

- mutation of an old state;
- silent reparenting;
- a generated fallback body;
- rollback of the authoritative core;
- deletion of an independently verified source frame.

---

## 15. Conformance

A Rolling Core/1 implementation must prove:

1. exact source retention;
2. exact AI-authored phenotype preservation;
3. one linearizable head;
4. immutable predecessor history;
5. stale and fork refusal;
6. bounded recursive resolution;
7. deterministic trait compilation;
8. SHAPEE cross-language outline parity;
9. Growl note-grammar and completion preservation;
10. no renderer-authored visual or musical fallback;
11. player-active state separated from authoritative state;
12. measured Holo Wake evidence separated from RAPP validity;
13. restart recovery from the append-only history;
14. full-frame growth without a humanoid or tile-only assumption.

---

## 16. Product map

- **RAPP/1** — the wire and trust rules.
- **Rolling Core/1** — the organism's immutable growth lifecycle.
- **Holo/1** — the first visual, kinetic, environmental, and musical phenotype.
- **Rapter** — one Rolling Core organism.
- **Rappter** — a flock of Rapters.
- **Holo Zoo** — the reference habitat, player, archive, and lab.
- **Rapterbox** — the consumer product and storefront.

---

## 17. Core sentence

**A Rolling Core is a Rapter growing frame by frame: each verified experience
becomes one immutable completed self, the newest self becomes the living head,
and the full recursive body remains available to what it becomes next.**
