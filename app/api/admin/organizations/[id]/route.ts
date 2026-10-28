import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateNip } from "@/lib/validators/nip";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || freshUser.role !== "ADMIN" || !freshUser.isActive) {
      return NextResponse.json({ error: "Dostęp zabroniony. Wymagane uprawnienia administratora." }, { status: 403 });
    }

    const { id } = await params;
    const organization = await prisma.organization.findUnique({
      where: { id },
      include: {
        users: {
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
          },
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: { reports: true },
        },
      },
    });

    if (!organization) {
      return NextResponse.json({ error: "Nie odnaleziono organizacji." }, { status: 404 });
    }

    return NextResponse.json({ success: true, organization });
  } catch (err: any) {
    console.error("[ADMIN_ORG_DETAIL_GET_ERROR]", err);
    return NextResponse.json({ error: err.message || "Błąd pobierania danych organizacji." }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || freshUser.role !== "ADMIN" || !freshUser.isActive) {
      return NextResponse.json({ error: "Dostęp zabroniony. Wymagane uprawnienia administratora." }, { status: 403 });
    }

    const { id } = await params;
    const existingOrg = await prisma.organization.findUnique({ where: { id } });
    if (!existingOrg) {
      return NextResponse.json({ error: "Nie odnaleziono organizacji." }, { status: 404 });
    }

    const body = await req.json();
    const { name, nip, street, postalCode, city, country, billingEmail, isActive, billingMode } = body;

    const dataToUpdate: any = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "Nazwa firmy nie może być pusta." }, { status: 400 });
      }
      dataToUpdate.name = name.trim();
    }

    if (nip !== undefined) {
      const nipValidation = validateNip(nip);
      if (!nipValidation.isValid) {
        return NextResponse.json({ error: nipValidation.error || "Nieprawidłowy NIP." }, { status: 400 });
      }
      if (nipValidation.normalizedNip !== existingOrg.nip) {
        const conflict = await prisma.organization.findUnique({
          where: { nip: nipValidation.normalizedNip },
        });
        if (conflict) {
          return NextResponse.json({ error: `Inna firma posiada już NIP ${nipValidation.normalizedNip}.` }, { status: 409 });
        }
        dataToUpdate.nip = nipValidation.normalizedNip;
      }
    }

    if (street !== undefined) dataToUpdate.street = street.trim();
    if (postalCode !== undefined) {
      if (!/^\d{2}-\d{3}$/.test(postalCode.trim())) {
        return NextResponse.json({ error: "Kod pocztowy musi mieć format XX-XXX." }, { status: 400 });
      }
      dataToUpdate.postalCode = postalCode.trim();
    }
    if (city !== undefined) dataToUpdate.city = city.trim();
    if (country !== undefined) dataToUpdate.country = country.trim();
    if (billingEmail !== undefined) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail.trim())) {
        return NextResponse.json({ error: "Nieprawidłowy adres e-mail do faktur." }, { status: 400 });
      }
      dataToUpdate.billingEmail = billingEmail.trim().toLowerCase();
    }
    if (isActive !== undefined && typeof isActive === "boolean") {
      dataToUpdate.isActive = isActive;
    }

    let billingModeChange: { from: string; to: string } | null = null;
    if (billingMode !== undefined) {
      if (billingMode !== "PREPAID" && billingMode !== "UNLIMITED") {
        return NextResponse.json({ error: "Nieprawidłowy tryb rozliczeń." }, { status: 400 });
      }
      if (billingMode !== existingOrg.billingMode) {
        dataToUpdate.billingMode = billingMode;
        billingModeChange = { from: existingOrg.billingMode, to: billingMode };
      }
    }

    const updated = await prisma.organization.update({
      where: { id },
      data: dataToUpdate,
    });

    // Audit Event
    await prisma.auditEvent.create({
      data: {
        userId: freshUser.id,
        userEmail: freshUser.email,
        action: "UPDATE_ORGANIZATION",
        resource: `Organization:${updated.id}`,
        metadataJson: JSON.stringify({
          updatedFields: Object.keys(dataToUpdate),
          changes: dataToUpdate,
        }),
      },
    });

    if (billingModeChange) {
      await prisma.auditEvent.create({
        data: {
          userId: freshUser.id,
          userEmail: freshUser.email,
          action: "UPDATE_BILLING_MODE",
          resource: `Organization:${updated.id}`,
          metadataJson: JSON.stringify({ organizationId: updated.id, ...billingModeChange }),
        },
      });
    }

    return NextResponse.json({ success: true, organization: updated });
  } catch (err: any) {
    console.error("[ADMIN_ORG_PATCH_ERROR]", err);
    return NextResponse.json({ error: err.message || "Błąd aktualizacji organizacji." }, { status: 500 });
  }
}
