"""Compatibility checks against the pinned public RAPP reference implementation."""

import importlib.util
import json
import os
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "utils"))

import rapp_protocol as Z


REFERENCE = os.environ.get("RAPP1_REFERENCE_PATH")


@unittest.skipUnless(REFERENCE and pathlib.Path(REFERENCE).is_file(), "pinned rapp.py not provided")
class TestReferenceCompatibility(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("rapp_public_reference", REFERENCE)
        cls.reference = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.reference)

    def test_address_primitives_match(self):
        values = [
            None,
            True,
            42,
            "hello",
            [1, "two", False],
            {"b": 1, "a": {"x": "y"}},
        ]
        for value in values:
            self.assertEqual(Z.canonical(value), self.reference.canonical(value))
            self.assertEqual(
                Z.H("rapp/1:particle", value),
                self.reference.H("rapp/1:particle", value),
            )
        self.assertEqual(
            Z.Hb("rapp/1:egg", b"bytes"),
            self.reference.Hb("rapp/1:egg", b"bytes"),
        )

    def test_public_verifier_accepts_zoo_eggs(self):
        rid = Z.mint_rappid("kody-w", "compat", uuid_bytes=b"c" * 16)
        blob = Z.pack_egg(
            "organism",
            rid,
            "2026-08-28T20:00:00.000Z",
            files={
                "rappid.json": json.dumps(
                    {"schema": "rapp/1", "rappid": rid}
                ).encode(),
                "soul.md": b"# soul\n",
            },
        )
        self.assertEqual(self.reference.verify_egg(blob), (True, None, "ok"))


if __name__ == "__main__":
    unittest.main()
