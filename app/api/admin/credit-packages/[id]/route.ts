import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-admin";
import { parsePackageInput } from "@/lib/billing/package-validation";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const admin = auth.admin;

    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const parsed = parsePackageInput(body, { partial: true });
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const existing = await prisma.creditPackage.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: "Nie odnaleziono pakietu." }, { status: 404 });
    }

    const updated = await prisma.creditPackage.update({ where: { id }, data: parsed.value });

    // The change is already saved; a failed audit write must not turn it into a 500.
    try {
      await prisma.auditEvent.create({
        data: {
          userId: admin.id,
          userEmail: admin.email,
          action: "UPDATE_CREDIT_PACKAGE",
          resource: `CreditPackage:${id}`,
          metadataJson: JSON.stringify(parsed.value),
        },
      });
    } catch (auditErr) {
      console.error("[ADMIN_CREDIT_PACKAGE_AUDIT_ERROR]", auditErr);
    }

    return NextResponse.json({ success: true, package: updated });
  } catch (err) {
    console.error("[ADMIN_CREDIT_PACKAGES_PATCH_ERROR]", err);
    return NextResponse.json({ error: "Nie udało się zapisać pakietu." }, { status: 500 });
  }
}
