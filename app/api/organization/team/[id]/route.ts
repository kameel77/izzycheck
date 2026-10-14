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

    const { id: targetUserId } = await params;

    // Anti-escalation rule 1: Manager cannot edit their own permissions
    if (targetUserId === freshUser.id) {
      return NextResponse.json({ error: "Nie możesz modyfikować własnego konta z poziomu panelu zespołu." }, { status: 403 });
    }

    // Anti-escalation rule 2: Target user must exist and belong to the manager's organization
    const targetUser = await prisma.user.findFirst({
      where: {
        id: targetUserId,
        organizationId: organizationId,
      },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "Nie odnaleziono pracownika w Twojej organizacji." }, { status: 404 });
    }

    // Anti-escalation rule 3: Manager cannot modify another MANAGER or an ADMIN
    if (freshUser.role !== "ADMIN" && (targetUser.role === "ADMIN" || targetUser.role === "MANAGER")) {
      return NextResponse.json({ error: "Nie posiadasz uprawnień do edycji innych managerów ani administratorów." }, { status: 403 });
    }

    const body = await req.json();
    const {
      name,
      password,
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

    if (password !== undefined && password) {
      if (typeof password !== "string" || password.length < 8) {
        return NextResponse.json({ error: "Nowe hasło musi zawierać co najmniej 8 znaków." }, { status: 400 });
      }
      dataToUpdate.passwordHash = await hashPassword(password);
    }

    if (canGenerateValuation !== undefined) dataToUpdate.canGenerateValuation = Boolean(canGenerateValuation);
    if (canGenerateClaimCheck !== undefined) dataToUpdate.canGenerateClaimCheck = Boolean(canGenerateClaimCheck);
    if (canGenerateClaimDetails !== undefined) dataToUpdate.canGenerateClaimDetails = Boolean(canGenerateClaimDetails);
    if (canViewOrgReports !== undefined) dataToUpdate.canViewOrgReports = Boolean(canViewOrgReports);
    if (isActive !== undefined && typeof isActive === "boolean") dataToUpdate.isActive = isActive;

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
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
        action: "UPDATE_USER_PERMISSIONS",
        resource: `User:${updatedUser.id}`,
        metadataJson: JSON.stringify({
          targetUserId: updatedUser.id,
          targetUserEmail: updatedUser.email,
          updatedFields: Object.keys(dataToUpdate),
          changes: dataToUpdate,
        }),
      },
    });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (err: any) {
    console.error("[ORGANIZATION_TEAM_PATCH_ERROR]", err);
    return NextResponse.json({ error: err.message || "Błąd aktualizacji uprawnień pracownika." }, { status: 500 });
  }
}
