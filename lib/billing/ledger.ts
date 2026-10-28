import type { Prisma, Role } from "@prisma/client";

export type LedgerScope = "mine" | "org";

export interface LedgerViewer {
  userId: string;
  role: Role;
  organizationId: string;
}

/**
 * Filter for the credit usage history. Always limited to the viewer's organization;
 * the organization-wide scope (usage and manual adjustments of everyone) is only for
 * MANAGER and ADMIN with an organization, everybody else gets their own usage.
 */
export function buildLedgerWhere(viewer: LedgerViewer, scope: LedgerScope): Prisma.CreditLedgerEntryWhereInput {
  const canSeeOrg = viewer.role === "MANAGER" || viewer.role === "ADMIN";
  if (scope === "org" && canSeeOrg) {
    return { organizationId: viewer.organizationId };
  }
  return { organizationId: viewer.organizationId, type: "USAGE", userId: viewer.userId };
}
