import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-admin";
import { currentMonthWarsaw, isValidMonth } from "@/lib/api-clients/month";
import { getApiUsageSummary } from "@/lib/api-clients/usage";

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(req.url);
    const organizationId = searchParams.get("organizationId");
    const month = searchParams.get("month") || currentMonthWarsaw();

    if (!organizationId) {
      return NextResponse.json({ error: "Wybierz organizację." }, { status: 400 });
    }
    if (!isValidMonth(month)) {
      return NextResponse.json({ error: "Miesiąc musi mieć format RRRR-MM." }, { status: 400 });
    }

    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) {
      return NextResponse.json({ error: "Nie odnaleziono organizacji." }, { status: 404 });
    }

    const summary = await getApiUsageSummary(prisma, organizationId, month);
    return NextResponse.json({ summary });
  } catch (err) {
    console.error("[ADMIN_API_USAGE_GET_ERROR]", err);
    return NextResponse.json({ error: "Nie udało się pobrać użycia API." }, { status: 500 });
  }
}
