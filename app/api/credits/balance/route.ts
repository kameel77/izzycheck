import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getBalances, isPrepaid } from "@/lib/billing/credits";

export async function GET() {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne lub nie istnieje." }, { status: 401 });
    }

    const organizationId = freshUser.organizationId;
    if (!organizationId) {
      return NextResponse.json({ billingMode: "UNLIMITED", balances: null });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { billingMode: true },
    });
    if (!isPrepaid(organization)) {
      return NextResponse.json({ billingMode: "UNLIMITED", balances: null });
    }

    const balances = await getBalances(prisma, organizationId);
    return NextResponse.json({
      billingMode: "PREPAID",
      balances: { VALUATION: balances.VALUATION, CLAIM_DETAILS: balances.CLAIM_DETAILS },
    });
  } catch (error) {
    console.error("[CREDITS_BALANCE_GET_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się pobrać salda kredytów." }, { status: 500 });
  }
}
