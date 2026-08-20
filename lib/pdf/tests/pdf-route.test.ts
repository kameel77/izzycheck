import assert from "node:assert";
import { test, describe, beforeEach, afterEach } from "node:test";
import { GET } from "../../../app/api/reports/[id]/pdf/route.ts";
import { prisma } from "../../db.ts";

describe("PDF API Endpoint GET Route Handler (Direct app/api/reports/[id]/pdf/route.ts execution)", () => {
  let originalFindUnique: any;
  let originalUpdateReport: any;
  let originalCreateAudit: any;

  beforeEach(() => {
    originalFindUnique = prisma.report.findUnique;
    originalUpdateReport = prisma.report.update;
    originalCreateAudit = prisma.auditEvent.create;

    (prisma.report as any).update = async ({ data }: any) => ({ id: "rep-mock", ...data });
    (prisma.auditEvent as any).create = async ({ data }: any) => ({ id: "audit-mock", ...data });
  });

  afterEach(() => {
    globalThis.__mockCurrentUser = undefined;
    globalThis.__mockRenderToBuffer = undefined;
    (prisma.report as any).findUnique = originalFindUnique;
    (prisma.report as any).update = originalUpdateReport;
    (prisma.auditEvent as any).create = originalCreateAudit;
  });

  test("Returns 401 Unauthenticated when getCurrentUser() returns null", async () => {
    globalThis.__mockCurrentUser = null;

    const req = new Request("http://localhost:3000/api/reports/rep-1/pdf");
    const params = Promise.resolve({ id: "rep-1" });

    const res = await GET(req, { params });
    assert.strictEqual(res.status, 401);

    const json = await res.json();
    assert.strictEqual(json.error, "Brak autoryzacji.");
  });

  test("Returns 403 Forbidden when OPERATOR attempts to download another user's report", async () => {
    globalThis.__mockCurrentUser = {
      userId: "user-operator-1",
      email: "op1@izzylease.pl",
      name: "Operator 1",
      role: "OPERATOR",
    };

    (prisma.report as any).findUnique = async () => ({
      id: "rep-forbidden",
      vin: "WBA12345678900000",
      createdById: "user-other-99",
      firstRegistrationDate: "2020-01-01",
      createdAt: new Date().toISOString(),
      createdBy: { id: "user-other-99", name: "Other User", email: "other@izzylease.pl" },
      vehicleSnapshot: null,
      moduleResults: [],
      damageClaims: [],
    });

    const req = new Request("http://localhost:3000/api/reports/rep-forbidden/pdf");
    const params = Promise.resolve({ id: "rep-forbidden" });

    const res = await GET(req, { params });
    assert.strictEqual(res.status, 403);

    const json = await res.json();
    assert.strictEqual(json.error, "Dostęp zabroniony. Nie posiadasz uprawnień do pobierania tego raportu.");
  });

  test("Returns 200 with application/pdf and records DOWNLOAD_REPORT_PDF audit event for report owner", async () => {
    globalThis.__mockCurrentUser = {
      userId: "user-admin-1",
      email: "admin@izzylease.pl",
      name: "Admin User",
      role: "ADMIN",
    };

    globalThis.__mockRenderToBuffer = async () => Buffer.from("%PDF-1.4 mock binary data for izzycheck");

    let auditRecorded: any = null;
    (prisma.auditEvent as any).create = async ({ data }: any) => {
      auditRecorded = data;
      return { id: "audit-1", ...data };
    };

    (prisma.report as any).findUnique = async () => ({
      id: "rep-valid-100",
      vin: "WBA3N51030KS15173",
      createdById: "user-other-22",
      firstRegistrationDate: "2021-05-10",
      valuationDate: "2026-08-06",
      status: "COMPLETED",
      createdAt: new Date().toISOString(),
      createdBy: { id: "user-other-22", name: "Jan", email: "jan@izzylease.pl" },
      vehicleSnapshot: {
        make: "BMW",
        model: "Seria 4",
        variant: "420i",
      },
      moduleResults: [],
      damageClaims: [],
    });

    const req = new Request("http://localhost:3000/api/reports/rep-valid-100/pdf");
    const params = Promise.resolve({ id: "rep-valid-100" });

    const res = await GET(req, { params });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("Content-Type"), "application/pdf");
    assert.ok(res.headers.get("Content-Disposition")?.includes("Raport-IzzyCheck-WBA3N51030KS15173.pdf"));

    const pdfArrayBuffer = await res.arrayBuffer();
    const pdfHeader = Buffer.from(pdfArrayBuffer).toString("utf-8", 0, 5);
    assert.strictEqual(pdfHeader, "%PDF-");

    // Verify audit event recording
    assert.ok(auditRecorded);
    assert.strictEqual(auditRecorded.action, "DOWNLOAD_REPORT_PDF");
    assert.strictEqual(auditRecorded.resource, "REPORT:rep-valid-100");
    assert.strictEqual(auditRecorded.userId, "user-admin-1");
  });

  test("Serves cached immutable pdfBytes directly from database without calling renderToBuffer", async () => {
    globalThis.__mockCurrentUser = {
      userId: "user-admin-1",
      email: "admin@izzylease.pl",
      name: "Admin User",
      role: "ADMIN",
    };

    const cachedPdfBytes = Buffer.from("%PDF-1.4 CACHED IMMUTABLE BYTES FROM DB");

    let rendererCalled = false;
    globalThis.__mockRenderToBuffer = async () => {
      rendererCalled = true;
      return Buffer.from("%PDF-1.4 FRESH RENDER");
    };

    (prisma.report as any).findUnique = async () => ({
      id: "rep-cached-200",
      publicReference: "IC-2026-08-0042",
      vin: "WBA3N51030KS15173",
      createdById: "user-admin-1",
      firstRegistrationDate: "2021-05-10",
      valuationDate: "2026-08-06",
      status: "COMPLETED",
      pdfBytes: cachedPdfBytes,
      pdfGeneratedAt: new Date("2026-08-20T18:00:00Z"),
      pdfGeneratorVersion: "0.1.0",
      createdAt: new Date().toISOString(),
      createdBy: { id: "user-admin-1", name: "Admin", email: "admin@izzylease.pl" },
      vehicleSnapshot: null,
      moduleResults: [],
      damageClaims: [],
    });

    const req = new Request("http://localhost:3000/api/reports/rep-cached-200/pdf");
    const params = Promise.resolve({ id: "rep-cached-200" });

    const res = await GET(req, { params });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("Content-Type"), "application/pdf");
    assert.strictEqual(
      res.headers.get("Content-Disposition"),
      'attachment; filename="Raport-IzzyCheck-IC-2026-08-0042.pdf"'
    );

    const receivedBytes = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(receivedBytes.toString(), "%PDF-1.4 CACHED IMMUTABLE BYTES FROM DB");
    assert.strictEqual(rendererCalled, false, "Renderer must NOT be called when pdfBytes is cached");
  });
});
