import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateNip } from "@/lib/validators/nip";

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

    const organizations = await prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            users: true,
            reports: true,
          },
        },
        users: {
          where: { role: "MANAGER" },
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
          },
        },
      },
    });

    return NextResponse.json({ success: true, organizations });
  } catch (err: any) {
    console.error("[ADMIN_ORGS_GET_ERROR]", err);
    return NextResponse.json({ error: err.message || "Błąd pobierania organizacji." }, { status: 500 });
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
    const { name, nip, street, postalCode, city, country, billingEmail } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Nazwa firmy jest wymagana." }, { status: 400 });
    }

    const nipValidation = validateNip(nip);
    if (!nipValidation.isValid) {
      return NextResponse.json({ error: nipValidation.error || "Nieprawidłowy numer NIP." }, { status: 400 });
    }

    if (!street || !street.trim()) {
      return NextResponse.json({ error: "Ulica i numer są wymagane." }, { status: 400 });
    }

    if (!postalCode || !/^\d{2}-\d{3}$/.test(postalCode.trim())) {
      return NextResponse.json({ error: "Kod pocztowy musi mieć format XX-XXX." }, { status: 400 });
    }

    if (!city || !city.trim()) {
      return NextResponse.json({ error: "Miejscowość jest wymagana." }, { status: 400 });
    }

    if (!billingEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail.trim())) {
      return NextResponse.json({ error: "Podaj poprawny adres e-mail do faktur." }, { status: 400 });
    }

    // Check NIP uniqueness
    const existingOrg = await prisma.organization.findUnique({
      where: { nip: nipValidation.normalizedNip },
    });
    if (existingOrg) {
      return NextResponse.json({ error: `Firma o NIP ${nipValidation.normalizedNip} już istnieje w systemie.` }, { status: 409 });
    }

    const org = await prisma.organization.create({
      data: {
        name: name.trim(),
        nip: nipValidation.normalizedNip,
        street: street.trim(),
        postalCode: postalCode.trim(),
        city: city.trim(),
        country: country?.trim() || "PL",
        billingEmail: billingEmail.trim().toLowerCase(),
        isActive: true,
      },
    });

    // Audit Event
    await prisma.auditEvent.create({
      data: {
        userId: freshUser.id,
        userEmail: freshUser.email,
        action: "CREATE_ORGANIZATION",
        resource: `Organization:${org.id}`,
        metadataJson: JSON.stringify({
          name: org.name,
          nip: org.nip,
          billingEmail: org.billingEmail,
        }),
      },
    });

    return NextResponse.json({ success: true, organization: org }, { status: 201 });
  } catch (err: any) {
    console.error("[ADMIN_ORGS_POST_ERROR]", err);
    return NextResponse.json({ error: err.message || "Błąd tworzenia organizacji." }, { status: 500 });
  }
}
