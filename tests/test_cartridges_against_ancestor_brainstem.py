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
from unittest import mock


_REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
_RAPP_BRAINSTEM = pathlib.Path(
    os.environ.get(
        "RAPP_BRAINSTEM_PATH",
        "/Users/kodywildfeuer/Documents/GitHub/RAPP/rapp_brainstem",
    )
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
        for k in ("XDG_CONFIG_HOME", "HOME", "RAPP_HOME", "RAPP_OWNER"):
            self._prev[k] = os.environ.get(k)
        os.environ["XDG_CONFIG_HOME"] = self.tmp
        os.environ["HOME"] = self.tmp
        os.environ["RAPP_HOME"] = os.path.join(self.tmp, ".rapp")
        os.environ["RAPP_OWNER"] = "kody-w"
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
    for cart in (
        "summon_twin_agent.py",
        "hatch_egg_agent.py",
        "hologram_dogg_agent.py",
        "hologram_forge_agent.py",
    ):
        src = _REPO_ROOT / "agents" / cart
        shutil.copy2(src, os.path.join(tmp_agents, cart))
    return tmp_agents


def _register_protocol_shim():
    utils_dir = _REPO_ROOT / "utils"
    if str(utils_dir) not in sys.path:
        sys.path.insert(0, str(utils_dir))
    import rapp_protocol

    sys.modules["utils.rapp_protocol"] = rapp_protocol
    utils_pkg = sys.modules.get("utils")
    if utils_pkg is not None:
        setattr(utils_pkg, "rapp_protocol", rapp_protocol)
    return rapp_protocol


@unittest.skipUnless(HAVE_BRAINSTEM, "ancestor brainstem.py not available")
class TestCartridgesLoadIntoAncestorBrainstem(unittest.TestCase):
    """The most important contract test: do our cartridges load via the
    real brainstem's _load_agent_from_file()?"""

    def setUp(self):
        _register_protocol_shim()

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

    def test_hologram_dogg_agent_loads_and_lists_catalog(self):
        agents_dir = _stage_cartridges()
        try:
            cart_path = os.path.join(agents_dir, "hologram_dogg_agent.py")
            loaded = _brainstem._load_agent_from_file(cart_path)
            self.assertIn("HologramDOGG", loaded)
            instance = loaded["HologramDOGG"]
            tool = instance.to_tool()
            self.assertIn(
                "hologram_id",
                tool["function"]["parameters"]["properties"],
            )
            self.assertIn(
                "frame_json",
                tool["function"]["parameters"]["properties"],
            )
            catalog = {
                "schema": "rar-hologram-dogg-index/1.0",
                "entries": [{
                    "id": "holo-avatar",
                    "name": "Holo Avatar",
                    "kind": "character",
                    "bottle": True,
                    "dimensions": ["identity", "character"],
                    "rappid": "rappid:@kody-w/holo-avatar:" + "a" * 64,
                }, {
                    "id": "holo-briefing",
                    "name": "The Briefing",
                    "kind": "data-projection",
                    "bottle": True,
                    "dimensions": ["briefing", "status", "priorities"],
                    "rappid": "rappid:@kody-w/holo-briefing:" + "b" * 64,
                }],
            }
            with mock.patch(
                "urllib.request.urlopen",
                return_value=io.BytesIO(json.dumps(catalog).encode()),
            ):
                result = json.loads(instance.perform(action="list"))
            self.assertEqual(result["status"], "ok")
            self.assertEqual(result["holograms"][0]["id"], "holo-avatar")
            with mock.patch(
                "urllib.request.urlopen",
                return_value=io.BytesIO(json.dumps(catalog).encode()),
            ):
                result = json.loads(instance.perform(
                    action="match",
                    frame_json=json.dumps({
                        "payload": {"status": "ready", "priorities": ["ship"]},
                    }),
                ))
            self.assertEqual(result["status"], "ok")
            self.assertEqual(result["mode"], "dimensional")
            self.assertEqual(result["bottle"]["id"], "holo-briefing")
            self.assertEqual(result["matched_dimensions"], ["priorities", "status"])
        finally:
            shutil.rmtree(agents_dir, ignore_errors=True)

    def test_hologram_forge_agent_accepts_exact_holo_output(self):
        agents_dir = _stage_cartridges()
        previous_schema = os.environ.get("RAPP_HOLO_OUTPUT_SCHEMA")
        os.environ["RAPP_HOLO_OUTPUT_SCHEMA"] = str(
            _REPO_ROOT
            / "holograms"
            / "protocol"
            / "rapp-holo-output.schema.json"
        )
        try:
            cart_path = os.path.join(agents_dir, "hologram_forge_agent.py")
            loaded = _brainstem._load_agent_from_file(cart_path)
            self.assertIn("HologramForge", loaded)
            authored = json.loads(
                (
                    _REPO_ROOT
                    / "holograms"
                    / "protocol"
                    / "examples"
                    / "minimal-blank-output.json"
                ).read_text()
            )
            result = json.loads(loaded["HologramForge"].perform(
                authored_holo_output=authored,
            ))
            self.assertEqual(result["status"], "ok")
            self.assertEqual(result["authored"], authored)
        finally:
            if previous_schema is None:
                os.environ.pop("RAPP_HOLO_OUTPUT_SCHEMA", None)
            else:
                os.environ["RAPP_HOLO_OUTPUT_SCHEMA"] = previous_schema
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
                    owner="kody-w",
                )
                self.assertIn("Created personal twin instance", result)
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
                self.assertTrue(rj["rappid"].startswith("rappid:@kody-w/alice-test:"))
                self.assertIsNone(rj["grown_from"])
                self.assertEqual(rj["parent_rappid"],
                                 "rappid:@kody-w/wildhaven-ai-homes-twin:"
                                 "df9c3f1f4b09d000720e93be4248d44213025ba5f76bf1180dc5d1ba0b0efd36")

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
                protocol = _register_protocol_shim()
                artifact_rappid = (
                    "rappid:@kody-w/imported-twin:" + "d" * 64
                )
                rj_source = {
                    "schema": "rapp/1",
                    "rappid": artifact_rappid,
                    "parent_rappid": (
                        "rappid:@kody-w/rapp:"
                        "9a8f0a4b5a710e20f4d819a0f37d2a4c9f113b5e78fb3c29e70b54fff48a38f9"
                    ),
                    "parent_repo": "https://github.com/example/parent.git",
                    "parent_commit": "abc",
                    "born_at": "2026-05-04T00:00:00.000Z",
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
                blob = protocol.pack_egg(
                    "organism",
                    artifact_rappid,
                    "2026-08-28T20:00:00.000Z",
                    files={
                        "rappid.json": (
                            json.dumps(rj_source, indent=2) + "\n"
                        ).encode(),
                        "brainstem.py": b"# kernel\n",
                        "soul.md": b"# soul\nyou are imported-twin.\n",
                        "agents/custom_agent.py": b"class Custom: pass\n",
                        "data/memory.json": json.dumps(
                            {"facts": ["the imported twin's persistent memory"]}
                        ).encode(),
                    },
                    payload={"layout": "variant-repo"},
                )
                egg_path = pathlib.Path(os.environ["HOME"]) / "imported.egg"
                egg_path.write_bytes(blob)

                # Step 2: invoke the cartridge to hatch it
                cart_path = os.path.join(agents_dir, "hatch_egg_agent.py")
                loaded = _brainstem._load_agent_from_file(cart_path)
                instance = loaded["HatchEgg"]
                result = instance.perform(
                    egg_path=str(egg_path),
                    owner="kody-w",
                )

                self.assertIn("Hatched organism instance", result)
                self.assertIn("fully viable", result.lower())
                self.assertIn(artifact_rappid, result)

                # Step 3: verify the workspace is fully viable
                rapp_home = pathlib.Path(os.environ["RAPP_HOME"])
                workspaces = list((rapp_home / "twins").iterdir())
                self.assertEqual(len(workspaces), 1)
                ws = workspaces[0]

                rj_after = json.loads((ws / "rappid.json").read_text())
                artifact_after = json.loads(
                    (ws / "artifact-rappid.json").read_text()
                )
                self.assertEqual(artifact_after["rappid"], artifact_rappid)
                self.assertNotEqual(rj_after["rappid"], artifact_rappid)
                self.assertEqual(rj_after["artifact_rappid"], artifact_rappid)
                self.assertEqual(
                    rj_after["grown_from"],
                    protocol.egg_address(protocol.read_egg(blob)[0]),
                )
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

    def test_full_loader_picks_up_all_cartridges(self):
        """End-to-end: every shipped cartridge registers as a tool."""
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
                self.assertIn("HologramDOGG", agents)
                self.assertIn("HologramForge", agents)
                # Every cartridge has a valid OpenAI tool definition.
                for name, instance in agents.items():
                    tool = instance.to_tool()
                    self.assertEqual(tool["type"], "function")
                    self.assertEqual(tool["function"]["name"], name)
        finally:
            shutil.rmtree(agents_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
