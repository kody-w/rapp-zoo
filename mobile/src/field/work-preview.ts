import { domainHash } from "@/lib/strict-json";

const RAPPID_PATTERN =
  /^rappid:@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*:[0-9a-f]{64}$/;
export type WorkPreviewCategory =
  | "research"
  | "build"
  | "creative"
  | "verify";

export type WorkPreviewPhase =
  | "draft"
  | "status_walkthrough"
  | "proof_walkthrough"
  | "delivery_walkthrough";

export type LocalWorkPreview = {
  schema: "local-work-preview/1";
  previewId: string;
  organismId: string;
  organismRappid: string;
  category: WorkPreviewCategory;
  phase: WorkPreviewPhase;
  requestedUtc: string;
  maxMinutes: number;
  maxOutputTokens: number;
  officialJobId: null;
  economicsApplied: false;
  tippingAvailable: false;
  publicPublicationAvailable: false;
  companionStateChanged: false;
  privateLocalOnly: true;
};

export const WORK_PREVIEW_CATEGORIES: readonly {
  code: WorkPreviewCategory;
  label: string;
  request: string;
}[] = [
  {
    code: "research",
    label: "Research",
    request: "Investigate a bounded question and return sources plus conclusions.",
  },
  {
    code: "build",
    label: "Build",
    request: "Create a bounded artifact and return the complete local result.",
  },
  {
    code: "creative",
    label: "Create",
    request: "Produce an original bounded concept with inspectable evidence.",
  },
  {
    code: "verify",
    label: "Verify",
    request: "Check a bounded claim or artifact and return refusal evidence if needed.",
  },
];

export function createLocalWorkPreview(input: {
  organismId: string;
  organismRappid: string;
  category: WorkPreviewCategory;
  requestedUtc: string;
}): LocalWorkPreview {
  if (
    !input.organismId ||
    !rappidValid(input.organismRappid) ||
    !WORK_PREVIEW_CATEGORIES.some((item) => item.code === input.category) ||
    !utcValid(input.requestedUtc)
  ) {
    throw new Error("Local work preview input is invalid.");
  }
  const previewId = `preview:${domainHash("holo-zoo/local-work-preview/1", {
    category: input.category,
    organism_id: input.organismId,
    organism_rappid: input.organismRappid,
    requested_utc: input.requestedUtc,
  })}`;
  return {
    schema: "local-work-preview/1",
    previewId,
    organismId: input.organismId,
    organismRappid: input.organismRappid,
    category: input.category,
    phase: "draft",
    requestedUtc: input.requestedUtc,
    maxMinutes: 15,
    maxOutputTokens: 2048,
    officialJobId: null,
    economicsApplied: false,
    tippingAvailable: false,
    publicPublicationAvailable: false,
    companionStateChanged: false,
    privateLocalOnly: true,
  };
}

export function advanceLocalWorkPreview(
  preview: LocalWorkPreview,
): LocalWorkPreview {
  assertLocalWorkPreview(preview);
  if (preview.phase === "delivery_walkthrough") return preview;
  let next: LocalWorkPreview;
  if (preview.phase === "draft") {
    next = { ...preview, phase: "status_walkthrough" };
  } else if (preview.phase === "status_walkthrough") {
    next = { ...preview, phase: "proof_walkthrough" };
  } else {
    next = { ...preview, phase: "delivery_walkthrough" };
  }
  assertLocalWorkPreview(next);
  return next;
}

export function assertLocalWorkPreview(preview: LocalWorkPreview): void {
  const expectedId = `preview:${domainHash("holo-zoo/local-work-preview/1", {
    category: preview.category,
    organism_id: preview.organismId,
    organism_rappid: preview.organismRappid,
    requested_utc: preview.requestedUtc,
  })}`;
  if (
    preview.schema !== "local-work-preview/1" ||
    !/^preview:[0-9a-f]{64}$/.test(preview.previewId) ||
    preview.previewId !== expectedId ||
    !preview.organismId ||
    !rappidValid(preview.organismRappid) ||
    !WORK_PREVIEW_CATEGORIES.some((item) => item.code === preview.category) ||
    ![
      "draft",
      "status_walkthrough",
      "proof_walkthrough",
      "delivery_walkthrough",
    ].includes(preview.phase) ||
    !utcValid(preview.requestedUtc) ||
    preview.officialJobId !== null ||
    preview.economicsApplied !== false ||
    preview.tippingAvailable !== false ||
    preview.publicPublicationAvailable !== false ||
    preview.companionStateChanged !== false ||
    preview.privateLocalOnly !== true ||
    preview.maxMinutes !== 15 ||
    preview.maxOutputTokens !== 2048
  ) {
    throw new Error("Local work preview crossed an official or economic boundary.");
  }
}

function rappidValid(value: string): boolean {
  if (!RAPPID_PATTERN.test(value)) return false;
  const identity = value.slice("rappid:@".length, -65);
  const separator = identity.indexOf("/");
  return (
    separator >= 1 &&
    identity.slice(0, separator).length <= 39 &&
    identity.slice(separator + 1).length <= 100
  );
}

function utcValid(value: string): boolean {
  if (
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(
      value,
    ) ||
    value.startsWith("0000-")
  ) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

export function workPreviewStatus(preview: LocalWorkPreview): {
  label: string;
  detail: string;
  nextAction: string | null;
} {
  assertLocalWorkPreview(preview);
  if (preview.phase === "draft") {
    return {
      label: "WORKFLOW PREVIEW · REQUEST SCREEN",
      detail:
        "This demonstrates bounded request scope. Nothing has been submitted.",
      nextAction: "Preview progress screen",
    };
  }
  if (preview.phase === "status_walkthrough") {
    return {
      label: "WORKFLOW PREVIEW · PROGRESS SCREEN",
      detail:
        "This demonstrates future server-authored status. No Rapter was matched or run.",
      nextAction: "Preview proof screen",
    };
  }
  if (preview.phase === "proof_walkthrough") {
    return {
      label: "WORKFLOW PREVIEW · PROOF SCREEN",
      detail:
        "This demonstrates where verified proof would appear. No proof exists.",
      nextAction: "Preview delivery screen",
    };
  }
  return {
    label: "WORKFLOW PREVIEW · DELIVERY SCREEN",
    detail:
      "Walkthrough complete. No job, work, proof, artifact, delivery, payment, tip, or publication occurred.",
    nextAction: null,
  };
}
