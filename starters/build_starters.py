#!/usr/bin/env python3
"""
build_starters.py — pre-pack the three starter rapplications into .egg files.

Run from the rapp-zoo repo root:  python3 starters/build_starters.py

Output: starters/dist/{workday,playtime,journal}.egg

These eggs ship with the rapp-zoo so users get an instant "pick a starter
organism" experience on first launch — no need to fetch from the catalog,
no Python execution required to materialize the choice. The zoo's UI lists
them, the user picks one, the zoo offers the .egg as a download (or hatches
it directly into a target brainstem).

Each starter follows the rapp-zoo standard layout:
    starters/<type>/source/<name>_agent.py    — the rapp's agent
    starters/<type>/source/ui/<files>          — the rapp's skin (UI bundle)

The build script stages each one into a brainstem-instance-shaped temp
dir so it can call bond.pack_rapplication() directly. Pure stdlib + bond.py.
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent

# Vendor bond from the zoo's utils dir
sys.path.insert(0, str(_ROOT / "utils"))
import bond  # noqa: E402


# Starter manifest: which source files map to which rapplication
STARTERS = [
    {
        "type": "work",
        "rapp_id": "workday",
        "agent_filename": "workday_agent.py",
        "name": "Workday",
        "version": "0.1.0",
        "publisher": "@rapp",
        "description": "Daybrief operator. Tight bullets, never paragraphs.",
        "category": "work",
    },
    {
        "type": "play",
        "rapp_id": "playtime",
        "agent_filename": "playtime_agent.py",
        "name": "Playtime",
        "version": "0.1.0",
        "publisher": "@rapp",
        "description": "Riff partner. Story prompts, what-if games, brainstorm fuel.",
        "category": "creative",
    },
    {
        "type": "regular",
        "rapp_id": "journal",
        "agent_filename": "journal_agent.py",
        "name": "Journal",
        "version": "0.1.0",
        "publisher": "@rapp",
        "description": "A journal that talks back. One question at a time.",
        "category": "reflection",
    },
]


def stage_starter(starter: dict, stage_root: str) -> str:
    """Copy a starter's source into a brainstem-instance shape so
    bond.pack_rapplication can pack it. Returns the stage src path."""
    src_dir = _HERE / starter["type"] / "source"
    if not src_dir.is_dir():
        raise FileNotFoundError(f"starter source missing: {src_dir}")

    # bond expects:
    #   <stage_src>/agents/<agent_filename>
    #   <stage_src>/.brainstem_data/rapp_ui/<rapp_id>/<ui files>
    stage_src = Path(stage_root) / "src" / "rapp_brainstem"
    (stage_src / "agents").mkdir(parents=True, exist_ok=True)
    ui_dest = stage_src / ".brainstem_data" / "rapp_ui" / starter["rapp_id"]
    ui_dest.mkdir(parents=True, exist_ok=True)

    # Copy the agent
    shutil.copy2(src_dir / starter["agent_filename"], stage_src / "agents" / starter["agent_filename"])

    # Copy the UI bundle (every file under source/ui/)
    ui_src = src_dir / "ui"
    if ui_src.is_dir():
        for f in ui_src.iterdir():
            if f.is_file():
                shutil.copy2(f, ui_dest / f.name)

    return str(stage_src)


def build_one(starter: dict, out_path: Path) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        stage_src = stage_starter(starter, tmp)
        blob = bond.pack_rapplication(
            stage_src,
            starter["rapp_id"],
            agent_filename=starter["agent_filename"],
            include_ui=True,
            include_state=False,  # starters ship clean — no example state
            name=starter["name"],
            version=starter["version"],
            publisher=starter["publisher"],
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(blob)
    manifest = bond.inspect_egg(blob)
    return {
        "rapp_id": starter["rapp_id"],
        "type": starter["type"],
        "out": str(out_path),
        "size_bytes": len(blob),
        "has_skin": manifest.get("has_skin"),
        "rappid": manifest.get("rappid"),
    }


def main():
    dist = _HERE / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    dist.mkdir()

    print(f"Building {len(STARTERS)} starter rapplications …")
    print()
    for s in STARTERS:
        out = dist / f"{s['rapp_id']}.egg"
        info = build_one(s, out)
        print(f"  ✓ {info['type']:<10} → {info['out'].replace(str(_ROOT) + '/', '')}")
        print(f"    {info['size_bytes']:,} bytes  ·  has_skin={info['has_skin']}")
        print(f"    {info['rappid']}")
        print()
    print(f"All starters built into {dist.relative_to(_ROOT)}/")


if __name__ == "__main__":
    main()
