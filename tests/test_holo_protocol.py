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
