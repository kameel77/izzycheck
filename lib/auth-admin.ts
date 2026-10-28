import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";

/** Resolves the active ADMIN behind the current session, or a ready 401/403 response. */
export async function requireAdmin() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    return { error: NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 }) };
  }

  const freshUser = await getFreshUser(sessionUser.userId);
  if (!freshUser || freshUser.role !== "ADMIN" || !freshUser.isActive) {
    return {
      error: NextResponse.json({ error: "Dostęp zabroniony. Wymagane uprawnienia administratora." }, { status: 403 }),
    };
  }
  return { admin: freshUser };
}
