export type RapterCoinEconomics = {
  status: "dormant";
  cashValue: null;
  purchasable: false;
  redeemable: false;
  transferable: false;
  yieldBearing: false;
};

export type RapterCoinRecord = {
  schema: "rapp-rapter-coin/1";
  coinId: string;
  organismRappid: string;
  publisherRappid: string;
  publisherAuthorizationHash: string;
  doggPublicationHash: string;
  coreFrameHash: string;
  coreSeq: number;
  coinSeq: number;
  sourceFrameHash: string;
  previousCoinId: string | null;
  rightsProfileId: string;
  rightsProfileHash: string;
  visibility: "public-dogg";
  economics: RapterCoinEconomics;
  createdUtc: string;
};

export type RapterCoinPolicy = {
  schema: "rapp-rapter-coin-policy/1";
  rollout: "dormant";
  projectionEnabled: false;
  publicDisplayEnabled: false;
  walletEnabled: false;
  marketEnabled: false;
  titleAuthority: "rapter-credit-registry";
  publicationAuthority: "authorized-keyed-publisher";
  eligibleVisibility: "public-dogg";
  privateDataIncluded: false;
  tipsMayReferenceCoin: true;
  tipsAffectCoinValue: false;
};
