import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { AudatexValuationAdapter } from "../valuation.ts";
import { NonRetryableError, VinNotFoundError } from "../types.ts";
import { loadFixture, syntheticVin } from "../../integrations/mamygo/tests/fixtures.ts";

const originalFetch = global.fetch;
const originalMock = process.env.AUDATEX_MOCK_MODE;

interface FetchCall {
  url: string;
  action: string;
  body: string;
}

/** Podstawia fetch: odpowiedź zależy od akcji SOAP; zapisuje wywołania. */
function stubFetch(responses: Record<string, { status: number; body: string }>): FetchCall[] {
  const calls: FetchCall[] = [];
  global.fetch = (async (url: string, init: RequestInit) => {
    const action = String((init.headers as Record<string, string>).SOAPAction);
    calls.push({ url: String(url), action, body: String(init.body) });
    const response = responses[action.split("/").pop()!];
    if (!response) throw new Error(`Nieoczekiwana akcja ${action}`);
    return { ok: response.status >= 200 && response.status < 300, status: response.status, text: async () => response.body } as Response;
  }) as typeof fetch;
  return calls;
}

beforeEach(() => {
  process.env.AUDATEX_MOCK_MODE = "false";
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalMock === undefined) delete process.env.AUDATEX_MOCK_MODE;
  else process.env.AUDATEX_MOCK_MODE = originalMock;
});

describe("AudatexValuationAdapter.identifyVehicle", () => {
  test("woła GetCarByVinWs i GetClassificationByIBSCode ze stałą datą techniczną i zwraca surowe XML-e", async () => {
    const vinXml = loadFixture("bmw-420d.vin.xml");
    const classificationXml = loadFixture("bmw-420d.cls.xml");
    const calls = stubFetch({
      GetCarByVinWs: { status: 200, body: vinXml },
      GetClassificationByIBSCode: { status: 200, body: classificationXml },
    });

    const result = await new AudatexValuationAdapter().identifyVehicle(syntheticVin());

    assert.deepEqual(calls.map((c) => c.action.split("/").pop()), ["GetCarByVinWs", "GetClassificationByIBSCode"]);
    assert.match(calls[0].body, /<te5:dateOfFirstReg>2012-01-01<\/te5:dateOfFirstReg>/);
    assert.match(calls[1].body, /<IBSCode>965894<\/IBSCode>/);
    assert.match(calls[1].body, /<ManufacturedYear>2012<\/ManufacturedYear>/);
    assert.match(calls[1].body, /<ManufacturedMonth>01<\/ManufacturedMonth>/);
    assert.equal(calls.some((c) => c.action.endsWith("EvaluateCarFull")), false, "identyfikacja nie wyceniaje auta");

    assert.equal(result.ibsCode, "965894");
    assert.equal(result.fittedEquipmentCodes.length, 18);
    assert.equal(result.vinXml, vinXml);
    assert.equal(result.classificationXml, classificationXml);
  });

  test("fault 'brak dopasowania' (HTTP 500) to VinNotFoundError bez VIN w komunikacie", async () => {
    const vin = syntheticVin();
    const calls = stubFetch({ GetCarByVinWs: { status: 500, body: loadFixture("suzuki-not-found.vin.xml") } });

    await assert.rejects(
      () => new AudatexValuationAdapter().identifyVehicle(vin),
      (err: unknown) => {
        assert.ok(err instanceof VinNotFoundError);
        assert.ok(err instanceof NonRetryableError);
        assert.equal(err.message.includes(vin), false);
        return true;
      },
    );
    assert.equal(calls.length, 1, "VinNotFoundError nie jest ponawiany");
  });

  test("odpowiedź 200 bez IbsCode to VinNotFoundError", async () => {
    stubFetch({
      GetCarByVinWs: {
        status: 200,
        body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetCarByVinWsResponse xmlns="http://TE5.ibs-expert.cz/"><GetCarByVinWsResult/></GetCarByVinWsResponse></soap:Body></soap:Envelope>`,
      },
    });
    await assert.rejects(() => new AudatexValuationAdapter().identifyVehicle(syntheticVin()), VinNotFoundError);
  });

  test("inny błąd HTTP z Audatex to zwykły NonRetryableError (nie VinNotFoundError)", async () => {
    stubFetch({ GetCarByVinWs: { status: 401, body: "<soap:Fault><faultstring>Access denied</faultstring></soap:Fault>" } });
    await assert.rejects(
      () => new AudatexValuationAdapter().identifyVehicle(syntheticVin()),
      (err: unknown) => err instanceof NonRetryableError && !(err instanceof VinNotFoundError),
    );
  });

  test("tryb mock zwraca fixture bez wywołań sieciowych", async () => {
    process.env.AUDATEX_MOCK_MODE = "true";
    const calls = stubFetch({});
    const result = await new AudatexValuationAdapter().identifyVehicle(syntheticVin());
    assert.equal(calls.length, 0);
    assert.equal(result.ibsCode, "965392");
    assert.ok(result.fittedEquipmentCodes.includes("B1T"));
    assert.match(result.classificationXml, /GetClassificationByIBSCodeResponse/);
    assert.match(result.vinXml, /GetCarByVinWsResponse/);
  });
});

describe("AudatexValuationAdapter.evaluateVehicle po refaktorze", () => {
  test("nadal woła GetCarByVinWs -> EvaluateCarFull -> GetClassificationByIBSCode z datą pierwszej rejestracji", async () => {
    const calls = stubFetch({
      GetCarByVinWs: { status: 200, body: loadFixture("bmw-420d.vin.xml") },
      EvaluateCarFull: {
        status: 200,
        body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><EvaluateCarFullResponse xmlns="http://TE5.ibs-expert.cz/"><EvaluateCarFullResult><CVv>100000.00</CVv><COBv>60000.00</COBv><THv>58000.00</THv></EvaluateCarFullResult></EvaluateCarFullResponse></soap:Body></soap:Envelope>`,
      },
      GetClassificationByIBSCode: { status: 200, body: loadFixture("bmw-420d.cls.xml") },
    });

    const result = await new AudatexValuationAdapter().evaluateVehicle({
      vin: syntheticVin(),
      dateOfFirstReg: "2019-05-10",
      manufactureDate: "2019-03-01",
    });

    assert.deepEqual(calls.map((c) => c.action.split("/").pop()), ["GetCarByVinWs", "EvaluateCarFull", "GetClassificationByIBSCode"]);
    assert.match(calls[0].body, /<te5:dateOfFirstReg>2019-05-10<\/te5:dateOfFirstReg>/);
    assert.match(calls[2].body, /<ManufacturedYear>2019<\/ManufacturedYear>/);
    assert.match(calls[2].body, /<ManufacturedMonth>03<\/ManufacturedMonth>/);
    assert.equal(result.ibsCode, "965894");
    assert.equal(result.make, "BMW");
    assert.equal(result.newPriceCv, 100000);
    assert.equal(result.marketPriceCob, 60000);
    assert.equal(result.technicalValueTh, 58000);
    assert.equal(result.technicalSpec?.fuelType, "Diesel");
  });

  test("brak IbsCode nadal daje NonRetryableError z dotychczasowym komunikatem (nie VinNotFoundError)", async () => {
    stubFetch({
      GetCarByVinWs: {
        status: 200,
        body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetCarByVinWsResponse xmlns="http://TE5.ibs-expert.cz/"><GetCarByVinWsResult/></GetCarByVinWsResponse></soap:Body></soap:Envelope>`,
      },
    });
    await assert.rejects(
      () => new AudatexValuationAdapter().evaluateVehicle({ vin: syntheticVin(), dateOfFirstReg: "2019-05-10" }),
      (err: unknown) =>
        err instanceof NonRetryableError &&
        !(err instanceof VinNotFoundError) &&
        err.message === "AUDATEX_VALUATION_ERROR: Identyfikacja AUDAVIN nie zwróciła IBSCode dla podanego VIN.",
    );
  });

  test("fault 'brak dopasowania' w evaluateVehicle zachowuje dotychczasowy komunikat HTTP 500", async () => {
    stubFetch({ GetCarByVinWs: { status: 500, body: loadFixture("suzuki-not-found.vin.xml") } });
    await assert.rejects(
      () => new AudatexValuationAdapter().evaluateVehicle({ vin: syntheticVin(), dateOfFirstReg: "2019-05-10" }),
      (err: unknown) =>
        err instanceof NonRetryableError &&
        !(err instanceof VinNotFoundError) &&
        err.message === "AUDATEX_VALUATION_ERROR: Błąd komunikacji z serwisem wycen Audatex (HTTP 500).",
    );
  });
});
