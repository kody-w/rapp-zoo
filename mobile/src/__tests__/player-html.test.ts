import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoHoloRaw } from "@/generated/holo-fixtures";
import { normalizeBaseUrl, privateHttpHostname } from "@/lib/api";
import { buildPlayerUpdate, validateHoloRaw } from "@/lib/holo";
import { buildPlayerHtml } from "@/lib/player-html";

describe("offline player shell", () => {
  it("inlines the fixed sandbox assets with no network capability", () => {
    const holo = validateHoloRaw(demoHoloRaw);
    const html = buildPlayerHtml(buildPlayerUpdate(holo, [holo], holo.id, false));
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /rapp-holo-player-update\/1/);
    assert.match(html, /RollingCoresNative/);
    assert.doesNotMatch(html, /src="\/static\//);
    assert.doesNotMatch(html, /href="\/static\//);
  });

  it("normalizes local hosts and refuses credentials", () => {
    assert.equal(
      normalizeBaseUrl("http://192.168.1.5:5000/"),
      "http://192.168.1.5:5000",
    );
    assert.throws(
      () => normalizeBaseUrl("https://token@example.com"),
      /credentials/,
    );
    assert.equal(privateHttpHostname("10.0.2.2"), true);
    assert.equal(privateHttpHostname("172.31.2.3"), true);
    assert.equal(privateHttpHostname("172.32.2.3"), false);
    assert.equal(privateHttpHostname("192.168.1.8"), true);
    assert.equal(privateHttpHostname("127.0.0.1"), true);
    assert.equal(privateHttpHostname("::1"), true);
    assert.equal(privateHttpHostname("fd12::1"), true);
    assert.equal(privateHttpHostname("example.com"), false);
    assert.throws(
      () => normalizeBaseUrl("http://example.com:5000"),
      /must use HTTPS/,
    );
    assert.equal(
      normalizeBaseUrl("https://example.com"),
      "https://example.com",
    );
  });
});
