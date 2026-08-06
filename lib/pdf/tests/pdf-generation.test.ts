import assert from "node:assert";
import { test, describe } from "node:test";
import React from "react";
import { buildReportPdfViewModel } from "../report-pdf-view-model.ts";

describe("PDF Generation & View Model Module", () => {
  const mockReport = {
    id: "report-12345678-abcd",
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
    assert.strictEqual(viewModel.operatorName, "Jan Kowalski");
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
});
