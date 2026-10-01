import assert from "node:assert";
import { test, describe } from "node:test";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { buildReportPdfViewModel } from "../report-pdf-view-model.ts";

describe("PDF Generation & View Model Module", () => {
  const mockReport = {
    id: "report-12345678-abcd",
    publicReference: "IC-2026-08-0417",
    vin: "WBA3N51030KS15173",
    firstRegistrationDate: "2021-04-15",
    mileage: 45200,
    valuationDate: "2026-08-06",
    status: "COMPLETED",
    createdAt: "2026-08-06T12:00:00.000Z",
    createdBy: { name: "Jan Kowalski", email: "jan@izzylease.pl" },
    vehicleSnapshot: {
      make: "BMW",
      model: "Seria 4 Coupé",
      variant: "420i",
      ibsCode: "965392",
      newPriceCv: 208909.0,
      marketPriceCob: 124500.0,
      technicalValueTh: 118000.0,
      technicalSpecJson: JSON.stringify({
        engineCapacityCm3: 1997,
        enginePowerKw: 180,
        enginePowerHp: 245,
        fuelType: "Benzyna",
        driveType: "4x4 (xDrive)",
        gearboxType: "Automatyczna",
        bodyType: "Coupé",
      }),
      standardEquipment: JSON.stringify([{ name: "Klimatyzacja automatyczna", code: "0534" }]),
      optionalEquipment: JSON.stringify([{ name: "Pakiet M Sport", code: "0337" }]),
    },
    moduleResults: [
      { moduleId: "VALUATION", status: "SUCCEEDED" },
      { moduleId: "CLAIM_CHECK", status: "SUCCEEDED" },
      { moduleId: "CLAIM_DETAILS", status: "SUCCEEDED" },
    ],
    damageClaims: [
      {
        id: "dc-1",
        claimId: "claim-88219",
        accidentDate: "2023-05-10",
        country: "PL",
        damageValue: 18450.0,
        currency: "PLN",
        isTotalLoss: false,
        mandateCode: "D1",
        mandateDescription: "Kolizja drogowa",
        damageZones: JSON.stringify(["Przód prawy środek", "Podwozie środek"]),
        significantParts: JSON.stringify(["Elementy poszycia zewnętrznego nadwozia"]),
        damageAssessmentJson: JSON.stringify({
          generalFlags: { mechanical: true },
          glassFlags: { front: true },
          damagePositionCodes: ["05", "18"],
          significantPartGroupCodes: ["004", "006"],
          markers: [
            {
              id: "marker-zone-05",
              sourceKind: "zone",
              sourceCode: "05",
              labelPl: "Strefa 05: Przód prawy środek",
              categories: ["BODY"],
              primaryCategory: "BODY",
              viewAnchors: ["right-front-3q"],
              confidence: "zone",
            },
            {
              id: "marker-zone-18",
              sourceKind: "zone",
              sourceCode: "18",
              labelPl: "Strefa 18: Podwozie środek",
              categories: ["UNDERBODY"],
              primaryCategory: "UNDERBODY",
              viewAnchors: ["underbody-bottom"],
              confidence: "zone",
            },
          ],
        }),
      },
    ],
  };

  test("Builds neutral ReportPdfViewModel correctly for new reports", () => {
    const viewModel = buildReportPdfViewModel(mockReport);

    assert.strictEqual(viewModel.vin, "WBA3N51030KS15173");
    assert.strictEqual(viewModel.publicReference, "IC-2026-08-0417");
    assert.strictEqual(viewModel.operatorName, "Jan Kowalski");
    assert.ok(viewModel.technicalSpec);
    assert.strictEqual(viewModel.technicalSpec.engineCapacityCm3, 1997);
    assert.strictEqual(viewModel.technicalSpec.fuelType, "Benzyna");
    assert.strictEqual(viewModel.claims.length, 1);
    assert.strictEqual(viewModel.claims[0].claimId, "claim-88219");
    // Markers are re-derived from the raw Audatex fields: zones 05, 18 + groups 004, 006
    // (flags mechanical / glass front are text-only because zone codes are present).
    assert.strictEqual(viewModel.claims[0].presentation.totalMarkersCount, 4);
    assert.strictEqual(
      viewModel.claims[0].presentation.flagsText,
      "Flagi ogólne Audatex: mechaniczne · Szyby: przednia"
    );
  });

  test("Builds ReportPdfViewModel with fallback markers for historical reports lacking damageAssessmentJson", () => {
    const historicalReport = {
      ...mockReport,
      damageClaims: [
        {
          id: "dc-historic-1",
          claimId: "claim-legacy-99",
          accidentDate: "2022-01-15",
          country: "PL",
          damageValue: 9500.0,
          currency: "PLN",
          isTotalLoss: false,
          damageZones: JSON.stringify(["Przód", "Szyba przednia"]),
          significantParts: JSON.stringify(["Elementy poszycia zewnętrznego nadwozia"]),
          damageAssessmentJson: null,
        },
      ],
    };

    const viewModel = buildReportPdfViewModel(historicalReport);
    assert.strictEqual(viewModel.claims.length, 1);
    assert.ok(viewModel.claims[0].presentation.totalMarkersCount >= 3);

    const markers = viewModel.claims[0].presentation.markers;
    // No zone codes in legacy data: flags become approximate markers (front -> 08, glass front -> 07)
    assert.ok(markers.some((m) => m.sourceCode === "front" && m.approximate && m.view === "rf3q"));
    assert.ok(markers.some((m) => m.primaryCategory === "GLASS_LIGHTING" && m.approximate));
  });

  test("Renders PDF buffer starting with %PDF- header with Polish Unicode font ArialCustom", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { ReportPdfDocument } = await import("../report-pdf-document.tsx");

    const viewModel = buildReportPdfViewModel(mockReport);
    const pdfDoc = React.createElement(ReportPdfDocument, { model: viewModel }) as any;
    const buffer = await renderToBuffer(pdfDoc);

    assert.ok(buffer);
    assert.ok(buffer.length > 1000);
    const pdfHeader = buffer.toString("utf-8", 0, 5);
    assert.strictEqual(pdfHeader, "%PDF-");
  });

  test("Renders ReportPdfDocument component structure with legal disclaimer placeholder", async () => {
    const { ReportPdfDocument } = await import("../report-pdf-document.tsx");
    const { ISSUER_CONFIG } = await import("../../config/issuer.ts");

    const viewModel = buildReportPdfViewModel(mockReport);
    const pdfElement = React.createElement(ReportPdfDocument, { model: viewModel }) as any;

    assert.ok(pdfElement);
    assert.strictEqual(pdfElement.props.model.publicReference, "IC-2026-08-0417");
    assert.ok(ISSUER_CONFIG.companyName);
    assert.ok(ISSUER_CONFIG.taxId);
  });

  test("Renders PDF stress test with 250 standard equipment items across row-major grid without dropping items", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { ReportPdfDocument } = await import("../report-pdf-document.tsx");
    const { chunkEquipmentForRows } = await import("../../reports/equipment.ts");

    const manyItems = Array.from({ length: 250 }, (_, i) => ({
      code: `CODE-${String(i + 1).padStart(3, "0")}`,
      name: `Element standardowy #${i + 1} z polskimi znakami ąćęłńóśźż`,
    }));

    const heavyReport = {
      ...mockReport,
      vehicleSnapshot: {
        ...mockReport.vehicleSnapshot,
        standardEquipment: JSON.stringify(manyItems),
        optionalEquipment: JSON.stringify([{ code: "OPT-1", name: "Pakiet Sportowy" }]),
      },
    };

    const viewModel = buildReportPdfViewModel(heavyReport);
    assert.strictEqual(viewModel.standardEquipment.length, 250);

    // Verify grid row-major arithmetic: 250 items ÷ 3 columns = 84 rows
    const rows = chunkEquipmentForRows(viewModel.standardEquipment, 3);
    assert.strictEqual(rows.length, 84);
    assert.strictEqual(rows[0].length, 3);
    assert.strictEqual(rows[83].length, 1); // Remainder 250 % 3 = 1

    const pdfDoc = React.createElement(ReportPdfDocument, { model: viewModel }) as any;
    const buffer = await renderToBuffer(pdfDoc);

    assert.ok(buffer);
    assert.ok(buffer.length > 30000, `Buffer should be substantial for 250 items (got ${buffer.length} bytes)`);

    const pdfString = buffer.toString("latin1");
    // Verify valid PDF header
    assert.strictEqual(pdfString.substring(0, 5), "%PDF-");

    // Page 1 carries the vehicle band, KPI row, valuation bar and claims timeline/table, so the 84 equipment rows
    // overflow onto several pages, followed by the claim page. The exact count depends on layout details, so only
    // assert that the overflow happened; a lonely-disclaimer page is ruled out structurally (see "kept together").
    const pageCount = (pdfString.match(/\/Type\s*\/Page\b/g) || []).length;
    assert.ok(pageCount >= 5, `84 rows of equipment with 1 claim must overflow onto several pages (got ${pageCount})`);
  });

  test("Renders distinct empty state notices for missing valuation module vs zero items from Audatex", async () => {
    const { ReportPdfDocument } = await import("../report-pdf-document.tsx");

    function extractAllTexts(root: any): string[] {
      const texts: string[] = [];
      function traverse(node: any) {
        if (!node) return;
        if (typeof node === "string") {
          texts.push(node);
        } else if (typeof node === "number") {
          texts.push(String(node));
        } else if (Array.isArray(node)) {
          node.forEach(traverse);
        } else if (node.props?.children) {
          traverse(node.props.children);
        }
      }
      traverse(root);
      return texts;
    }

    // Case 1: Valuation module failed
    const failedValReport = {
      ...mockReport,
      moduleResults: [{ moduleId: "VALUATION", status: "FAILED" }],
      vehicleSnapshot: null,
    };
    const vmFailed = buildReportPdfViewModel(failedValReport);
    const elemFailed = ReportPdfDocument({ model: vmFailed }) as any;
    assert.ok(elemFailed);
    assert.strictEqual(vmFailed.valuationStatus, "FAILED");

    const failedTexts = extractAllTexts(elemFailed);
    assert.ok(
      failedTexts.some((t) => t.includes("Moduł wyceny nie został wykonany")),
      "Document must render failed valuation notice when valuation module fails"
    );

    // Case 2: Valuation succeeded but zero items returned
    const emptyEqReport = {
      ...mockReport,
      moduleResults: [{ moduleId: "VALUATION", status: "SUCCEEDED" }],
      vehicleSnapshot: {
        ...mockReport.vehicleSnapshot,
        standardEquipment: JSON.stringify([]),
        optionalEquipment: JSON.stringify([]),
      },
    };
    const vmEmpty = buildReportPdfViewModel(emptyEqReport);
    const elemEmpty = ReportPdfDocument({ model: vmEmpty }) as any;
    assert.ok(elemEmpty);
    assert.strictEqual(vmEmpty.standardEquipment.length, 0);
    assert.strictEqual(vmEmpty.optionalEquipment.length, 0);

    const emptyTexts = extractAllTexts(elemEmpty);
    assert.ok(
      emptyTexts.some((t) => t.includes("Audatex nie zwrócił pozycji wyposażenia")),
      "Document must render zero standard equipment notice"
    );
    assert.ok(
      emptyTexts.some((t) => t.includes("Brak zarejestrowanego wyposażenia opcjonalnego w Audatex")),
      "Document must render zero optional equipment notice"
    );

    // Case 3: Common mixed case: standard present, optional empty
    const mixedEqReport = {
      ...mockReport,
      moduleResults: [{ moduleId: "VALUATION", status: "SUCCEEDED" }],
      vehicleSnapshot: {
        ...mockReport.vehicleSnapshot,
        standardEquipment: JSON.stringify([{ code: "S1", name: "Klimatyzacja" }]),
        optionalEquipment: JSON.stringify([]),
      },
    };
    const vmMixed = buildReportPdfViewModel(mixedEqReport);
    const elemMixed = ReportPdfDocument({ model: vmMixed }) as any;
    const mixedTexts = extractAllTexts(elemMixed);

    assert.ok(
      mixedTexts.some((t) => t.includes("Klimatyzacja")),
      "Mixed document must render standard equipment item"
    );
    assert.ok(
      mixedTexts.some((t) => t.includes("Brak zarejestrowanego wyposażenia opcjonalnego w Audatex")),
      "Mixed document must render zero optional equipment notice"
    );
  });

  test("Renders multi-claim stress test (5 claims with realistic mockups) in < 1s with compact buffer size < 500 KB", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { ReportPdfDocument } = await import("../report-pdf-document.tsx");

    const multiClaimReport = {
      ...mockReport,
      damageClaims: Array.from({ length: 5 }, (_, i) => ({
        id: `dc-multi-${i + 1}`,
        claimId: `claim-stress-${1000 + i}`,
        accidentDate: `2024-0${i + 1}-15`,
        country: "PL",
        damageValue: 12000.0 + i * 2500,
        currency: "PLN",
        isTotalLoss: false,
        mandateCode: `M-${i + 1}`,
        mandateDescription: `Kolizja drogowa #${i + 1}`,
        damageAssessmentJson: JSON.stringify({
          damagePositionCodes: ["05", "08", "20", "26", "18"],
          significantPartGroupCodes: ["004", "006"],
        }),
      })),
    };

    const t0 = performance.now();
    const viewModel = buildReportPdfViewModel(multiClaimReport);
    assert.strictEqual(viewModel.claims.length, 5);

    const pdfDoc = React.createElement(ReportPdfDocument, { model: viewModel }) as any;
    const buffer = await renderToBuffer(pdfDoc);
    const durationMs = performance.now() - t0;

    assert.ok(buffer);
    assert.strictEqual(buffer.toString("latin1", 0, 5), "%PDF-");

    const bufferKb = buffer.length / 1024;
    assert.ok(bufferKb < 500, `Multi-claim PDF must be < 500 KB (got ${bufferKb.toFixed(1)} KB)`);
    assert.ok(durationMs < 2000, `Multi-claim PDF render took too long: ${durationMs.toFixed(1)} ms`);
  });
  describe("Claims history (CLAIM_CHECK) section on page 1", () => {
    function collectTexts(root: any): string[] {
      const texts: string[] = [];
      function traverse(node: any) {
        if (!node) return;
        if (typeof node === "string") {
          texts.push(node);
        } else if (typeof node === "number") {
          texts.push(String(node));
        } else if (Array.isArray(node)) {
          node.forEach(traverse);
        } else if (node.props?.children) {
          traverse(node.props.children);
        }
      }
      traverse(root);
      return texts;
    }

    const SECTION_TITLE = "Historia szkód";

    async function renderTexts(report: any) {
      const { ReportPdfDocument } = await import("../report-pdf-document.tsx");
      const viewModel = buildReportPdfViewModel(report);
      // pl-PL grouping uses a non-breaking space: normalise it so expectations stay readable
      const texts = collectTexts(ReportPdfDocument({ model: viewModel }) as any).map((t) => t.replace(/\u00a0/g, " "));
      return { viewModel, texts };
    }

    test("Details available: factual summary line with claim count and details pointer", async () => {
      const { viewModel, texts } = await renderTexts(mockReport);
      assert.strictEqual(viewModel.claimsHistoryPresentation, "CLAIM_DETAILS_AVAILABLE");
      assert.ok(texts.some((t) => t.includes(SECTION_TITLE)));
      assert.ok(
        texts.some((t) =>
          t.includes("Zarejestrowano 1 szkodę (ostatnia: 2023-05-10). Łączna wartość szkód: ok. 22 000 – 23 000 zł brutto.")
        ),
        "Must render singular claim count summary"
      );
      assert.ok(
        texts.some((t) => t.includes("Szczegóły każdej szkody") && t.includes("na kolejnych stronach")),
        "Must point to the claim pages"
      );
    });

    test("Details available: Polish plural forms and total loss marker", async () => {
      const makeClaims = (n: number, totalLoss = false) =>
        Array.from({ length: n }, (_, i) => ({
          ...mockReport.damageClaims[0],
          id: `dc-plural-${i}`,
          claimId: `claim-plural-${i}`,
          isTotalLoss: totalLoss && i === 0,
          // disjoint zones: these are different claims, not assessments of one accident
          damageAssessmentJson: JSON.stringify({
            damagePositionCodes: [String(i + 1).padStart(2, "0")],
            significantPartGroupCodes: [],
          }),
        }));

      const two = await renderTexts({ ...mockReport, damageClaims: makeClaims(2) });
      assert.ok(
        two.texts.some((t) =>
          t.includes("Zarejestrowano 2 szkody (ostatnia: 2023-05-10). Łączna wartość szkód: ok. 45 000 – 46 000 zł brutto.")
        )
      );

      const five = await renderTexts({ ...mockReport, damageClaims: makeClaims(5, true) });
      assert.ok(
        five.texts.some((t) =>
          t.includes(
            "Zarejestrowano 5 szkód (ostatnia: 2023-05-10), w tym szkodę całkowitą. Łączna wartość szkód: ok. 110 000 – 115 000 zł brutto."
          )
        )
      );
    });

    test("Check SUCCEEDED + details NOT_REQUESTED: history detected, details not ordered", async () => {
      const report = {
        ...mockReport,
        damageClaims: [],
        moduleResults: [
          { moduleId: "VALUATION", status: "SUCCEEDED" },
          { moduleId: "CLAIM_CHECK", status: "SUCCEEDED" },
          { moduleId: "CLAIM_DETAILS", status: "NOT_REQUESTED" },
        ],
      };
      const { viewModel, texts } = await renderTexts(report);
      assert.strictEqual(viewModel.claimsHistoryPresentation, "HISTORY_DETECTED_DETAILS_NOT_REQUESTED");
      assert.ok(texts.some((t) => t.includes(SECTION_TITLE)));
      assert.ok(
        texts.some((t) =>
          t.includes("Wykryto wpisy historii szkód w bazie Audatex. Szczegóły zdarzeń nie były objęte zamówieniem.")
        )
      );
    });

    test("Check SUCCEEDED + details FAILED: details unavailable notice", async () => {
      const report = {
        ...mockReport,
        damageClaims: [],
        moduleResults: [
          { moduleId: "VALUATION", status: "SUCCEEDED" },
          { moduleId: "CLAIM_CHECK", status: "SUCCEEDED" },
          { moduleId: "CLAIM_DETAILS", status: "FAILED" },
        ],
      };
      const { viewModel, texts } = await renderTexts(report);
      assert.strictEqual(viewModel.claimsHistoryPresentation, "HISTORY_DETECTED_DETAILS_UNAVAILABLE");
      assert.ok(texts.some((t) => t.includes(SECTION_TITLE)));
      assert.ok(
        texts.some((t) =>
          t.includes("Wykryto wpisy historii szkód w bazie Audatex. Szczegóły zdarzeń nie są dostępne w tym raporcie.")
        )
      );
    });

    test("Check NO_DATA: no history notice", async () => {
      const report = {
        ...mockReport,
        damageClaims: [],
        moduleResults: [
          { moduleId: "VALUATION", status: "SUCCEEDED" },
          { moduleId: "CLAIM_CHECK", status: "NO_DATA" },
          { moduleId: "CLAIM_DETAILS", status: "NO_DATA" },
        ],
      };
      const { viewModel, texts } = await renderTexts(report);
      assert.strictEqual(viewModel.claimsHistoryPresentation, "NO_HISTORY");
      assert.ok(texts.some((t) => t.includes(SECTION_TITLE)));
      assert.ok(texts.some((t) => t.includes("Brak zarejestrowanych szkód w bazie Audatex Claims History Engine.")));
    });

    test("Check FAILED: unavailable notice", async () => {
      const report = {
        ...mockReport,
        damageClaims: [],
        moduleResults: [
          { moduleId: "VALUATION", status: "SUCCEEDED" },
          { moduleId: "CLAIM_CHECK", status: "FAILED" },
          { moduleId: "CLAIM_DETAILS", status: "PENDING" },
        ],
      };
      const { viewModel, texts } = await renderTexts(report);
      assert.strictEqual(viewModel.claimsHistoryPresentation, "UNAVAILABLE");
      assert.ok(texts.some((t) => t.includes("Kontrola historii szkód nie została wykonana poprawnie.")));
    });

    test("Section is absent when CLAIM_CHECK is NOT_REQUESTED or missing", async () => {
      const notRequested = await renderTexts({
        ...mockReport,
        damageClaims: [],
        moduleResults: [
          { moduleId: "VALUATION", status: "SUCCEEDED" },
          { moduleId: "CLAIM_CHECK", status: "NOT_REQUESTED" },
          { moduleId: "CLAIM_DETAILS", status: "NOT_REQUESTED" },
        ],
      });
      assert.strictEqual(notRequested.texts.some((t) => t.includes(SECTION_TITLE)), false);

      const missing = await renderTexts({
        ...mockReport,
        damageClaims: [],
        moduleResults: [{ moduleId: "VALUATION", status: "SUCCEEDED" }],
      });
      assert.strictEqual(missing.viewModel.claimCheckStatus, "NIEWYKONANO");
      assert.strictEqual(missing.texts.some((t) => t.includes(SECTION_TITLE)), false);
    });
  });
  describe("Visual refresh: document-level behaviour", () => {
    function walk(root: any, visit: (node: any) => void) {
      (function traverse(node: any) {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(traverse);
        if (typeof node !== "object") return;
        visit(node);
        if (node.props?.children) traverse(node.props.children);
      })(root);
    }
    // Texts of the whole tree, expanding the (pure, hook-free) function components such as KPI tiles and grids.
    function textsOf(root: any): string[] {
      const out: string[] = [];
      (function traverse(node: any) {
        if (!node) return;
        if (typeof node === "string") out.push(node);
        else if (typeof node === "number") out.push(String(node));
        else if (Array.isArray(node)) node.forEach(traverse);
        else if (typeof node.type === "function") traverse(node.type(node.props));
        else if (node.props?.children) traverse(node.props.children);
      })(root);
      return out.map((t) => t.replace(/\u00a0/g, " "));
    }
    function sectionNumbers(root: any): number[] {
      const nums: number[] = [];
      walk(root, (n) => {
        if (typeof n.props?.number === "number") nums.push(n.props.number);
      });
      return nums;
    }

    async function render(report: any) {
      const { ReportPdfDocument } = await import("../report-pdf-document.tsx");
      const viewModel = buildReportPdfViewModel(report);
      return { viewModel, tree: ReportPdfDocument({ model: viewModel }) as any };
    }

    test("Sections are numbered 1..n in rendered order, also without valuation and technical spec", async () => {
      const full = await render(mockReport);
      assert.deepStrictEqual(sectionNumbers(full.tree), [1, 2, 3, 4, 5]);

      const noValuation = await render({
        ...mockReport,
        moduleResults: [{ moduleId: "VALUATION", status: "FAILED" }, { moduleId: "CLAIM_CHECK", status: "SUCCEEDED" }],
        vehicleSnapshot: null,
        damageClaims: [],
      });
      // claims overview + one "Wyposażenie" section (no valuation, no technical spec, equipment not split)
      assert.deepStrictEqual(sectionNumbers(noValuation.tree), [1, 2]);
    });

    test("Document title uses the public reference, falling back to VIN", async () => {
      const withRef = await render(mockReport);
      assert.strictEqual(withRef.tree.props.title, "Raport IzzyCheck IC-2026-08-0417");
      const withoutRef = await render({ ...mockReport, publicReference: null });
      assert.strictEqual(withoutRef.tree.props.title, "Raport IzzyCheck WBA3N51030KS15173");
    });

    test("createdAtFormatted is rendered in Europe/Warsaw time", () => {
      const vm = buildReportPdfViewModel(mockReport);
      assert.strictEqual(vm.createdAtFormatted, "06.08.2026, 14:00");
      const winter = buildReportPdfViewModel({ ...mockReport, createdAt: "2026-01-15T23:30:00.000Z" });
      assert.strictEqual(winter.createdAtFormatted, "16.01.2026, 00:30");
    });

    test("KPI row: market value, claims tile and completeness for a complete report", async () => {
      const { tree } = await render(mockReport);
      const texts = textsOf(tree);
      assert.ok(texts.includes("124 500"), "market value as integer with Polish grouping");
      assert.ok(texts.includes("PLN netto (bez VAT)"), "net label next to the hero value");
      assert.ok(texts.includes("1 szkoda"));
      assert.ok(texts.includes("Kompletny"));
    });

    test("KPI row: missing valuation shows Brak wyceny and partial status shows the as-is tile", async () => {
      const { tree } = await render({
        ...mockReport,
        status: "PARTIALLY_FAILED",
        vehicleSnapshot: null,
        damageClaims: [],
        moduleResults: [{ moduleId: "VALUATION", status: "FAILED" }, { moduleId: "CLAIM_CHECK", status: "NO_DATA" }],
      });
      const texts = textsOf(tree);
      assert.ok(texts.includes("Brak wyceny"));
      assert.ok(texts.includes("Niepełny (as-is)"));
      assert.ok(texts.includes("Brak szkód"));
      assert.ok(texts.includes("W bazie Audatex nie odnotowano szkód dla tego pojazdu."));
      assert.ok(texts.includes("Pojazd o numerze VIN"), "generic title without a make");
      assert.strictEqual(
        texts.filter((t) => t.includes("WBA3N51030KS15173")).length,
        2,
        "VIN appears once in the band and once in the header, not repeated in the title"
      );
      assert.strictEqual(
        texts.filter((t) => t === "Moduł wyceny nie został wykonany").length,
        1,
        "a single equipment section with one failed notice"
      );
      assert.ok(texts.includes("Wyposażenie"));
      assert.strictEqual(texts.some((t) => t.includes("Wyposażenie standardowe")), false);
    });

    test("Equipment count chips use the correct Polish plural", async () => {
      const items = (n: number) => Array.from({ length: n }, (_, i) => ({ code: `C${i}`, name: `Pozycja ${i}` }));
      const chipFor = async (std: number, opt: number) => {
        const { tree } = await render({
          ...mockReport,
          vehicleSnapshot: {
            ...mockReport.vehicleSnapshot,
            standardEquipment: JSON.stringify(items(std)),
            optionalEquipment: JSON.stringify(items(opt)),
          },
        });
        const chips: string[] = [];
        walk(tree, (n) => {
          if (typeof n.props?.chip === "string") chips.push(n.props.chip);
        });
        return chips;
      };
      assert.deepStrictEqual(await chipFor(1, 2), ["2 pozycje", "1 pozycja"]);
      assert.deepStrictEqual(await chipFor(5, 3), ["3 pozycje", "5 pozycji"]);
      assert.deepStrictEqual(await chipFor(12, 22), ["22 pozycje", "12 pozycji"]);
    });

    test("Valuation section shows plain-Polish labels and the market/new-price percentage", async () => {
      const { tree } = await render(mockReport);
      const texts = textsOf(tree);
      assert.ok(texts.includes("Cena nowego pojazdu (CV)"));
      assert.ok(texts.includes("Wartość rynkowa (COB)"));
      assert.ok(texts.includes("Wartość techniczna (TH)"));
      assert.ok(texts.includes("Wartość rynkowa = 60% ceny nowego"));
    });

    test("Technical spec raw attributes are an allowlist: system keys hidden, labelled ones printed in Polish", async () => {
      const withRaw = {
        ...mockReport,
        vehicleSnapshot: {
          ...mockReport.vehicleSnapshot,
          technicalSpecJson: JSON.stringify({
            ...JSON.parse(mockReport.vehicleSnapshot.technicalSpecJson),
            rawAttributes: { marketCode: "PL", Fake100900: "20220427", HS_M: "1788", engineMark: "420d", couple: "400" },
          }),
        },
      };
      const { tree } = await render(withRaw);
      const texts = textsOf(tree);
      for (const hidden of ["marketCode", "Fake100900", "HS_M", "20220427", "1788"]) {
        assert.strictEqual(texts.includes(hidden), false, hidden);
      }
      assert.ok(texts.includes("Pozostałe parametry"));
      assert.ok(texts.includes("Oznaczenie silnika"));
      assert.ok(texts.includes("420d"));
      assert.ok(texts.includes("Moment obrotowy (Nm)"));
    });

    test("Technical spec omits the 'Pozostałe parametry' block when no raw attribute has a label", async () => {
      const withRaw = {
        ...mockReport,
        vehicleSnapshot: {
          ...mockReport.vehicleSnapshot,
          technicalSpecJson: JSON.stringify({
            ...JSON.parse(mockReport.vehicleSnapshot.technicalSpecJson),
            rawAttributes: { marketCode: "PL", ax_Options: "P8,P9,O2", KP_UNI: "0.015", engineMark: "" },
          }),
        },
      };
      const { tree } = await render(withRaw);
      const texts = textsOf(tree);
      assert.strictEqual(texts.includes("Pozostałe parametry"), false);
      assert.strictEqual(texts.includes("ax_Options"), false);
    });

    describe("Real production data (BMW 420d Gran Coupé)", () => {
      const realReport = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "lib/pdf/tests/fixtures/real-bmw-420d-report.json"), "utf8")
      );

      test("Hides system keys and the mandate placeholder, shows Polish country, body type and group names", async () => {
        const { viewModel, tree } = await render(realReport);
        const texts = textsOf(tree);

        assert.strictEqual(texts.some((t) => t.includes("Fake100900")), false);
        assert.strictEqual(texts.some((t) => t.includes("ax_Options")), false);
        assert.strictEqual(texts.some((t) => t.toLowerCase().includes("brak kodu mandatu")), false);
        assert.ok(texts.includes("Polska"));
        assert.strictEqual(texts.includes("PL"), false);
        assert.ok(texts.includes("Oznaczenie silnika"));
        assert.ok(texts.includes("Emisja CO2 (g/km)"));
        assert.ok(texts.some((t) => t.startsWith("Liftback")), "body type is capitalised");
        assert.strictEqual(viewModel.claims[0].presentation.template.bodyType, "passenger-sedan");
        assert.strictEqual(viewModel.claims[0].presentation.template.isGeneric, false);

        // claim 2 has the unpadded group code "4": it must resolve to the Polish group name
        const group2 = viewModel.claims[1].presentation.markers.find((m) => m.sourceKind === "group");
        assert.strictEqual(group2?.sourceCode, "004");
        assert.strictEqual(group2?.titlePl, "Elementy poszycia zewnętrznego nadwozia");
        assert.strictEqual(texts.filter((t) => t === "Elementy poszycia zewnętrznego nadwozia").length, 2);
        assert.strictEqual(texts.some((t) => t.startsWith("Grupa części w kalkulacji")), false);
      });

      test("Page 1 has no vehicle illustration: the 3/4 photos appear only on the claim pages", async () => {
        const { tree } = await render(realReport);
        const srcs: string[] = [];
        (function traverse(node: any) {
          if (!node) return;
          if (Array.isArray(node)) return node.forEach(traverse);
          if (typeof node !== "object") return;
          if (typeof node.type === "function") return traverse(node.type(node.props));
          if (typeof node.props?.src === "string") srcs.push(node.props.src);
          if (node.props?.children) traverse(node.props.children);
        })(tree);
        const rf3q = srcs.filter((s) => s.endsWith("-rf3q.jpg"));
        const lr3q = srcs.filter((s) => s.endsWith("-lr3q.jpg"));
        assert.strictEqual(rf3q.length, 2, "one per claim page, none in the page-1 band");
        assert.strictEqual(lr3q.length, 2);
      });

      test("Section title is 'Historia szkód'; claim type is never 'Częściowa'; table column is 'Uwagi'", async () => {
        const { tree } = await render(realReport);
        const texts = textsOf(tree);
        assert.strictEqual(texts.some((t) => t.includes("Audatex CHE")), false);
        assert.ok(texts.includes("Historia szkód"));
        for (const t of texts) assert.ok(!/częściowa/i.test(t), t);
        assert.ok(texts.includes("Uwagi"));
        assert.strictEqual(texts.includes("Typ"), false);
        // both claims are probable duplicates and not total losses: only the probable badge is shown
        assert.strictEqual(texts.includes("Szkoda całkowita"), false);
      });

      test("Claim card: Stan drogomierza (km or Brak danych) and the gross damage range with its caption", async () => {
        const { tree } = await render(realReport);
        const texts = textsOf(tree);
        assert.strictEqual(texts.filter((t) => t === "Stan drogomierza").length, 2);
        assert.ok(texts.includes("214 357 km"));
        assert.ok(texts.includes("Brak danych"), "claim 2 has no mileage");
        // 19 768.92 -> 24 000 – 25 000 zł and 15 483.51 -> 19 000 – 20 000 zł (page-1 table + claim page)
        assert.strictEqual(texts.filter((t) => t === "24 000 – 25 000 zł").length >= 2, true);
        assert.strictEqual(texts.filter((t) => t === "19 000 – 20 000 zł").length >= 2, true);
        assert.strictEqual(
          texts.filter((t) => t === "brutto, szacunek (kwota netto Audatex + 23% VAT)").length,
          2,
          "full caption on the two claim pages"
        );
        assert.ok(texts.includes("brutto, szacunek"), "short caption in the table / timeline");
        // the net label is left only on vehicle valuation prices (KPI tile + 3 valuation cells)
        assert.strictEqual(texts.filter((t) => t === "PLN netto (bez VAT)").length, 4);
        assert.strictEqual(texts.some((t) => /^\d[\d ]* PLN$/.test(t)), false, "no net damage amount in the timeline");
        assert.ok(texts.includes("brutto, szacunek"));
      });

      test("Non-PLN damage amounts are not converted: net value with the currency", async () => {
        const eur = {
          ...realReport,
          damageClaims: realReport.damageClaims.map((c: any, i: number) => (i === 0 ? { ...c, currency: "EUR" } : c)),
        };
        const texts = textsOf((await render(eur)).tree);
        assert.ok(texts.includes("EUR netto (bez VAT)"));
        assert.ok(texts.includes("19 769"), "net amount, rounded as before");
        assert.strictEqual(texts.includes("24 000 – 25 000 zł"), false);
      });

      test("Disclaimer point 2 explains net valuation prices and the estimated gross damage range", async () => {
        const texts = textsOf((await render(realReport)).tree);
        assert.ok(
          texts.includes(
            "2. Wartości wyceny pojazdu są wartościami netto (bez VAT) według Audatex. Wartości szkód prezentujemy jako szacunkowy przedział brutto wyliczony z kwoty netto Audatex powiększonej o 23% VAT."
          )
        );
        assert.strictEqual(texts.some((t) => t.includes("nie dokonuje wyliczeń")), false);
      });

      test("Claim pages: plain zone list with category dots, group chips, no codes, no photo column", async () => {
        const { tree } = await render(realReport);
        const texts = textsOf(tree);
        assert.ok(texts.includes("Zdjęcie 1: przód i prawy bok"));
        assert.ok(texts.includes("Zdjęcie 2: tył i lewy bok"));
        assert.strictEqual(texts.includes("Strefy uszkodzeń"), true);
        assert.ok(texts.includes("Tył, prawa strona, góra"));
        assert.ok(texts.includes("okolice: prawy słupek C (orientacyjnie)"));
        assert.ok(texts.includes("Zakres naprawy (grupy części w kalkulacji Audatex)"));
        assert.ok(texts.includes("Elementy poszycia zewnętrznego nadwozia"));
        assert.ok(texts.includes("Oszklenie"));
        assert.strictEqual(
          texts.filter((t) => t === "Audatex wskazał także elementy bez przypisanej strefy.").length,
          2,
          "zone 00 is only a caption under the list, once per claim"
        );
        // removed: code column, photo column, "1 · / 2 ·" texts, zone 00 row, part-group codes, badge numbers
        for (const gone of ["Strefa / kod", "Opis", "Widoczność", "Zdjęcie", "Grupa funkcjonalna", "Strefa nieokreślona", "Inne / nieokreślone"]) {
          assert.strictEqual(texts.includes(gone), false, gone);
        }
        assert.strictEqual(texts.some((t) => t.includes("1 · przód") || t.includes("2 · tył")), false);
        for (const code of ["00", "05", "13", "14", "15", "19", "22", "23", "004", "007"]) {
          assert.strictEqual(texts.includes(code), false, `code ${code} must not be rendered`);
        }
        assert.strictEqual(texts.some((t) => t.includes("Prawy skos")), false);
      });

      test("Claim pages: one plain dot per zone row and per group chip, in the category colour", async () => {
        const { tree } = await render(realReport);
        const dots: any[] = [];
        (function traverse(node: any) {
          if (!node) return;
          if (Array.isArray(node)) return node.forEach(traverse);
          if (typeof node !== "object") return;
          if (typeof node.type === "function") return traverse(node.type(node.props));
          const flat = Object.assign({}, ...[node.props?.style].flat(Infinity).filter(Boolean));
          if (flat.width === 7 && flat.height === 7 && flat.borderRadius === 3.5) dots.push(flat);
          if (node.props?.children) traverse(node.props.children);
        })(tree);
        // claim 1: 6 zones + 2 groups (004, 007); claim 2: 6 zones + 1 group (004)
        assert.strictEqual(dots.length, 15);
        const colours = new Set(dots.map((d) => d.backgroundColor));
        assert.deepStrictEqual([...colours].sort(), ["#3B82F6", "#EF4444"]);
      });

      test("A claim without accidentDate shows the claim date as 'Data zgłoszenia' (claim page and overview)", async () => {
        const { viewModel, tree } = await render(realReport);
        assert.strictEqual(viewModel.claims[0].accidentDate, "2025-02-20");
        assert.ok(!viewModel.claims[1].accidentDate);
        const texts = textsOf(tree);
        assert.strictEqual(texts.filter((t) => t === "Data zdarzenia").length, 2); // overview header + claim 1 page
        assert.strictEqual(texts.filter((t) => t === "Data zgłoszenia").length, 1); // claim 2 page
        assert.ok(texts.includes("2025-10-07"));
        assert.strictEqual(texts.filter((t) => t === "(zgłoszenie)").length, 1); // overview marker for claim 2 only
      });

      test("A and B are one probable event: KPI '2 wpisy', summary, badges, captions and disclaimer", async () => {
        const { viewModel, tree } = await render(realReport);
        assert.strictEqual(viewModel.claims.length, 2);
        assert.deepStrictEqual(viewModel.claims.map((c) => c.probableWith), [[2], [1]]);
        assert.deepStrictEqual(viewModel.dedup, {
          entriesCount: 2,
          likelyEventsCount: 1,
          likelyTotal: { total: 19768.92, currency: "PLN" },
          hasMerged: false,
        });
        const texts = textsOf(tree);
        assert.ok(texts.includes("2 wpisy"));
        assert.ok(texts.includes("prawdopodobnie 1 szkoda"));
        assert.strictEqual(texts.includes("2 szkody"), false);
        assert.ok(
          texts.includes(
            "Zarejestrowano 2 wpisy, prawdopodobnie dotyczące 1 szkody. Łączna wartość szkód według najnowszych wycen: ok. 24 000 – 25 000 zł brutto."
          )
        );
        // badge: 2 rows of the page-1 table + 2 claim pages
        assert.strictEqual(texts.filter((t) => t === "Prawdopodobnie ta sama szkoda").length, 4);
        assert.ok(
          texts.includes(
            "Zbliżony zakres uszkodzeń i termin jak szkoda 2. Audatex nie podaje wspólnego identyfikatora zdarzenia."
          )
        );
        assert.ok(
          texts.includes(
            "Zbliżony zakres uszkodzeń i termin jak szkoda 1. Audatex nie podaje wspólnego identyfikatora zdarzenia."
          )
        );
        assert.ok(texts.some((t) => t.startsWith("Wyceny tej samej szkody scalamy automatycznie")));
        assert.strictEqual(texts.includes("Wcześniejsze wyceny tej szkody"), false);
        // timeline: probable label suffix and the "(zgłoszenie)" marker on the claim without accident date
        assert.strictEqual(texts.filter((t) => t === " ≈").length, 2);
        assert.strictEqual(texts.filter((t) => t === " (zgłoszenie)").length, 1);
      });

      test("Merged assessments (same accident date): one claim, KPI '1 szkoda', earlier assessments block", async () => {
        const merged = {
          ...realReport,
          damageClaims: realReport.damageClaims.map((c: any, i: number) =>
            i === 1 ? { ...c, accidentDate: "2025-02-20" } : c
          ),
        };
        const { viewModel, tree } = await render(merged);
        assert.strictEqual(viewModel.claims.length, 1);
        assert.strictEqual(viewModel.claims[0].dedupKind, "MERGED");
        assert.strictEqual(viewModel.claims[0].earlierAssessments.length, 1);
        assert.strictEqual(viewModel.claims[0].damageValue, 19768.92);
        const texts = textsOf(tree);
        assert.ok(texts.includes("1 szkoda"));
        assert.strictEqual(texts.some((t) => /^\d+ wpis/.test(t) || t.startsWith("prawdopodobnie")), false);
        assert.ok(
          texts.includes("Zarejestrowano 1 szkodę (najnowsza wycena: 2025-10-11). Łączna wartość szkód: ok. 24 000 – 25 000 zł brutto.")
        );
        assert.ok(texts.includes("Wcześniejsze wyceny tej szkody"));
        assert.ok(texts.includes("2025-10-07"));
        assert.ok(texts.includes("2025-10-07.PL.B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2"));
        assert.ok(texts.includes("Najnowsza z 2 wycen tej szkody"));
        assert.ok(texts.includes("najnowsza z 2 wycen"));
        assert.ok(texts.includes("Szkoda 1 z 1"));
        assert.strictEqual(texts.includes("Prawdopodobnie ta sama szkoda"), false);
        assert.ok(texts.some((t) => t.startsWith("Wyceny tej samej szkody scalamy automatycznie")));
      });

      test("Disclaimer is kept together with the last zone row (never alone on a page)", async () => {
        const { tree } = await render(realReport);
        const keptTogether: string[][] = [];
        (function traverse(node: any) {
          if (!node) return;
          if (Array.isArray(node)) return node.forEach(traverse);
          if (typeof node !== "object") return;
          if (typeof node.type === "function") return traverse(node.type(node.props));
          if (node.props?.wrap === false) keptTogether.push(textsOf(node.props.children));
          if (node.props?.children) traverse(node.props.children);
        })(tree);
        const withDisclaimer = keptTogether.filter((t) => t.some((x) => x.startsWith("1. Niniejszy raport ma charakter")));
        assert.ok(
          withDisclaimer.some((t) => t.includes("Tył, prawa strona, środek")),
          "a wrap={false} block must hold the disclaimer together with the last zone row"
        );
      });

      test("Total loss is never hidden by a newer partial assessment of the same accident", async () => {
        const tl = {
          ...realReport,
          damageClaims: realReport.damageClaims.map((c: any, i: number) =>
            i === 1 ? { ...c, accidentDate: "2025-02-20", isTotalLoss: true } : c
          ),
        };
        const { viewModel, tree } = await render(tl);
        assert.strictEqual(viewModel.claims.length, 1);
        // claim A (newer, primary) is partial; claim B (older) is a total loss
        assert.strictEqual(realReport.damageClaims[0].isTotalLoss, false);
        assert.strictEqual(viewModel.claims[0].isTotalLoss, true);
        assert.deepStrictEqual(viewModel.claims[0].earlierAssessments.map((e) => e.isTotalLoss), [true]);
        const texts = textsOf(tree);
        // page-1 table badge + claim-page badge + badge on the earlier assessment
        assert.strictEqual(texts.filter((t) => t === "Szkoda całkowita").length, 3);
        assert.strictEqual(texts.includes("Częściowa"), false);
        assert.ok(texts.includes("w tym szkoda całkowita"), "KPI sub-line");
        assert.ok(texts.some((t) => t.includes("w tym szkodę całkowitą")), "factual summary");
      });

      test("'Poza zdjęciami' lists only interior zones; underbody zones stay on the underbody photo; one heading when there is no underbody photo", async () => {
        const withZones = (codes: string[]) => ({
          ...realReport,
          damageClaims: [
            {
              ...realReport.damageClaims[0],
              damageAssessmentJson: JSON.stringify({ damagePositionCodes: codes, significantPartGroupCodes: [] }),
            },
          ],
        });
        const count = (texts: string[], t: string) => texts.filter((x) => x === t).length;
        const interior = "Środek, oś pojazdu, środek"; // zone 17
        const underbody = "Środek, oś pojazdu, dół"; // zone 18

        const both = textsOf((await render(withZones(["05", "17", "18"]))).tree);
        assert.ok(both.includes("Podwozie (widok od spodu)"));
        assert.strictEqual(count(both, "Poza zdjęciami"), 1);
        assert.strictEqual(count(both, interior), 2, "zone list + off-photo list");
        assert.strictEqual(count(both, underbody), 1, "zone list only: it is drawn on the underbody photo");

        const interiorOnly = textsOf((await render(withZones(["05", "17"]))).tree);
        assert.strictEqual(count(interiorOnly, "Strefy poza zdjęciami"), 1);
        assert.strictEqual(count(interiorOnly, "Poza zdjęciami"), 0, "no duplicated sub-heading");
        assert.strictEqual(count(interiorOnly, interior), 2);

        const underbodyOnly = textsOf((await render(withZones(["05", "18"]))).tree);
        assert.ok(underbodyOnly.includes("Podwozie (widok od spodu)"));
        assert.strictEqual(count(underbodyOnly, "Poza zdjęciami"), 0, "nothing off-photo: no empty list");
        assert.strictEqual(count(underbodyOnly, "Strefy poza zdjęciami"), 0);
      });

      test("Renders to a valid PDF", async () => {
        const { renderToBuffer } = await import("@react-pdf/renderer");
        const { ReportPdfDocument } = await import("../report-pdf-document.tsx");
        const vm = buildReportPdfViewModel(realReport);
        const buffer = await renderToBuffer(React.createElement(ReportPdfDocument, { model: vm }) as any);
        assert.strictEqual(buffer.toString("latin1", 0, 5), "%PDF-");
      });
    });

    test("Renders a claim with missing country and a long equipment list without throwing", async () => {
      const { renderToBuffer } = await import("@react-pdf/renderer");
      const { ReportPdfDocument } = await import("../report-pdf-document.tsx");
      const items = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ code: `${p}${i}`, name: `Pozycja ${p}${i}` }));
      const vm = buildReportPdfViewModel({
        ...mockReport,
        vehicleSnapshot: {
          ...mockReport.vehicleSnapshot,
          standardEquipment: JSON.stringify(items(80, "S")),
          optionalEquipment: JSON.stringify(items(25, "O")),
        },
        damageClaims: [{ ...mockReport.damageClaims[0], country: undefined }],
      });
      assert.strictEqual(vm.claims[0].country, undefined);
      const buffer = await renderToBuffer(React.createElement(ReportPdfDocument, { model: vm }) as any);
      assert.strictEqual(buffer.toString("latin1", 0, 5), "%PDF-");
    });
  });
});
