import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

describe("Rolling Cores master SHAPEE sigil", () => {
  it("keeps every app/store asset on the canonical deterministic outline", () => {
    execFileSync(
      process.execPath,
      ["scripts/generate-brand-assets.mjs", "--check"],
      {
        cwd: new URL("../../", import.meta.url),
        stdio: "pipe",
      },
    );
  });
});
