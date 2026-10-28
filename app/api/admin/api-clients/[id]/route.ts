import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-admin";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const admin = auth.admin;

    const { id } = await params;

    let body: any;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    if (typeof body?.isActive !== "boolean") {
      return NextResponse.json({ error: "Pole isActive musi być wartością logiczną." }, { status: 400 });
    }

    const existing = await prisma.apiClient.findUnique({ where: { id }, select: { id: true, isActive: true } });
    if (!existing) {
      return NextResponse.json({ error: "Nie odnaleziono klienta API." }, { status: 404 });
    }

    const updated = await prisma.apiClient.update({
      where: { id },
      data: { isActive: body.isActive },
      select: { id: true, name: true, isActive: true },
    });

    // Zmiana jest już zapisana; nieudany zapis audytu nie może zamienić jej w 500.
    if (existing.isActive !== updated.isActive) {
      try {
        await prisma.auditEvent.create({
          data: {
            userId: admin.id,
            userEmail: admin.email,
            action: updated.isActive ? "ENABLE_API_CLIENT" : "DISABLE_API_CLIENT",
            resource: `ApiClient:${id}`,
            metadataJson: JSON.stringify({ name: updated.name, isActive: updated.isActive }),
          },
        });
      } catch (auditErr) {
        console.error("[ADMIN_API_CLIENT_AUDIT_ERROR]", auditErr);
      }
    }

    return NextResponse.json({ success: true, client: updated });
  } catch (err) {
    console.error("[ADMIN_API_CLIENTS_PATCH_ERROR]", err);
    return NextResponse.json({ error: "Nie udało się zapisać klienta API." }, { status: 500 });
  }
}
