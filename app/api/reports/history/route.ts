import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne lub nie istnieje." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const searchVin = searchParams.get("vin")?.trim().toUpperCase();
    const scope = searchParams.get("scope"); // "my" | "organization"
    const filterOrgId = searchParams.get("organizationId");

    // Scoped RBAC access
    const whereClause: any = {};

    if (freshUser.role === "ADMIN") {
      if (filterOrgId) {
        whereClause.organizationId = filterOrgId;
      }
      if (scope === "my") {
        whereClause.createdById = freshUser.id;
      }
    } else if (freshUser.role === "MANAGER") {
      if (scope === "my") {
        whereClause.createdById = freshUser.id;
      } else {
        // Manager views all reports in their organization
        if (freshUser.organizationId) {
          whereClause.organizationId = freshUser.organizationId;
        } else {
          whereClause.createdById = freshUser.id;
        }
      }
    } else {
      // USER / OPERATOR
      if (freshUser.canViewOrgReports && scope === "organization" && freshUser.organizationId) {
        whereClause.organizationId = freshUser.organizationId;
      } else {
        whereClause.createdById = freshUser.id;
      }
    }

    if (searchVin) {
      whereClause.vin = { contains: searchVin };
    }

    const reports = await prisma.report.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        publicReference: true,
        vin: true,
        firstRegistrationDate: true,
        mileage: true,
        valuationDate: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        createdById: true,
        organizationId: true,
        organization: { select: { id: true, name: true } },
        pdfGeneratedAt: true,
        pdfGeneratorVersion: true,
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
