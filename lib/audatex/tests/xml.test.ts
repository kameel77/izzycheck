import assert from "node:assert";
import { test, describe } from "node:test";
import { escapeXml } from "../xml.ts";
import { AudatexValuationAdapter } from "../valuation.ts";
import { AudatexHistoryAdapter } from "../history.ts";

describe("escapeXml", () => {
  test("converts null and undefined to empty string", () => {
    assert.strictEqual(escapeXml(null), "");
    assert.strictEqual(escapeXml(undefined), "");
  });

  test("escapes all five XML special characters", () => {
    assert.strictEqual(escapeXml(`<a href="x">Tom & 'Jerry'</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;");
  });

  test("escapes ampersand first (no double escaping of produced entities)", () => {
    assert.strictEqual(escapeXml("a&b<c"), "a&amp;b&lt;c");
    assert.strictEqual(escapeXml("&lt;"), "&amp;lt;");
  });

  test("stringifies non-string values", () => {
    assert.strictEqual(escapeXml(45200), "45200");
    assert.strictEqual(escapeXml(0), "0");
    assert.strictEqual(escapeXml(false), "false");
  });
});

describe("SOAP envelope XML injection protection", () => {
  async function withNonMockFetch(run: (getBody: () => string) => Promise<void>) {
    const originalMock = process.env.AUDATEX_MOCK_MODE;
    const originalPassword = process.env.AUDATEX_CHE_PASSWORD;
    const originalFetch = global.fetch;
    let capturedBody = "";

    process.env.AUDATEX_MOCK_MODE = "false";
    process.env.AUDATEX_CHE_PASSWORD = "a&b<c";
    global.fetch = (async (_url: any, init?: any) => {
      capturedBody = String(init?.body ?? "");
      return {
        ok: false,
        status: 401,
        text: async () => "<fault/>",
      } as Response;
    }) as typeof fetch;

    try {
      await run(() => capturedBody);
    } finally {
      global.fetch = originalFetch;
      if (originalMock === undefined) delete process.env.AUDATEX_MOCK_MODE;
      else process.env.AUDATEX_MOCK_MODE = originalMock;
      if (originalPassword === undefined) delete process.env.AUDATEX_CHE_PASSWORD;
      else process.env.AUDATEX_CHE_PASSWORD = originalPassword;
    }
  }

  test("valuation GetCarByVinWs request escapes malicious dateOfFirstReg", async () => {
    await withNonMockFetch(async (getBody) => {
      const adapter = new AudatexValuationAdapter();
      await assert.rejects(() =>
        adapter.evaluateVehicle({
          vin: "WBA3N51030KS15173",
          dateOfFirstReg: "2026-01-01</te5:dateOfFirstReg><evil>",
        } as any)
      );

      const body = getBody();
      assert.ok(body.includes("2026-01-01&lt;/te5:dateOfFirstReg&gt;&lt;evil&gt;"), "escaped form must be present");
      assert.strictEqual(body.includes("<evil>"), false, "raw injected tag must not be present");
    });
  });

  test("valuation does not crash on non-string dateOfFirstReg", async () => {
    await withNonMockFetch(async (getBody) => {
      const adapter = new AudatexValuationAdapter();
      await assert.rejects(
        () => adapter.evaluateVehicle({ vin: "WBA3N51030KS15173", dateOfFirstReg: 20210415 } as any),
        (err: any) => {
          assert.strictEqual(err instanceof TypeError, false, "must fail on the HTTP call, not on .trim()");
          return true;
        }
      );
      assert.ok(getBody().includes("<te5:dateOfFirstReg>20210415</te5:dateOfFirstReg>"));
    });
  });

  test("CHE hasHistory request escapes password and malicious firstRegistration", async () => {
    await withNonMockFetch(async (getBody) => {
      const adapter = new AudatexHistoryAdapter();
      await assert.rejects(() =>
        adapter.checkClaimHistory({
          vin: "WBA3N51030KS15173",
          firstRegistration: "2026-01-01</urn:firstRegistration><evil>",
        } as any)
      );

      const body = getBody();
      assert.ok(body.includes("<urn:password>a&amp;b&lt;c</urn:password>"), "password must be escaped");
      assert.ok(body.includes("2026-01-01&lt;/urn:firstRegistration&gt;&lt;evil&gt;"), "escaped form must be present");
      assert.strictEqual(body.includes("<evil>"), false, "raw injected tag must not be present");
    });
  });
});
