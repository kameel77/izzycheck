import { prisma } from "../db.ts";

/**
 * Generates a strictly monotonic, human-readable external reference for IzzyCheck reports.
 * Format: IC-YYYY-MM-XXXX (e.g. IC-2026-08-0001, IC-2026-08-0002)
 * Uses atomic increment in the database to prevent collisions under concurrent load.
 */
export async function generateMonotonicReference(
  date: Date = new Date(),
  customPrisma: any = prisma
): Promise<string> {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const period = `${yyyy}-${mm}`;

  const seq = await customPrisma.reportReferenceSequence.upsert({
    where: { period },
    create: { period, currentVal: 1 },
    update: { currentVal: { increment: 1 } },
  });

  const paddedNum = String(seq.currentVal).padStart(4, "0");
  return `IC-${period}-${paddedNum}`;
}
