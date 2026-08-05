import { XMLParser } from "fast-xml-parser";
import { VinValuationInput, ValuationResult, EquipmentItem } from "./types.ts";
import {
  AUDAVIN_GET_CAR_BY_VIN_RESPONSE,
  AUDAVALUATION_EVALUATE_CAR_RESPONSE,
  VEHICLE_DATA_CLASSIFICATION_RESPONSE,
} from "./fixtures.ts";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export class AudatexValuationAdapter {
  private isMockMode: boolean;
  private timeoutMs: number;
  private maxRetries: number;

  constructor() {
    // Mock mode is enabled ONLY if explicitly set to "true"
    this.isMockMode = process.env.AUDATEX_MOCK_MODE === "true";
    this.timeoutMs = parseInt(process.env.AUDATEX_TIMEOUT_MS || "15000", 10);
    this.maxRetries = parseInt(process.env.AUDATEX_MAX_RETRIES || "2", 10);
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

    const marketCode = input.marketCode || process.env.AUDATEX_MARKET_CODE || "PL";
    const language = input.language || process.env.AUDATEX_LANGUAGE || "PL";

    // Live SOAP Calls with timeout & retry
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
    };
  }

  private async getCarByVinWs(input: VinValuationInput, marketCode: string, language: string) {
    const endpoint = process.env.AUDATEX_VALUATION_ENDPOINT || "https://te5adxwseu.taxexpert.cz/TE5_AUDAVIN_Service.asmx";
    const body = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:te5="http://TE5.ibs-expert.cz/">
        <soapenv:Header/>
        <soapenv:Body>
          <te5:GetCarByVinWs>
            <te5:vin>${input.vin}</te5:vin>
            <te5:language>${language}</te5:language>
            <te5:marketCode>${marketCode}</te5:marketCode>
            <te5:dateOfFirstReg>${input.dateOfFirstReg}</te5:dateOfFirstReg>
            <te5:certificateHash>${process.env.AUDATEX_CERTIFICATE_HASH || ""}</te5:certificateHash>
            <te5:licenceNumber>${process.env.AUDATEX_LICENCE_NUMBER || ""}</te5:licenceNumber>
          </te5:GetCarByVinWs>
        </soapenv:Body>
      </soapenv:Envelope>
    `;

    const responseText = await this.postSoapWithRetry(endpoint, body, "http://TE5.ibs-expert.cz/GetCarByVinWs");
    const parsed = xmlParser.parse(responseText);
    const resultNode = parsed["soap:Envelope"]?.["soap:Body"]?.["GetCarByVinWsResponse"]?.["GetCarByVinWsResult"];

    if (!resultNode || !resultNode["IbsCode"]) {
      throw new Error("Identyfikacja AUDAVIN nie zwróciła IBSCode dla podanego VIN.");
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
    const endpoint = process.env.AUDATEX_VALUATION_SERVICE_ENDPOINT || "https://te5wseu.taxexpert.cz/TE5_EvaluationServices.asmx";
    const valuationDate = input.valuationDate || new Date().toISOString().split("T")[0];

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
              <IBSCode>${ibsCode}</IBSCode>
              <DV>${input.dateOfFirstReg}</DV>
              <DO>${valuationDate}</DO>
              <KPS>${input.mileage || 0}</KPS>
              <Equipments>${eqXml}</Equipments>
              <EquipmentPackets>${pktXml}</EquipmentPackets>
            </car>
            <certificateHash>${process.env.AUDATEX_CERTIFICATE_HASH || ""}</certificateHash>
            <licenceNumber>${process.env.AUDATEX_LICENCE_NUMBER || ""}</licenceNumber>
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
    const endpoint = process.env.AUDATEX_VEHICLE_DATA_ENDPOINT || "https://te5wseu.taxexpert.cz/TE5_VehicleData.asmx";
    
    // Separation: Use explicit manufactureDate if supplied, otherwise do not send unconfirmed production date
    let monthXml = "";
    let yearXml = "";
    if (input.manufactureDate && /^\d{4}-\d{2}/.test(input.manufactureDate)) {
      const [y, m] = input.manufactureDate.split("-");
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
            <IBSCode>${ibsCode}</IBSCode>
            <certificateHash>${process.env.AUDATEX_CERTIFICATE_HASH || ""}</certificateHash>
            <licenceNumber>${process.env.AUDATEX_LICENCE_NUMBER || ""}</licenceNumber>
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

    const params = resultNode?.["CarInfo"]?.["Parameteres"]?.["Parameter"];
    if (Array.isArray(params)) {
      for (const p of params) {
        const desc = p["Description"];
        const val = p["Value"];
        if (desc === "manufacturerName") make = val;
        if (desc === "modelName") model = val;
        if (desc === "typeName") variant = val;
      }
    }

    const equipmentsRaw = resultNode?.["Equipment"];
    const standardEquipment: EquipmentItem[] = [];
    const optionalEquipment: EquipmentItem[] = [];

    if (Array.isArray(equipmentsRaw)) {
      for (const eq of equipmentsRaw) {
        const item: EquipmentItem = {
          code: String(eq["Code"] || ""),
          name: String(eq["Name"] || ""),
          type: eq["EquipmentType"] === "Standard" ? "Standard" : "Optional",
        };

        if (item.type === "Standard") standardEquipment.push(item);
        else optionalEquipment.push(item);
      }
    }

    return { make, model, variant, standardEquipment, optionalEquipment };
  }

  private async postSoapWithRetry(url: string, body: string, soapAction: string): Promise<string> {
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
          throw new Error(`SOAP Fault (${res.status}): ${errText}`);
        }

        return await res.text();
      } catch (err: any) {
        clearTimeout(timer);
        lastError = err;
        if (attempt === this.maxRetries) break;
        // Exponential backoff
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }

    throw new Error(`Usługa AudaValuation SOAP nie odpowiedziała po ${this.maxRetries} próbach. Błąd: ${lastError?.message || lastError}`);
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
    };
  }
}
