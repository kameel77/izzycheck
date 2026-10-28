import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-admin";
import { generateApiToken, hashApiToken, tokenPrefixOf } from "@/lib/api-clients/token";

const MAX_NAME_LENGTH = 100;

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    // tokenHash celowo poza select: do panelu trafia tylko prefiks tokenu.
    const clients = await prisma.apiClient.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        organizationId: true,
        organization: { select: { name: true, nip: true } },
        tokenPrefix: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ clients });
  } catch (err) {
    console.error("[ADMIN_API_CLIENTS_GET_ERROR]", err);
    return NextResponse.json({ error: "Nie udało się pobrać klientów API." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const admin = auth.admin;

    let body: any;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: `Nazwa klienta jest wymagana (maks. ${MAX_NAME_LENGTH} znaków).` }, { status: 400 });
    }
    if (typeof body?.organizationId !== "string" || !body.organizationId) {
      return NextResponse.json({ error: "Wybierz organizację." }, { status: 400 });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: body.organizationId },
      select: { id: true, isActive: true },
    });
    if (!organization || !organization.isActive) {
      return NextResponse.json({ error: "Nie odnaleziono aktywnej organizacji." }, { status: 400 });
    }

    const token = generateApiToken();
    const client = await prisma.apiClient.create({
      data: {
        name,
        organizationId: organization.id,
        tokenHash: hashApiToken(token),
        tokenPrefix: tokenPrefixOf(token),
        createdById: admin.id,
      },
      select: { id: true, name: true, organizationId: true, tokenPrefix: true, isActive: true, createdAt: true },
    });

    // Klient jest już utworzony, a token znany tylko teraz: nieudany zapis audytu nie może zamienić tego w 500.
    try {
      await prisma.auditEvent.create({
        data: {
          userId: admin.id,
          userEmail: admin.email,
          action: "CREATE_API_CLIENT",
          resource: `ApiClient:${client.id}`,
          metadataJson: JSON.stringify({
            name: client.name,
            organizationId: client.organizationId,
            tokenPrefix: client.tokenPrefix,
          }),
        },
      });
    } catch (auditErr) {
      console.error("[ADMIN_API_CLIENT_AUDIT_ERROR]", auditErr);
    }

    // Token jest zwracany wyłącznie tutaj, jednorazowo.
    return NextResponse.json({ success: true, client, token }, { status: 201 });
  } catch (err) {
    console.error("[ADMIN_API_CLIENTS_POST_ERROR]", err);
    return NextResponse.json({ error: "Nie udało się utworzyć klienta API." }, { status: 500 });
  }
}
