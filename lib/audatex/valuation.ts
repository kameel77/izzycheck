import { XMLParser } from "fast-xml-parser";
import { createHash } from "crypto";
import { VinValuationInput, ValuationResult, EquipmentItem, NonRetryableError } from "./types.ts";
import {
  AUDAVIN_GET_CAR_BY_VIN_RESPONSE,
  AUDAVALUATION_EVALUATE_CAR_RESPONSE,
  VEHICLE_DATA_CLASSIFICATION_RESPONSE,
} from "./fixtures.ts";

function cleanEnv(val: string | undefined, defaultVal = ""): string {
  if (!val) return defaultVal;
  return val.trim().replace(/^["']|["']$/g, "");
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export class AudatexValuationAdapter {
  private isMockMode: boolean;
  private timeoutMs: number;
  private maxRetries: number;

  constructor() {
    this.isMockMode = cleanEnv(process.env.AUDATEX_MOCK_MODE) === "true";
    this.timeoutMs = parseInt(cleanEnv(process.env.AUDATEX_TIMEOUT_MS, "15000"), 10);
    this.maxRetries = parseInt(cleanEnv(process.env.AUDATEX_MAX_RETRIES, "2"), 10);
  }

  public getIsMockMode(): boolean {
    return this.isMockMode;
  }

  /**
   * Evaluates vehicle: GetCarByVinWs -> EvaluateCarFull -> GetClassificationByIBSCode
   */
  async evaluateVehicle(input: VinValuationInput): Promise<ValuationResult> {
    if (this.isMockMode) {
      return this.parseMockValuation(input);
    }

    const marketCode = cleanEnv(input.marketCode || process.env.AUDATEX_MARKET_CODE, "PL");
    const language = cleanEnv(input.language || process.env.AUDATEX_LANGUAGE, "PL");

    const carVinResult = await this.getCarByVinWs(input, marketCode, language);
    const evaluationResult = await this.evaluateCarFull(input, carVinResult.ibsCode, carVinResult.equipments, carVinResult.packets, language);
    const classificationResult = await this.getClassificationByIBSCode(input, carVinResult.ibsCode, marketCode, language);

    return {
      ibsCode: carVinResult.ibsCode,
      make: classificationResult.make || "Nieznana",
      model: classificationResult.model || "Nieznany",
      variant: classificationResult.variant || "",
      newPriceCv: evaluationResult.newPriceCv,
      marketPriceCob: evaluationResult.marketPriceCob,
      technicalValueTh: evaluationResult.technicalValueTh,
      mileageUsed: input.mileage && input.mileage > 0 ? input.mileage : 0,
      isAverageMileageUsed: !input.mileage || input.mileage === 0,
      manufactureDate: input.manufactureDate || undefined,
      standardEquipment: classificationResult.standardEquipment,
      optionalEquipment: classificationResult.optionalEquipment,
      technicalSpec: classificationResult.technicalSpec,
    };
  }

  private async getCarByVinWs(input: VinValuationInput, marketCode: string, language: string) {
    const endpoint = cleanEnv(process.env.AUDATEX_VALUATION_ENDPOINT, "https://te5adxwseu.taxexpert.cz/TE5_AUDAVIN_Service.asmx");
    const certHash = cleanEnv(process.env.AUDATEX_CERTIFICATE_HASH);
    const licenceNumber = cleanEnv(process.env.AUDATEX_LICENCE_NUMBER);

    const body = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:te5="http://TE5.ibs-expert.cz/">
        <soapenv:Header/>
        <soapenv:Body>
          <te5:GetCarByVinWs>
            <te5:vin>${input.vin.trim()}</te5:vin>
            <te5:language>${language}</te5:language>
            <te5:marketCode>${marketCode}</te5:marketCode>
            <te5:dateOfFirstReg>${input.dateOfFirstReg.trim()}</te5:dateOfFirstReg>
            <te5:certificateHash>${certHash}</te5:certificateHash>
            <te5:licenceNumber>${licenceNumber}</te5:licenceNumber>
          </te5:GetCarByVinWs>
        </soapenv:Body>
      </soapenv:Envelope>
    `;

    const responseText = await this.postSoapWithRetry(endpoint, body, "http://TE5.ibs-expert.cz/GetCarByVinWs");
    const parsed = xmlParser.parse(responseText);
    const resultNode = parsed["soap:Envelope"]?.["soap:Body"]?.["GetCarByVinWsResponse"]?.["GetCarByVinWsResult"];

    if (!resultNode || !resultNode["IbsCode"]) {
      throw new NonRetryableError("AUDATEX_VALUATION_ERROR: Identyfikacja AUDAVIN nie zwróciła IBSCode dla podanego VIN.");
    }

    const eqCodes = this.extractStringArray(resultNode["AdditionalEquipmentsCodes"]);
    const packetCodes = this.extractStringArray(resultNode["AdditionalPacketCodes"]);

    return {
      ibsCode: String(resultNode["IbsCode"]),
      equipments: eqCodes,
      packets: packetCodes,
    };
  }

  private async evaluateCarFull(input: VinValuationInput, ibsCode: string, equipments: string[], packets: string[], language: string) {
    const endpoint = cleanEnv(process.env.AUDATEX_VALUATION_SERVICE_ENDPOINT, "https://te5wseu.taxexpert.cz/TE5_EvaluationServices.asmx");
    const certHash = cleanEnv(process.env.AUDATEX_CERTIFICATE_HASH);
    const licenceNumber = cleanEnv(process.env.AUDATEX_LICENCE_NUMBER);
    const valuationDate = input.valuationDate ? input.valuationDate.trim() : new Date().toISOString().split("T")[0];

    const eqXml = equipments.map(c => `
      <InputEvaluationEquipment>
        <EquipmentType>OptionalSpecified</EquipmentType>
        <Code>${c}</Code>
      </InputEvaluationEquipment>
    `).join("");

    const pktXml = packets.map(p => `
      <InputEvaluationEquipmentPacket>
        <EquipmentPacketType>Optional</EquipmentPacketType>
        <Code>${p}</Code>
      </InputEvaluationEquipmentPacket>
    `).join("");

    const body = `
      <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
        <SOAP-ENV:Header/>
        <SOAP-ENV:Body>
          <EvaluateCarFull xmlns="http://TE5.ibs-expert.cz/">
            <language>${language}</language>
            <car>
              <IBSCode>${ibsCode.trim()}</IBSCode>
              <DV>${input.dateOfFirstReg.trim()}</DV>
              <DO>${valuationDate}</DO>
              <KPS>${input.mileage || 0}</KPS>
              <Equipments>${eqXml}</Equipments>
              <EquipmentPackets>${pktXml}</EquipmentPackets>
            </car>
            <certificateHash>${certHash}</certificateHash>
            <licenceNumber>${licenceNumber}</licenceNumber>
          </EvaluateCarFull>
        </SOAP-ENV:Body>
      </SOAP-ENV:Envelope>
    `;

    const responseText = await this.postSoapWithRetry(endpoint, body, "http://TE5.ibs-expert.cz/EvaluateCarFull");
    const parsed = xmlParser.parse(responseText);
    const evalResult = parsed["soap:Envelope"]?.["soap:Body"]?.["EvaluateCarFullResponse"]?.["EvaluateCarFullResult"];

    return {
      newPriceCv: parseFloat(evalResult?.["CVv"] || 0),
      marketPriceCob: parseFloat(evalResult?.["COBv"] || 0),
      technicalValueTh: parseFloat(evalResult?.["THv"] || 0),
    };
  }

  private async getClassificationByIBSCode(input: VinValuationInput, ibsCode: string, marketCode: string, language: string) {
    const endpoint = cleanEnv(process.env.AUDATEX_VEHICLE_DATA_ENDPOINT, "https://te5wseu.taxexpert.cz/TE5_VehicleData.asmx");
    const certHash = cleanEnv(process.env.AUDATEX_CERTIFICATE_HASH);
    const licenceNumber = cleanEnv(process.env.AUDATEX_LICENCE_NUMBER);

    let monthXml = "";
    let yearXml = "";
    const dateSource = input.manufactureDate || input.dateOfFirstReg;
    if (dateSource && /^\d{4}-\d{2}/.test(dateSource.trim())) {
      const [y, m] = dateSource.trim().split("-");
      monthXml = `<ManufacturedMonth>${m}</ManufacturedMonth>`;
      yearXml = `<ManufacturedYear>${y}</ManufacturedYear>`;
    }

    const body = `
      <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
        <SOAP-ENV:Header/>
        <SOAP-ENV:Body>
          <GetClassificationByIBSCode xmlns="http://TE5.ibs-expert.cz/">
            <marketCode>${marketCode}</marketCode>
            <language>${language}</language>
            ${monthXml}
            ${yearXml}
            <IBSCode>${ibsCode.trim()}</IBSCode>
            <certificateHash>${certHash}</certificateHash>
            <licenceNumber>${licenceNumber}</licenceNumber>
          </GetClassificationByIBSCode>
        </SOAP-ENV:Body>
      </SOAP-ENV:Envelope>
    `;

    const responseText = await this.postSoapWithRetry(endpoint, body, "http://TE5.ibs-expert.cz/GetClassificationByIBSCode");
    return this.parseClassificationXml(responseText);
  }

  private parseClassificationXml(xmlText: string) {
    const parsed = xmlParser.parse(xmlText);
    const resultNode = parsed["soap:Envelope"]?.["soap:Body"]?.["GetClassificationByIBSCodeResponse"]?.["GetClassificationByIBSCodeResult"]?.["ResultedTypes"];

    let make = "";
    let model = "";
    let variant = "";

    const rawAttributes: Record<string, string> = {};
    let engineCapacityCm3: number | undefined;
    let enginePowerKw: number | undefined;
    let enginePowerHp: number | undefined;
    let isEnginePowerHpCalculated: boolean | undefined;
    let fuelType: string | undefined;
    let driveType: string | undefined;
    let gearboxType: string | undefined;
    let gearCount: number | undefined;
    let bodyType: string | undefined;
    let doorsCount: number | undefined;
    let seatsCount: number | undefined;
    let curbWeightKg: number | undefined;
    let grossWeightKg: number | undefined;
    let lengthMm: number | undefined;
    let widthMm: number | undefined;
    let heightMm: number | undefined;
    let wheelbaseMm: number | undefined;
    let wheelSize: string | undefined;
    let emissionStandard: string | undefined;
    let maxSpeedKmh: number | undefined;

    const params = resultNode?.["CarInfo"]?.["Parameteres"]?.["Parameter"];
    if (Array.isArray(params)) {
      for (const p of params) {
        const desc = String(p["Description"] || "").trim();
        const val = String(p["Value"] || "").trim();
        if (!desc) continue;

        let consumed = true;

        if (desc === "manufacturerName") {
          make = val;
        } else if (desc === "modelName") {
          model = val;
        } else if (desc === "typeName") {
          variant = val;
        } else if (desc === "engineCapacity") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) engineCapacityCm3 = num;
        } else if (desc === "engineKW" || desc === "enginePowerKw") {
          const num = parseFloat(val);
          if (!isNaN(num)) enginePowerKw = Math.round(num);
        } else if (desc === "engineHP" || desc === "enginePowerHp") {
          const num = parseFloat(val);
          if (!isNaN(num)) {
            enginePowerHp = Math.round(num);
            isEnginePowerHpCalculated = false;
          }
        } else if (desc === "engineFuelType" || desc === "fuelType") {
          if (val === "BA") fuelType = "Benzyna";
          else if (val === "NM") fuelType = "Diesel";
          else if (val === "EL") fuelType = "Elektryczny";
          else if (val === "HY") fuelType = "Hybrydowy";
          else if (val === "LPG") fuelType = "LPG / Benzyna";
          else if (val === "CNG") fuelType = "CNG";
          else fuelType = val;
        } else if (desc === "axlePowered" || desc === "driveType") {
          if (val === "4x4") driveType = "4x4";
          else if (val === "P1") driveType = "Napęd przedni (FWD)";
          else if (val === "Z1") driveType = "Napęd tylny (RWD)";
          else driveType = val;
        } else if (desc === "gearBox" || desc === "gearBoxType" || desc === "gearboxType") {
          if (val === "A") gearboxType = "Automatyczna";
          else if (val === "M") gearboxType = "Manualna";
          else if (val !== "n/a" && val) gearboxType = val;
        } else if (desc === "gearNumber" || desc === "gearCount") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) gearCount = num;
        } else if (desc === "carBodyType" || desc === "carBodyKind" || desc === "bodyType") {
          if (val === "kupe") bodyType = "Coupé";
          else if (val === "kombi") bodyType = "Kombi";
          else if (val === "sedan") bodyType = "Sedan";
          else if (val === "hatchback") bodyType = "Hatchback";
          else if (val === "suv") bodyType = "SUV";
          else bodyType = val;
        } else if (desc === "carDoorNr" || desc === "doorsCount") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) doorsCount = num;
        } else if (desc === "sittingPlaceNr" || desc === "seatsCount") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) seatsCount = num;
        } else if (desc === "weightServiceAble" || desc === "curbWeightKg") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) curbWeightKg = num;
        } else if (desc === "weightTotal" || desc === "grossWeightKg") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) grossWeightKg = num;
        } else if (desc === "length" || desc === "lengthMm") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) lengthMm = num;
        } else if (desc === "width" || desc === "widthMm") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) widthMm = num;
        } else if (desc === "height" || desc === "heightMm") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) heightMm = num;
        } else if (desc === "wheelBase" || desc === "wheelbaseMm") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) wheelbaseMm = num;
        } else if (desc === "tireFront" || desc === "wheelSize") {
          wheelSize = val;
        } else if (desc === "katalyzatorUS_EuroNorm" || desc === "emissionStandard") {
          emissionStandard = val;
        } else if (desc === "speedMax" || desc === "maxSpeedKmh") {
          const num = parseInt(val, 10);
          if (!isNaN(num)) maxSpeedKmh = num;
        } else {
          consumed = false;
          rawAttributes[desc] = val;
        }
      }
    }

    // If vendor did not provide HP directly, derive it from kW and mark as calculated
    if (enginePowerHp === undefined && enginePowerKw !== undefined) {
      enginePowerHp = Math.round(enginePowerKw * 1.35962);
      isEnginePowerHpCalculated = true;
    }

    const technicalSpec = {
      engineCapacityCm3,
      enginePowerKw,
      enginePowerHp,
      isEnginePowerHpCalculated,
      fuelType,
      driveType,
      gearboxType,
      gearCount,
      bodyType,
      doorsCount,
      seatsCount,
      curbWeightKg,
      grossWeightKg,
      lengthMm,
      widthMm,
      heightMm,
      wheelbaseMm,
      wheelSize,
      emissionStandard,
      maxSpeedKmh,
      rawAttributes: Object.keys(rawAttributes).length > 0 ? rawAttributes : undefined,
    };

    const rawEquipments = resultNode?.["CarInfo"]?.["Equipments"]?.["Equipment"] || resultNode?.["Equipment"] || resultNode?.["CarInfo"]?.["Equipment"];
    const equipmentsRaw = Array.isArray(rawEquipments) ? rawEquipments : rawEquipments ? [rawEquipments] : [];
    const standardEquipment: EquipmentItem[] = [];
    const optionalEquipment: EquipmentItem[] = [];

    for (const eq of equipmentsRaw) {
      const item: EquipmentItem = {
        code: String(eq["Code"] || ""),
        name: String(eq["Name"] || ""),
        type: eq["EquipmentType"] === "Standard" ? "Standard" : "Optional",
      };

      if (item.type === "Standard") standardEquipment.push(item);
      else optionalEquipment.push(item);
    }

    return { make, model, variant, standardEquipment, optionalEquipment, technicalSpec };
  }

  public async postSoapWithRetry(url: string, body: string, soapAction: string): Promise<string> {
    let lastError: any = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: soapAction,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const errText = await res.text();
          // SECURITY COMPLIANCE: Log ONLY operational metadata + payload hash. NEVER log raw XML/HTML body or VIN!
          const responseHash = createHash("sha256").update(errText).digest("hex").substring(0, 12);
          console.error(`[AUDATEX_VALUATION_ERROR] Service: AudaValuation | Action: ${soapAction} | HTTP Status: ${res.status} | ResponseHash: ${responseHash} | Attempt: ${attempt}`);

          const sanitizedMessage = `AUDATEX_VALUATION_ERROR: Błąd komunikacji z serwisem wycen Audatex (HTTP ${res.status}).`;
          const nonRetryable = new NonRetryableError(sanitizedMessage);

          if (res.status < 502 || res.status > 504) {
            throw nonRetryable;
          }
          lastError = nonRetryable;
        } else {
          return await res.text();
        }
      } catch (err: any) {
        clearTimeout(timer);
        if (err instanceof NonRetryableError || err.isNonRetryable) {
          throw err;
        }

        lastError = err;
        if (err.name === "AbortError") {
          lastError = new Error(`AUDATEX_TIMEOUT_ERROR: Przekroczono limit czasu oczekiwania SOAP (${this.timeoutMs}ms).`);
        }
        if (attempt === this.maxRetries) break;
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }

    throw lastError || new Error(`AUDATEX_VALUATION_ERROR: Usługa AudaValuation SOAP nie odpowiedziała.`);
  }

  private extractStringArray(node: any): string[] {
    if (!node) return [];
    const item = node["string"];
    if (Array.isArray(item)) return item.map(String);
    if (item) return [String(item)];
    return [];
  }

  private parseMockValuation(input: VinValuationInput): ValuationResult {
    const classification = this.parseClassificationXml(VEHICLE_DATA_CLASSIFICATION_RESPONSE);
    return {
      ibsCode: "965392",
      make: classification.make || "BMW",
      model: classification.model || "Seria 4 Coupé F32",
      variant: classification.variant || "428i xDrive (A8)",
      newPriceCv: 208909.0,
      marketPriceCob: 124500.0,
      technicalValueTh: 121000.0,
      mileageUsed: input.mileage && input.mileage > 0 ? input.mileage : 0,
      isAverageMileageUsed: !input.mileage || input.mileage === 0,
      manufactureDate: input.manufactureDate || undefined,
      standardEquipment: classification.standardEquipment,
      optionalEquipment: classification.optionalEquipment,
      technicalSpec: classification.technicalSpec,
    };
  }
}
