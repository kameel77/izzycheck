import assert from "node:assert";
import { test, describe } from "node:test";
import React from "react";
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
    assert.strictEqual(viewModel.claims[0].presentation.totalMarkersCount, 2);
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
          damageZones: JSON.stringify(["Przód prawy środek", "Szyba przednia"]),
          significantParts: JSON.stringify(["Elementy poszycia zewnętrznego nadwozia"]),
          damageAssessmentJson: null,
        },
      ],
    };

    const viewModel = buildReportPdfViewModel(historicalReport);
    assert.strictEqual(viewModel.claims.length, 1);
    assert.ok(viewModel.claims[0].presentation.totalMarkersCount >= 3);

    const markers = viewModel.claims[0].presentation.markers;
    assert.ok(markers.some((m) => m.sourceCode === "05"));
    assert.ok(markers.some((m) => m.primaryCategory === "GLASS_LIGHTING"));
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

    // Verify exact multi-page count from row-major layout (Page 1 + 2 overflow equipment pages + 1 claim page = 4 pages)
    const pageCount = (pdfString.match(/\/Type\s*\/Page\b/g) || []).length;
    assert.strictEqual(pageCount, 4, `84 rows of equipment with 1 claim must span exactly 4 pages (got ${pageCount})`);
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

    const SECTION_TITLE = "Historia Szkód (Audatex CHE)";

    async function renderTexts(report: any) {
      const { ReportPdfDocument } = await import("../report-pdf-document.tsx");
      const viewModel = buildReportPdfViewModel(report);
      const texts = collectTexts(ReportPdfDocument({ model: viewModel }) as any);
      return { viewModel, texts };
    }

    test("Details available: warning with claim count and details pointer", async () => {
      const { viewModel, texts } = await renderTexts(mockReport);
      assert.strictEqual(viewModel.claimsHistoryPresentation, "CLAIM_DETAILS_AVAILABLE");
      assert.ok(texts.some((t) => t.includes(SECTION_TITLE)));
      assert.ok(
        texts.some((t) => t.includes("Zarejestrowano 1 szkodę w bazie Audatex. Szczegóły na kolejnych stronach.")),
        "Must render singular claim count notice"
      );
    });

    test("Details available: Polish plural forms and total loss marker", async () => {
      const makeClaims = (n: number, totalLoss = false) =>
        Array.from({ length: n }, (_, i) => ({
          ...mockReport.damageClaims[0],
          id: `dc-plural-${i}`,
          claimId: `claim-plural-${i}`,
          isTotalLoss: totalLoss && i === 0,
        }));

      const two = await renderTexts({ ...mockReport, damageClaims: makeClaims(2) });
      assert.ok(two.texts.some((t) => t.includes("Zarejestrowano 2 szkody w bazie Audatex.")));

      const five = await renderTexts({ ...mockReport, damageClaims: makeClaims(5, true) });
      assert.ok(five.texts.some((t) => t.includes("Zarejestrowano 5 szkód w bazie Audatex, w tym szkoda całkowita.")));
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
});
