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
    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne." }, { status: 401 });
    }

    const isAuthorized = freshUser.role === "MANAGER" || freshUser.role === "ADMIN";
    if (!isAuthorized) {
      return NextResponse.json({ error: "Dostęp zabroniony. Wymagane uprawnienia managera." }, { status: 403 });
    }

    const organizationId = freshUser.organizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "Brak przypisanej organizacji do Twojego konta." }, { status: 400 });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        nip: true,
        street: true,
        postalCode: true,
        city: true,
        country: true,
        billingEmail: true,
        isActive: true,
        users: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
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
        },
      },
    });

    if (!organization) {
      return NextResponse.json({ error: "Nie odnaleziono organizacji." }, { status: 404 });
    }

    if (freshUser.role !== "ADMIN" && !organization.isActive) {
      return NextResponse.json({ error: "Twoja organizacja została zablokowana." }, { status: 403 });
    }

    return NextResponse.json({ success: true, organization });
  } catch (err: any) {
    console.error("[ORGANIZATION_TEAM_GET_ERROR]", err);
    return NextResponse.json({ error: err.message || "Błąd pobierania zespołu." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne." }, { status: 401 });
    }

    if (freshUser.role !== "ADMIN" && freshUser.organization && !freshUser.organization.isActive) {
      return NextResponse.json({ error: "Twoja organizacja została zablokowana." }, { status: 403 });
    }

    const isAuthorized = freshUser.role === "MANAGER" || freshUser.role === "ADMIN";
    if (!isAuthorized) {
      return NextResponse.json({ error: "Dostęp zabroniony. Wymagane uprawnienia managera." }, { status: 403 });
    }

    const organizationId = freshUser.organizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "Brak przypisanej organizacji do Twojego konta." }, { status: 400 });
    }

    const body = await req.json();
    const {
      email,
      name,
      password,
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

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json({ error: `Użytkownik o adresie ${normalizedEmail} już istnieje w systemie.` }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    // Strictly enforce role: USER for members created by Manager
    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name.trim(),
        passwordHash,
        role: "USER",
        organizationId,
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
          createdByManager: freshUser.id,
        }),
      },
    });

    return NextResponse.json({ success: true, user: newUser }, { status: 201 });
  } catch (err: any) {
    console.error("[ORGANIZATION_TEAM_POST_ERROR]", err);
    return NextResponse.json({ error: err.message || "Błąd tworzenia pracownika." }, { status: 500 });
  }
}
