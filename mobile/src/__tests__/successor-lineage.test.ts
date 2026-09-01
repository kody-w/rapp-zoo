import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeSuccessorLineage } from "@/lib/successor-lineage";

describe("Direct successor lineage", () => {
  it("preserves capsule parents while adding reloaded library frames", () => {
    const parent = { id: "parent", subjectRappid: "rappid:one", holoSequence: 1 };
    const prior = { id: "prior", subjectRappid: "rappid:one", holoSequence: 2 };
    const successor = {
      id: "successor",
      subjectRappid: "rappid:one",
      holoSequence: 3,
    };
    const unrelated = {
      id: "other",
      subjectRappid: "rappid:two",
      holoSequence: 99,
    };
    assert.deepEqual(
      mergeSuccessorLineage(
        successor,
        [parent, prior],
        [{ holo: successor }, { holo: prior }, { holo: unrelated }],
      ).map((frame) => frame.id),
      ["successor", "prior", "parent"],
    );
  });
});
