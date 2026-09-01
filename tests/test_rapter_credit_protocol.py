"""RAPP/1 carrier and schema tests for Rapter Credit commerce records."""

from __future__ import annotations

import pathlib
import json
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "utils"))

import rapp_protocol as R
import rapter_credit as C


SUBJECT = "rappid:@kody-w/market-rapter:" + "a" * 64
ISSUER = "rappid:@kody-w/rapterbox:" + "b" * 64


def credit_record():
    return {
        "schema": "rapp-rapter-credit/1",
        "credit_id": "rcredit:" + "c" * 64,
        "series": "rapterbox-genesis",
        "issuance_index": 42,
        "series_cap": 10_000,
        "organism_rappid": SUBJECT,
        "genesis_core_id": "d" * 64,
        "core_manifest_hash": "e" * 64,
        "birth": {
            "schema": "rapp-rapter-birth/1",
            "conception_utc": "2026-08-29T18:00:00.000Z",
            "tier": "holo",
            "schedule_id": "rapterbox-genesis-v1",
            "schedule_hash": "f" * 64,
            "btc_fraction": {
                "numerator": 1,
                "denominator": 40_000,
            },
            "btc_quote": {
                "pair": "BTC-USD",
                "price_usd_micros": 100_000_000_000,
                "source": "coinbase",
                "observed_utc": "2026-08-29T18:00:00.000Z",
                "response_hash": "1" * 64,
            },
            "price_sats": 2_500,
            "birth_value_usd_micros": 2_500_000,
        },
        "settlement": {
            "rail": "bitcoin",
            "payment_reference_hash": "2" * 64,
            "bitcoin_outpoint": {
                "txid": "3" * 64,
                "vout": 0,
            },
        },
        "issuer_rappid": ISSUER,
        "issued_utc": "2026-08-29T18:01:00.000Z",
    }


class RapterCreditProtocolTests(unittest.TestCase):
    def test_json_schema_references_close_and_birth_is_not_nested_in_outpoint(self):
        schema = json.loads(
            (
                ROOT
                / "holograms"
                / "protocol"
                / "rapp-rapter-credit.schema.json"
            ).read_text(encoding="utf-8")
        )
        refs = []

        def collect(value):
            if isinstance(value, dict):
                if isinstance(value.get("$ref"), str):
                    refs.append(value["$ref"])
                for item in value.values():
                    collect(item)
            elif isinstance(value, list):
                for item in value:
                    collect(item)

        collect(schema)
        definitions = schema["$defs"]
        missing = [
            ref
            for ref in refs
            if ref.startswith("#/$defs/")
            and ref.removeprefix("#/$defs/") not in definitions
        ]
        self.assertEqual(missing, [])
        self.assertIn("birth", definitions)
        self.assertNotIn("birth", definitions["outpoint"]["properties"])
        self.assertIn("issuance_index < series_cap", schema["$comment"])

    def test_credit_is_valid_payload_on_registered_body_pulse(self):
        record = credit_record()
        self.assertIs(C.validate_credit_record(record), record)
        frame = R.build_frame(
            "body.pulse",
            ISSUER,
            0,
            "2026-08-29T18:01:00.000Z",
            record,
            None,
        )
        self.assertEqual(R.verify_frame(frame), (True, None, "ok"))

    def test_birth_value_formula_is_exact_integer_arithmetic(self):
        record = credit_record()
        birth = record["birth"]
        price_sats, birth_usd = C.birth_valuation(
            numerator=birth["btc_fraction"]["numerator"],
            denominator=birth["btc_fraction"]["denominator"],
            btc_usd_micros=birth["btc_quote"]["price_usd_micros"],
        )
        self.assertEqual(price_sats, birth["price_sats"])
        self.assertEqual(birth_usd, birth["birth_value_usd_micros"])

    def test_bitcoin_settlement_requires_one_outpoint(self):
        record = credit_record()
        record["settlement"]["bitcoin_outpoint"] = None
        with self.assertRaises(C.CreditError):
            C.validate_credit_record(record)

    def test_transfer_is_an_appendable_registered_body_pulse(self):
        transfer = {
            "schema": "rapp-rapter-credit-transfer/1",
            "credit_id": "rcredit:" + "c" * 64,
            "previous_transfer_hash": None,
            "from_owner_rappid": "rappid:@kody-w/owner-one:" + "5" * 64,
            "to_owner_rappid": "rappid:@kody-w/owner-two:" + "6" * 64,
            "settlement_reference_hash": "4" * 64,
            "utc": "2026-09-30T18:01:00.000Z",
        }
        self.assertIs(C.validate_transfer_record(transfer), transfer)
        frame = R.build_frame(
            "body.pulse",
            ISSUER,
            0,
            transfer["utc"],
            transfer,
            None,
        )
        self.assertEqual(R.verify_frame(frame), (True, None, "ok"))

    def test_birth_value_and_issuance_index_mutations_are_refused(self):
        record = credit_record()
        record["birth"]["price_sats"] += 1
        with self.assertRaises(C.CreditError):
            C.validate_credit_record(record)

        record = credit_record()
        record["issuance_index"] = record["series_cap"]
        with self.assertRaises(C.CreditError):
            C.validate_credit_record(record)

    def test_official_credit_validator_requires_outer_frame_signature(self):
        record = credit_record()
        frame = R.build_frame(
            "body.pulse",
            ISSUER,
            0,
            "2026-08-29T18:01:00.000Z",
            record,
            None,
        )
        with self.assertRaises(C.CreditError):
            C.validate_credit_frame(
                frame,
                head=None,
                issuer_rappid=ISSUER,
                signature_verifier=lambda *_: (True, "ok"),
            )

    def test_official_credit_accepts_a_verified_ed25519_outer_signature(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ed25519

        private_key = ed25519.Ed25519PrivateKey.generate()
        public_key = private_key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        issuer = f"rappid:@kody-w/rapterbox:{R.Hb('rapp/1:rappid', public_key)}"
        record = credit_record()
        record["issuer_rappid"] = issuer
        frame = R.build_frame(
            "body.pulse",
            issuer,
            0,
            "2026-08-29T18:01:00.000Z",
            record,
            None,
        )
        unsigned = {key: value for key, value in frame.items() if key != "sig"}
        frame["sig"] = R.sign_detached_jws(unsigned, private_key, issuer)

        def verify_signature(value, signature):
            return R.verify_detached_jws(
                value,
                signature,
                public_key,
                expected_kid=issuer,
            )

        self.assertIs(
            C.validate_credit_frame(
                frame,
                head=None,
                issuer_rappid=issuer,
                signature_verifier=verify_signature,
            ),
            frame,
        )


if __name__ == "__main__":
    unittest.main()
