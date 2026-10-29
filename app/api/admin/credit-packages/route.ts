import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-admin";
import { parsePackageInput } from "@/lib/billing/package-validation";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const packages = await prisma.creditPackage.findMany({
      orderBy: [{ creditType: "asc" }, { credits: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ packages });
  } catch (err) {
    console.error("[ADMIN_CREDIT_PACKAGES_GET_ERROR]", err);
    return NextResponse.json({ error: "Nie udało się pobrać cennika pakietów." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const admin = auth.admin;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const parsed = parsePackageInput(body, { partial: false });
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const created = await prisma.creditPackage.create({ data: parsed.value });

    // The package is already created; a failed audit write must not turn it into a 500 (a retry would duplicate it).
    try {
      await prisma.auditEvent.create({
        data: {
          userId: admin.id,
          userEmail: admin.email,
          action: "CREATE_CREDIT_PACKAGE",
          resource: `CreditPackage:${created.id}`,
          metadataJson: JSON.stringify(parsed.value),
        },
      });
    } catch (auditErr) {
      console.error("[ADMIN_CREDIT_PACKAGE_AUDIT_ERROR]", auditErr);
    }

    return NextResponse.json({ success: true, package: created }, { status: 201 });
  } catch (err) {
    console.error("[ADMIN_CREDIT_PACKAGES_POST_ERROR]", err);
    return NextResponse.json({ error: "Nie udało się zapisać pakietu." }, { status: 500 });
  }
}
