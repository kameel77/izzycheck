import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return NextResponse.json({ error: "Nie odnaleziono użytkownika." }, { status: 404 });
    }

    const body = await req.json();
    const {
      name,
      email,
      password,
      role,
      organizationId,
      canGenerateValuation,
      canGenerateClaimCheck,
      canGenerateClaimDetails,
      canViewOrgReports,
      isActive,
    } = body;

    const dataToUpdate: any = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "Imię i nazwisko nie mogą być puste." }, { status: 400 });
      }
      dataToUpdate.name = name.trim();
    }

    if (email !== undefined) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return NextResponse.json({ error: "Nieprawidłowy adres e-mail." }, { status: 400 });
      }
      if (normalizedEmail !== targetUser.email) {
        const conflict = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (conflict) {
          return NextResponse.json({ error: "Adres e-mail jest już zajęty przez innego użytkownika." }, { status: 409 });
        }
        dataToUpdate.email = normalizedEmail;
      }
    }

    if (password !== undefined && password) {
      if (typeof password !== "string" || password.length < 8) {
        return NextResponse.json({ error: "Nowe hasło musi zawierać co najmniej 8 znaków." }, { status: 400 });
      }
      dataToUpdate.passwordHash = await hashPassword(password);
    }

    if (role !== undefined) {
      const validRoles = ["ADMIN", "MANAGER", "USER", "OPERATOR"];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: "Nieprawidłowa rola." }, { status: 400 });
      }
      dataToUpdate.role = role;
    }

    if (organizationId !== undefined) {
      if (organizationId) {
        const org = await prisma.organization.findUnique({ where: { id: organizationId } });
        if (!org) {
          return NextResponse.json({ error: "Organizacja nie istnieje." }, { status: 404 });
        }
        dataToUpdate.organizationId = organizationId;
      } else {
        dataToUpdate.organizationId = null;
      }
    }

    if (canGenerateValuation !== undefined) dataToUpdate.canGenerateValuation = Boolean(canGenerateValuation);
    if (canGenerateClaimCheck !== undefined) dataToUpdate.canGenerateClaimCheck = Boolean(canGenerateClaimCheck);
    if (canGenerateClaimDetails !== undefined) dataToUpdate.canGenerateClaimDetails = Boolean(canGenerateClaimDetails);
    if (canViewOrgReports !== undefined) dataToUpdate.canViewOrgReports = Boolean(canViewOrgReports);
    if (isActive !== undefined && typeof isActive === "boolean") dataToUpdate.isActive = isActive;

    const updatedUser = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
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
        updatedAt: true,
      },
    });

    // Audit Event
    await prisma.auditEvent.create({
      data: {
        userId: freshUser.id,
        userEmail: freshUser.email,
        action: "UPDATE_USER",
        resource: `User:${updatedUser.id}`,
        metadataJson: JSON.stringify({
          updatedFields: Object.keys(dataToUpdate),
        }),
      },
    });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (err: any) {
    console.error("[ADMIN_USERS_PATCH_ERROR]", err);
    return NextResponse.json({ error: err.message || "Błąd aktualizacji użytkownika." }, { status: 500 });
  }
}
