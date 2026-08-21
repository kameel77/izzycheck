import assert from "node:assert";
import { test, describe } from "node:test";
import {
  sortEquipmentAlphabetically,
  chunkEquipmentForRows,
  ReportEquipmentItem,
} from "../equipment.ts";

describe("Equipment Sorting & Row Grid Utility", () => {
  test("Sorts equipment alphabetically with strict Polish collation (variant sensitivity)", () => {
    const unsorted: ReportEquipmentItem[] = [
      { code: "E01", name: "Żaluzje przeciwsłoneczne" },
      { code: "E02", name: "Ładowarka bezprzewodowa" },
      { code: "E03", name: "Ladowarka standardowa" },
      { code: "E04", name: "Bąbelkowe fotele" },
      { code: "E05", name: "Brak oznaczenia modelu" },
      { code: "E06", name: "Adapter USB-C" },
      { code: "E07", name: "Ćwiartkowe oświetlenie" },
      { code: "E08", name: "Czujnik deszczu" },
      { code: "E09", name: "Światła matrycowe LED" },
      { code: "E10", name: "System nawigacji" },
      { code: "E11", name: "Źródło zasilania 230V" },
    ];

    const sorted = sortEquipmentAlphabetically(unsorted);
    const sortedNames = sorted.map((s) => s.name);

    // Expected order:
    // 1. Adapter USB-C
    // 2. Brak oznaczenia modelu
    // 3. Bąbelkowe fotele (Brak < Bąbel)
    // 4. Czujnik deszczu
    // 5. Ćwiartkowe oświetlenie (C < Ć)
    // 6. Ladowarka standardowa
    // 7. Ładowarka bezprzewodowa (L < Ł)
    // 8. System nawigacji
    // 9. Światła matrycowe LED (S < Ś)
    // 10. Źródło zasilania 230V (Z < Ź)
    // 11. Żaluzje przeciwsłoneczne (Ź < Ż)

    assert.strictEqual(sortedNames[0], "Adapter USB-C");
    assert.strictEqual(sortedNames[1], "Bąbelkowe fotele");
    assert.strictEqual(sortedNames[2], "Brak oznaczenia modelu");
    assert.strictEqual(sortedNames[3], "Czujnik deszczu");
    assert.strictEqual(sortedNames[4], "Ćwiartkowe oświetlenie");
    assert.strictEqual(sortedNames[5], "Ladowarka standardowa");
    assert.strictEqual(sortedNames[6], "Ładowarka bezprzewodowa");
    assert.strictEqual(sortedNames[7], "System nawigacji");
    assert.strictEqual(sortedNames[8], "Światła matrycowe LED");
    assert.strictEqual(sortedNames[9], "Źródło zasilania 230V");
    assert.strictEqual(sortedNames[10], "Żaluzje przeciwsłoneczne");
  });

  test("Chunks items into rows of 3 columns in row-major order", () => {
    const items: ReportEquipmentItem[] = [
      { code: "1", name: "A" },
      { code: "2", name: "B" },
      { code: "3", name: "C" },
      { code: "4", name: "D" },
      { code: "5", name: "E" },
      { code: "6", name: "F" },
      { code: "7", name: "G" },
    ];

    const rows = chunkEquipmentForRows(items, 3);

    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(
      rows[0].map((i) => i.name),
      ["A", "B", "C"]
    );
    assert.deepStrictEqual(
      rows[1].map((i) => i.name),
      ["D", "E", "F"]
    );
    assert.deepStrictEqual(
      rows[2].map((i) => i.name),
      ["G"]
    );
  });

  test("Handles empty or null arrays safely", () => {
    assert.deepStrictEqual(sortEquipmentAlphabetically([]), []);
    assert.deepStrictEqual(chunkEquipmentForRows([]), []);
  });
});
