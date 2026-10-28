import type { Role } from "@prisma/client";

/** Who may see an order: its creator, or a MANAGER/ADMIN of the order's organization. */
export function canViewOrder(
  viewer: { userId: string; role: Role; organizationId: string | null },
  order: { userId: string; organizationId: string },
): boolean {
  if (viewer.organizationId === null || viewer.organizationId !== order.organizationId) return false;
  return order.userId === viewer.userId || viewer.role === "MANAGER" || viewer.role === "ADMIN";
}
