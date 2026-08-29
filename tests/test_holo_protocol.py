"""Shared conformance fixtures for the Python RAPP Holo/1 validator."""

import copy
import json
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "utils"))

import holo_protocol as H


CORPUS_PATH = ROOT / "holograms" / "protocol" / "fixtures" / "corpus.json"
CORPUS = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


def resolve_references(value):
    if isinstance(value, dict) and set(value) == {"document", "path"}:
        result = copy.deepcopy(CORPUS["documents"][value["document"]])
        for part in value["path"]:
            result = result[part]
        return copy.deepcopy(result)
    if isinstance(value, dict):
        return {key: resolve_references(item) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_references(item) for item in value]
    return copy.deepcopy(value)


def apply_patches(value, patches):
    for patch in patches:
        target = value
        for part in patch["path"][:-1]:
            target = target[part]
        final = patch["path"][-1]
        if patch["op"] == "replace":
            target[final] = copy.deepcopy(patch["value"])
        elif patch["op"] == "remove":
            if isinstance(target, list):
                target.pop(final)
            else:
                del target[final]
        elif patch["op"] == "add" and isinstance(target, list):
            replacement = copy.deepcopy(patch["value"])
            if final == "-":
                target.append(replacement)
            else:
                target.insert(final, replacement)
        elif patch["op"] == "add":
            target[final] = copy.deepcopy(patch["value"])
        else:
            raise AssertionError(f"unsupported fixture patch: {patch}")
    return value


def validate(kind, value, context):
    if kind == "output":
        return H.validate_output(
            value,
            base=context.get("base_state"),
            ancestor_ids=context.get("ancestors"),
        )
    options = {
        "subject_rappid": context["subject_rappid"],
        "source_binding": context["source_binding"],
        "base_state": context.get("base_state"),
        "ancestor_resolver": context.get("ancestors"),
    }
    if "expected_visual_parent" in context:
        options["expected_visual_parent"] = context["expected_visual_parent"]
    options["base"] = options.pop("base_state")
    options["ancestor_ids"] = options.pop("ancestor_resolver")
    return H.validate_bound_record(value, **options)


def history_output(references, *, base_holo_id=None, state=None):
    value = copy.deepcopy(CORPUS["documents"]["blank-valid-output"])
    value["base_holo_id"] = base_holo_id
    if state is not None:
        value["state"] = copy.deepcopy(state)
    if references:
        value["performance"]["sustain"] = {
            "duration_ms": max(1, len(references) - 1),
            "repeat": "once",
            "tracks": [],
            "flipbook": [
                {
                    "at_ms": index,
                    "holo_id": holo_id,
                    "blend": "cut",
                    "blend_ms": 0,
                }
                for index, holo_id in enumerate(references)
            ],
        }
    return value


def history_record(holo_id, sequence, parent, references, *, state=None):
    authored = history_output(
        references,
        base_holo_id=parent,
        state=state,
    )
    return {
        "schema": "rapp-holo-record/1",
        "holo_seq": sequence,
        "visual_parent": parent,
        "source": {
            "stream_id": (
                f"rappid:@kody-w/history:{'3' * 64}:session"
            ),
            "seq": sequence,
            "frame_hash": f"{sequence + 1000:064x}",
        },
        "authored_hash": H.authored_hash(authored),
        "producer_provenance": None,
        "authored": authored,
    }


def history_id(index):
    return f"{index + 100:064x}"


class TestHoloProtocolFixtures(unittest.TestCase):
    def test_shared_corpus_accepts_and_refuses_without_repair(self):
        self.assertEqual(CORPUS["schema"], "rapp-holo-fixtures/1")
        for case in CORPUS["cases"]:
            with self.subTest(case=case["name"]):
                source = copy.deepcopy(CORPUS["documents"][case["document"]])
                value = apply_patches(source, case.get("patches", []))
                context = resolve_references(CORPUS["contexts"][case["context"]])
                before = copy.deepcopy(value)
                if case["accept"]:
                    result = validate(case["kind"], value, context)
                    if case["kind"] == "output":
                        self.assertIs(result, value)
                        manifest = H.compile_manifest(
                            value,
                            base=context.get("base_state"),
                            ancestor_ids=context.get("ancestors"),
                        )
                    else:
                        manifest = result
                    self.assertEqual(
                        H.domain_hash("rapp-holo/1:compiled", manifest),
                        case["manifest_hash"],
                    )
                    self.assertEqual(value, before)
                else:
                    with self.assertRaises(H.HoloProtocolError):
                        validate(case["kind"], value, context)
                    self.assertEqual(value, before)

    def test_every_rejected_fixture_is_a_sensitive_mutation(self):
        for case in CORPUS["cases"]:
            if case["accept"]:
                continue
            with self.subTest(case=case["name"]):
                baseline = copy.deepcopy(CORPUS["documents"][case["document"]])
                baseline_context = resolve_references(
                    CORPUS["contexts"][case["baseline_context"]]
                )
                validate(case["kind"], baseline, baseline_context)
                value = apply_patches(
                    copy.deepcopy(baseline),
                    case.get("patches", []),
                )
                mutated_context = resolve_references(
                    CORPUS["contexts"][case["context"]]
                )
                with self.assertRaises(H.HoloProtocolError):
                    validate(case["kind"], value, mutated_context)

    def test_every_accepted_fixture_rejects_an_unknown_member_mutation(self):
        for case in CORPUS["cases"]:
            if not case["accept"]:
                continue
            with self.subTest(case=case["name"]):
                value = copy.deepcopy(CORPUS["documents"][case["document"]])
                value["validator-invented"] = True
                context = resolve_references(CORPUS["contexts"][case["context"]])
                with self.assertRaises(H.HoloProtocolError):
                    validate(case["kind"], value, context)

    def test_canonical_authored_ceiling_is_measured_in_utf8_bytes(self):
        value = copy.deepcopy(CORPUS["documents"]["blank-valid-output"])
        value["accessibility"]["description"] = "🧭" * (H.MAX_AUTHORED_BYTES // 4)
        with self.assertRaisesRegex(H.HoloProtocolError, "256 KiB"):
            H.validate_output(value)

    def test_unverified_ancestor_is_refused(self):
        value = copy.deepcopy(CORPUS["documents"]["historical-flipbook"])
        context = resolve_references(CORPUS["contexts"]["historical"])
        context["ancestors"]["a" * 64]["verified_ancestor"] = False
        with self.assertRaisesRegex(H.HoloProtocolError, "verified strict"):
            H.validate_output(
                value,
                base=context["base_state"],
                ancestor_ids=context["ancestors"],
            )

    def test_non_null_provenance_fails_closed(self):
        case = next(
            item for item in CORPUS["cases"]
            if item["name"] == "untrusted-provenance"
        )
        record = apply_patches(
            copy.deepcopy(CORPUS["documents"][case["document"]]),
            case["patches"],
        )
        with self.assertRaisesRegex(
            H.HoloProtocolError,
            "trusted provenance verification unavailable",
        ):
            H.validate_record(record)

    def test_stable_adapters_accept_output_base_and_ancestor_id_set(self):
        value = copy.deepcopy(CORPUS["documents"]["historical-flipbook"])
        base = CORPUS["documents"]["multi-node-non-humanoid-scene"]
        ancestor_ids = {"a" * 64, "b" * 64}
        self.assertIs(
            H.validate_output(value, base=base, ancestor_ids=ancestor_ids),
            value,
        )
        self.assertEqual(
            H.compile_manifest(value, base=base, ancestor_ids=ancestor_ids)[
                "schema"
            ],
            "rapp-holo-compiled/1",
        )
        self.assertEqual(
            H.compile_scene_manifest(value)["schema"],
            "rapp-holo-compiled/1",
        )

    def test_stable_record_adapter_preserves_exact_payload(self):
        record = copy.deepcopy(CORPUS["documents"]["valid-successor-record"])
        self.assertIs(H.validate_record(record), record)
        subject = CORPUS["contexts"]["successor-record"]["subject_rappid"]
        self.assertIs(
            H.validate_record(record, subject_rappid=subject),
            record,
        )
        historical = copy.deepcopy(record)
        historical["authored"] = copy.deepcopy(
            CORPUS["documents"]["historical-flipbook"]
        )
        historical["authored_hash"] = H.authored_hash(historical["authored"])
        historical["producer_provenance"] = None
        self.assertIs(H.validate_record(historical), historical)
        wrong_subject = f"rappid:@kody-w/other:{'2' * 64}"
        with self.assertRaisesRegex(H.HoloProtocolError, "body subject"):
            H.validate_record(record, subject_rappid=wrong_subject)


class TestHoloProtocolHelpers(unittest.TestCase):
    def test_shared_integer_helper_vectors(self):
        for item in CORPUS["helpers"]["round_div"]:
            self.assertEqual(H.round_div(*item["args"]), item["expected"])
        for item in CORPUS["helpers"]["easing"]:
            self.assertEqual(H.easing(*item["args"]), item["expected"])
        for item in CORPUS["helpers"]["local_sustain_time"]:
            self.assertEqual(H.local_sustain_time(*item["args"]), item["expected"])
        for item in CORPUS["helpers"]["growl_events"]:
            growl = copy.deepcopy(item["growl"])
            self.assertEqual(H.growl_events(growl), item["expected"])
            self.assertEqual(H.complete_growl(growl), item["expected"])
            self.assertEqual(growl, item["growl"])

    def test_shared_track_and_flipbook_vectors(self):
        for item in CORPUS["helpers"]["property_tracks"]:
            track = resolve_references(item["track"])
            self.assertEqual(
                H.evaluate_property_track(track, item["at_ms"]),
                item["expected"],
            )
        flipbook = CORPUS["documents"]["historical-flipbook"]["performance"][
            "sustain"
        ]["flipbook"]
        for item in CORPUS["helpers"]["flipbook"]:
            self.assertEqual(
                H.select_flipbook(flipbook, item["at_ms"], 4000, "loop"),
                item["expected"],
            )

    def test_shared_shapee_outline_and_compiled_counts(self):
        for item in CORPUS["helpers"]["shapee_outline"]:
            geometry = copy.deepcopy(item["geometry"])
            self.assertEqual(
                H.shapee_outline(geometry),
                item["expected"],
            )
            self.assertEqual(geometry, item["geometry"])
            self.assertEqual(item["expected"][0], item["expected"][-1])
        manifest = H.compile_manifest(CORPUS["documents"]["shapee-ai-tile"])
        geometry = manifest["draws"][0]["geometry"]
        expected = CORPUS["helpers"]["shapee_outline"][0]
        self.assertEqual(geometry["derived"]["outline"], expected["expected"])
        self.assertEqual(
            geometry["derived"]["outline_vertex_count"],
            expected["outline_vertex_count"],
        )
        self.assertEqual(geometry["vertex_count"], expected["vertex_count"])
        self.assertEqual(geometry["triangle_count"], expected["triangle_count"])

    def test_shared_recursive_history_resolution(self):
        item = CORPUS["helpers"]["resolve_history"][0]
        value = copy.deepcopy(CORPUS["documents"][item["document"]])
        context = resolve_references(CORPUS["contexts"][item["context"]])
        self.assertEqual(
            H.resolve_history(value, context["ancestors"]),
            item["expected"],
        )
        for case_name, message in (
            ("recursive-history-cycle", "historical reference cycle"),
            ("recursive-history-non-ancestor", "not a strict visual ancestor"),
        ):
            case = next(
                case for case in CORPUS["cases"]
                if case["name"] == case_name
            )
            context = resolve_references(CORPUS["contexts"][case["context"]])
            with self.assertRaisesRegex(H.HoloProtocolError, message):
                H.resolve_history(
                    copy.deepcopy(CORPUS["documents"][case["document"]]),
                    context["ancestors"],
                )

    def test_recursive_history_depth_and_unique_limits(self):
        records = {}
        for index in range(9):
            parent = history_id(index - 1) if index else None
            references = [parent] if parent is not None else []
            records[history_id(index)] = history_record(
                history_id(index),
                index,
                parent,
                references,
            )
        root = history_output([history_id(8)], base_holo_id=history_id(8))
        with self.assertRaisesRegex(H.HoloProtocolError, "depth exceeds eight"):
            H.resolve_history(root, records)

        records = {}
        nested = {
            64: list(range(48, 64)),
            48: list(range(32, 48)),
            32: list(range(16, 32)),
            16: list(range(0, 16)),
        }
        for index in range(65):
            parent = history_id(index - 1) if index else None
            records[history_id(index)] = history_record(
                history_id(index),
                index,
                parent,
                [history_id(item) for item in nested.get(index, [])],
            )
        root = history_output([history_id(64)], base_holo_id=history_id(64))
        with self.assertRaisesRegex(H.HoloProtocolError, "exceed 64"):
            H.resolve_history(root, records)

    def test_recursive_history_byte_limit(self):
        points = [
            {"position": [index % 1000, index // 1000, 0], "size": 1}
            for index in range(5000)
        ]
        state = copy.deepcopy(
            CORPUS["documents"]["blank-valid-output"]["state"]
        )
        state["nodes"] = [
            {
                "id": "mass",
                "parent": None,
                "type": "points",
                "visible": True,
                "transform": {
                    "position": [0, 0, 0],
                    "rotation": [0, 0, 0],
                    "scale": [1000, 1000, 1000],
                },
                "geometry": {"points": points},
                "material": {
                    "color": "#FFFFFF",
                    "emissive": "#000000",
                    "emissive_strength": 0,
                    "opacity": 1000,
                    "presentation": "points",
                    "blend": "normal",
                    "side": "front",
                    "metallic": 0,
                    "roughness": 1000,
                },
            }
        ]
        records = {}
        nested = {31: list(range(16, 31)), 16: list(range(0, 16))}
        for index in range(32):
            parent = history_id(index - 1) if index else None
            records[history_id(index)] = history_record(
                history_id(index),
                index,
                parent,
                [history_id(item) for item in nested.get(index, [])],
                state=state,
            )
        root = history_output([history_id(31)], base_holo_id=history_id(31))
        with self.assertRaisesRegex(H.HoloProtocolError, "exceed 4 MiB"):
            H.resolve_history(root, records)

    def test_growl_aggregate_duration_limit(self):
        value = copy.deepcopy(CORPUS["documents"]["blank-valid-output"])
        note = {
            "pitch": 64,
            "delta_onset": 65_535,
            "duration": 1,
            "velocity": 64,
        }
        value["growl"]["continuation"] = [
            copy.deepcopy(note) for _ in range(257)
        ]
        with self.assertRaisesRegex(H.HoloProtocolError, "song duration"):
            H.validate_output(value)

    def test_strict_parser_refuses_duplicate_members_and_floats(self):
        with self.assertRaises(H.ProtocolError):
            H.parse_json('{"a":1,"a":2}')
        with self.assertRaises(H.ProtocolError):
            H.parse_json('{"a":1.0}')

    def test_round_div_refuses_nonpositive_denominator(self):
        with self.assertRaises(H.HoloProtocolError):
            H.round_div(1, 0)


if __name__ == "__main__":
    unittest.main()
