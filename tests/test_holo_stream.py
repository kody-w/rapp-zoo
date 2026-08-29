"""Integrated Holo/1 stream, flipbook, and Holo Wake tests."""

from __future__ import annotations

import copy
import json
import os
import pathlib
import shutil
import sqlite3
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor


ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "utils"))

import rapp_protocol as R
import zoo


SUBJECT = "rappid:@kody-w/holo-test:" + "a" * 64
TOKEN = "d" * 64


class IsolatedHome:
    def __enter__(self):
        self.tmp = tempfile.mkdtemp()
        self.previous = {
            key: os.environ.get(key)
            for key in (
                "XDG_CONFIG_HOME",
                "HOME",
                "RAPP_HOME",
                "RAPP_OWNER",
                "RAPP_ZOO_DESKTOP_TOKEN",
                "RAPP_REGISTRY_PATH",
                "RAPP_ESTATE_OWNER_RAPPID",
                "RAPP_ESTATE_OWNER_SPKI_PATH",
            )
        }
        os.environ["XDG_CONFIG_HOME"] = self.tmp
        os.environ["HOME"] = self.tmp
        os.environ["RAPP_HOME"] = os.path.join(self.tmp, ".rapp")
        os.environ["RAPP_OWNER"] = "kody-w"
        os.environ["RAPP_ZOO_DESKTOP_TOKEN"] = TOKEN
        for key in (
            "RAPP_REGISTRY_PATH",
            "RAPP_ESTATE_OWNER_RAPPID",
            "RAPP_ESTATE_OWNER_SPKI_PATH",
        ):
            os.environ.pop(key, None)
        return self

    def __exit__(self, *_):
        for key, value in self.previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmp, ignore_errors=True)


def blank_output(base_holo_id=None):
    value = json.loads(
        (
            ROOT
            / "holograms"
            / "protocol"
            / "examples"
            / "minimal-blank-output.json"
        ).read_text()
    )
    value["base_holo_id"] = base_holo_id
    return value


def fixture_output(name: str):
    corpus = json.loads(
        (
            ROOT
            / "holograms"
            / "protocol"
            / "fixtures"
            / "corpus.json"
        ).read_text()
    )
    return copy.deepcopy(corpus["documents"][name])


def build_turn(
    *,
    stream_id: str,
    seq: int,
    head: dict | None,
    holo,
    channel_enabled: bool = True,
    turn_latency_ms: int | None = 120,
    deadline_ms: int | None = 30_000,
) -> dict:
    return R.build_frame(
        "memory.chat-turn",
        stream_id,
        seq,
        f"2026-08-29T15:00:{seq:02d}.000Z",
        {
            "role": "assistant",
            "outputs": {
                "text": f"turn {seq}",
                "voice": None,
                "holo": holo,
            },
            "holo_channel": {
                "enabled": channel_enabled,
                "turn_latency_ms": turn_latency_ms,
                "deadline_ms": deadline_ms,
            },
        },
        head["payload_hash"] if head else None,
        head=head,
    )


def commit(client, frame):
    return client.post(
        "/api/holo/commit",
        json={"source_frame": frame},
        headers={"X-RAPP-Zoo-Desktop": TOKEN},
    )


class TestHoloStream(unittest.TestCase):
    def test_holo_profile_uses_only_registered_rapp_frame_kinds(self):
        for relative in (
            "zoo.py",
            "README.md",
            "HOLOGRAM_PROTOCOL.md",
            "HOLO_ZOO.md",
            "HOLO_IN_THE_WILD.md",
        ):
            source = (ROOT / relative).read_text().replace("\r\n", "\n")
            self.assertNotIn("body.hologram", source)

    def test_fantasy_draft_example_is_verified_and_seats_both_rappters(self):
        with IsolatedHome():
            response = zoo.create_app().test_client().get(
                "/api/holo/examples/fantasy-draft"
            )
            self.assertEqual(response.status_code, 200, response.get_json())
            frame = response.get_json()
            self.assertEqual(R.verify_frame(frame), (True, None, "ok"))
            self.assertEqual(frame["payload"]["schema"], "rapp-fantasy-draft/1")
            participants = frame["payload"]["participants"]
            self.assertEqual(
                [participant["display_name"] for participant in participants[:2]],
                ["Rappter One", "Rappter Two"],
            )
            self.assertEqual(
                [participant["seat"] for participant in participants],
                [1, 2, 3, 4],
            )
            self.assertTrue(frame["payload"]["rules"]["holo_output"])

    def test_original_turn_endpoint_commits_exact_ai_output(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            authored = blank_output()
            first = client.post(
                "/api/holo/turn",
                json={
                    "subject_rappid": SUBJECT,
                    "session_id": "brainstem-session",
                    "text": "The exact text output.",
                    "holo": authored,
                    "evidence": {
                        "channel_enabled": True,
                        "turn_latency_ms": 120,
                        "deadline_ms": 30_000,
                    },
                },
                headers={"X-RAPP-Zoo-Desktop": TOKEN},
            )
            self.assertEqual(first.status_code, 201, first.get_json())
            source = first.get_json()["source_frame"]
            self.assertEqual(source["kind"], "memory.chat-turn")
            self.assertEqual(source["payload"]["outputs"]["text"], "The exact text output.")
            self.assertEqual(source["payload"]["outputs"]["holo"], authored)
            self.assertEqual(
                first.get_json()["holo_frame"]["payload"]["authored"],
                authored,
            )

            base = first.get_json()["holo_frame"]["frame_hash"]
            second_authored = blank_output(base)
            second = client.post(
                "/api/holo/turn",
                json={
                    "subject_rappid": SUBJECT,
                    "session_id": "brainstem-session",
                    "text": "The next exact text output.",
                    "holo": second_authored,
                    "evidence": {
                        "channel_enabled": True,
                        "turn_latency_ms": 140,
                        "deadline_ms": 30_000,
                    },
                },
                headers={"X-RAPP-Zoo-Desktop": TOKEN},
            )
            self.assertEqual(second.status_code, 201, second.get_json())
            self.assertEqual(second.get_json()["source_frame"]["seq"], 1)
            self.assertEqual(
                second.get_json()["holo_frame"]["payload"]["visual_parent"],
                base,
            )

    def test_commit_materializes_rapp_body_frame_and_exact_source(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            source = build_turn(
                stream_id=f"{SUBJECT}:session",
                seq=0,
                head=None,
                holo=blank_output(),
            )
            response = commit(client, source)
            self.assertEqual(response.status_code, 201, response.get_json())
            result = response.get_json()
            self.assertEqual(result["status"], "sighted")
            body = result["holo_frame"]
            self.assertEqual(body["kind"], "body.pulse")
            self.assertEqual(body["stream_id"], SUBJECT)
            self.assertEqual(body["seq"], 0)
            self.assertIsNone(body["prev"])
            self.assertEqual(R.verify_frame(body), (True, None, "ok"))
            self.assertEqual(body["payload"]["authored"], source["payload"]["outputs"]["holo"])
            self.assertEqual(
                body["payload"]["authored_hash"],
                R.H("rapp-holo/1:authored", source["payload"]["outputs"]["holo"]),
            )
            stored_source = client.get(
                f"/api/holo/sources/{source['frame_hash']}"
            )
            self.assertEqual(stored_source.status_code, 200)
            self.assertEqual(stored_source.get_json(), source)
            viewer = client.get(f"/holo/{body['frame_hash']}")
            self.assertEqual(viewer.status_code, 200)
            viewer_html = viewer.get_data(as_text=True)
            self.assertIn('"mode":"holo/1"', viewer_html)
            self.assertIn('"schema":"rapp-holo-player-update/1"', viewer_html)
            self.assertIn('"record":{"frame_hash":', viewer_html)
            self.assertIn('"kind":"body.pulse"', viewer_html)
            self.assertIn("connect-src 'none'", viewer.headers["Content-Security-Policy"])
            replay = commit(client, source)
            self.assertEqual(replay.status_code, 200, replay.get_json())
            self.assertEqual(replay.get_json()["holo_frame"], body)

    def test_source_memory_fork_is_refused_without_moving_holo_head(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            stream = f"{SUBJECT}:session"
            source = build_turn(
                stream_id=stream,
                seq=0,
                head=None,
                holo=blank_output(),
            )
            first = commit(client, source)
            self.assertEqual(first.status_code, 201, first.get_json())
            head_id = first.get_json()["current_head"]["holo_id"]
            fork = build_turn(
                stream_id=stream,
                seq=0,
                head=None,
                holo=None,
            )
            refused = commit(client, fork)
            self.assertEqual(refused.status_code, 422, refused.get_json())
            heads = client.get("/api/holo/heads").get_json()["heads"]
            self.assertEqual(heads[0]["holo_id"], head_id)

    def test_successor_advances_head_without_mutating_predecessor_and_survives_restart(self):
        with IsolatedHome():
            app = zoo.create_app()
            client = app.test_client()
            stream = f"{SUBJECT}:session"
            first_source = build_turn(
                stream_id=stream,
                seq=0,
                head=None,
                holo=blank_output(),
            )
            first = commit(client, first_source).get_json()
            first_id = first["holo_frame"]["frame_hash"]
            first_before = client.get(f"/api/holo/frames/{first_id}").get_json()

            second_source = build_turn(
                stream_id=stream,
                seq=1,
                head=first_source,
                holo=blank_output(first_id),
            )
            second_response = commit(client, second_source)
            self.assertEqual(second_response.status_code, 201, second_response.get_json())
            second = second_response.get_json()
            second_id = second["holo_frame"]["frame_hash"]
            self.assertEqual(second["holo_frame"]["payload"]["visual_parent"], first_id)
            self.assertEqual(second["holo_frame"]["payload"]["holo_seq"], 1)
            first_after = client.get(f"/api/holo/frames/{first_id}").get_json()
            self.assertEqual(first_after["frame"], first_before["frame"])
            self.assertEqual(first_after["compiled"], first_before["compiled"])
            self.assertFalse(first_after["authoritative"])

            restarted = zoo.create_app().test_client()
            heads = restarted.get("/api/holo/heads").get_json()["heads"]
            self.assertEqual(len(heads), 1)
            self.assertEqual(heads[0]["holo_id"], second_id)
            history = restarted.get(
                "/api/holo/history",
                query_string={"subject_rappid": SUBJECT},
            ).get_json()
            self.assertEqual(
                [item["holo_id"] for item in history["frames"]],
                [second_id, first_id],
            )

    def test_stale_holo_is_observed_but_source_chain_continues(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            stream = f"{SUBJECT}:session"
            source0 = build_turn(
                stream_id=stream,
                seq=0,
                head=None,
                holo=blank_output(),
            )
            result0 = commit(client, source0).get_json()
            holo0 = result0["holo_frame"]["frame_hash"]
            source1 = build_turn(
                stream_id=stream,
                seq=1,
                head=source0,
                holo=blank_output(holo0),
            )
            result1 = commit(client, source1).get_json()
            holo1 = result1["holo_frame"]["frame_hash"]

            stale_source = build_turn(
                stream_id=stream,
                seq=2,
                head=source1,
                holo=blank_output(holo0),
            )
            stale = commit(client, stale_source)
            self.assertEqual(stale.status_code, 409, stale.get_json())
            self.assertEqual(stale.get_json()["status"], "stale")
            self.assertEqual(stale.get_json()["current_head"]["holo_id"], holo1)

            recovery_source = build_turn(
                stream_id=stream,
                seq=3,
                head=stale_source,
                holo=blank_output(holo1),
            )
            recovery = commit(client, recovery_source)
            self.assertEqual(recovery.status_code, 201, recovery.get_json())
            self.assertEqual(recovery.get_json()["status"], "sighted")

    def test_null_holo_holds_head_and_is_idempotent(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            stream = f"{SUBJECT}:session"
            source0 = build_turn(
                stream_id=stream,
                seq=0,
                head=None,
                holo=blank_output(),
            )
            first = commit(client, source0).get_json()
            head_id = first["holo_frame"]["frame_hash"]
            source1 = build_turn(
                stream_id=stream,
                seq=1,
                head=source0,
                holo=None,
            )
            held = commit(client, source1)
            replay = commit(client, source1)
            self.assertEqual(held.status_code, 200, held.get_json())
            self.assertEqual(replay.status_code, 200, replay.get_json())
            self.assertEqual(held.get_json(), replay.get_json())
            self.assertEqual(held.get_json()["status"], "absent")
            self.assertEqual(held.get_json()["current_head"]["holo_id"], head_id)

    def test_invalid_holo_does_not_block_later_source_turn(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            stream = f"{SUBJECT}:session"
            invalid = blank_output()
            invalid["invented-default"] = "forbidden"
            source0 = build_turn(
                stream_id=stream,
                seq=0,
                head=None,
                holo=invalid,
            )
            refused = commit(client, source0)
            self.assertEqual(refused.status_code, 422, refused.get_json())
            self.assertEqual(refused.get_json()["status"], "blind")
            self.assertIsNone(refused.get_json()["current_head"])

            source1 = build_turn(
                stream_id=stream,
                seq=1,
                head=source0,
                holo=blank_output(),
            )
            accepted = commit(client, source1)
            self.assertEqual(accepted.status_code, 201, accepted.get_json())
            self.assertEqual(accepted.get_json()["holo_frame"]["payload"]["holo_seq"], 0)

    def test_competing_sessions_cannot_publish_two_genesis_heads(self):
        with IsolatedHome():
            app = zoo.create_app()
            frame_a = build_turn(
                stream_id=f"{SUBJECT}:alpha",
                seq=0,
                head=None,
                holo=blank_output(),
            )
            frame_b = build_turn(
                stream_id=f"{SUBJECT}:beta",
                seq=0,
                head=None,
                holo=blank_output(),
            )
            barrier = threading.Barrier(2)

            def worker(frame):
                with app.test_client() as client:
                    barrier.wait()
                    response = commit(client, frame)
                    return response.status_code, response.get_json()

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(worker, (frame_a, frame_b)))
            self.assertEqual(sorted(status for status, _ in results), [201, 409])
            heads = app.test_client().get("/api/holo/heads").get_json()["heads"]
            self.assertEqual(len(heads), 1)
            history = app.test_client().get(
                "/api/holo/history",
                query_string={"subject_rappid": SUBJECT},
            ).get_json()
            self.assertEqual(len(history["frames"]), 1)

    def test_wild_ingest_extends_body_chain_without_conflating_holo_order(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            source = build_turn(
                stream_id=f"{SUBJECT}:wild",
                seq=0,
                head=None,
                holo=blank_output(),
            )
            pulse = R.build_frame(
                "body.pulse",
                SUBJECT,
                0,
                "2026-08-29T15:00:01.000Z",
                {"status": "online"},
                None,
            )
            authored = source["payload"]["outputs"]["holo"]
            record = {
                "schema": "rapp-holo-record/1",
                "holo_seq": 0,
                "visual_parent": None,
                "source": {
                    "stream_id": source["stream_id"],
                    "seq": source["seq"],
                    "frame_hash": source["frame_hash"],
                },
                "authored_hash": R.H("rapp-holo/1:authored", authored),
                "producer_provenance": None,
                "authored": authored,
            }
            wild_holo = R.build_frame(
                "body.pulse",
                SUBJECT,
                1,
                "2026-08-29T15:00:02.000Z",
                record,
                pulse["payload_hash"],
                head=pulse,
            )
            response = client.post(
                "/api/holo/ingest",
                json={
                    "source_frame": source,
                    "body_chain": [pulse, wild_holo],
                },
                headers={"X-RAPP-Zoo-Desktop": TOKEN},
            )
            self.assertEqual(response.status_code, 201, response.get_json())
            head = response.get_json()["current_head"]
            self.assertEqual(head["body_seq"], 1)
            self.assertEqual(head["holo_seq"], 0)
            self.assertEqual(head["holo_id"], wild_holo["frame_hash"])

    def test_wild_ingest_retains_verified_source_and_intervening_body_on_refusal(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            source = build_turn(
                stream_id=f"{SUBJECT}:wild-refusal",
                seq=0,
                head=None,
                holo=blank_output(),
            )
            pulse = R.build_frame(
                "body.pulse",
                SUBJECT,
                0,
                "2026-08-29T15:00:01.000Z",
                {"status": "online"},
                None,
            )
            authored = source["payload"]["outputs"]["holo"]
            record = {
                "schema": "rapp-holo-record/1",
                "holo_seq": 0,
                "visual_parent": None,
                "source": {
                    "stream_id": source["stream_id"],
                    "seq": source["seq"],
                    "frame_hash": source["frame_hash"],
                },
                "authored_hash": R.H("rapp-holo/1:authored", authored),
                "producer_provenance": None,
                "authored": authored,
            }
            invalid_holo = R.build_frame(
                "body.pulse",
                SUBJECT,
                1,
                "2026-08-29T15:00:02.000Z",
                record,
                pulse["payload_hash"],
                head=pulse,
            )
            invalid_holo["payload"]["authored_hash"] = "0" * 64
            response = client.post(
                "/api/holo/ingest",
                json={
                    "source_frame": source,
                    "body_chain": [pulse, invalid_holo],
                },
                headers={"X-RAPP-Zoo-Desktop": TOKEN},
            )
            self.assertEqual(response.status_code, 422, response.get_json())
            self.assertEqual(
                client.get(f"/api/holo/sources/{source['frame_hash']}").status_code,
                200,
            )
            connection = sqlite3.connect(zoo.holo_db_path())
            try:
                stored = connection.execute(
                    "SELECT seq, kind FROM body_frames ORDER BY seq"
                ).fetchall()
                observation = connection.execute(
                    "SELECT sightedness FROM holo_observations "
                    "WHERE source_frame_hash = ?",
                    (source["frame_hash"],),
                ).fetchone()
            finally:
                connection.close()
            self.assertEqual(stored, [(0, "body.pulse")])
            self.assertEqual(observation, ("blind",))

    def test_historical_flipbook_resolves_exact_verified_ancestor_states(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            stream = f"{SUBJECT}:flipbook"
            first_output = fixture_output("multi-node-non-humanoid-scene")
            source0 = build_turn(
                stream_id=stream,
                seq=0,
                head=None,
                holo=first_output,
            )
            first = commit(client, source0)
            self.assertEqual(first.status_code, 201, first.get_json())
            first_id = first.get_json()["holo_frame"]["frame_hash"]

            second_output = fixture_output("transition-successor")
            second_output["base_holo_id"] = first_id
            source1 = build_turn(
                stream_id=stream,
                seq=1,
                head=source0,
                holo=second_output,
            )
            second = commit(client, source1)
            self.assertEqual(second.status_code, 201, second.get_json())
            second_id = second.get_json()["holo_frame"]["frame_hash"]

            flipbook = fixture_output("historical-flipbook")
            flipbook["base_holo_id"] = second_id
            flipbook["performance"]["sustain"]["flipbook"][1]["holo_id"] = first_id
            flipbook["performance"]["sustain"]["flipbook"][2]["holo_id"] = second_id
            source2 = build_turn(
                stream_id=stream,
                seq=2,
                head=source1,
                holo=flipbook,
            )
            third = commit(client, source2)
            self.assertEqual(third.status_code, 201, third.get_json())
            self.assertEqual(third.get_json()["status"], "sighted")
            self.assertEqual(
                third.get_json()["holo_frame"]["payload"]["authored"][
                    "performance"
                ]["sustain"]["flipbook"][1]["holo_id"],
                first_id,
            )

            third_id = third.get_json()["holo_frame"]["frame_hash"]
            recursive = fixture_output("historical-flipbook")
            recursive["base_holo_id"] = third_id
            recursive["performance"]["sustain"]["flipbook"] = [
                {
                    "at_ms": 0,
                    "holo_id": "self",
                    "blend": "crossfade",
                    "blend_ms": 500,
                },
                {
                    "at_ms": 2000,
                    "holo_id": third_id,
                    "blend": "crossfade",
                    "blend_ms": 500,
                },
            ]
            source3 = build_turn(
                stream_id=stream,
                seq=3,
                head=source2,
                holo=recursive,
            )
            fourth = commit(client, source3)
            self.assertEqual(fourth.status_code, 201, fourth.get_json())
            fourth_id = fourth.get_json()["holo_frame"]["frame_hash"]
            viewer = client.get(f"/holo/{fourth_id}")
            self.assertEqual(viewer.status_code, 200, viewer.get_json())
            html = viewer.get_data(as_text=True)
            for ancestor_id in (third_id, second_id, first_id):
                self.assertIn(ancestor_id, html)
            viewer.close()

    def test_holo_wake_classifies_sustained_machine_and_manual_absence(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            stream = f"{SUBJECT}:machine"
            source = None
            base = None
            for seq in range(8):
                source = build_turn(
                    stream_id=stream,
                    seq=seq,
                    head=source,
                    holo=blank_output(base),
                )
                response = commit(client, source)
                self.assertEqual(response.status_code, 201, response.get_json())
                base = response.get_json()["holo_frame"]["frame_hash"]
            presence = client.get(
                "/api/holo/presence",
                query_string={"subject_rappid": SUBJECT},
            ).get_json()
            self.assertEqual(presence["classification"], "ai-present-likely")
            self.assertEqual(presence["window"]["sighted_outputs"], 8)
            self.assertEqual(presence["window"]["timed_outputs"], 8)
            self.assertEqual(presence["window"]["on_time_holo_outputs"], 8)
            self.assertEqual(
                presence["window"]["history_resolved_outputs"],
                8,
            )
            self.assertEqual(
                presence["window"]["replay_consistent_outputs"],
                8,
            )

        manual_subject = "rappid:@kody-w/manual-test:" + "b" * 64
        with IsolatedHome():
            client = zoo.create_app().test_client()
            stream = f"{manual_subject}:manual"
            source = None
            for seq in range(8):
                source = build_turn(
                    stream_id=stream,
                    seq=seq,
                    head=source,
                    holo=None,
                )
                response = commit(client, source)
                self.assertEqual(response.status_code, 200, response.get_json())
            presence = client.get(
                "/api/holo/presence",
                query_string={"subject_rappid": manual_subject},
            ).get_json()
            self.assertEqual(
                presence["classification"],
                "unassisted-human-likely",
            )
            self.assertEqual(presence["window"]["sighted_outputs"], 0)

    def test_holo_wake_requires_enabled_timing_and_replay_evidence(self):
        disabled_subject = "rappid:@kody-w/disabled-holo:" + "c" * 64
        with IsolatedHome():
            client = zoo.create_app().test_client()
            stream = f"{disabled_subject}:manual"
            source = None
            for seq in range(8):
                source = build_turn(
                    stream_id=stream,
                    seq=seq,
                    head=source,
                    holo=None,
                    channel_enabled=False,
                    turn_latency_ms=None,
                    deadline_ms=None,
                )
                response = commit(client, source)
                self.assertEqual(response.status_code, 200, response.get_json())
                self.assertEqual(response.get_json()["status"], "unknown")
            presence = client.get(
                "/api/holo/presence",
                query_string={"subject_rappid": disabled_subject},
            ).get_json()
            self.assertEqual(presence["classification"], "indeterminate")
            self.assertIsNone(presence["window"])
            self.assertEqual(presence["reason_codes"], ["holo-disabled"])

        untimed_subject = "rappid:@kody-w/untimed-holo:" + "d" * 64
        with IsolatedHome():
            client = zoo.create_app().test_client()
            stream = f"{untimed_subject}:untimed"
            source = None
            base = None
            for seq in range(8):
                source = build_turn(
                    stream_id=stream,
                    seq=seq,
                    head=source,
                    holo=blank_output(base),
                    channel_enabled=True,
                    turn_latency_ms=None,
                    deadline_ms=None,
                )
                response = commit(client, source)
                self.assertEqual(response.status_code, 201, response.get_json())
                base = response.get_json()["holo_frame"]["frame_hash"]
            presence = client.get(
                "/api/holo/presence",
                query_string={"subject_rappid": untimed_subject},
            ).get_json()
            self.assertEqual(presence["classification"], "indeterminate")
            self.assertEqual(presence["window"]["timed_outputs"], 0)
            self.assertEqual(presence["window"]["replay_consistent_outputs"], 8)

    def test_activation_records_player_order_without_moving_authority(self):
        with IsolatedHome():
            client = zoo.create_app().test_client()
            stream = f"{SUBJECT}:session"
            source0 = build_turn(
                stream_id=stream,
                seq=0,
                head=None,
                holo=blank_output(),
            )
            holo0 = commit(client, source0).get_json()["holo_frame"]["frame_hash"]
            source1 = build_turn(
                stream_id=stream,
                seq=1,
                head=source0,
                holo=blank_output(holo0),
            )
            holo1 = commit(client, source1).get_json()["holo_frame"]["frame_hash"]

            first = client.post(
                "/api/holo/activate",
                json={
                    "player_id": "zoo-main",
                    "previous_active_holo_id": None,
                    "departure_logical_ms": None,
                    "departure_manifest_hash": None,
                    "new_holo_id": holo0,
                },
            )
            self.assertEqual(first.status_code, 201, first.get_json())
            second = client.post(
                "/api/holo/activate",
                json={
                    "player_id": "zoo-main",
                    "previous_active_holo_id": holo0,
                    "departure_logical_ms": 7342,
                    "departure_manifest_hash": "c" * 64,
                    "new_holo_id": holo1,
                },
            )
            self.assertEqual(second.status_code, 201, second.get_json())
            self.assertEqual(second.get_json()["activation_order"], 1)
            heads = client.get("/api/holo/heads").get_json()["heads"]
            self.assertEqual(heads[0]["holo_id"], holo1)

    def test_holo_commit_requires_desktop_capability(self):
        with IsolatedHome():
            frame = build_turn(
                stream_id=f"{SUBJECT}:session",
                seq=0,
                head=None,
                holo=blank_output(),
            )
            response = zoo.create_app().test_client().post(
                "/api/holo/commit",
                json={"source_frame": frame},
            )
            self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
