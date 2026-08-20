import assert from "node:assert";
import { test, describe } from "node:test";
import { generateMonotonicReference } from "../reference.ts";

describe("Monotonic Report Reference Generator", () => {
  test("Generates reference with format IC-YYYY-MM-XXXX", async () => {
    let current = 0;
    const mockPrisma = {
      reportReferenceSequence: {
        upsert: async ({ create, update }: any) => {
          current += 1;
          return { period: create.period, currentVal: current };
        },
      },
    };

    const ref = await generateMonotonicReference(new Date("2026-08-20T12:00:00Z"), mockPrisma);
    assert.strictEqual(ref, "IC-2026-08-0001");
    assert.match(ref, /^IC-\d{4}-\d{2}-\d{4}$/);
  });

  test("Maintains strict sequential monotonicity under concurrent calls", async () => {
    let current = 0;
    const mockPrisma = {
      reportReferenceSequence: {
        upsert: async ({ create }: any) => {
          current += 1;
          return { period: create.period, currentVal: current };
        },
      },
    };

    const promises = Array.from({ length: 15 }, () =>
      generateMonotonicReference(new Date("2026-08-20T12:00:00Z"), mockPrisma)
    );

    const results = await Promise.all(promises);

    assert.strictEqual(results.length, 15);
    const uniqueRefs = new Set(results);
    assert.strictEqual(uniqueRefs.size, 15, "All generated references must be unique");

    assert.strictEqual(results[0], "IC-2026-08-0001");
    assert.strictEqual(results[14], "IC-2026-08-0015");
  });
});
