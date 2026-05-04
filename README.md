# rapp-zoo

> **Local-first Pokédex of digital organisms on your device.**

A small Flask app at `http://127.0.0.1:7070` that lists, lays-egg, summons, hatches, starts, stops, **imports**, and **exports** organisms — at every scale (rapplications, twins, full brainstem instances). Sits **above** the per-twin brainstems — never replaces them. Each organism is its own sovereign process; the zoo is the keeper that lets you operate on them all from one place.

## What it does

- **Three tabs** in the UI:
  - **My collection** — every organism on this device, grouped by rappid. Multiple incarnations of the same organism (one in your global brainstem, one in a project-local brainstem, one summoned from an egg) appear as a single card with multiple incarnation pills.
  - **Starters** — three archetype rapplications shipped pre-baked with the zoo (`workday` / `playtime` / `journal`). One-click download as `.egg`. The on-ramp for new users.
  - **Discover** — fetches the global Pokédex API from `kody-w/RAPP_Store` (a static catalog hosted on `raw.githubusercontent.com`). Browse, inspect, download eggs from anyone in the federation.

- **Drag-drop import** — drop any `.egg` file anywhere on the page; the zoo accepts the upload, peeks the manifest, saves it under `~/.rapp/eggs/imported/`, and refreshes the collection.
- **One-click export** — download any local egg with `Content-Disposition: attachment` so it lands in your Downloads folder, ready to AirDrop / Slack / USB-stick to another device.
- **Manifest inspection** — peek any egg's schema, kernel version, file tree without unpacking. Useful before you summon a stranger's organism.
- **Card visual with sprites** — every organism card carries a deterministic 6×6 SVG sprite derived from its rappid hash. Same organism → same sprite, on every device, forever. Recognition without recognition logic.
- **Lays eggs** at three schemas, picked automatically from the source layout:
  - `brainstem-egg/2.1` (`utils/egg.py`) — for **variant repos** (rappid.json + brainstem.py at the same root).
  - `brainstem-egg/2.2-organism` (`utils/bond.py`) — for **brainstem-instance organisms** (rappid.json above `src/rapp_brainstem/`). Used by locally-hatched RAPP installs.
  - `brainstem-egg/2.2-rapplication` (`utils/bond.py`) — for **rapplications** packed via `bond.pack_rapplication()`. Includes agent + UI bundle + organ + per-rapp state.
- **Summons** any `.egg` into `~/.rapp/twins/<rappid>/`. The summon endpoint dispatches on schema. Organism eggs land in a brainstem-instance workspace; rapplication eggs install into an existing host.
- **Hatches** — the egg-based kernel-update flow. Lay → swap kernel files → summon back. No git merge, no conflicts. Identity, memory, and mutations preserved across the kernel swap.
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

## Cartridges — drop-in tools for the ancestor brainstem

The canonical extension pattern: drop a `*_agent.py` into `~/.brainstem/agents/`. The brainstem's loader picks it up at next boot. The LLM gets it as an OpenAI-style tool. Capability lives **inside the chat**, not in a separate CLI.

Two cartridges ship in [`agents/`](./agents/):

| File | Tool name | What it does |
|---|---|---|
| [`agents/summon_twin_agent.py`](./agents/summon_twin_agent.py) | `SummonTwin` | Generate a fresh twin organism on the device. Picks a soul template based on `kind` (personal / pre-founder / memorial / project / place / custom), mints a fresh `rappid` (UUIDv4), writes `~/.rapp/twins/<rappid>/`, registers in the neighborhood. |
| [`agents/hatch_egg_agent.py`](./agents/hatch_egg_agent.py) | `HatchEgg` | Import a `.egg` cartridge (someone's twin packed elsewhere) and hatch it as a fully-viable local twin. Identity, memory, and mutations preserved across the substrate hop. Same `rappid` as wherever the egg was packed. |

Install with one command (after running the rapp-installer):

```bash
cp agents/summon_twin_agent.py agents/hatch_egg_agent.py ~/.brainstem/agents/
# restart the brainstem; the cartridges auto-load
```

Then in chat:

> **You:** "I have my dad's twin egg on a USB stick at /Volumes/usb/dad.egg. Hatch it on this machine."
>
> **Model:** *invokes HatchEgg(egg_path="/Volumes/usb/dad.egg")*
> "Hatched twin 'dad-twin' (rappid 7bd3...) — fully viable. Workspace: ~/.rapp/twins/7bd3.../. Identity preserved across the substrate hop. Same rappid as wherever this egg was packed; this is the same twin, materialized here."

> **You:** "Make me a memorial twin for my grandmother who passed last year."
>
> **Model:** *invokes SummonTwin(twin_name="grandma-twin", kind="memorial", description="my grandmother who passed in 2025")*
> "Created memorial twin 'grandma-twin' (rappid 2af8...). Located at ~/.rapp/twins/2af8.../. Estate: registered at port 7081. Soul.md uses the memorial template, with your description woven in."

The cartridges follow the rule: **the rapp-installer'd brainstem is the static ancestor; cartridges conform to its interface and never request console-side changes.** Test contract: [`tests/test_cartridges_against_ancestor_brainstem.py`](./tests/test_cartridges_against_ancestor_brainstem.py) loads each cartridge through the actual `brainstem._load_agent_from_file()` and asserts they pass the BasicAgent contract + produce viable artifacts.

The zoo reuses `~/.brainstem/venv/` if you already have a RAPP brainstem installed; otherwise it creates a local venv on first run.

## What it isn't

- **Not a brainstem.** The zoo doesn't host any organisms; it's a tool that operates on them. Twins keep running in their own processes regardless of whether the zoo is up.
- **Not a cloud service.** All state is on-device:
  - `~/.config/rapp/peers.json` — neighborhood registry (existing RAPP convention)
  - `~/.rapp/eggs/<rappid>/<timestamp>.egg` — local egg backups (laid by you)
  - `~/.rapp/eggs/imported/<sha8>-<filename>.egg` — eggs you imported from elsewhere
  - `~/.rapp/twins/<rappid>/` — summoned twin workspaces
  - `~/.rapp/pids/<rappid>.pid` — zoo-managed PIDs
- **Not a variant.** No `rappid.json`. No lineage. The zoo is a tool; only organisms have rappids.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/`                          | The zoo UI |
| `GET`  | `/static/<path>`             | Static assets |
| `GET`  | `/starters/dist/<name>.egg`  | Pre-built starter egg downloads |
| `GET`  | `/api/health`                | Liveness + per-twin health summary |
| `GET`  | `/api/twins`                 | List organisms grouped by rappid |
| `GET`  | `/api/eggs`                  | List local egg backups (with manifest peeks) |
| `GET`  | `/api/eggs/manifest?path=`   | Peek a single egg's manifest + file tree |
| `GET`  | `/api/starters`              | List the 3 bundled starter rapplications |
| `GET`  | `/api/discover`              | Pointer to the global rapp_store API URL |
| `POST` | `/api/import-egg`            | Multipart upload of a `.egg` (drag-drop endpoint) |
| `GET`  | `/api/export-egg?path=`      | Stream a local egg back as a download |
| `POST` | `/api/lay-egg`               | `{repo_path}` — pack an organism to egg |
| `POST` | `/api/summon`                | `{egg_path, host_root?, keep_existing_kernel?}` — schema-dispatching unpacker |
| `POST` | `/api/hatch`                 | `{rappid_uuid, new_kernel}` — egg-roundtrip kernel update |
| `POST` | `/api/start`                 | `{rappid_uuid}` — bash `<workspace>/installer/start.sh` |
| `POST` | `/api/stop`                  | `{rappid_uuid}` — SIGTERM the registered PID |
| `POST` | `/api/reveal`                | `{path}` — open workspace in OS file manager (path must be inside `~/.rapp/`) |

## Starter rapplications

Three pre-baked rapps ship with the zoo. Each has its own personality + UI skin:

| Type     | Rapp        | Personality |
|---|---|---|
| **work**    | `workday`  | Daybrief operator. Tight bullets, never paragraphs. Plan / recap / prep. |
| **play**    | `playtime` | Riff partner. Story prompts, what-if games, brainstorm fuel — generous and loose. |
| **regular** | `journal`  | A journal that talks back. Listens, mirrors, asks one question at a time. |

Built locally via `python3 starters/build_starters.py` from sources in `starters/<type>/source/`.

## How it relates to RAPP

The zoo is built on the RAPP variant primitives:
- [`utils/egg.py`](./utils/egg.py) — vendored. Schema `brainstem-egg/2.1` (variant-repo cartridges).
- [`utils/bond.py`](./utils/bond.py) — vendored. Schemas `brainstem-egg/2.2-organism` + `brainstem-egg/2.2-rapplication` + identity/bonding CLI.
- [`utils/peer_registry.py`](./utils/peer_registry.py) — vendored. Schema `rapp-peers/1.1` (twin-aware).

All three modules are also shipped inside `RAPP/rapp_brainstem/utils/`. They're the same files. Vendored here so the zoo can be installed standalone.

## Constitution

The zoo respects the same rules as the kernel:
- **Never overwrite local data.** Hatch flows don't touch your soul.md, agents/, or .brainstem_data — those travel through the egg.
- **Single-parent rule.** When summoning eggs from a templated twin, the lineage chain is preserved unchanged.
- **Drop-in kernel replaceability** (Article XXXIII). The `--keep-kernel` summon flag is the mechanism that makes egg-based hatching work.
- **Local-first.** Everything runs on your device. No telemetry, no auth, no cloud calls beyond the optional `Discover` tab fetch.
- **Rapplications are organisms** (companion vault note in `kody-w/RAPP`: *Rapplications Are Organisms — collapsing a false distinction*). The zoo's UI renders catalog rapps, locally-hatched instances, and AirDropped organisms with the same card model. One protocol at every scale.

## License

All Rights Reserved. Source-available under the same terms as RAPP. License posture mirrors the species root.
