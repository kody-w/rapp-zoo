export const HOLO_ZOO_RELEASE_POLICY = Object.freeze({
  schema: "holo-zoo-release-policy/1",
  channel: "internal-testflight",
  audience: "adult-internal-testers",
  otaUpdatesEnabled: false,
  automaticTelemetry: false,
  realCommerceEnabled: false,
  productionRapterWorksEnabled: false,
  tipsEnabled: false,
  sponsorshipEnabled: false,
  rentalsEnabled: false,
  resaleEnabled: false,
  managedComputeSalesEnabled: false,
  coinEconomicsEnabled: false,
  externalInteroperabilityEnabled: false,
  irreversibleProtocolWritesEnabled: false,
  currentRappMigrationRequired: true,
});

export function assertReleasePolicy(): void {
  const policy = HOLO_ZOO_RELEASE_POLICY;
  if (
    policy.channel !== "internal-testflight" ||
    policy.audience !== "adult-internal-testers" ||
    policy.otaUpdatesEnabled ||
    policy.automaticTelemetry ||
    policy.realCommerceEnabled ||
    policy.productionRapterWorksEnabled ||
    policy.tipsEnabled ||
    policy.sponsorshipEnabled ||
    policy.rentalsEnabled ||
    policy.resaleEnabled ||
    policy.managedComputeSalesEnabled ||
    policy.coinEconomicsEnabled ||
    policy.externalInteroperabilityEnabled ||
    policy.irreversibleProtocolWritesEnabled ||
    !policy.currentRappMigrationRequired
  ) {
    throw new Error("Holo Zoo release policy enables an unapproved surface.");
  }
}
