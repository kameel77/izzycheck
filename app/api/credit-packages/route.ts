import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPrepaid } from "@/lib/billing/credits";
import { isPaymentsConfigured } from "@/lib/billing/payments-config";
import { unitGrossFromNet } from "@/lib/billing/pricing";

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
      return NextResponse.json({ packages: [], paymentsEnabled: false });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { billingMode: true, isActive: true },
    });
    // Same rule as checkout: an inactive organization cannot buy.
    if (!organization?.isActive || !isPrepaid(organization)) {
      return NextResponse.json({ packages: [], paymentsEnabled: false });
    }

    const packages = await prisma.creditPackage.findMany({
      where: { isActive: true },
      orderBy: [{ creditType: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, creditType: true, credits: true, priceNetGrosze: true, vatRate: true },
    });

    return NextResponse.json({
      packages: packages.map((p) => ({ ...p, unitGrossGrosze: unitGrossFromNet(p.priceNetGrosze, p.vatRate) })),
      paymentsEnabled: isPaymentsConfigured(),
    });
  } catch (error) {
    console.error("[CREDIT_PACKAGES_GET_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się pobrać cennika pakietów." }, { status: 500 });
  }
}
