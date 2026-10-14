import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || freshUser.role !== "ADMIN" || !freshUser.isActive) {
      return NextResponse.json({ error: "Dostęp zabroniony. Wymagane uprawnienia administratora." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("organizationId");
    const role = searchParams.get("role");
    const isActiveParam = searchParams.get("isActive");

    const where: any = {};
    if (orgId) where.organizationId = orgId;
    if (role) where.role = role;
    if (isActiveParam !== null && isActiveParam !== undefined) {
      where.isActive = isActiveParam === "true";
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
            nip: true,
            isActive: true,
          },
        },
        canGenerateValuation: true,
        canGenerateClaimCheck: true,
        canGenerateClaimDetails: true,
        canViewOrgReports: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { reports: true },
        },
      },
    });

    return NextResponse.json({ success: true, users });
  } catch (err: any) {
    console.error("[ADMIN_USERS_GET_ERROR]", err);
    return NextResponse.json({ error: err.message || "Błąd pobierania użytkowników." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || freshUser.role !== "ADMIN" || !freshUser.isActive) {
      return NextResponse.json({ error: "Dostęp zabroniony. Wymagane uprawnienia administratora." }, { status: 403 });
    }

    const body = await req.json();
    const {
      email,
      name,
      password,
      role = "USER",
      organizationId,
      canGenerateValuation = false,
      canGenerateClaimCheck = false,
      canGenerateClaimDetails = false,
      canViewOrgReports = false,
    } = body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return NextResponse.json({ error: "Podaj prawidłowy adres e-mail." }, { status: 400 });
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Imię i nazwisko są wymagane." }, { status: 400 });
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Hasło startowe musi zawierać co najmniej 8 znaków." }, { status: 400 });
    }

    const validRoles = ["ADMIN", "MANAGER", "USER"];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: "Nieprawidłowa rola użytkownika." }, { status: 400 });
    }

    // Manager and User must belong to an organization
    if ((role === "MANAGER" || role === "USER") && !organizationId) {
      return NextResponse.json({ error: "Dla roli Manager oraz User wymagane jest przypisanie do organizacji." }, { status: 400 });
    }

    if (organizationId) {
      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (!org) {
        return NextResponse.json({ error: "Wskazana organizacja nie istnieje w systemie." }, { status: 404 });
      }
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json({ error: `Użytkownik o adresie ${normalizedEmail} już istnieje.` }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name.trim(),
        passwordHash,
        role,
        organizationId: organizationId || null,
        canGenerateValuation: Boolean(canGenerateValuation),
        canGenerateClaimCheck: Boolean(canGenerateClaimCheck),
        canGenerateClaimDetails: Boolean(canGenerateClaimDetails),
        canViewOrgReports: Boolean(canViewOrgReports),
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        canGenerateValuation: true,
        canGenerateClaimCheck: true,
        canGenerateClaimDetails: true,
        canViewOrgReports: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Record Audit Event
    await prisma.auditEvent.create({
      data: {
        userId: freshUser.id,
        userEmail: freshUser.email,
        action: "CREATE_USER",
        resource: `User:${newUser.id}`,
        metadataJson: JSON.stringify({
          createdUserId: newUser.id,
          createdUserEmail: newUser.email,
          role: newUser.role,
          organizationId: newUser.organizationId,
        }),
      },
    });

    return NextResponse.json({ success: true, user: newUser }, { status: 201 });
  } catch (err: any) {
    console.error("[ADMIN_USERS_POST_ERROR]", err);
    return NextResponse.json({ error: err.message || "Błąd tworzenia użytkownika." }, { status: 500 });
  }
}
