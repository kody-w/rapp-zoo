import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalize, domainHash, strictParse } from "@/lib/strict-json";

describe("strict RAPP JSON", () => {
  it("matches the Python canonical hash fixture", () => {
    const value = strictParse('{"z":"🧭","a":[1,true,null],"é":"ok"}');
    assert.equal(canonicalize(value), '{"a":[1,true,null],"z":"🧭","é":"ok"}');
    assert.equal(
      domainHash("fixture", value),
      "563a93cad33f9241a650afb5e3d050593df18112b7781690022a54929c535edc",
    );
  });

  it("refuses duplicate members and floating point values", () => {
    assert.throws(
      () => strictParse('{"a":1,"a":2}'),
      /Duplicate object member/,
    );
    assert.throws(() => strictParse('{"a":1.0}'), /Floating-point values/);
  });

  it("orders object keys by UTF-16 code units", () => {
    assert.equal(
      canonicalize(strictParse('{"😀":1,"\\uE000":2}')),
      '{"😀":1,"":2}',
    );
  });

  it("does not permit prototype pollution through parsed object keys", () => {
    const value = strictParse('{"__proto__":{"polluted":true}}');
    assert.equal(canonicalize(value), '{"__proto__":{"polluted":true}}');
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  });
});
