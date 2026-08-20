import { Prisma } from "@prisma/client";
import { prisma } from "../db.ts";

/**
 * Generates a strictly monotonic, human-readable external reference for IzzyCheck reports.
 * Format: IC-YYYY-MM-XXXX (e.g. IC-2026-08-0001, IC-2026-08-0002)
 * Handles P2002 race conditions on month transition with atomic update retry.
 */
export async function generateMonotonicReference(
  date: Date = new Date(),
  customPrisma: any = prisma
): Promise<string> {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const period = `${yyyy}-${mm}`;

  let currentVal: number;

  try {
    const seq = await customPrisma.reportReferenceSequence.upsert({
      where: { period },
      create: { period, currentVal: 1 },
      update: { currentVal: { increment: 1 } },
    });
    currentVal = seq.currentVal;
  } catch (err: any) {
    // Handle edge-case race condition where two requests hit a brand new month simultaneously
    // and both try to execute 'create', triggering P2002 (Unique constraint failed on period).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const retrySeq = await customPrisma.reportReferenceSequence.update({
        where: { period },
        data: { currentVal: { increment: 1 } },
      });
      currentVal = retrySeq.currentVal;
    } else {
      throw err;
    }
  }

  const paddedNum = String(currentVal).padStart(4, "0");
  return `IC-${period}-${paddedNum}`;
}
