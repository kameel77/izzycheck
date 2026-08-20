import assert from "node:assert";
import { test, describe } from "node:test";
import { generateMonotonicReference } from "../reference.ts";
import { Prisma } from "@prisma/client";

describe("Monotonic Report Reference Generator", () => {
  test("Generates reference with format IC-YYYY-MM-XXXX and zero-padded counter", async () => {
    let current = 0;
    const mockPrisma = {
      reportReferenceSequence: {
        upsert: async ({ create }: any) => {
          current += 1;
          return { period: create.period, currentVal: current };
        },
      },
    };

    const ref = await generateMonotonicReference(new Date("2026-08-20T12:00:00Z"), mockPrisma);
    assert.strictEqual(ref, "IC-2026-08-0001");
    assert.match(ref, /^IC-\d{4}-\d{2}-\d{4}$/);
  });

  test("Handles P2002 race condition on initial month creation transition via atomic retry", async () => {
    let upsertAttempts = 0;
    let updateAttempts = 0;

    const mockPrisma = {
      reportReferenceSequence: {
        upsert: async () => {
          upsertAttempts += 1;
          // Simulate race condition where concurrent request already inserted the month row
          const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on period", {
            code: "P2002",
            clientVersion: "6.2.1",
          });
          throw err;
        },
        update: async ({ data }: any) => {
          updateAttempts += 1;
          return { period: "2026-09", currentVal: 2 };
        },
      },
    };

    const ref = await generateMonotonicReference(new Date("2026-09-01T00:00:00Z"), mockPrisma);

    assert.strictEqual(upsertAttempts, 1);
    assert.strictEqual(updateAttempts, 1);
    assert.strictEqual(ref, "IC-2026-09-0002");
  });

  test("Generates sequential reference sequence within single execution context", async () => {
    let current = 0;
    const mockPrisma = {
      reportReferenceSequence: {
        upsert: async ({ create }: any) => {
          current += 1;
          return { period: create.period, currentVal: current };
        },
      },
    };

    const ref1 = await generateMonotonicReference(new Date("2026-08-20T12:00:00Z"), mockPrisma);
    const ref2 = await generateMonotonicReference(new Date("2026-08-20T12:00:00Z"), mockPrisma);
    const ref3 = await generateMonotonicReference(new Date("2026-08-20T12:00:00Z"), mockPrisma);

    assert.strictEqual(ref1, "IC-2026-08-0001");
    assert.strictEqual(ref2, "IC-2026-08-0002");
    assert.strictEqual(ref3, "IC-2026-08-0003");
  });
});
