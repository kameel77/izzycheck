import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    // Strict RBAC: Rezerwa dla Administratora
    if (user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Dostęp zabroniony. Rejestr audytowy jest dostępny wyłącznie dla roli ADMINISTRATORA." },
        { status: 403 }
      );
    }

    const auditEvents = await prisma.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        user: { select: { name: true, email: true, role: true } },
      },
    });

    return NextResponse.json({ success: true, auditEvents });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Błąd pobierania logów audytowych." }, { status: 500 });
  }
}
