import { createPreviewBillingAdapter } from "./preview-adapter";
import type { BillingAdapter } from "./types";

export function createBillingAdapter(): BillingAdapter {
  return createPreviewBillingAdapter("Web billing preview");
}
