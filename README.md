# rapp-zoo

> **Local-first keeper for the twin estate on your device.**

A small Flask app at `http://127.0.0.1:7070` that lists, lays-egg, summons, hatches, starts, and stops twin organisms running on this machine. Sits **above** the per-twin brainstems — never replaces them. Each twin is its own sovereign process; the zoo is the keeper that lets you operate on them all from one place.

## What it does

- **Lists every twin on this device**, grouped by `rappid_uuid`. Multiple incarnations of the same twin (e.g., one in your global brainstem, one in a project-local brainstem, one summoned from an egg) appear as a single twin with multiple incarnations — the parallel-omniscience pattern.
- **Lays eggs** (`utils/egg.py` schema `brainstem-egg/2.1`). Pack a hatched twin's repo into a portable `.egg` cartridge containing identity, mutations, and `.brainstem_data` state.
- **Summons** any `.egg` into `~/.rapp/twins/<rappid>/`. Twin self-materializes on this device's brainstem, no cloud.
- **Hatches**: the egg-based kernel-update flow. Lay → swap kernel files → summon back. No git merge, no conflicts. Identity, memory, and mutations preserved across the kernel swap.
- **Starts / stops** twin processes. Runs `bash <workspace>/installer/start.sh`, tracks PIDs, sends SIGTERM on stop.

## Install

```bash
curl -fsSL https://kody-w.github.io/rapp-zoo/installer/install.sh | bash
bash ~/.rapp-zoo/installer/start.sh
```

Then open <http://127.0.0.1:7070>.

The zoo reuses `~/.brainstem/venv/` if you already have a RAPP brainstem installed; otherwise it creates a local venv on first run.

## What it isn't

- **Not a brainstem.** The zoo doesn't host any organisms; it's a tool that operates on them. Twins keep running in their own processes regardless of whether the zoo is up.
- **Not a cloud service.** All state is on-device:
  - `~/.config/rapp/peers.json` — the neighborhood registry (existing RAPP convention)
  - `~/.rapp/eggs/<rappid>/<timestamp>.egg` — local egg backups
  - `~/.rapp/twins/<rappid>/` — summoned twin workspaces
  - `~/.rapp/pids/<rappid>.pid` — zoo-managed PIDs
- **Not a variant.** No `rappid.json`. No lineage. The zoo is a tool; only organisms have rappids.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | The zoo UI |
| `GET` | `/api/health` | Liveness + summary |
| `GET` | `/api/twins` | List twins (grouped by rappid) |
| `GET` | `/api/eggs` | List local egg backups |
| `POST` | `/api/lay-egg` | `{repo_path}` → pack a twin to egg |
| `POST` | `/api/summon` | `{egg_path, host_root?, keep_existing_kernel?}` |
| `POST` | `/api/hatch` | `{rappid_uuid, new_kernel}` → kernel-update via egg roundtrip |
| `POST` | `/api/start` | `{rappid_uuid}` → bash <workspace>/installer/start.sh |
| `POST` | `/api/stop` | `{rappid_uuid}` → SIGTERM the registered PID |

## How it relates to RAPP

The zoo is built on the RAPP variant primitives:
- [`utils/egg.py`](./utils/egg.py) — vendored from the RAPP species root. Schema `brainstem-egg/2.1`.
- [`utils/peer_registry.py`](./utils/peer_registry.py) — vendored. Schema `rapp-peers/1.1` (twin-aware).

Both modules are also shipped inside every variant repo (twin/, wildhaven-ai-homes-twin/) and in `RAPP/rapp_brainstem/utils/`. They're the same files. Vendored here so the zoo can be installed standalone.

## Constitution

The zoo respects the same rules as the kernel:
- **Never overwrite local data.** The hatch flow doesn't touch your soul.md, agents/, or .brainstem_data — those travel through the egg.
- **Single-parent rule.** When summoning eggs from a templated twin, the lineage chain is preserved unchanged.
- **Drop-in kernel replaceability** (Article XXXIII). The `--keep-kernel` summon flag is the mechanism that makes egg-based hatching work.
- **Local-first.** Everything runs on your device. No telemetry, no auth, no cloud calls.

## License

All Rights Reserved. Source-available under the same terms as RAPP. License posture mirrors the species root.
