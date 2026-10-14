import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";

export async function GET() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    return NextResponse.json({ authenticated: false, user: null }, { status: 401 });
  }

  // Fetch fresh state from database to protect against stale 24h JWT
  const freshUser = await getFreshUser(sessionUser.userId);
  if (!freshUser || !freshUser.isActive) {
    return NextResponse.json({ authenticated: false, user: null, error: "Konto nieaktywne lub nie istnieje." }, { status: 401 });
  }

  // Check if organization is inactive (for non-admin users)
  if (freshUser.role !== "ADMIN" && freshUser.organization && !freshUser.organization.isActive) {
    return NextResponse.json({ authenticated: false, user: null, error: "Organizacja została zablokowana." }, { status: 403 });
  }

  const isFullAccess = freshUser.role === "ADMIN" || freshUser.role === "MANAGER";

  const enrichedUser = {
    userId: freshUser.id,
    id: freshUser.id,
    email: freshUser.email,
    name: freshUser.name,
    role: freshUser.role,
    isActive: freshUser.isActive,
    organizationId: freshUser.organizationId,
    organization: freshUser.organization,
    canGenerateValuation: isFullAccess || freshUser.canGenerateValuation,
    canGenerateClaimCheck: isFullAccess || freshUser.canGenerateClaimCheck,
    canGenerateClaimDetails: isFullAccess || freshUser.canGenerateClaimDetails,
    canViewOrgReports: isFullAccess || freshUser.canViewOrgReports,
  };

  return NextResponse.json({ authenticated: true, user: enrichedUser });
}
