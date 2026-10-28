import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { adjustCredits, getBalances, InsufficientBalanceError } from "@/lib/billing/credits";
import { LEDGER_ENTRY_SELECT } from "@/lib/billing/ledger";
import { parseAdjustment } from "@/lib/billing/admin-validation";

const RECENT_ENTRIES = 20;

async function requireAdmin() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    return { error: NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 }) };
  }

  const freshUser = await getFreshUser(sessionUser.userId);
  if (!freshUser || freshUser.role !== "ADMIN" || !freshUser.isActive) {
    return {
      error: NextResponse.json({ error: "Dostęp zabroniony. Wymagane uprawnienia administratora." }, { status: 403 }),
    };
  }
  return { admin: freshUser };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { id } = await params;
    const organization = await prisma.organization.findUnique({
      where: { id },
      select: { id: true, billingMode: true },
    });
    if (!organization) {
      return NextResponse.json({ error: "Nie odnaleziono organizacji." }, { status: 404 });
    }

    const [balances, entries] = await Promise.all([
      getBalances(prisma, id),
      prisma.creditLedgerEntry.findMany({
        where: { organizationId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: RECENT_ENTRIES,
        select: LEDGER_ENTRY_SELECT,
      }),
    ]);

    return NextResponse.json({ billingMode: organization.billingMode, balances, entries });
  } catch (err: any) {
    console.error("[ADMIN_ORG_CREDITS_GET_ERROR]", err);
    return NextResponse.json({ error: "Nie udało się pobrać danych kredytów organizacji." }, { status: 500 });
  }
}

export async function POST(
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
    const parsed = parseAdjustment(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const organization = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!organization) {
      return NextResponse.json({ error: "Nie odnaleziono organizacji." }, { status: 404 });
    }

    const { creditType, amount, note } = parsed.value;
    let balance: number;
    try {
      ({ balance } = await adjustCredits(prisma, {
        organizationId: id,
        creditType,
        amount,
        note,
        adminUserId: admin.id,
      }));
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return NextResponse.json({ error: "Saldo nie może spaść poniżej zera." }, { status: 409 });
      }
      throw err;
    }

    // The adjustment is already committed (and recorded in the ledger); a failed audit write
    // must not turn it into a 500, otherwise a retry would apply the adjustment twice.
    try {
      await prisma.auditEvent.create({
        data: {
          userId: admin.id,
          userEmail: admin.email,
          action: "ADJUST_CREDITS",
          resource: `Organization:${id}`,
          metadataJson: JSON.stringify({ organizationId: id, creditType, amount, note }),
        },
      });
    } catch (auditErr) {
      console.error("[ADMIN_CREDITS_AUDIT_ERROR]", auditErr);
    }

    return NextResponse.json({ success: true, balance });
  } catch (err: any) {
    console.error("[ADMIN_ORG_CREDITS_POST_ERROR]", err);
    return NextResponse.json({ error: "Nie udało się zapisać korekty kredytów." }, { status: 500 });
  }
}
