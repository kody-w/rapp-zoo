"""Cross-language and anti-speculation tests for Rapter Coin Trail/1."""

from __future__ import annotations

import copy
import json
import pathlib
import re
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "utils"))

import rapter_coin as C
import rapp_protocol as R


SUBJECT = "rappid:@kody-w/coin-trail:" + "a" * 64
PUBLISHER = "rappid:@kody-w/coin-publisher:" + "9" * 64
EXPECTED_COIN_ID = (
    "rcoin:14dccd61ab2854b678cfa436166d7893f"
    "ceefb9fe4fa57ca2bbb1b0bc28fcab2"
)
CORPUS = json.loads(
    (
        ROOT
        / "holograms"
        / "protocol"
        / "fixtures"
        / "corpus.json"
    ).read_text(encoding="utf-8")
)
COIN_SCHEMA = json.loads(
    (
        ROOT
        / "holograms"
        / "protocol"
        / "rapp-rapter-coin.schema.json"
    ).read_text(encoding="utf-8")
)


def genesis_coin():
    return C.build_coin_record(
        organism_rappid=SUBJECT,
        publisher_rappid=PUBLISHER,
        publisher_authorization_hash="8" * 64,
        dogg_publication_hash="7" * 64,
        core_frame_hash="b" * 64,
        core_seq=0,
        source_frame_hash="c" * 64,
        rights_profile_id="rapterbox-public-bones-v1",
        rights_profile_hash="d" * 64,
        created_utc="2026-08-31T17:19:44.000Z",
    )


def publication_evidence(subject, publisher_rappid):
    record = copy.deepcopy(CORPUS["documents"]["valid-genesis-record"])
    source = R.build_frame(
        "memory.chat-turn",
        f"{subject}:session",
        0,
        "2026-08-31T17:19:40.000Z",
        {
            "outputs": {
                "text": "An intentionally public Holo source.",
                "holo": copy.deepcopy(record["authored"]),
            }
        },
        None,
    )
    record["source"] = {
        "stream_id": source["stream_id"],
        "seq": source["seq"],
        "frame_hash": source["frame_hash"],
    }
    core = R.build_frame(
        "body.pulse",
        subject,
        0,
        "2026-08-31T17:19:41.000Z",
        record,
        None,
    )
    coin = C.build_coin_record(
        organism_rappid=subject,
        publisher_rappid=publisher_rappid,
        publisher_authorization_hash="8" * 64,
        dogg_publication_hash="7" * 64,
        core_frame_hash=core["frame_hash"],
        core_seq=record["holo_seq"],
        source_frame_hash=source["frame_hash"],
        rights_profile_id="rapterbox-public-bones-v1",
        rights_profile_hash="d" * 64,
        created_utc="2026-08-31T17:19:42.000Z",
    )
    return source, core, coin


def verify_public_evidence(coin, core, source):
    source_ok = R.verify_frame(
        source,
        head=None,
        stream_id_of_record=source["stream_id"],
    )
    core_ok = R.verify_frame(
        core,
        head=None,
        stream_id_of_record=coin["organism_rappid"],
    )
    if (
        source_ok[0]
        and core_ok[0]
        and coin["dogg_publication_hash"] == "7" * 64
    ):
        return True, "verified RAPP frames and explicit DOGG-safe publication"
    return False, f"source={source_ok}; core={core_ok}"


def build_publication_frame(subject, core, coin):
    return R.build_frame(
        "body.pulse",
        subject,
        core["seq"] + 1,
        coin["created_utc"],
        coin,
        core["payload_hash"],
        head=core,
    )


def sign_frame(frame, private_key, kid):
    unsigned = {key: value for key, value in frame.items() if key != "sig"}
    frame["sig"] = R.sign_detached_jws(unsigned, private_key, kid)
    return frame


def keyed_identity(slug):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ed25519

    private_key = ed25519.Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    rappid = f"rappid:@kody-w/{slug}:{R.Hb('rapp/1:rappid', public_key)}"
    return private_key, public_key, rappid


def signature_verifier(keys):
    def verify(value, signature):
        try:
            protected, _, _ = R.parse_detached_jws(signature)
        except R.ProtocolError as exc:
            return False, str(exc)
        public_key = keys.get(protected["kid"])
        if public_key is None:
            return False, "signer key is not trusted"
        return R.verify_detached_jws(
            value,
            signature,
            public_key,
            expected_kid=protected["kid"],
        )

    return verify


def verify_publisher_authorization(coin, publisher, utc):
    if (
        publisher == coin["publisher_rappid"]
        and coin["publisher_authorization_hash"] == "8" * 64
        and utc == coin["created_utc"]
    ):
        return True, "publisher is authorized by the test title authority"
    return False, "publisher is not authorized for this organism and time"


def source_resolver(source):
    return lambda frame_hash: (
        source if frame_hash == source["frame_hash"] else None
    )


class BodyStore:
    def __init__(self, frames):
        self.frames = list(frames)

    def resolve(self, organism_rappid):
        if any(frame["stream_id"] != organism_rappid for frame in self.frames):
            raise AssertionError("body store contains a different organism")
        return list(self.frames)

    def compare_and_append(self, organism_rappid, expected_head_hash, frame):
        if frame["stream_id"] != organism_rappid:
            return False
        current = self.frames[-1] if self.frames else None
        current_hash = current["frame_hash"] if current else None
        if current_hash != expected_head_hash:
            return False
        if current is None:
            if frame["seq"] != 0 or frame["prev"] is not None:
                return False
        elif (
            frame["seq"] != current["seq"] + 1
            or frame["prev"] != current["payload_hash"]
        ):
            return False
        self.frames.append(frame)
        return True


def append_publication(
    frame,
    store,
    source,
    verifier,
    *,
    authorization_verifier=verify_publisher_authorization,
):
    return C.append_coin_frame(
        frame,
        organism_rappid=frame["stream_id"],
        authoritative_body_history_resolver=store.resolve,
        atomic_compare_and_append=store.compare_and_append,
        signature_verifier=verifier,
        publisher_authorization_verifier=authorization_verifier,
        source_frame_resolver=source_resolver(source),
        publication_evidence_verifier=verify_public_evidence,
    )


class RapterCoinProtocolTests(unittest.TestCase):
    def test_coin_id_is_deterministic_for_one_public_frame(self):
        coin = genesis_coin()
        self.assertEqual(
            coin["coin_id"],
            C.coin_id_for(
                organism_rappid=SUBJECT,
                core_frame_hash="b" * 64,
            ),
        )
        self.assertEqual(coin["coin_id"], EXPECTED_COIN_ID)
        self.assertRegex(coin["coin_id"], r"^rcoin:[0-9a-f]{64}$")

    def test_coin_trail_advances_without_mutating_the_prior_coin(self):
        first = genesis_coin()
        second = C.build_coin_record(
            organism_rappid=SUBJECT,
            publisher_rappid=PUBLISHER,
            publisher_authorization_hash="8" * 64,
            dogg_publication_hash="7" * 64,
            core_frame_hash="e" * 64,
            core_seq=1,
            source_frame_hash="f" * 64,
            rights_profile_id="rapterbox-public-bones-v1",
            rights_profile_hash="d" * 64,
            created_utc="2026-08-31T17:20:44.000Z",
            previous=first,
        )
        self.assertEqual(second["previous_coin_id"], first["coin_id"])
        self.assertEqual(second["coin_seq"], first["coin_seq"] + 1)
        self.assertEqual(first["core_seq"], 0)

    def test_private_or_unpublished_frames_never_qualify(self):
        coin = genesis_coin()
        coin["visibility"] = "private-godd"
        with self.assertRaises(C.CoinError):
            C.validate_coin_record(coin)

    def test_utc_is_ascii_calendar_valid_in_runtime_and_schema(self):
        pattern = re.compile(COIN_SCHEMA["$defs"]["utc"]["pattern"])
        self.assertRegex("2024-02-29T23:59:59.999Z", pattern)
        for invalid in (
            "２０２６-08-31T17:19:44.000Z",
            "2026-02-30T17:19:44.000Z",
            "2100-02-29T17:19:44.000Z",
            "0000-01-01T00:00:00.000Z",
        ):
            with self.subTest(invalid=invalid):
                self.assertIsNone(pattern.fullmatch(invalid))
                coin = genesis_coin()
                coin["created_utc"] = invalid
                with self.assertRaises(C.CoinError):
                    C.validate_coin_record(coin)

    def test_financial_or_transfer_semantics_are_refused(self):
        for key, value in (
            ("cash_value", 1),
            ("purchasable", True),
            ("redeemable", True),
            ("transferable", True),
            ("yield_bearing", True),
        ):
            with self.subTest(key=key):
                coin = genesis_coin()
                coin["economics"][key] = value
                with self.assertRaises(C.CoinError):
                    C.validate_coin_record(coin)

        coin = genesis_coin()
        coin["price_sats"] = 1
        with self.assertRaises(C.CoinError):
            C.validate_coin_record(coin)

    def test_coin_identity_cannot_be_rebound_to_another_frame(self):
        coin = genesis_coin()
        coin["core_frame_hash"] = "0" * 64
        with self.assertRaises(C.CoinError):
            C.validate_coin_record(coin)

    def test_coin_trail_cannot_skip_or_change_lineage(self):
        first = genesis_coin()
        second = C.build_coin_record(
            organism_rappid=SUBJECT,
            publisher_rappid=PUBLISHER,
            publisher_authorization_hash="8" * 64,
            dogg_publication_hash="7" * 64,
            core_frame_hash="e" * 64,
            core_seq=7,
            source_frame_hash="f" * 64,
            rights_profile_id="rapterbox-public-bones-v1",
            rights_profile_hash="d" * 64,
            created_utc="2026-08-31T17:20:44.000Z",
            previous=first,
        )
        second["coin_seq"] = 2
        with self.assertRaises(C.CoinError):
            C.validate_coin_record(second, previous=first)

        unresolved = genesis_coin()
        unresolved["coin_seq"] = 1
        unresolved["previous_coin_id"] = "rcoin:" + "1" * 64
        with self.assertRaisesRegex(C.CoinError, "resolved predecessor"):
            C.validate_coin_record(unresolved)

    def test_official_publication_requires_an_outer_signature(self):
        source, core, coin = publication_evidence(SUBJECT, PUBLISHER)
        frame = build_publication_frame(SUBJECT, core, coin)
        store = BodyStore([core])
        with self.assertRaises(C.CoinError):
            append_publication(
                frame,
                store,
                source,
                lambda *_: (True, "ok"),
            )

    def test_keyless_organism_accepts_an_authorized_publisher_signature(self):
        private_key, public_key, publisher = keyed_identity("coin-publisher")
        source, core, coin = publication_evidence(SUBJECT, publisher)
        frame = sign_frame(
            build_publication_frame(SUBJECT, core, coin),
            private_key,
            publisher,
        )
        store = BodyStore([core])

        self.assertIs(
            append_publication(
                frame,
                store,
                source,
                signature_verifier({publisher: public_key}),
            ),
            frame,
        )
        self.assertEqual(store.frames[-1], frame)

    def test_official_publication_refuses_a_different_signer(self):
        _, publisher_key, publisher = keyed_identity("coin-publisher")
        other_private, other_key, other = keyed_identity("other-signer")
        source, core, coin = publication_evidence(SUBJECT, publisher)
        frame = sign_frame(
            build_publication_frame(SUBJECT, core, coin),
            other_private,
            other,
        )
        store = BodyStore([core])

        with self.assertRaisesRegex(C.CoinError, "signer"):
            append_publication(
                frame,
                store,
                source,
                signature_verifier(
                    {
                        publisher: publisher_key,
                        other: other_key,
                    }
                ),
            )

    def test_official_non_genesis_publication_requires_prior_coin(self):
        private_key, public_key, publisher = keyed_identity("coin-publisher")
        source, core, coin = publication_evidence(SUBJECT, publisher)
        coin["coin_seq"] = 1
        coin["previous_coin_id"] = "rcoin:" + "1" * 64
        frame = sign_frame(
            build_publication_frame(SUBJECT, core, coin),
            private_key,
            publisher,
        )
        store = BodyStore([core])

        with self.assertRaisesRegex(C.CoinError, "coin_seq 0"):
            append_publication(
                frame,
                store,
                source,
                signature_verifier({publisher: public_key}),
            )

    def test_official_publication_requires_real_bound_public_evidence(self):
        private_key, public_key, publisher = keyed_identity("coin-publisher")
        source, core, _ = publication_evidence(SUBJECT, publisher)
        coin = C.build_coin_record(
            organism_rappid=SUBJECT,
            publisher_rappid=publisher,
            publisher_authorization_hash="8" * 64,
            dogg_publication_hash="7" * 64,
            core_frame_hash="0" * 64,
            core_seq=0,
            source_frame_hash=source["frame_hash"],
            rights_profile_id="rapterbox-public-bones-v1",
            rights_profile_hash="d" * 64,
            created_utc="2026-08-31T17:19:42.000Z",
        )
        frame = sign_frame(
            build_publication_frame(SUBJECT, core, coin),
            private_key,
            publisher,
        )
        store = BodyStore([core])

        with self.assertRaisesRegex(C.CoinError, "authoritative history"):
            append_publication(
                frame,
                store,
                source,
                signature_verifier({publisher: public_key}),
            )

    def test_current_publication_requires_authoritative_source_resolution(self):
        private_key, public_key, publisher = keyed_identity("coin-publisher")
        source, core, coin = publication_evidence(SUBJECT, publisher)
        frame = sign_frame(
            build_publication_frame(SUBJECT, core, coin),
            private_key,
            publisher,
        )
        store = BodyStore([core])

        with self.assertRaisesRegex(C.CoinError, "source is absent"):
            C.append_coin_frame(
                frame,
                organism_rappid=SUBJECT,
                authoritative_body_history_resolver=store.resolve,
                atomic_compare_and_append=store.compare_and_append,
                signature_verifier=signature_verifier({publisher: public_key}),
                publisher_authorization_verifier=verify_publisher_authorization,
                source_frame_resolver=lambda _: None,
                publication_evidence_verifier=verify_public_evidence,
            )

    def test_official_publication_cannot_restart_an_existing_coin_trail(self):
        private_key, public_key, publisher = keyed_identity("coin-publisher")
        source, core, first_coin = publication_evidence(SUBJECT, publisher)
        first_frame = sign_frame(
            build_publication_frame(SUBJECT, core, first_coin),
            private_key,
            publisher,
        )
        restarted_coin = C.build_coin_record(
            organism_rappid=SUBJECT,
            publisher_rappid=publisher,
            publisher_authorization_hash="8" * 64,
            dogg_publication_hash="7" * 64,
            core_frame_hash=core["frame_hash"],
            core_seq=0,
            source_frame_hash=source["frame_hash"],
            rights_profile_id="rapterbox-public-bones-v1",
            rights_profile_hash="d" * 64,
            created_utc="2026-08-31T17:19:43.000Z",
        )
        restarted_frame = R.build_frame(
            "body.pulse",
            SUBJECT,
            first_frame["seq"] + 1,
            restarted_coin["created_utc"],
            restarted_coin,
            first_frame["payload_hash"],
            head=first_frame,
        )
        sign_frame(restarted_frame, private_key, publisher)
        store = BodyStore([core, first_frame])

        with self.assertRaises(C.CoinError):
            append_publication(
                restarted_frame,
                store,
                source,
                signature_verifier({publisher: public_key}),
            )

    def test_official_publication_requires_current_publisher_authorization(self):
        private_key, public_key, publisher = keyed_identity("coin-publisher")
        source, core, coin = publication_evidence(SUBJECT, publisher)
        frame = sign_frame(
            build_publication_frame(SUBJECT, core, coin),
            private_key,
            publisher,
        )
        store = BodyStore([core])

        with self.assertRaisesRegex(C.CoinError, "not authorized"):
            append_publication(
                frame,
                store,
                source,
                signature_verifier({publisher: public_key}),
                authorization_verifier=lambda *_: (
                    False,
                    "title authorization is absent",
                ),
            )

    def test_body_replay_refuses_historical_coin_without_real_evidence(self):
        private_key, public_key, publisher = keyed_identity("coin-publisher")
        source, core, _ = publication_evidence(SUBJECT, publisher)
        fake_coin = C.build_coin_record(
            organism_rappid=SUBJECT,
            publisher_rappid=publisher,
            publisher_authorization_hash="8" * 64,
            dogg_publication_hash="7" * 64,
            core_frame_hash="0" * 64,
            core_seq=0,
            source_frame_hash=source["frame_hash"],
            rights_profile_id="rapterbox-public-bones-v1",
            rights_profile_hash="d" * 64,
            created_utc="2026-08-31T17:19:42.000Z",
        )
        fake_frame = sign_frame(
            build_publication_frame(SUBJECT, core, fake_coin),
            private_key,
            publisher,
        )

        with self.assertRaisesRegex(C.CoinError, "missing accepted core"):
            C.coin_head_from_body_history(
                [core, fake_frame],
                head=fake_frame,
                organism_rappid=SUBJECT,
                signature_verifier=signature_verifier({publisher: public_key}),
                publisher_authorization_verifier=verify_publisher_authorization,
                source_frame_resolver=source_resolver(source),
                publication_evidence_verifier=verify_public_evidence,
            )

    def test_atomic_append_allows_only_one_sibling_branch(self):
        private_key, public_key, publisher = keyed_identity("coin-publisher")
        source, core, first_coin = publication_evidence(SUBJECT, publisher)
        second_coin = C.build_coin_record(
            organism_rappid=SUBJECT,
            publisher_rappid=publisher,
            publisher_authorization_hash="8" * 64,
            dogg_publication_hash="7" * 64,
            core_frame_hash=core["frame_hash"],
            core_seq=0,
            source_frame_hash=source["frame_hash"],
            rights_profile_id="rapterbox-public-bones-v1",
            rights_profile_hash="e" * 64,
            created_utc=first_coin["created_utc"],
        )
        first_frame = sign_frame(
            build_publication_frame(SUBJECT, core, first_coin),
            private_key,
            publisher,
        )
        second_frame = sign_frame(
            build_publication_frame(SUBJECT, core, second_coin),
            private_key,
            publisher,
        )
        authoritative_store = BodyStore([core])
        stale_history = [core]
        stale_resolver = lambda _: list(stale_history)
        verifier = signature_verifier({publisher: public_key})

        self.assertIs(
            C.append_coin_frame(
                first_frame,
                organism_rappid=SUBJECT,
                authoritative_body_history_resolver=stale_resolver,
                atomic_compare_and_append=authoritative_store.compare_and_append,
                signature_verifier=verifier,
                publisher_authorization_verifier=verify_publisher_authorization,
                source_frame_resolver=source_resolver(source),
                publication_evidence_verifier=verify_public_evidence,
            ),
            first_frame,
        )
        with self.assertRaisesRegex(C.CoinError, "head race"):
            C.append_coin_frame(
                second_frame,
                organism_rappid=SUBJECT,
                authoritative_body_history_resolver=stale_resolver,
                atomic_compare_and_append=authoritative_store.compare_and_append,
                signature_verifier=verifier,
                publisher_authorization_verifier=verify_publisher_authorization,
                source_frame_resolver=source_resolver(source),
                publication_evidence_verifier=verify_public_evidence,
            )
        self.assertEqual(authoritative_store.frames[-1], first_frame)


if __name__ == "__main__":
    unittest.main()
