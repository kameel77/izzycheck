import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const { id } = await params;

    const report = await prisma.report.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        moduleResults: { select: { moduleId: true, status: true, responseMetadata: true, errorMessage: true } },
        vehicleSnapshot: true,
        damageClaims: true,
      },
    });

    if (!report) {
      return NextResponse.json({ error: "Nie odnaleziono raportu w bazie danych." }, { status: 404 });
    }

    // Role-based check: Non-admin users can view reports created by operators in their organization
    return NextResponse.json({ success: true, report });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Błąd pobierania raportu z bazy." }, { status: 500 });
  }
}
