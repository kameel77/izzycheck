import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const searchVin = searchParams.get("vin")?.trim().toUpperCase();

    const reports = await prisma.report.findMany({
      where: searchVin ? { vin: { contains: searchVin } } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        createdBy: { select: { name: true, email: true } },
        vehicleSnapshot: { select: { make: true, model: true, variant: true, marketPriceCob: true } },
        moduleResults: { select: { moduleId: true, status: true } },
        damageClaims: { select: { id: true, isTotalLoss: true, damageValue: true } },
      },
    });

    return NextResponse.json({ success: true, reports });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Błąd pobierania historii." }, { status: 500 });
  }
}
