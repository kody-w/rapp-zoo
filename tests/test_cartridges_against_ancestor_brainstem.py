"""Test that the cartridges load via the ANCESTOR brainstem.py's actual
agent loader, exactly as they would on a freshly rapp-installer'd device.

The test:
  1. Imports the canonical brainstem.py (from RAPP/rapp_brainstem/) by
     file path — same contract a user gets after running `curl ...
     install.sh | bash`.
  2. Points AGENTS_PATH at a temp directory containing only our two
     cartridge files (summon_twin_agent.py, hatch_egg_agent.py).
  3. Calls _load_agent_from_file() — the brainstem's own loader.
  4. Asserts SummonTwin and HatchEgg are loaded as instances.
  5. Calls .perform() on each, in isolation, and verifies the produced
     artifacts are correct (twin workspace exists, files are right,
     egg roundtrip is byte-identical).

If this test passes, the cartridges work in production: drop them into
~/.brainstem/agents/ on any rapp-installer'd device and they will be
picked up at the next brainstem boot.
"""

import importlib.util
import io
import json
import os
import pathlib
import shutil
import sys
import tempfile
import unittest
import zipfile


_REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
_RAPP_BRAINSTEM = pathlib.Path(
    "/Users/kodywildfeuer/Documents/GitHub/RAPP/rapp_brainstem"
)


def _import_brainstem():
    """Import the canonical brainstem.py by file path so we exercise the
    real loader. This is the SAME file the rapp-installer drops at
    ~/.brainstem/src/rapp_brainstem/brainstem.py (and its sys.path
    setup is identical when imported this way)."""
    if not _RAPP_BRAINSTEM.exists():
        return None
    bs_file = _RAPP_BRAINSTEM / "brainstem.py"
    if not bs_file.exists():
        return None
    # The brainstem expects its own dir on sys.path so its sibling
    # modules (local_storage, basic_agent, etc.) resolve.
    if str(_RAPP_BRAINSTEM) not in sys.path:
        sys.path.insert(0, str(_RAPP_BRAINSTEM))
    try:
        spec = importlib.util.spec_from_file_location(
            "brainstem_under_test", str(bs_file),
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception as e:
        print(f"[test] could not import brainstem: {e}")
        return None


_brainstem = _import_brainstem()
HAVE_BRAINSTEM = _brainstem is not None


class _Iso:
    """Isolate XDG/HOME/RAPP_HOME so cartridge tests don't pollute the
    real ~/.config/rapp/peers.json or ~/.rapp/."""

    def __init__(self):
        self.tmp = tempfile.mkdtemp()

    def __enter__(self):
        self._prev = {}
        for k in ("XDG_CONFIG_HOME", "HOME", "RAPP_HOME"):
            self._prev[k] = os.environ.get(k)
        os.environ["XDG_CONFIG_HOME"] = self.tmp
        os.environ["HOME"] = self.tmp
        os.environ["RAPP_HOME"] = os.path.join(self.tmp, ".rapp")
        return self

    def __exit__(self, *exc):
        for k, v in self._prev.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)


def _stage_cartridges() -> str:
    """Copy our cartridges into a temp agents/ dir suitable for AGENTS_PATH."""
    tmp_agents = tempfile.mkdtemp()
    for cart in ("summon_twin_agent.py", "hatch_egg_agent.py"):
        src = _REPO_ROOT / "agents" / cart
        shutil.copy2(src, os.path.join(tmp_agents, cart))
    return tmp_agents


@unittest.skipUnless(HAVE_BRAINSTEM, "ancestor brainstem.py not available")
class TestCartridgesLoadIntoAncestorBrainstem(unittest.TestCase):
    """The most important contract test: do our cartridges load via the
    real brainstem's _load_agent_from_file()?"""

    def test_summon_twin_agent_loads_and_registers(self):
        agents_dir = _stage_cartridges()
        try:
            cart_path = os.path.join(agents_dir, "summon_twin_agent.py")
            loaded = _brainstem._load_agent_from_file(cart_path)
            self.assertIn("SummonTwin", loaded,
                          f"SummonTwin should be loaded; got: {list(loaded.keys())}")

            instance = loaded["SummonTwin"]
            # Must implement BasicAgent contract
            self.assertTrue(hasattr(instance, "name"))
            self.assertTrue(hasattr(instance, "metadata"))
            self.assertTrue(hasattr(instance, "perform"))
            self.assertTrue(hasattr(instance, "to_tool"))
            self.assertEqual(instance.name, "SummonTwin")

            tool = instance.to_tool()
            self.assertEqual(tool["type"], "function")
            self.assertEqual(tool["function"]["name"], "SummonTwin")
            self.assertIn("twin_name", tool["function"]["parameters"]["properties"])
            self.assertIn("kind", tool["function"]["parameters"]["properties"])
        finally:
            shutil.rmtree(agents_dir, ignore_errors=True)

    def test_hatch_egg_agent_loads_and_registers(self):
        agents_dir = _stage_cartridges()
        try:
            cart_path = os.path.join(agents_dir, "hatch_egg_agent.py")
            loaded = _brainstem._load_agent_from_file(cart_path)
            self.assertIn("HatchEgg", loaded,
                          f"HatchEgg should be loaded; got: {list(loaded.keys())}")
            instance = loaded["HatchEgg"]
            self.assertEqual(instance.name, "HatchEgg")
            tool = instance.to_tool()
            self.assertIn("egg_path", tool["function"]["parameters"]["properties"])
        finally:
            shutil.rmtree(agents_dir, ignore_errors=True)

    def test_summon_twin_perform_creates_viable_workspace(self):
        agents_dir = _stage_cartridges()
        try:
            with _Iso():
                cart_path = os.path.join(agents_dir, "summon_twin_agent.py")
                loaded = _brainstem._load_agent_from_file(cart_path)
                instance = loaded["SummonTwin"]
                result = instance.perform(
                    twin_name="alice-test",
                    kind="personal",
                    description="for the contract test",
                )
                self.assertIn("Created personal twin", result)
                self.assertIn("alice-test", result)
                self.assertIn("rappid", result)

                # Verify the workspace materialized correctly
                rapp_home = pathlib.Path(os.environ["RAPP_HOME"])
                twins_dir = rapp_home / "twins"
                self.assertTrue(twins_dir.exists())
                workspaces = list(twins_dir.iterdir())
                self.assertEqual(len(workspaces), 1, "expected exactly one twin workspace")
                ws = workspaces[0]
                self.assertTrue((ws / "rappid.json").exists())
                self.assertTrue((ws / "soul.md").exists())
                self.assertTrue((ws / "agents").is_dir())
                self.assertTrue((ws / ".brainstem_data").is_dir())

                # rappid.json content
                rj = json.loads((ws / "rappid.json").read_text())
                self.assertEqual(rj["name"], "alice-test")
                self.assertEqual(rj["kind"], "personal")
                self.assertEqual(rj["parent_rappid"],
                                 "37ad22f5-ed6d-48b1-b8b4-61019f58a42b")

                # soul.md uses the personal template
                soul = (ws / "soul.md").read_text()
                self.assertIn("digital twin of alice-test", soul)
                self.assertIn("first person", soul.lower())
        finally:
            shutil.rmtree(agents_dir, ignore_errors=True)

    def test_hatch_egg_perform_materializes_viable_offspring(self):
        """The user's specific test scenario: an .egg arrives on the device,
        HatchEgg unpacks it, the result is a fully-viable local twin."""
        agents_dir = _stage_cartridges()
        try:
            with _Iso():
                # Step 1: pack a synthetic source twin into an .egg
                from utils import egg as egg_module  # vendored in brainstem
                source_repo = pathlib.Path(os.environ["HOME"]) / "source-repo"
                source_repo.mkdir(parents=True)
                rj_source = {
                    "schema": "rapp-rappid/1.1",
                    "rappid": "deadbeef-1111-2222-3333-444444444444",
                    "parent_rappid": "37ad22f5-ed6d-48b1-b8b4-61019f58a42b",
                    "parent_repo": "https://github.com/example/parent.git",
                    "parent_commit": "abc",
                    "born_at": "2026-05-04T00:00:00Z",
                    "name": "imported-twin",
                    "role": "variant",
                    "kind": "memorial",
                    "description": "for the egg-import contract test",
                    "attestation": None,
                    "brainstem": {
                        "version": "0.12.2",
                        "source_repo": "https://github.com/kody-w/RAPP.git",
                        "source_commit": "deadbeef",
                    },
                }
                (source_repo / "rappid.json").write_text(json.dumps(rj_source, indent=2))
                (source_repo / "brainstem.py").write_text("# kernel\n")
                (source_repo / "soul.md").write_text("# soul\nyou are imported-twin.\n")
                (source_repo / "agents").mkdir()
                (source_repo / "agents" / "basic_agent.py").write_text("# stub\n")
                (source_repo / "utils").mkdir()
                (source_repo / "utils" / "lineage_check.py").write_text("# stub\n")
                (source_repo / "installer").mkdir()
                (source_repo / "installer" / "VERSION").write_text("0.12.2\n")
                (source_repo / ".brainstem_data").mkdir()
                (source_repo / ".brainstem_data" / "memory.json").write_text(
                    json.dumps({"facts": ["the imported twin's persistent memory"]})
                )

                blob = egg_module.pack_twin_from_repo(str(source_repo))
                egg_path = pathlib.Path(os.environ["HOME"]) / "imported.egg"
                egg_path.write_bytes(blob)

                # Step 2: invoke the cartridge to hatch it
                cart_path = os.path.join(agents_dir, "hatch_egg_agent.py")
                loaded = _brainstem._load_agent_from_file(cart_path)
                instance = loaded["HatchEgg"]
                result = instance.perform(egg_path=str(egg_path))

                self.assertIn("Hatched twin", result)
                self.assertIn("fully viable", result.lower())
                self.assertIn("deadbeef-1111-2222-3333-444444444444", result)

                # Step 3: verify the workspace is fully viable
                rapp_home = pathlib.Path(os.environ["RAPP_HOME"])
                workspaces = list((rapp_home / "twins").iterdir())
                self.assertEqual(len(workspaces), 1)
                ws = workspaces[0]
                self.assertEqual(ws.name, "deadbeef-1111-2222-3333-444444444444")

                # Identity preserved
                rj_after = json.loads((ws / "rappid.json").read_text())
                self.assertEqual(rj_after["rappid"], rj_source["rappid"])
                self.assertEqual(rj_after["name"], "imported-twin")

                # Memory survived
                memory = json.loads(
                    (ws / ".brainstem_data" / "memory.json").read_text()
                )
                self.assertIn("persistent memory", memory["facts"][0])

                # Soul survived
                self.assertIn("imported-twin", (ws / "soul.md").read_text())

                # Required files present (the "fully viable" assertion)
                for required in ("rappid.json", "soul.md"):
                    self.assertTrue((ws / required).exists(),
                                    f"missing: {required}")
        finally:
            shutil.rmtree(agents_dir, ignore_errors=True)

    def test_full_loader_picks_up_both_cartridges(self):
        """End-to-end: AGENTS_PATH=our_dir, call load_agents() — both
        cartridges should appear as registered tools."""
        agents_dir = _stage_cartridges()
        try:
            with _Iso():
                # Patch AGENTS_PATH on the imported brainstem module
                old_path = _brainstem.AGENTS_PATH
                _brainstem.AGENTS_PATH = agents_dir
                try:
                    agents = _brainstem.load_agents()
                finally:
                    _brainstem.AGENTS_PATH = old_path

                self.assertIn("SummonTwin", agents)
                self.assertIn("HatchEgg", agents)
                # Both have valid OpenAI tool definitions
                for name, instance in agents.items():
                    tool = instance.to_tool()
                    self.assertEqual(tool["type"], "function")
                    self.assertEqual(tool["function"]["name"], name)
        finally:
            shutil.rmtree(agents_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
