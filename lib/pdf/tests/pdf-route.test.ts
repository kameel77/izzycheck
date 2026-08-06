import assert from "node:assert";
import { test, describe, beforeEach, afterEach } from "node:test";
import { GET } from "../../../app/api/reports/[id]/pdf/route.ts";
import { prisma } from "../../db.ts";

describe("PDF API Endpoint GET Route Handler (Direct app/api/reports/[id]/pdf/route.ts execution)", () => {
  let originalFindUnique: any;
  let originalCreateAudit: any;

  beforeEach(() => {
    originalFindUnique = prisma.report.findUnique;
    originalCreateAudit = prisma.auditEvent.create;
  });

  afterEach(() => {
    globalThis.__mockCurrentUser = undefined;
    globalThis.__mockRenderToBuffer = undefined;
    (prisma.report as any).findUnique = originalFindUnique;
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
});
