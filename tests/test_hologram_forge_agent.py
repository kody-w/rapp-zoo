import copy
import json
from pathlib import Path
import unittest

from agents.hologram_forge_agent import HologramForgeAgent


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


class HologramOutputAgentTests(unittest.TestCase):
    def setUp(self):
        self.agent = HologramForgeAgent()

    def perform(self, **kwargs):
        return json.loads(self.agent.perform(**kwargs))

    def test_returns_exact_authored_object_and_cross_language_hash(self):
        authored = copy.deepcopy(BLANK)
        before = copy.deepcopy(authored)
        result = self.perform(authored_holo_output=authored)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["authored"], authored)
        self.assertEqual(authored, before)
        self.assertEqual(
            result["authored_hash"],
            "4a37cce65057ee3c8a2f4c133c28a08b2d26f8f7779143ac62c2beeeff5968b9",
        )

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
        self.assertIn("accessibility is required", result["message"])
        self.assertEqual(authored, before)
        self.assertNotIn("authored", result)

    def test_refuses_executable_content_and_invalid_conditionals(self):
        executable = copy.deepcopy(BLANK)
        executable["accessibility"]["description"] = "Load https://example.test/a.js"
        result = self.perform(authored_holo_output=executable)
        self.assertEqual(result["status"], "refused")
        self.assertIn("executable or remote content", result["message"])

        expressive = copy.deepcopy(BLANK)
        expressive["accessibility"]["description"] = (
            "A shell of light unfolds through shader-like bands."
        )
        result = self.perform(authored_holo_output=expressive)
        self.assertEqual(result["status"], "ok", result)

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


if __name__ == "__main__":
    unittest.main()
