# rapp-zoo

> **Local-first Pokédex of digital organisms on your device.**

A small Flask app at `http://127.0.0.1:7070` that lists, packs, verifies, imports, exports, summons, bonds, starts, and stops organisms. It sits **above** per-instance brainstems and never replaces them.

## What it does

- **Three tabs** in the UI:
  - **My collection** — every live installation on this device, grouped by artifact lineage. Each installation retains its own instance RAPPID.
  - **Starters** — three archetype rapplications shipped pre-baked with the zoo (`workday` / `playtime` / `journal`). One-click download as `.egg`. The on-ramp for new users.
  - **Discover** — fetches the global Pokédex API from `kody-w/RAPP_Store` (a static catalog hosted on `raw.githubusercontent.com`). Browse, inspect, download eggs from anyone in the federation.

- **Drag-drop import** — drop any `.egg`; the zoo verifies canonical bytes, hashes, paths, container rules, variant viability, and any signature before writing it to disk.
- **One-click export** — download any local egg with `Content-Disposition: attachment` so it lands in your Downloads folder, ready to AirDrop / Slack / USB-stick to another device.
- **Manifest inspection** — inspect a verified manifest, egg address, and file tree without extraction.
- **Card visual with sprites** — artifact cards derive their deterministic sprite from the artifact RAPPID.
- **RAPP/1 eggs** — every producer emits the single `rapp/1-egg` schema. The zoo reads all six ratified variants and materializes `organism` and `rapplication` eggs.
- **Rev-6 hatching** — the packed `rappid.json` names the artifact. Each new installation mints a fresh instance RAPPID and records the immutable egg address in `grown_from`.
- **In-place bonding** — pack → replace kernel → restore over the same installation. The existing instance RAPPID is preserved and the kernel is rolled back if restore fails.
- **Starts / stops** organism processes. Runs `bash <workspace>/installer/start.sh`, tracks PIDs, sends SIGTERM on stop.
- **Reveal in Finder** — opens any organism workspace in the OS file manager (macOS `open`, Windows `explorer`, Linux `xdg-open`).

## Install

```bash
curl -fsSL https://kody-w.github.io/rapp-zoo/installer/install.sh | bash
bash ~/.rapp-zoo/installer/start.sh
# Build the starter eggs (one-time):
python3 ~/.rapp-zoo/starters/build_starters.py
```

Then open <http://127.0.0.1:7070>.

Set `RAPP_OWNER` to the lowercase GitHub login used for newly minted instance identities. This estate defaults to `kody-w`.

## Frontier desktop and mobile app

The optional Electron shell supervises the loopback Flask zoo and an app-owned RAPP Brainstem on port `7072`. It follows the Frontier pattern: the Python zoo remains authoritative and removable; the unchanged Grail Brainstem runs by reference with the user's installed agents plus the hologram foundry agents.

The foundry requires an explicitly installed, trusted Brainstem at
`~/.brainstem/src/rapp_brainstem` with its venv at `~/.brainstem/venv`.
`RAPP_ZOO_BRAINSTEM_PATH` and `RAPP_ZOO_BRAINSTEM_PYTHON` can select another
verified installation. The desktop app never downloads or pipes a remote
installer into a shell.

```bash
npm install
npm run desktop
```

The desktop intelligence panel calls that Brainstem's single `/chat` surface. GitHub Copilot can use the full installed agent/tool set to inspect, build, test, and operate the computer; high-impact or externally publishing actions remain explicit authorization boundaries. `HologramForge` and `HologramDOGG` are installed as ordinary hotloaded agents. Set `RAPP_ZOO_BRAINSTEM_MODEL` to request a foundry model; the app requests `gpt-5.6-sol` by default, while the installed Brainstem remains authoritative over model availability and fallback.

The same responsive UI is an installable PWA through `/manifest.webmanifest`. A mobile browser can operate a reachable zoo host, but does not run Brainstem or GitHub Copilot on-device; intelligent actions require the desktop host and its supervisor. See [`FRONTIER.md`](./FRONTIER.md).

Build unpacked desktop artifacts with `npm run dist:dir`, or platform installers with `npm run dist`.

## Holograms and RAR DOGGs

The hologram contract is specified in
[`HOLOGRAM_PROTOCOL.md`](./HOLOGRAM_PROTOCOL.md): hologram is a first-class,
AI-authored output channel whose immutable `body.hologram` frames form a
per-AI flipbook. The application verifies and plays that data; it does not
choose a body, form, emotion, or fallback visual.

The product split is explicit:

- [`HOLO_ZOO.md`](./HOLO_ZOO.md) defines the local player, collection,
  flipbook, debugger, and conformance lab.
- [`HOLO_IN_THE_WILD.md`](./HOLO_IN_THE_WILD.md) defines live Holo/1 output
  across RAPP streams and the rolling signal that an AI-capable computational
  participant is present.

Holo/1 is broader than RAPP Factory. Factory is one possible client; other use
cases reuse the same source binding, immutable visual lineage, safe IR, player,
and Holo Wake while changing only their frame payload and AI-authored scene
data.

The Holo Zoo has two deliberately separated areas:

- **Live AI habitats** — current Holo/1 heads, player-active state, immutable
  flipbooks, source binding, and the rolling Holo Wake presence heuristic.
- **Legacy projection exhibit** — the prior character/data bottle demos,
  retained for compatibility but never presented as an AI's current self.

During every Holo-enabled Brainstem turn, the AI emits exactly one
`rapp-holo-output/1` object beside text and voice. The Zoo commits the exact
candidate into a verified `memory.chat-turn`, materializes it as
`body.hologram`, and advances a separate visual flipbook head. A null output
keeps the prior holo performing. Invalid or stale output is surfaced and never
replaced with a generated avatar.

Wild Holo/1 body chains can be ingested with their exact source frame and
intervening body frames. Sustained, on-time continuity across changing heads is
reported as the **Holo Wake**: a practical signal that AI-capable computation is
present even though ordinary RAPP frame verification remains independent.

The bundled `Holo Avatar`, `HOLO in the Nexus`, and `The Briefing` bottles share
one sandboxed, offline Three.js renderer. They remain in the legacy exhibit.

RAR publishes the summonable DOGG records at:

```text
https://raw.githubusercontent.com/kody-w/RAR/refs/heads/main/doggs/holograms/index.json
```

Choosing **Catch RAR bottle** downloads the small JSON record, verifies its SHA-256 from the allowlisted RAR index, validates that it contains no executable or remote content, and atomically stores it under `~/.rapp/holograms/rar/`. The local zoo owns all rendering.

Brainstem users can install `agents/hologram_dogg_agent.py` and say:

> “List the hologram DOGGs in RAR, then summon `holo-avatar` into my local zoo.”

## Cartridges — drop-in tools for the ancestor brainstem

The canonical extension pattern: drop a `*_agent.py` into `~/.brainstem/agents/`. The brainstem's loader picks it up at next boot. The LLM gets it as an OpenAI-style tool. Capability lives **inside the chat**, not in a separate CLI.

Four cartridges ship in [`agents/`](./agents/):

| File | Tool name | What it does |
|---|---|---|
| [`agents/summon_twin_agent.py`](./agents/summon_twin_agent.py) | `SummonTwin` | Generate a fresh local twin instance with a valid mint-once RAPPID. |
| [`agents/hatch_egg_agent.py`](./agents/hatch_egg_agent.py) | `HatchEgg` | Verify an organism egg, preserve its artifact identity, and mint a fresh instance identity linked by `grown_from`. |
| [`agents/hologram_dogg_agent.py`](./agents/hologram_dogg_agent.py) | `HologramDOGG` | List and dimension-match RAR bottles, then catch a hash-verified record into the local zoo. |
| [`agents/hologram_forge_agent.py`](./agents/hologram_forge_agent.py) | `HologramOutput` / `HologramForge` compatibility | Validate an AI-authored Holo/1 output without designing, polishing, or repairing it. |

Install with one command (after running the rapp-installer):

```bash
BRAINSTEM=~/.brainstem/src/rapp_brainstem
cp agents/*_agent.py "$BRAINSTEM/agents/"
cp utils/rapp_protocol.py "$BRAINSTEM/utils/"
# restart the brainstem; the cartridges auto-load
```

Then in chat:

> **You:** "I have my dad's twin egg on a USB stick at /Volumes/usb/dad.egg. Hatch it on this machine."
>
> **Model:** *invokes HatchEgg(egg_path="/Volumes/usb/dad.egg")*
> "Hatched organism instance 'dad-twin' — fully viable. Artifact RAPPID preserved; new instance RAPPID minted; `grown_from` records the verified egg address."

> **You:** "Make me a memorial twin for my grandmother who passed last year."
>
> **Model:** *invokes SummonTwin(twin_name="grandma-twin", kind="memorial", description="my grandmother who passed in 2025")*
> "Created memorial twin instance 'grandma-twin' with a mint-once RAPPID. Estate: registered at port 7081."

The cartridges follow the rule: **the rapp-installer'd brainstem is the static ancestor; cartridges conform to its interface and never request console-side changes.** Test contract: [`tests/test_cartridges_against_ancestor_brainstem.py`](./tests/test_cartridges_against_ancestor_brainstem.py) loads each cartridge through the actual `brainstem._load_agent_from_file()` and asserts they pass the BasicAgent contract + produce viable artifacts.

The zoo reuses `~/.brainstem/venv/` if you already have a RAPP brainstem installed; otherwise it creates a local venv on first run.

## What it isn't

- **Not a brainstem.** The zoo doesn't host any organisms; it's a tool that operates on them. Twins keep running in their own processes regardless of whether the zoo is up.
- **Not a cloud service.** All state is on-device:
  - `~/.config/rapp/peers.json` — neighborhood registry (existing RAPP convention)
  - `~/.rapp/eggs/<artifact-tail>/<timestamp>.egg` — local egg artifacts
  - `~/.rapp/eggs/imported/<egg-hash-prefix>-<filename>.egg` — verified imports
  - `~/.rapp/twins/<random-workspace-key>/` — live instances
  - `~/.rapp/pids/<sha256(instance-rappid)>.pid` — zoo-managed PIDs
- **Not a variant.** No `rappid.json`. No lineage. The zoo is a tool; only organisms have rappids.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/`                          | The zoo UI |
| `GET`  | `/static/<path>`             | Static assets |
| `GET`  | `/starters/dist/<name>.egg`  | Pre-built starter egg downloads |
| `GET`  | `/api/health`                | Liveness + per-twin health summary |
| `GET`  | `/api/twins`                 | List instances grouped by artifact lineage |
| `GET`  | `/api/eggs`                  | List local egg backups (with manifest peeks) |
| `GET`  | `/api/eggs/manifest?path=`   | Peek a single egg's manifest + file tree |
| `GET`  | `/api/starters`              | List the 3 bundled starter rapplications |
| `GET`  | `/api/discover`              | Pointer to the global rapp_store API URL |
| `POST` | `/api/import-egg`            | Multipart upload of a `.egg` (drag-drop endpoint) |
| `GET`  | `/api/export-egg?path=`      | Stream a local egg back as a download |
| `POST` | `/api/lay-egg`               | `{repo_path}` — pack an organism to egg |
| `POST` | `/api/summon`                | `{egg_path, host_root?, owner?}` — verified variant dispatch |
| `POST` | `/api/bond`                  | `{instance_rappid, new_kernel}` — in-place kernel update |
| `POST` | `/api/hatch`                 | Compatibility alias for `/api/bond` |
| `POST` | `/api/start`                 | `{instance_rappid}` — start one installation |
| `POST` | `/api/stop`                  | `{instance_rappid}` — stop one installation |
| `POST` | `/api/reveal`                | `{path}` — open workspace in OS file manager (path must be inside `~/.rapp/`) |
| `GET`  | `/api/holo/heads`            | List authoritative Holo/1 heads, player-active state, and Holo Wake |
| `GET`  | `/api/holo/history`          | Read one subject's immutable visual flipbook |
| `GET`  | `/api/holo/frames/<id>`      | Read one materialized `body.hologram` frame |
| `GET`  | `/api/holo/sources/<hash>`   | Read the exact bound assistant source frame |
| `GET`  | `/api/holo/presence`         | Evaluate the rolling in-the-wild AI-presence heuristic |
| `GET`  | `/api/holo/example-turn`     | Build a verified blank Holo/1 assistant turn |
| `GET`  | `/api/holo/examples/fantasy-draft` | Build a verified fantasy-draft frame with Rappter One, Rappter Two, and AI drafters |
| `POST` | `/api/holo/turn`             | Commit exact text/holo output from the original Brainstem turn |
| `POST` | `/api/holo/commit`           | Materialize an already-built `memory.chat-turn` |
| `POST` | `/api/holo/ingest`           | Ingest source evidence plus a verified wild body-chain segment |
| `POST` | `/api/holo/activate`         | Persist player-specific activation/departure evidence |
| `GET`  | `/api/holograms`             | List legacy bundled, RAR-caught, and generated bottles |
| `GET`  | `/api/holograms/rar`         | Fetch and validate the legacy public RAR bottle index |
| `POST` | `/api/holograms/summon`      | Hash-verify and catch one legacy data-only RAR bottle |
| `GET`  | `/api/holograms/example-frame` | Build a verified legacy bottle-match frame |
| `POST` | `/api/holograms/match`       | Select a legacy cached dimensional lens |
| `POST` | `/api/holograms/generated`   | Legacy generated-bottle persistence endpoint |

## Starter rapplications

Three pre-baked rapps ship with the zoo. Each has its own personality + UI skin:

| Type     | Rapp        | Personality |
|---|---|---|
| **work**    | `workday`  | Daybrief operator. Tight bullets, never paragraphs. Plan / recap / prep. |
| **play**    | `playtime` | Riff partner. Story prompts, what-if games, brainstorm fuel — generous and loose. |
| **regular** | `journal`  | A journal that talks back. Listens, mirrors, asks one question at a time. |

Built locally via `python3 starters/build_starters.py` from sources in `starters/<type>/source/`.

## How it relates to RAPP

The protocol boundary is deliberately singular:
- [`utils/rapp_protocol.py`](./utils/rapp_protocol.py) — pinned rev-6 canonicalization, content addressing, identity, deterministic egg packing, nested verification, and detached-JWS trust. Its output passes the official verifier and also enforces §9.1's normative UTF-8 ZIP flag and deterministic metadata.
- [`utils/egg.py`](./utils/egg.py) — variant-repo and hosted-brainstem adapters.
- [`utils/bond.py`](./utils/bond.py) — brainstem-instance and rapplication adapters.
- [`utils/peer_registry.py`](./utils/peer_registry.py) — local registry separating artifact and instance identity.

The exact authority pin is recorded in [`RAPP1_AUTHORITY.json`](./RAPP1_AUTHORITY.json).

Signed eggs are accepted only when `RAPP_REGISTRY_PATH`, `RAPP_ESTATE_OWNER_RAPPID`, and `RAPP_ESTATE_OWNER_SPKI_PATH` provide a verified registry and trust anchor. Registry sequence state is persisted under `~/.config/rapp/registry-state.json`; `RAPP_REGISTRY_MAX_AGE_SECONDS` defaults to 86400. Without fresh trusted material, signed eggs—including required-signed invites—fail closed.

## Constitution

The zoo respects the same rules as the kernel:
- **Refuse before side effects.** An invalid egg is never saved or extracted.
- **Artifact ≠ instance.** Hatching preserves artifact identity, mints a fresh installation identity, and records `grown_from`.
- **Single-parent rule.** When summoning eggs from a templated twin, the lineage chain is preserved unchanged.
- **Drop-in kernel replaceability.** In-place bond preserves instance identity and restores the old kernel if the round trip fails.
- **Local-first.** Everything runs on your device. No telemetry, no auth, no cloud calls beyond the optional `Discover` tab fetch.
- **Rapplications are organisms** (companion vault note in `kody-w/RAPP`: *Rapplications Are Organisms — collapsing a false distinction*). The zoo's UI renders catalog rapps, locally-hatched instances, and AirDropped organisms with the same card model. One protocol at every scale.

## License

All Rights Reserved. Source-available under the same terms as RAPP. License posture mirrors the species root.
