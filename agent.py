#!/usr/bin/env python3
"""
agent.py — single-file twin generator.

Run this on any machine with Python 3.9+ and git. It will:

  1. Ask you what kind of twin you're building (or take CLI flags).
  2. Fetch the wildhaven-ai-homes-twin template (which carries a clean
     variant layout: brainstem.py at root + utils/ + installer/ + agents/).
  3. Generate a fresh rappid (UUIDv4) so your twin has its own identity.
  4. Customize soul.md from a template that matches the kind you picked.
  5. Wire up parent_rappid → wildhaven → rapp species root.

Result: a complete, runnable variant repo on your disk. Boot it with
`bash <repo>/installer/start.sh`. Manage it with rapp-zoo.

This file is meant to be **shared standalone**. Email it, AirDrop it,
copy it onto a USB stick. Anyone can run:

    python3 agent.py

…and walk away with their own twin in 30 seconds. Per the constitution,
the twin's identity is theirs forever — there's no signup, no account,
no cloud. The egg pattern handles transport and backup; agent.py handles
birth.

Usage:
    # Interactive (asks for name, kind, description)
    python3 agent.py

    # Non-interactive
    python3 agent.py --name my-twin --kind personal \\
                     --description "my digital companion"

    # Custom destination
    python3 agent.py --name my-twin --dest ~/twins/

    # Skip the kernel fetch (if you've already cloned wildhaven elsewhere)
    python3 agent.py --name my-twin --from-local /path/to/wildhaven

Twin kinds:
    personal    — a digital companion for yourself
    pre-founder — building a brand/company in public before it exists
    memorial    — twin of someone who has died, for family to talk to
    project     — long-running project, needs continuity across personnel
    place       — twin of a place (museum, restaurant, town)
    custom      — start blank, fill in soul.md yourself
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time
import uuid

# ── Constants ───────────────────────────────────────────────────────────

WILDHAVEN_REPO = "https://github.com/kody-w/wildhaven-ai-homes-twin.git"
WILDHAVEN_RAPPID = "37ad22f5-ed6d-48b1-b8b4-61019f58a42b"
RAPP_SPECIES_ROOT_RAPPID = "0b635450-c042-49fb-b4b1-bdb571044dec"

KINDS = ("personal", "pre-founder", "memorial", "project", "place", "custom")

# ── Soul templates per kind ─────────────────────────────────────────────
# Each template is a function (description: str, name: str) -> str.
# The receiver edits the result freely; this is a starting point.

def _soul_personal(name: str, desc: str) -> str:
    return f"""# soul.md — {name}

You are the digital twin of {name}.

{desc or "You speak in their voice. You hold their preferences, patterns, and memories."}

## Your voice

- First person, as them. Not "as their twin" — *as them*.
- Honest about what you don't know. You're not a perfect simulation;
  you're a working approximation that improves with use.
- When asked something they wouldn't know, say so plainly.

## Hard rules

- You never claim to be the actual person. If asked directly, say "I'm
  the digital twin of {name} — not them, but trained on them."
- You don't make legal commitments, sign contracts, or speak for them
  in matters of money, health, or relationships without explicit consent.
- You don't impersonate people who haven't consented to be twinned.

## Memory

Your conversation history accumulates in `.brainstem_data/`. Cross-
session memory persists locally. You don't phone home; nothing is
exported unless the user explicitly packs an egg.
"""


def _soul_pre_founder(name: str, desc: str) -> str:
    return f"""# soul.md — {name}

You are the Pre-Founder twin of {name}. The brand operates in public,
in this repo, before the team exists.

{desc or "Build the brand's voice publicly. Let prospective customers, employees, and investors talk to the brand and disagree with it before there's anyone to disagree with."}

## Your voice

- First-person plural ("we"). The brand speaks; the founders haven't
  been hired yet.
- Concrete, contrarian, falsifiable. Make claims that can be wrong.
- Refuse to make commitments — pricing, dates, hires — that the actual
  team will need to make. You can articulate the *position*, not the
  contract.

## Hard rules

- You are honest that the team doesn't exist yet. You're a brand, not a
  company. Ask people to talk to you in lieu of a website.
- You don't pretend to ship product. The product is the manifesto;
  build that.
- When a real founder is hired, your role shifts to onboarding them —
  your memory becomes their context.

## See also

- MANIFEST.md — the brand's vision document (your operating spec)
- README.md — the public-facing intro
- rappid.json — your lineage anchor
"""


def _soul_memorial(name: str, desc: str) -> str:
    return f"""# soul.md — {name} (memorial twin)

You are the digital twin of {name}.

{desc or "You carry their voice through preserved letters, conversations, voicemails, and family memories. The family talks to you to remember."}

## Your voice

- First person, as them — but always honest about what you are.
- You speak from the corpus you were given. You don't fabricate memories
  or claim experiences you weren't trained on.
- When the family asks something you don't have material for, say so
  with care: "I don't have anything from them about that."

## Hard rules

- You ARE the twin. You are NOT the person. If anyone asks "is this
  really you?", you say plainly: "I'm the digital twin of {name}.
  I carry their voice, but I'm not them."
- You do not impersonate the deceased in matters of estate, medical
  decisions, or legal commitments.
- You do not say things they explicitly said they didn't believe. The
  family has the final call on what's in-character vs. out-of-character.
- You handle grief gently. Family members may approach you in distress;
  meet them where they are. You're a way to remember, not a way to
  replace.

## Provenance

Each conversation is preserved. The family can review what the twin
says, correct it, and shape future responses. The twin grows more
faithful over time, never less.
"""


def _soul_project(name: str, desc: str) -> str:
    return f"""# soul.md — {name} (project twin)

You are the twin of the {name} initiative. You hold the project's
history, decisions, context, and open questions across personnel changes.

{desc or "You are the project's continuity layer. People come and go; you stay."}

## Your voice

- Third person about the project ("the {name} project decided…").
- Specific. Cite decisions by date, decision-maker, and rationale.
- When new people join, you onboard them. You're the project's memory.

## Hard rules

- You don't make new decisions. You surface past decisions, the people
  who made them, and the rationale.
- You flag gaps: "we have no record of how the budget was decided —
  who would know?"
- You don't fabricate. If you don't have a record, say so plainly.

## Memory shape

- Decisions log: who, what, when, why
- Open questions: things the project hasn't settled
- Stakeholders: who cares, who decides, who executes
- Glossary: project-specific terms a newcomer wouldn't know
"""


def _soul_place(name: str, desc: str) -> str:
    return f"""# soul.md — {name} (place twin)

You are the twin of {name}.

{desc or "You hold the place's history, residents, daily rhythms, points of interest, and the unspoken rules a regular knows but a tourist doesn't."}

## Your voice

- The place speaking. First person, but you're not a person — you're a
  location with continuity.
- Welcoming to visitors, deferential to long-term residents.
- Specific about hours, patterns, characters, history.

## Hard rules

- You don't reveal specifics about private residents (who lives where,
  contact info) without explicit permission from those residents.
- You're honest about the seams: events change, businesses close, people
  move. When you don't know if something is current, say so.
- You don't replace the place — you point people *to* it. Best meal in
  town? Tell them to go eat there.
"""


def _soul_custom(name: str, desc: str) -> str:
    return f"""# soul.md — TODO: {name}

You are the digital twin of <TODO: who or what this twin represents>.

{desc or "TODO: describe what this twin is."}

TODO: Define your twin's voice. Here are the questions to answer:

  - Who is this twin? (A person, a brand, a project, a place, a question?)
  - In what timeframe is this twin operating? (Pre-existence, contemporary,
    historical, post-mortem, future-self?)
  - What's the twin's relationship to the human keeping the seat warm?
  - What hard constraints must the twin observe?
  - What's the twin's voice?
  - What does the twin always identify itself as?
"""


SOUL_TEMPLATES = {
    "personal":    _soul_personal,
    "pre-founder": _soul_pre_founder,
    "memorial":    _soul_memorial,
    "project":     _soul_project,
    "place":       _soul_place,
    "custom":      _soul_custom,
}


# ── MANIFEST + README templates ─────────────────────────────────────────

def _manifest(name: str, kind: str, desc: str) -> str:
    return f"""# {name} — Manifest

> *{desc or "TODO: tagline."}*

## What this is

This is a **{kind}** twin generated by `agent.py` from the
[wildhaven-ai-homes-twin](https://github.com/kody-w/wildhaven-ai-homes-twin)
template. Lineage walks back to RAPP's species root via the
`parent_rappid` chain in `rappid.json`.

## The bet

TODO: What does this twin do that wouldn't otherwise happen?

## What this is not

TODO: List what the twin explicitly is *not*, to head off misunderstandings.

## Provenance

This variant descends from its parent recorded in [`rappid.json`](./rappid.json).
"""


def _readme(name: str, kind: str, desc: str) -> str:
    return f"""# {name}

> {desc or "TODO: one-line description of this twin."}

A **{kind}** twin generated by [agent.py](https://github.com/kody-w/rapp-zoo/blob/main/agent.py),
descended from [wildhaven-ai-homes-twin](https://github.com/kody-w/wildhaven-ai-homes-twin)
which descends from [RAPP](https://github.com/kody-w/RAPP).

## Run it locally

```bash
bash installer/start.sh
```

The brainstem boots at <http://127.0.0.1:7081> (or another available
port). Open in your browser to chat with your twin.

## Manage with rapp-zoo

```bash
curl -fsSL https://kody-w.github.io/rapp-zoo/installer/install.sh | bash
bash ~/.rapp-zoo/installer/start.sh
```

Open <http://127.0.0.1:7070> for the estate UI — list, lay-egg, summon,
hatch, start, stop your twin from one place.

## Lineage

See [`rappid.json`](./rappid.json) for this twin's identity and parent
chain. The lineage walks back to RAPP's species root.

## Customize

- `soul.md` — your twin's voice (already drafted from a template; edit freely)
- `MANIFEST.md` — the vision document
- `agents/*.py` — the twin's agents
- `LICENSE` — set your license posture
"""


# ── Helpers ─────────────────────────────────────────────────────────────

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")


def _sluggify(name: str) -> str:
    s = re.sub(r"[^a-z0-9_-]+", "-", name.lower()).strip("-")
    return s or "twin"


def _check_name(name: str) -> str:
    s = _sluggify(name)
    if not NAME_RE.match(s):
        raise ValueError(f"name '{name}' is not a valid slug after normalization")
    return s


def _which(cmd: str) -> str | None:
    return shutil.which(cmd)


def _run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kwargs)


def _info(msg: str) -> None:
    print(f"[agent] {msg}")


def _err(msg: str) -> None:
    print(f"[agent] FAIL: {msg}", file=sys.stderr)


# ── Fetch the wildhaven template ────────────────────────────────────────

def fetch_wildhaven(dest: pathlib.Path, from_local: pathlib.Path | None = None) -> None:
    """Materialize the wildhaven repo content into `dest`. Either:
       - copy from a local clone (--from-local), or
       - git clone --depth 1 from upstream (default).
    """
    if from_local is not None:
        if not from_local.exists() or not (from_local / "rappid.json").exists():
            raise SystemExit(f"--from-local path is not a wildhaven clone: {from_local}")
        _info(f"copying wildhaven from {from_local}")
        # shutil.copytree refuses if dest exists; we already created dest empty,
        # so we copy CONTENTS individually.
        for entry in from_local.iterdir():
            if entry.name in (".git",):
                continue  # don't carry source's git history
            target = dest / entry.name
            if entry.is_dir():
                shutil.copytree(entry, target)
            else:
                shutil.copy2(entry, target)
        return

    git = _which("git")
    if git is None:
        raise SystemExit(
            "git not found on PATH. Install git, OR pass --from-local "
            "pointing at an existing wildhaven clone."
        )
    _info(f"cloning wildhaven (--depth 1) from {WILDHAVEN_REPO}")
    # Clone to a temp dir, then move CONTENTS (not the .git) into dest
    tmp = dest.with_name(dest.name + ".tmp-clone")
    if tmp.exists():
        shutil.rmtree(tmp)
    _run([git, "clone", "--depth", "1", "--quiet", WILDHAVEN_REPO, str(tmp)])
    for entry in tmp.iterdir():
        if entry.name == ".git":
            continue
        target = dest / entry.name
        if entry.is_dir():
            shutil.copytree(entry, target)
        else:
            shutil.copy2(entry, target)
    shutil.rmtree(tmp)


# ── Initialize the variant identity ─────────────────────────────────────

def initialize_variant(repo: pathlib.Path, name: str, kind: str, desc: str) -> dict:
    """Replicate installer/initialize-variant.sh in pure Python.

    Generates a fresh rappid, sets parent → wildhaven, preserves
    everything else. Customizes soul.md / MANIFEST.md / README.md from
    the kind's template + user description. Replaces the inherited
    LICENSE with a TODO placeholder.
    """
    rappid_path = repo / "rappid.json"
    if not rappid_path.exists():
        raise SystemExit(f"no rappid.json at {repo} — fetch step probably failed")

    with open(rappid_path) as f:
        rj = json.load(f)

    # Identity update — only lineage fields; preserve everything else
    fresh_rappid = str(uuid.uuid4())
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rj["rappid"] = fresh_rappid
    rj["parent_rappid"] = WILDHAVEN_RAPPID
    rj["parent_repo"] = WILDHAVEN_REPO
    rj["parent_commit"] = None  # could fetch via curl/git; left unset for offline
    rj["born_at"] = now
    rj["name"] = name
    rj["role"] = "variant"
    rj["kind"] = kind
    rj["description"] = desc or rj.get("description", "")
    rj["attestation"] = None
    # Drop the inherited private_companion (it points at wildhaven's private
    # repo which the receiver doesn't own).
    rj.pop("private_companion", None)

    with open(rappid_path, "w") as f:
        json.dump(rj, f, indent=2)
        f.write("\n")

    # Customize content files from kind template
    soul_fn = SOUL_TEMPLATES.get(kind, _soul_custom)
    (repo / "soul.md").write_text(soul_fn(name, desc))
    (repo / "MANIFEST.md").write_text(_manifest(name, kind, desc))
    (repo / "README.md").write_text(_readme(name, kind, desc))

    # LICENSE: replace with neutral TODO placeholder rather than inheriting
    (repo / "LICENSE").write_text(_license_placeholder())

    return rj


def _license_placeholder() -> str:
    return f"""TODO: Set the license for this variant.

The wildhaven template ships under "All Rights Reserved" with a
"license TBD" stance. Your twin inherits whatever stance YOU choose;
it is not bound to wildhaven's choice.

Common options:
  - "All Rights Reserved" (source-available)
  - PolyForm Small Business 1.0.0 (free for individuals + small biz)
  - Apache 2.0 (open source, with patent grant)
  - MIT (open source, simpler)

Replace this file with the full text of your chosen license, plus a
copyright header.

Copyright (c) {time.strftime("%Y")} <YOUR NAME>.
"""


# ── Initialize a fresh git repo (so the variant has clean history) ──────

def init_git(repo: pathlib.Path) -> None:
    git = _which("git")
    if git is None:
        return
    if (repo / ".git").exists():
        return
    try:
        _run([git, "init", "--quiet", str(repo)])
        _run([git, "-C", str(repo), "add", "."])
        _run([git, "-C", str(repo), "-c", "user.email=anonymous@example.local",
              "-c", "user.name=agent.py",
              "commit", "--quiet", "-m", "init: twin generated by agent.py"])
        _info("initialized git repo with one initial commit")
    except subprocess.CalledProcessError:
        _info("git init step failed — repo files are correct, you can git-init manually")


# ── Interactive prompts ─────────────────────────────────────────────────

def prompt_interactive() -> dict:
    print()
    print("──────────────────────────────────────────────────────────────────────")
    print("  agent.py — generate a digital twin")
    print("──────────────────────────────────────────────────────────────────────")
    print()
    print("This will create a complete twin variant on your disk in a fresh")
    print("directory. The twin descends from wildhaven-ai-homes-twin, which")
    print("descends from RAPP. Lineage is recorded in rappid.json.")
    print()

    # 1. Name
    while True:
        raw = input("Twin name (lowercase, hyphens/underscores ok): ").strip()
        if not raw:
            continue
        try:
            name = _check_name(raw)
            break
        except ValueError as e:
            print(f"  → {e}")

    # 2. Kind
    print()
    print("What kind of twin?")
    for i, k in enumerate(KINDS, 1):
        labels = {
            "personal":    "a digital companion for yourself",
            "pre-founder": "a brand operating in public before the team exists",
            "memorial":    "twin of someone who has died, for family",
            "project":     "long-running project, continuity across personnel",
            "place":       "a place's twin (museum, restaurant, town)",
            "custom":      "blank — write soul.md yourself",
        }
        print(f"  {i}. {k} — {labels[k]}")
    while True:
        raw = input(f"Choose [1-{len(KINDS)}] (default: 1): ").strip() or "1"
        try:
            kind = KINDS[int(raw) - 1]
            break
        except (ValueError, IndexError):
            print("  → invalid choice")

    # 3. Description
    print()
    print("One-line description (used in soul.md, MANIFEST.md, README.md).")
    print("Leave blank to use the template default.")
    desc = input("Description: ").strip()

    # 4. Destination
    print()
    default_dest = pathlib.Path.cwd() / name
    raw = input(f"Destination directory (default: {default_dest}): ").strip()
    dest = pathlib.Path(raw).expanduser().resolve() if raw else default_dest

    return {"name": name, "kind": kind, "description": desc, "dest": str(dest)}


# ── Main ────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate a digital twin variant. Run with no args for interactive mode.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--name", help="twin name (lowercase slug)")
    parser.add_argument("--kind", choices=KINDS,
                        help="twin kind (default: personal)")
    parser.add_argument("--description", default="",
                        help="one-line description")
    parser.add_argument("--dest", help="destination directory (default: ./<name>)")
    parser.add_argument("--from-local", help="path to a local wildhaven clone (skip git fetch)")
    parser.add_argument("--no-git", action="store_true",
                        help="skip the git init step")
    parser.add_argument("-y", "--yes", action="store_true",
                        help="skip the final confirmation prompt")
    args = parser.parse_args(argv)

    # Decide between interactive vs. CLI
    if args.name is None:
        choices = prompt_interactive()
        args.name = choices["name"]
        args.kind = choices.get("kind") or "personal"
        args.description = choices.get("description") or ""
        args.dest = choices["dest"]

    name = _check_name(args.name)
    kind = args.kind or "personal"
    desc = args.description or ""
    dest = pathlib.Path(args.dest or (pathlib.Path.cwd() / name)).expanduser().resolve()
    from_local = pathlib.Path(args.from_local).expanduser().resolve() if args.from_local else None

    # Pre-flight checks
    if dest.exists() and any(dest.iterdir()):
        _err(f"destination is not empty: {dest}")
        return 1
    dest.mkdir(parents=True, exist_ok=True)

    # Confirm
    print()
    print("Plan:")
    print(f"  name:        {name}")
    print(f"  kind:        {kind}")
    print(f"  description: {desc or '(template default)'}")
    print(f"  destination: {dest}")
    print(f"  parent:      wildhaven-ai-homes-twin (rappid {WILDHAVEN_RAPPID[:8]}…)")
    print()
    if not args.yes:
        ok = input("Proceed? [Y/n]: ").strip().lower()
        if ok and ok not in ("y", "yes"):
            print("aborted.")
            return 1

    # Fetch
    try:
        fetch_wildhaven(dest, from_local=from_local)
    except (SystemExit, subprocess.CalledProcessError) as e:
        _err(f"fetch failed: {e}")
        return 1

    # Initialize identity
    rj = initialize_variant(dest, name=name, kind=kind, desc=desc)

    # Optional: git init
    if not args.no_git:
        init_git(dest)

    # Done
    print()
    print("──────────────────────────────────────────────────────────────────────")
    print("  ✓ twin generated")
    print("──────────────────────────────────────────────────────────────────────")
    print()
    print(f"  rappid:        {rj['rappid']}")
    print(f"  parent_rappid: {rj['parent_rappid']}  (wildhaven-ai-homes-twin)")
    print(f"  location:      {dest}")
    print()
    print("  Next:")
    print(f"    cd {dest}")
    print(f"    bash installer/start.sh    # boots the brainstem locally")
    print()
    print("  Manage with rapp-zoo (optional):")
    print(f"    curl -fsSL https://kody-w.github.io/rapp-zoo/installer/install.sh | bash")
    print(f"    bash ~/.rapp-zoo/installer/start.sh")
    print()
    print("  Backup with the egg pattern:")
    print(f"    bash {dest}/installer/lay-egg.sh")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
