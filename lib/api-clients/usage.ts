import type { ApiUsageOutcome, PrismaClient } from "@prisma/client";
import { formatWarsawDateTime, monthBoundsWarsaw } from "./month.ts";

export const API_USAGE_OUTCOMES: ApiUsageOutcome[] = [
  "IDENTIFIED",
  "NOT_FOUND",
  "UPSTREAM_ERROR",
  "REJECTED",
  "INTERNAL_ERROR",
];

export interface ApiUsageSummary {
  organizationId: string;
  month: string;
  billableCount: number;
  totalCount: number;
  byOutcome: Record<ApiUsageOutcome, number>;
}

function monthWhere(organizationId: string, month: string) {
  const { start, end } = monthBoundsWarsaw(month);
  return { organizationId, createdAt: { gte: start, lt: end } };
}

/** Podsumowanie użycia API organizacji w miesiącu (czas polski): płatne raporty, wszystkie wywołania, rozbicie po wyniku. */
export async function getApiUsageSummary(
  db: PrismaClient,
  organizationId: string,
  month: string,
): Promise<ApiUsageSummary> {
  const where = monthWhere(organizationId, month);
  const [billableCount, grouped] = await Promise.all([
    db.apiUsage.count({ where: { ...where, billable: true } }),
    db.apiUsage.groupBy({ by: ["outcome"], where, _count: { _all: true } }),
  ]);

  const byOutcome = Object.fromEntries(API_USAGE_OUTCOMES.map((o) => [o, 0])) as Record<ApiUsageOutcome, number>;
  let totalCount = 0;
  for (const row of grouped) {
    byOutcome[row.outcome] = row._count._all;
    totalCount += row._count._all;
  }

  return { organizationId, month, billableCount, totalCount, byOutcome };
}

export interface ApiUsageCsvRow {
  createdAt: Date;
  vin: string | null;
  outcome: string;
  httpStatus: number;
  billable: boolean;
  cacheHit: boolean;
}

/** Pole CSV: cudzysłów przy `;`, `"` i końcach linii oraz apostrof przed znakami uruchamiającymi formuły w arkuszu. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV rozliczeniowy: UTF-8 z BOM, separator `;`, data w czasie polskim. */
export function buildApiUsageCsv(rows: ApiUsageCsvRow[]): string {
  const lines = ["data;vin;wynik;status_http;platny;z_cache"];
  for (const row of rows) {
    lines.push(
      [
        formatWarsawDateTime(row.createdAt),
        csvField(row.vin ?? ""),
        row.outcome,
        String(row.httpStatus),
        row.billable ? "tak" : "nie",
        row.cacheHit ? "tak" : "nie",
      ].join(";"),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export async function exportApiUsageCsv(db: PrismaClient, organizationId: string, month: string): Promise<string> {
  const rows = await db.apiUsage.findMany({
    where: monthWhere(organizationId, month),
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, vin: true, outcome: true, httpStatus: true, billable: true, cacheHit: true },
  });
  return buildApiUsageCsv(rows);
}
