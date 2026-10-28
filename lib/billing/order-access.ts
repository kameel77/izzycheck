import type { Role } from "@prisma/client";

/** Who may see an order: its creator, or a MANAGER/ADMIN of the order's organization. */
export function canViewOrder(
  viewer: { userId: string; role: Role; organizationId: string | null },
  order: { userId: string; organizationId: string },
): boolean {
  if (viewer.organizationId === null || viewer.organizationId !== order.organizationId) return false;
  return order.userId === viewer.userId || viewer.role === "MANAGER" || viewer.role === "ADMIN";
}

/** The PayU payment link is only for the order's creator and only while the payment is still open. */
export function canResumePayment(
  viewerUserId: string,
  order: { userId: string; status: string; payuRedirectUri: string | null },
): boolean {
  return order.userId === viewerUserId && order.status === "PENDING_PAYMENT" && Boolean(order.payuRedirectUri);
}
