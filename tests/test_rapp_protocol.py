"""Controlled and adversarial checks for the vendored RAPP/1 primitives."""

import base64
import io
import json
import pathlib
import sys
import unittest
import zipfile


ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "utils"))

import rapp_protocol as R


def identity(rappid: str, name: str = "test") -> bytes:
    return (
        json.dumps(
            {"schema": "rapp/1", "rappid": rappid, "name": name},
            indent=2,
        )
        + "\n"
    ).encode()


def organism_egg(slug: str = "organism", byte: bytes = b"a") -> tuple[str, bytes]:
    rid = R.mint_rappid("kody-w", slug, uuid_bytes=byte * 16)
    blob = R.pack_egg(
        "organism",
        rid,
        "2026-08-28T20:00:00.000Z",
        files={"rappid.json": identity(rid, slug), "soul.md": b"# soul\n"},
        payload={"layout": "variant-repo"},
    )
    return rid, blob


class TestCanonicalization(unittest.TestCase):
    def test_utf16_key_order_and_domain_separation(self):
        value = {"\ue000": 1, "\U00010000": 2}
        self.assertEqual(R.canonical(value), '{"𐀀":2,"":1}')
        self.assertNotEqual(R.H("rapp/1:particle", value), R.H("rapp/1:wave", value))

    def test_refuses_out_of_domain_values(self):
        with self.assertRaises(R.ProtocolError):
            R.canonical(2**53)
        with self.assertRaises(R.ProtocolError):
            R.canonical(0.5)
        with self.assertRaises(R.ProtocolError):
            R.strict_json_loads('{"a":1,"a":2}')
        with self.assertRaises(R.ProtocolError):
            R.strict_json_loads('"\\ud800"')

    def test_rappid_mint_is_not_name_hash(self):
        rid = R.mint_rappid("kody-w", "test", uuid_bytes=b"x" * 16)
        self.assertTrue(R.rappid_valid(rid))
        self.assertNotEqual(
            rid.rsplit(":", 1)[1],
            __import__("hashlib").sha256(b"kody-w/test").hexdigest(),
        )

    def test_frame_build_verify_and_tamper_refusal(self):
        stream = R.mint_rappid("kody-w", "frame", uuid_bytes=b"f" * 16)
        frame = R.build_frame(
            "body.pulse",
            stream,
            0,
            "2026-08-28T20:00:00.000Z",
            {"query": "briefing", "dimensions": ["status"]},
            None,
        )
        self.assertEqual(
            R.verify_frame(
                frame,
                stream_id_of_record=stream,
            ),
            (True, None, "ok"),
        )
        tampered = {**frame, "payload": {"query": "other"}}
        self.assertEqual(R.verify_frame(tampered)[1], "2")

        successor = R.build_frame(
            "body.pulse",
            stream,
            1,
            "2026-08-28T20:00:01.000Z",
            {"query": "next"},
            frame["payload_hash"],
            head=frame,
        )
        self.assertEqual(R.verify_frame(successor)[1], "4")
        self.assertEqual(
            R.verify_frame(
                successor,
                head=frame,
                stream_id_of_record=stream,
            ),
            (True, None, "ok"),
        )

        def rehash(candidate):
            candidate["frame_hash"] = R.H(
                "rapp/1:wave",
                {
                    key: value
                    for key, value in candidate.items()
                    if key not in {"frame_hash", "sig"}
                },
            )
            return candidate

        unregistered = rehash({**frame, "kind": "evil.execute"})
        self.assertEqual(R.verify_frame(unregistered)[1], "1")
        wrong_family = rehash({**frame, "kind": "memory.chat-turn"})
        self.assertEqual(R.verify_frame(wrong_family)[1], "1")
        malformed_sig = {**frame, "sig": "not-a-jws"}
        self.assertEqual(R.verify_frame(malformed_sig)[1], "1")


class TestEggs(unittest.TestCase):
    def test_deterministic_organism_zip(self):
        rid, first = organism_egg()
        _, second = organism_egg()
        self.assertEqual(first, second)
        self.assertEqual(R.verify_egg(first), (True, None, "ok"))
        manifest, _ = R.read_egg(first)
        self.assertEqual(manifest["rappid"], rid)
        with zipfile.ZipFile(io.BytesIO(first)) as archive:
            for info in archive.infolist():
                self.assertEqual(info.compress_type, zipfile.ZIP_STORED)
                self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertTrue(info.flag_bits & 0x800)

    def test_rapplication_and_session_variants(self):
        rid = R.mint_rappid("kody-w", "app", uuid_bytes=b"b" * 16)
        app = R.pack_egg(
            "rapplication",
            rid,
            "2026-08-28T20:00:00.000Z",
            files={
                "rappid.json": identity(rid),
                "agent.py": b"class App: pass\n",
                "ui.html": b"<p>app</p>\n",
            },
            payload={"rapp_id": "app"},
        )
        self.assertEqual(R.verify_egg(app), (True, None, "ok"))

        session = R.pack_egg(
            "session",
            rid,
            "2026-08-28T20:00:00.000Z",
            payload={"runtime": "brainstem", "transcript": [{"role": "user"}]},
        )
        self.assertFalse(session.startswith(b"PK"))
        self.assertEqual(R.verify_egg(session), (True, None, "ok"))
        with self.assertRaises(R.ProtocolError):
            R.pack_egg(
                "rapplication",
                rid,
                "2026-08-28T20:00:00.000Z",
                files={"rappid.json": identity(rid)},
            )

    def test_nested_neighborhood_and_estate(self):
        rid_a, egg_a = organism_egg("alpha", b"a")
        rid_b, egg_b = organism_egg("beta", b"b")
        neighborhood_rid = R.mint_rappid(
            "kody-w", "neighborhood", uuid_bytes=b"n" * 16
        )
        neighborhood = R.pack_egg(
            "neighborhood",
            neighborhood_rid,
            "2026-08-28T20:00:00.000Z",
            files={
                "kody-w--alpha.egg": egg_a,
                "kody-w--beta.egg": egg_b,
            },
            payload={"members": [rid_a, rid_b]},
        )
        self.assertEqual(R.verify_egg(neighborhood), (True, None, "ok"))

        estate_rid = R.mint_rappid("kody-w", "estate", uuid_bytes=b"e" * 16)
        estate = R.pack_egg(
            "estate",
            estate_rid,
            "2026-08-28T20:00:00.000Z",
            files={"kody-w--neighborhood.egg": neighborhood},
            payload={"neighborhoods": [neighborhood_rid]},
        )
        self.assertEqual(R.verify_egg(estate), (True, None, "ok"))

    def test_signed_invite_requires_verified_estate_owner(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ed25519

        private_key = ed25519.Ed25519PrivateKey.generate()
        spki = private_key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        owner_rid = R.mint_rappid("kody-w", "estate-owner", spki_der=spki)
        registry_unsigned = {
            "schema": "rapp/1-registry",
            "registry_seq": 1,
            "entries": [
                {"type": "estate_owner", "rappid": owner_rid},
                {
                    "type": "kind",
                    "kind": "body.pulse",
                    "family": "body",
                    "deprecated": False,
                },
                {
                    "type": "spki",
                    "rappid": owner_rid,
                    "spki_der_b64": base64.b64encode(spki).decode(),
                    "deprecated": False,
                },
            ],
        }
        registry = {
            **registry_unsigned,
            "sig": R.sign_detached_jws(registry_unsigned, private_key, owner_rid),
        }
        trust = R.RegistryTrust(
            registry,
            trust_anchor_rappid=owner_rid,
            trust_anchor_spki_der=spki,
        )

        target_rid, _ = organism_egg("target", b"t")
        payload = {
            "target_rappid": target_rid,
            "target_url": "https://example.test/target.egg",
            "target_kind": "neighborhood",
        }
        unsigned, _ = R.build_egg_manifest(
            "invite",
            owner_rid,
            "2026-08-28T20:00:00.000Z",
            payload=payload,
        )
        unsigned.pop("sig")
        sig = R.sign_detached_jws(unsigned, private_key, owner_rid)
        invite = R.pack_egg(
            "invite",
            owner_rid,
            "2026-08-28T20:00:00.000Z",
            payload=payload,
            sig=sig,
            signature_verifier=trust.verify_egg_signature,
        )
        self.assertEqual(
            R.verify_egg(invite, signature_verifier=trust.verify_egg_signature),
            (True, None, "ok"),
        )
        self.assertEqual(R.verify_egg(invite)[1], "§10")

        frame = R.build_frame(
            "body.pulse",
            owner_rid,
            0,
            "2026-08-28T20:00:00.000Z",
            {"query": "signed briefing"},
            None,
        )
        unsigned_frame = {
            key: value for key, value in frame.items() if key != "sig"
        }
        frame["sig"] = R.sign_detached_jws(
            unsigned_frame,
            private_key,
            owner_rid,
        )
        self.assertEqual(R.verify_frame(frame)[1], "6")
        self.assertEqual(
            R.verify_frame(
                frame,
                kind_families=trust.kind_families,
                signature_verifier=trust.verify_frame_signature,
            ),
            (True, None, "ok"),
        )

    def test_owner_rotation_accepts_history_and_refuses_superseded_signer(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ed25519

        old_key = ed25519.Ed25519PrivateKey.generate()
        new_key = ed25519.Ed25519PrivateKey.generate()
        public = lambda key: key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        old_spki, new_spki = public(old_key), public(new_key)
        old_rid = R.mint_rappid("kody-w", "owner-old", spki_der=old_spki)
        new_rid = R.mint_rappid("kody-w", "owner-new", spki_der=new_spki)
        rotation_value = {
            "type": "re-anchor",
            "old_rappid": old_rid,
            "new_rappid": new_rid,
            "case": "rotation",
            "utc": "2026-08-28T20:00:00.000Z",
        }
        rotation = {
            **rotation_value,
            "old_key_sig": R.sign_detached_jws(rotation_value, old_key, old_rid),
            "sig": R.sign_detached_jws(rotation_value, old_key, old_rid),
        }
        registry_unsigned = {
            "schema": "rapp/1-registry",
            "registry_seq": 2,
            "entries": [
                {"type": "estate_owner", "rappid": new_rid},
                {
                    "type": "spki",
                    "rappid": old_rid,
                    "spki_der_b64": base64.b64encode(old_spki).decode(),
                    "deprecated": True,
                },
                {
                    "type": "spki",
                    "rappid": new_rid,
                    "spki_der_b64": base64.b64encode(new_spki).decode(),
                    "deprecated": False,
                },
                rotation,
            ],
        }
        registry = {
            **registry_unsigned,
            "sig": R.sign_detached_jws(registry_unsigned, new_key, new_rid),
        }
        trust = R.RegistryTrust(
            registry,
            trust_anchor_rappid=new_rid,
            trust_anchor_spki_der=new_spki,
        )
        payload = {
            "target_rappid": new_rid,
            "target_url": "https://example.test/estate.egg",
            "target_kind": "estate",
        }

        def signed_invite(created):
            unsigned, files = R.build_egg_manifest(
                "invite", old_rid, created, payload=payload
            )
            value = {key: val for key, val in unsigned.items() if key != "sig"}
            signed = {**unsigned, "sig": R.sign_detached_jws(value, old_key, old_rid)}
            return R.serialize_egg(signed, files)

        self.assertEqual(
            R.verify_egg(
                signed_invite("2026-08-28T19:59:59.999Z"),
                signature_verifier=trust.verify_egg_signature,
            ),
            (True, None, "ok"),
        )
        self.assertEqual(
            R.verify_egg(
                signed_invite("2026-08-28T20:00:00.000Z"),
                signature_verifier=trust.verify_egg_signature,
            )[1],
            "§10",
        )

    def test_mutations_are_refused_whole(self):
        _, blob = organism_egg()
        manifest, files = R.read_egg(blob)

        bad_files = dict(files)
        bad_files["soul.md"] = b"# tampered\n"
        tampered = R.serialize_egg(manifest, bad_files)
        self.assertEqual(R.verify_egg(tampered)[1], "§5")

        extra_manifest = {**manifest, "extra": True}
        extra = R._stored_zip(
            [
                ("manifest.json", R.canonical(extra_manifest).encode()),
                *[(item["path"], files[item["path"]]) for item in manifest["contents"]],
            ]
        )
        self.assertEqual(R.verify_egg(extra)[1], "§9.1")

        compressed_buf = io.BytesIO()
        with zipfile.ZipFile(compressed_buf, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", R.canonical(manifest))
            for item in manifest["contents"]:
                archive.writestr(item["path"], files[item["path"]])
        self.assertEqual(R.verify_egg(compressed_buf.getvalue())[1], "§9.1")

        noncanonical = R._stored_zip(
            [
                ("manifest.json", json.dumps(manifest, indent=2).encode()),
                *[(item["path"], files[item["path"]]) for item in manifest["contents"]],
            ]
        )
        self.assertEqual(R.verify_egg(noncanonical)[1], "§9.1")

        reversed_entries = R._stored_zip(
            [
                ("manifest.json", R.canonical(manifest).encode()),
                *[
                    (item["path"], files[item["path"]])
                    for item in reversed(manifest["contents"])
                ],
            ]
        )
        self.assertEqual(R.verify_egg(reversed_entries)[1], "§9.1")

        duplicate = R._stored_zip(
            [
                ("manifest.json", R.canonical(manifest).encode()),
                ("rappid.json", files["rappid.json"]),
                ("rappid.json", files["rappid.json"]),
                ("soul.md", files["soul.md"]),
            ]
        )
        self.assertEqual(R.verify_egg(duplicate)[1], "parse")

        traversal_manifest = {
            **manifest,
            "contents": [{"path": "../escape", "hash": R.Hb("rapp/1:egg", b"x")}],
        }
        traversal = R._stored_zip(
            [
                ("manifest.json", R.canonical(traversal_manifest).encode()),
                ("../escape", b"x"),
            ]
        )
        self.assertEqual(R.verify_egg(traversal)[1], "§9.1")

        corrupt = bytearray(blob)
        marker = corrupt.find(b"# soul\n")
        self.assertGreater(marker, 0)
        corrupt[marker] ^= 1
        self.assertEqual(R.verify_egg(bytes(corrupt))[1], "parse")

    def test_egg_address_ignores_signature(self):
        rid = R.mint_rappid("kody-w", "invite", uuid_bytes=b"i" * 16)
        first, _ = R.build_egg_manifest(
            "session",
            rid,
            "2026-08-28T20:00:00.000Z",
            payload={"runtime": "x", "transcript": []},
            sig="one",
        )
        second = {**first, "sig": "two"}
        self.assertEqual(R.egg_address(first), R.egg_address(second))


if __name__ == "__main__":
    unittest.main()
