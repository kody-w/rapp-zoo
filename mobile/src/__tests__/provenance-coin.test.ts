import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RAPTER_COIN_POLICY,
  buildDormantRapterCoin,
  rapterCoinIdFor,
  rapterCoinWireValue,
  validateRapterCoinValue,
} from "@/provenance/policy";

const SUBJECT = `rappid:@kody-w/coin-trail:${"a".repeat(64)}`;
const PUBLISHER = `rappid:@kody-w/coin-publisher:${"9".repeat(64)}`;
const EXPECTED_COIN_ID =
  "rcoin:14dccd61ab2854b678cfa436166d7893fceefb9fe4fa57ca2bbb1b0bc28fcab2";

function genesisCoin() {
  return buildDormantRapterCoin({
    organismRappid: SUBJECT,
    publisherRappid: PUBLISHER,
    publisherAuthorizationHash: "8".repeat(64),
    doggPublicationHash: "7".repeat(64),
    coreFrameHash: "b".repeat(64),
    coreSeq: 0,
    sourceFrameHash: "c".repeat(64),
    rightsProfileId: "rapterbox-public-bones-v1",
    rightsProfileHash: "d".repeat(64),
    createdUtc: "2026-08-31T17:19:44.000Z",
  });
}

describe("dormant Rapter Coin Trail", () => {
  it("reserves one deterministic cross-language ID per public frame", () => {
    const coin = genesisCoin();
    assert.equal(
      coin.coinId,
      rapterCoinIdFor(SUBJECT, "b".repeat(64)),
    );
    assert.equal(coin.coinId, EXPECTED_COIN_ID);
    assert.match(coin.coinId, /^rcoin:[0-9a-f]{64}$/);
    assert.deepEqual(
      validateRapterCoinValue(rapterCoinWireValue(coin)),
      coin,
    );
  });

  it("keeps every consumer and economic surface dormant", () => {
    assert.deepEqual(RAPTER_COIN_POLICY, {
      schema: "rapp-rapter-coin-policy/1",
      rollout: "dormant",
      projectionEnabled: false,
      publicDisplayEnabled: false,
      walletEnabled: false,
      marketEnabled: false,
      titleAuthority: "rapter-credit-registry",
      publicationAuthority: "authorized-keyed-publisher",
      eligibleVisibility: "public-dogg",
      privateDataIncluded: false,
      tipsMayReferenceCoin: true,
      tipsAffectCoinValue: false,
    });
  });

  it("advances only as a same-lineage append-only public trail", () => {
    const first = genesisCoin();
    const second = buildDormantRapterCoin({
      organismRappid: SUBJECT,
      publisherRappid: PUBLISHER,
      publisherAuthorizationHash: "8".repeat(64),
      doggPublicationHash: "7".repeat(64),
      coreFrameHash: "e".repeat(64),
      coreSeq: 7,
      sourceFrameHash: "f".repeat(64),
      rightsProfileId: "rapterbox-public-bones-v1",
      rightsProfileHash: "d".repeat(64),
      createdUtc: "2026-08-31T17:20:44.000Z",
      previous: first,
    });
    assert.equal(second.previousCoinId, first.coinId);
    assert.equal(second.coinSeq, first.coinSeq + 1);
    assert.equal(second.coreSeq, 7);
  });

  it("refuses private, financial, and unknown record mutations", () => {
    const wire = rapterCoinWireValue(genesisCoin());

    assert.throws(() =>
      validateRapterCoinValue({ ...wire, visibility: "private-godd" }),
    );
    assert.throws(() =>
      validateRapterCoinValue({ ...wire, price_sats: 1 }),
    );
    assert.throws(() =>
      validateRapterCoinValue({
        ...wire,
        coin_seq: 1,
        previous_coin_id: `rcoin:${"1".repeat(64)}`,
      }),
    );
    assert.throws(() =>
      validateRapterCoinValue(
        {
          ...wire,
          economics: {
            status: "dormant",
            cash_value: null,
            purchasable: false,
            redeemable: false,
            transferable: true,
            yield_bearing: false,
          },
        },
      ),
    );
  });

  it("matches canonical RAPPID owner and slug length limits", () => {
    assert.throws(() =>
      rapterCoinIdFor(
        `rappid:@${"a".repeat(40)}/coin-trail:${"b".repeat(64)}`,
        "c".repeat(64),
      ),
    );
    assert.throws(() =>
      rapterCoinIdFor(
        `rappid:@owner/${"a".repeat(101)}:${"b".repeat(64)}`,
        "c".repeat(64),
      ),
    );
  });

  it("matches strict RAPP fixed-form calendar validation", () => {
    assert.throws(() =>
      buildDormantRapterCoin({
        organismRappid: SUBJECT,
        publisherRappid: PUBLISHER,
        publisherAuthorizationHash: "8".repeat(64),
        doggPublicationHash: "7".repeat(64),
        coreFrameHash: "b".repeat(64),
        coreSeq: 0,
        sourceFrameHash: "c".repeat(64),
        rightsProfileId: "rapterbox-public-bones-v1",
        rightsProfileHash: "d".repeat(64),
        createdUtc: "2026-02-30T17:19:44.000Z",
      }),
    );
    assert.throws(() =>
      buildDormantRapterCoin({
        organismRappid: SUBJECT,
        publisherRappid: PUBLISHER,
        publisherAuthorizationHash: "8".repeat(64),
        doggPublicationHash: "7".repeat(64),
        coreFrameHash: "b".repeat(64),
        coreSeq: 0,
        sourceFrameHash: "c".repeat(64),
        rightsProfileId: "rapterbox-public-bones-v1",
        rightsProfileHash: "d".repeat(64),
        createdUtc: "0000-01-01T00:00:00.000Z",
      }),
    );
  });
});
