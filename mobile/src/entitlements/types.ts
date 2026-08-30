export type CompanionEntitlement = {
  kind: "companion";
  accountIdHash: string;
  organismRappid: string;
  accountCap: 1;
  transferable: false;
  scarcePremiumSeries: false;
  signatureVerified: boolean;
};

export type RentedPremiumRapterEntitlement = {
  kind: "rented-premium-rapter";
  leaseId: string;
  organismRappid: string;
  activeLesseeAccountHash: string;
  exclusiveActiveLessee: true;
  startedUtc: string;
  expiresUtc: string;
  freshUntilUtc: string;
  lastSyncedUtc: string;
  renewal: "renews" | "cancels-at-expiry";
  signatureVerified: boolean;
};

export type OwnedRapterEntitlement = {
  kind: "owned-rapter";
  organismRappid: string;
  capsuleId: string;
  creditId: string;
  ownership: "permanent-local-capsule";
  transferableBy: "signed-registry-events";
  subscriptionRequired: false;
  signatureVerified: boolean;
};

export type SovereignApplicationEntitlement = {
  kind: "sovereign-application";
  applicationId: string;
  grantId: string;
  accountIdHash: string;
  issuedUtc: string;
  expiresUtc: string | null;
  status: "active" | "revoked";
  confersOrganismOwnership: false;
  signatureVerified: boolean;
};

export type ProductEntitlement =
  | CompanionEntitlement
  | RentedPremiumRapterEntitlement
  | OwnedRapterEntitlement
  | SovereignApplicationEntitlement;

export type EntitlementSnapshot = {
  schema: "rapterbox-entitlements/1";
  accountIdHash: string;
  verifiedUtc: string;
  companion: CompanionEntitlement | null;
  rentals: RentedPremiumRapterEntitlement[];
  ownedRapters: OwnedRapterEntitlement[];
  sovereignApplications: SovereignApplicationEntitlement[];
};

export type EntitlementPresentation = {
  state:
    | "companion"
    | "rented-active"
    | "rented-stale-offline"
    | "rented-expired"
    | "owned"
    | "sovereign-active"
    | "sovereign-expired"
    | "revoked"
    | "unverified";
  label: string;
  usable: boolean;
  transferable: boolean;
};
