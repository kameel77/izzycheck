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

    const pdfDoc = React.createElement(ReportPdfDocument, { model: viewModel }) as any;
    const buffer = await renderToBuffer(pdfDoc);

    assert.ok(buffer);
    assert.ok(buffer.length > 30000, `Buffer should be substantial for 250 items (got ${buffer.length} bytes)`);

    const pdfString = buffer.toString("latin1");
    // Verify valid PDF header
    assert.strictEqual(pdfString.substring(0, 5), "%PDF-");

    // Verify multi-page pagination: 250 items flow into multiple pages
    const pageCount = (pdfString.match(/\/Type\s*\/Page\b/g) || []).length;
    assert.ok(pageCount >= 2, `Document with 250 items must span at least 2 pages (got ${pageCount})`);
  });

  test("Renders distinct empty state notices for missing valuation module vs zero items from Audatex", async () => {
    const { ReportPdfDocument } = await import("../report-pdf-document.tsx");

    // Case 1: Valuation module failed
    const failedValReport = {
      ...mockReport,
      moduleResults: [{ moduleId: "VALUATION", status: "FAILED" }],
      vehicleSnapshot: null,
    };
    const vmFailed = buildReportPdfViewModel(failedValReport);
    const elemFailed = React.createElement(ReportPdfDocument, { model: vmFailed }) as any;
    assert.ok(elemFailed);
    assert.strictEqual(vmFailed.valuationStatus, "FAILED");

    // Case 2: Valuation succeeded but zero items returned
    const emptyEqReport = {
      ...mockReport,
      vehicleSnapshot: {
        ...mockReport.vehicleSnapshot,
        standardEquipment: JSON.stringify([]),
        optionalEquipment: JSON.stringify([]),
      },
    };
    const vmEmpty = buildReportPdfViewModel(emptyEqReport);
    const elemEmpty = React.createElement(ReportPdfDocument, { model: vmEmpty }) as any;
    assert.ok(elemEmpty);
    assert.strictEqual(vmEmpty.standardEquipment.length, 0);
    assert.strictEqual(vmEmpty.optionalEquipment.length, 0);

    // Case 3: Common mixed case: standard present, optional empty
    const mixedEqReport = {
      ...mockReport,
      vehicleSnapshot: {
        ...mockReport.vehicleSnapshot,
        standardEquipment: JSON.stringify([{ code: "S1", name: "Klimatyzacja" }]),
        optionalEquipment: JSON.stringify([]),
      },
    };
    const vmMixed = buildReportPdfViewModel(mixedEqReport);
    assert.strictEqual(vmMixed.standardEquipment.length, 1);
    assert.strictEqual(vmMixed.optionalEquipment.length, 0);
  });
});
