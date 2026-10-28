import { NextResponse } from "next/server";
import { getCurrentUser, getFreshUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildLedgerWhere, LEDGER_ENTRY_SELECT } from "@/lib/billing/ledger";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  try {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Brak autoryzacji. Zaloguj się ponownie." }, { status: 401 });
    }

    const freshUser = await getFreshUser(sessionUser.userId);
    if (!freshUser || !freshUser.isActive) {
      return NextResponse.json({ error: "Konto użytkownika jest nieaktywne lub nie istnieje." }, { status: 401 });
    }

    const organizationId = freshUser.organizationId;
    if (!organizationId) {
      return NextResponse.json({ entries: [], nextCursor: null });
    }

    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") === "org" ? "org" : "mine";
    const cursor = searchParams.get("cursor");

    const rows = await prisma.creditLedgerEntry.findMany({
      where: buildLedgerWhere({ userId: freshUser.id, role: freshUser.role, organizationId }, scope),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: LEDGER_ENTRY_SELECT,
    });

    const hasMore = rows.length > PAGE_SIZE;
    const entries = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    return NextResponse.json({
      entries,
      nextCursor: hasMore ? entries[entries.length - 1].id : null,
    });
  } catch (error) {
    console.error("[CREDITS_LEDGER_GET_ERROR]", error);
    return NextResponse.json({ error: "Nie udało się pobrać historii zużycia kredytów." }, { status: 500 });
  }
}
