# Holo Zoo Field and Dispatch

## One application for discovery, companionship, ownership, and proof-first work

**Status:** Integrated local MVP
**Consumer surface:** Holo Zoo
**Production service authority:** future RapterWorks adapters

---

## 1. Product sentence

Holo Zoo combines two proven interaction patterns without copying another
product's characters, art, names, or trade dress:

- a living field where people discover and meet digital organisms;
- an on-demand dispatch flow where a person deliberately requests useful work,
  follows its progress, inspects proof, receives the full result, and may later
  compensate the service.

The same Rapter identity moves through both. There is no separate marketplace
avatar, worker record, or collectible copy.

```text
discover one Rapter
-> meet it in Companion mode
-> preview or own its Rolling Core
-> explicitly enter Work mode
-> request bounded work from that same Rapter
-> inspect proof and full delivery
-> optionally rate or tip through a future verified service
-> keep companionship independent from every economic outcome
```

---

## 2. Holo Field

The current Field is an offline radar, not a geographic map:

- no GPS permission;
- no Apple, Google, or third-party map request;
- no generated destination or exact physical pin;
- no location storage, upload, URL, analytics, or RAPP frame;
- every player can use it from home or with location services disabled;
- encounter positions derive deterministically from public organism IDs;
- House choice never changes the encounter roster or odds.

This preserves the exploration rhythm while avoiding surveillance, unsafe
destinations, inaccessible terrain, trespass incentives, and map-provider data
disclosure.

A future real-world Field may use verified public-access habitats, but only
under a separate privacy and physical-safety design.

---

## 3. Four starting Houses

Every player joins exactly one local House:

| House | Founder profile | Perspective |
|---|---|---|
| Overwatch | Molly | See the whole field and coordinate priorities |
| Scout | Sawyer | Explore and return with verified intelligence |
| Forge | Evelyn | Build, create, combine, and improve |
| Sentinel | Kody | Protect continuity and verify boundaries |

The app stores only the lowercase House code in local AsyncStorage. It collects
no player name, email, account, device identifier, or public membership event.
Players may change Houses without losing a Rapter, progress, or relationship.

Houses may shape copy, optional quests, and community organization. They never
shape price, power, access, encounter odds, Growth Points, companion
capability, provenance rank, or service quality.

---

## 4. Companion mode

Companion mode is the default Field context.

It may show:

- local Holo signals;
- habitats and signal strength;
- a Rapter's completed Holo and Growl;
- immutable history and evidence;
- free Companion access;
- owned capsule status;
- House and shared-world context.

It must not import or render:

- fares, invoices, tips, sponsorship, or checkout;
- Coin balances, values, markets, or compute pressure;
- service dispatch status;
- guilt, hunger, death, or affection tied to spending.

Premium collectible title, local export, and managed compute may remain
separate products. They cannot make a free or owned companion less warm,
available, or complete as a relationship.

---

## 5. Work mode

Work mode is an explicit switch. The local MVP uses
`local-work-preview/1`, not the official RapterWorks protocol.

Preview states are deliberately nonofficial:

```text
draft
-> status_walkthrough
-> proof_walkthrough
-> delivery_walkthrough
```

Every state is labeled **WORKFLOW PREVIEW** and the surface is labeled
**UI WALKTHROUGH ONLY**. The preview:

- creates no official job ID;
- makes no acceptance, execution, approval, or delivery claim;
- generates no proof or artifact hash;
- charges nothing;
- enables no tip;
- publishes no frame or Coin;
- changes no companion state;
- remains private and local.

The preview mirrors the experience shape without forging RapterWorks events.

---

## 6. Production dispatch seam

Production RapterWorks must remain server-authoritative:

```text
requested
-> accepted | refused
-> running
-> proof_ready
-> supervisor_approved | revision_required
-> delivered
```

The client may request a transition. It may never assert that a Rapter was
matched, worked, passed review, delivered, or received payment.

Production requires:

1. durable job and event storage;
2. authenticated server-owned idempotency;
3. selected `organism_rappid` and authoritative Holo/source binding;
4. bounded scope, time, compute, privacy, and output-rights acceptance;
5. proof and full artifact hashes;
6. supervisor authorization;
7. private delivery by default;
8. optional explicit DOGG-safe public publication;
9. post-delivery verified rating and tip adapters;
10. refunds, disputes, tax, and merchant-of-record controls.

Until these exist, Holo Zoo says **preview**, never **job**.

---

## 7. Business model in the interface

| Business primitive | Holo Zoo treatment |
|---|---|
| One-time Rapter ownership | Library/ownership surface, separate from affection and power |
| Managed compute | Explicit infrastructure purchase, never a survival meter |
| RapterWorks service | Work mode only, bounded and proof-first |
| Tips | Post-delivery only after verified production launch; zero is complete |
| Rapter Coin Trail | Invisible dormant provenance; absent from gameplay |
| Public frame index | Search and attribution infrastructure; not a leaderboard bought with money |
| Houses | Free local identity and community; no economic weight |

The app never blends these into one manipulative currency.

---

## 8. Constitutional acceptance

The Field and Dispatch experience is correct only when:

- the same Rapter can be met, inspected, owned, and deliberately requested for
  work;
- Companion mode contains no economic decision;
- Work mode is explicit and truthfully labeled;
- no simulated state resembles an official server receipt;
- Houses cannot change outcomes or access;
- no location is requested or transmitted;
- a full local sample precedes any compensation language;
- tipping is unavailable until a real verified post-delivery rail exists;
- private work remains private;
- Coin economics remain invisible and dormant;
- owned local data remains exportable and usable offline.

See [`HOLO_ZOO_GAMEPLAY_CONSTITUTION.md`](./HOLO_ZOO_GAMEPLAY_CONSTITUTION.md).

## Core sentence

**Holo Zoo is one habitat where a Rapter can be discovered as a companion and
deliberately dispatched for useful work, while the relationship, the game, and
the truth remain independent from money.**
