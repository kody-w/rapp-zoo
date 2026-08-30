import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import unittest

from agents.hologram_forge_agent import HologramForgeAgent
from utils import holo_protocol as backend_holo_protocol


ROOT = Path(__file__).resolve().parents[1]
BLANK = json.loads(
    (
        ROOT
        / "holograms"
        / "protocol"
        / "examples"
        / "minimal-blank-output.json"
    ).read_text(encoding="utf-8")
)
CORPUS = json.loads(
    (
        ROOT / "holograms" / "protocol" / "fixtures" / "corpus.json"
    ).read_text(encoding="utf-8")
)


class HologramOutputAgentTests(unittest.TestCase):
    def setUp(self):
        self.agent = HologramForgeAgent()

    def perform(self, **kwargs):
        return json.loads(self.agent.perform(**kwargs))

    def test_agent_copy_identifies_rolling_core_growth_frames(self):
        self.assertIn(
            "Rolling Core rapp-holo-output/1 growth frame",
            self.agent.metadata["description"],
        )

    def test_returns_exact_authored_object_and_cross_language_hash(self):
        authored = copy.deepcopy(BLANK)
        before = copy.deepcopy(authored)
        result = self.perform(authored_holo_output=authored)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["authored"], authored)
        self.assertEqual(authored, before)
        self.assertEqual(
            result["authored_hash"],
            "cd93fe4410bb59439333b3ab9dbb4376831ece2b3bb06c02447ca33e6ac8df0d",
        )
        self.assertEqual(result["authored"]["growl"], before["growl"])

    def test_accepts_representable_ir_without_visual_defaults(self):
        authored = copy.deepcopy(BLANK)
        authored["state"]["nodes"].append(
            {
                "id": "signal-orb",
                "parent": None,
                "type": "primitive",
                "visible": True,
                "transform": {
                    "position": [0, 0, 0],
                    "rotation": [0, 0, 0],
                    "scale": [1000, 1000, 1000],
                },
                "geometry": {
                    "shape": "sphere",
                    "radius": 1000,
                    "detail": 2,
                },
                "material": {
                    "color": "#123456",
                    "emissive": "#000000",
                    "emissive_strength": 0,
                    "opacity": 1000,
                    "presentation": "solid",
                    "blend": "normal",
                    "side": "front",
                    "metallic": 0,
                    "roughness": 1000,
                },
            }
        )
        result = self.perform(authored_holo_output=authored)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["authored"], authored)

    def test_refuses_missing_fields_without_repair(self):
        authored = copy.deepcopy(BLANK)
        del authored["accessibility"]
        before = copy.deepcopy(authored)
        result = self.perform(authored_holo_output=authored)

        self.assertEqual(result["status"], "refused")
        self.assertIn("missing=['accessibility']", result["message"])
        self.assertEqual(authored, before)
        self.assertNotIn("authored", result)

    def test_refuses_unknown_content_and_invalid_conditionals(self):
        unknown = copy.deepcopy(BLANK)
        unknown["state"]["camera"]["executable"] = "not part of Holo/1"
        result = self.perform(authored_holo_output=unknown)
        self.assertEqual(result["status"], "refused")
        self.assertIn("extra=['executable']", result["message"])

        invalid_camera = copy.deepcopy(BLANK)
        invalid_camera["state"]["camera"]["ortho_height"] = 1000
        result = self.perform(authored_holo_output=invalid_camera)
        self.assertEqual(result["status"], "refused")

    def test_legacy_frame_and_design_generation_is_explicitly_refused(self):
        result = self.perform(frame_json="{}", design_json="{}")
        self.assertEqual(result["status"], "refused")
        self.assertIn("legacy post-hoc", result["message"])
        self.assertEqual(
            set(self.agent.metadata["parameters"]["required"]),
            {"authored_holo_output"},
        )

    def test_agent_delegates_to_shared_validator_without_local_fallback(self):
        source = (
            ROOT / "agents" / "hologram_forge_agent.py"
        ).read_text(encoding="utf-8")
        self.assertIn("accepted = HOLO_PROTOCOL.validate_output(", source)
        self.assertIn("HOLO_PROTOCOL.authored_hash(authored)", source)
        self.assertIn('HOLO_PROTOCOL.growl_events(accepted["growl"])', source)
        self.assertNotIn("def _assert_schema", source)
        self.assertNotIn("def _validate_holo_output", source)
        self.assertNotIn("complete_growl", source)
        self.assertNotIn("nibble", source)
        self.assertNotIn("deltas", source)

    def test_agent_preserves_authored_growl_without_completion(self):
        authored = copy.deepcopy(BLANK)
        before = copy.deepcopy(authored)
        result = self.perform(authored_holo_output=authored)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(authored, before)
        self.assertEqual(result["authored"], before)
        self.assertEqual(len(result["authored"]["growl"]["prompt"]), 8)
        self.assertGreater(
            len(result["authored"]["growl"]["continuation"]),
            0,
        )
        for event in (
            result["authored"]["growl"]["prompt"]
            + result["authored"]["growl"]["continuation"]
        ):
            self.assertEqual(
                set(event),
                {"pitch", "delta_onset", "duration", "velocity"},
            )

        missing = copy.deepcopy(BLANK)
        del missing["growl"]
        self.assertEqual(
            self.perform(authored_holo_output=missing)["status"],
            "refused",
        )

    def test_backend_and_agent_share_semantic_and_emoji_boundaries(self):
        nonexistent_parent = copy.deepcopy(BLANK)
        nonexistent_parent["state"]["nodes"].append(
            {
                "id": "orphan",
                "parent": "missing",
                "type": "group",
                "visible": True,
                "transform": {
                    "position": [0, 0, 0],
                    "rotation": [0, 0, 0],
                    "scale": [1000, 1000, 1000],
                },
                "geometry": None,
                "material": None,
            }
        )
        transition_mismatch = copy.deepcopy(BLANK)
        transition_mismatch["state"]["nodes"].append(
            {
                "id": "arrival",
                "parent": None,
                "type": "group",
                "visible": True,
                "transform": {
                    "position": [0, 0, 0],
                    "rotation": [0, 0, 0],
                    "scale": [1000, 1000, 1000],
                },
                "geometry": None,
                "material": None,
            }
        )
        transition_mismatch["transition"]["nodes"].append(
            {"id": "arrival", "mode": "crossfade"}
        )
        emoji_at_limit = copy.deepcopy(BLANK)
        emoji_at_limit["accessibility"]["description"] = "🧭" * 1024
        emoji_over_limit = copy.deepcopy(emoji_at_limit)
        emoji_over_limit["accessibility"]["description"] += "🧭"
        missing_growl = copy.deepcopy(BLANK)
        del missing_growl["growl"]
        invalid_growl = copy.deepcopy(BLANK)
        invalid_growl["growl"]["prompt"] = invalid_growl["growl"]["prompt"][:7]

        for name, authored, accepted in (
            ("nonexistent parent", nonexistent_parent, False),
            ("semantic transition mismatch", transition_mismatch, False),
            ("emoji at boundary", emoji_at_limit, True),
            ("emoji over boundary", emoji_over_limit, False),
            ("missing growl", missing_growl, False),
            ("invalid growl motif", invalid_growl, False),
        ):
            with self.subTest(case=name):
                try:
                    backend_holo_protocol.validate_output(authored)
                    backend_status = "ok"
                except backend_holo_protocol.HoloProtocolError:
                    backend_status = "refused"
                agent_status = self.perform(
                    authored_holo_output=authored
                )["status"]
                expected = "ok" if accepted else "refused"
                self.assertEqual(backend_status, expected)
                self.assertEqual(agent_status, expected)

    def test_agent_accepts_verified_base_and_ancestor_context(self):
        authored = copy.deepcopy(CORPUS["documents"]["historical-flipbook"])
        base = copy.deepcopy(
            CORPUS["documents"]["multi-node-non-humanoid-scene"]
        )
        ancestors = {
            "a" * 64: copy.deepcopy(
                CORPUS["documents"]["blank-valid-output"]
            ),
            "b" * 64: copy.deepcopy(base),
        }
        result = self.perform(
            authored_holo_output=authored,
            base_holo_output=base,
            ancestor_holo_outputs=ancestors,
        )
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["authored"], authored)

    def test_installed_agent_resolves_the_app_owned_shared_module(self):
        scratch = ROOT / f".hologram-agent-test-{os.getpid()}"
        installed_agents = scratch / "agents"
        protocol_dir = installed_agents / "rapp_zoo_holo_protocol"
        try:
            protocol_dir.mkdir(parents=True)
            shutil.copy2(
                ROOT / "agents" / "hologram_forge_agent.py",
                installed_agents / "rapp_zoo_hologram_forge_agent.py",
            )
            for filename in ("holo_protocol.py", "rapp_protocol.py"):
                shutil.copy2(ROOT / "utils" / filename, protocol_dir / filename)
            module_path = installed_agents / "rapp_zoo_hologram_forge_agent.py"
            spec = importlib.util.spec_from_file_location(
                "installed_hologram_forge_agent",
                module_path,
            )
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.assertEqual(
                Path(module.HOLO_PROTOCOL.__file__).resolve(),
                (protocol_dir / "holo_protocol.py").resolve(),
            )
            result = json.loads(
                module.HologramForgeAgent().perform(
                    authored_holo_output=copy.deepcopy(BLANK)
                )
            )
            self.assertEqual(result["status"], "ok")
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    def test_installed_agent_refuses_to_fall_back_without_shared_module(self):
        scratch = ROOT / f".hologram-agent-missing-test-{os.getpid()}"
        installed_agents = scratch / "agents"
        try:
            installed_agents.mkdir(parents=True)
            module_path = installed_agents / "rapp_zoo_hologram_forge_agent.py"
            shutil.copy2(
                ROOT / "agents" / "hologram_forge_agent.py",
                module_path,
            )
            spec = importlib.util.spec_from_file_location(
                "missing_hologram_forge_agent",
                module_path,
            )
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            with self.assertRaisesRegex(
                ImportError,
                "shared Holo/1 validator is unavailable",
            ):
                spec.loader.exec_module(module)
        finally:
            shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
