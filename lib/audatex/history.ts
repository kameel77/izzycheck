import { XMLParser } from "fast-xml-parser";
import { ClaimCheckInput, ClaimCheckResult, ClaimDetailsResult, DamageClaimDetail, NonRetryableError } from "./types.ts";
import {
  CHE_HAS_HISTORY_POSITIVE_RESPONSE,
  CHE_HAS_HISTORY_NEGATIVE_RESPONSE,
  CHE_GET_DETAILS_RESPONSE,
} from "./fixtures.ts";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export class AudatexHistoryAdapter {
  private isMockMode: boolean;
  private timeoutMs: number;
  private maxRetries: number;

  constructor() {
    this.isMockMode = process.env.AUDATEX_MOCK_MODE === "true";
    this.timeoutMs = parseInt(process.env.AUDATEX_TIMEOUT_MS || "15000", 10);
    this.maxRetries = parseInt(process.env.AUDATEX_MAX_RETRIES || "2", 10);
  }

  public getIsMockMode(): boolean {
    return this.isMockMode;
  }

  /**
   * Moduł 2: Kontrola obecności historii szkód (hasHistory)
   */
  async checkClaimHistory(input: ClaimCheckInput): Promise<ClaimCheckResult> {
    if (this.isMockMode) {
      const mockXml = input.vin.startsWith("WVW")
        ? CHE_HAS_HISTORY_NEGATIVE_RESPONSE
        : CHE_HAS_HISTORY_POSITIVE_RESPONSE;
      return this.parseHasHistoryXml(mockXml);
    }

    const endpoint = process.env.AUDATEX_CHE_ENDPOINT || "https://vin-history-v2.eu.solera.com/service/ExternalVin";
    const country = input.country || process.env.AUDATEX_CHE_COUNTRY || "pl";
    const currency = input.currency || process.env.AUDATEX_CHE_CURRENCY || "PLN";

    const body = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:HistoryWSDL">
        <soapenv:Header/>
        <soapenv:Body>
          <urn:hasHistoryRequest>
            <urn:requestParam>
              <urn:username>${process.env.AUDATEX_CHE_USERNAME || ""}</urn:username>
              <urn:password>${process.env.AUDATEX_CHE_PASSWORD || ""}</urn:password>
              <urn:country>${country}</urn:country>
              <urn:currency>${currency}</urn:currency>
              <urn:vin>${input.vin}</urn:vin>
              ${input.firstRegistration ? `<urn:firstRegistration>${input.firstRegistration}</urn:firstRegistration>` : ""}
              <urn:showIsMileage>true</urn:showIsMileage>
              <urn:showVinType>true</urn:showVinType>
              <urn:withPhotos>false</urn:withPhotos>
            </urn:requestParam>
          </urn:hasHistoryRequest>
        </soapenv:Body>
      </soapenv:Envelope>
    `;

    const responseText = await this.postSoapWithRetry(endpoint, body);
    return this.parseHasHistoryXml(responseText);
  }

  /**
   * Moduł 3: Szczegóły szkód (getDetails) - wymaga uprzedniego sprawdzania z wynikiem dodatnim
   */
  async getClaimDetails(input: ClaimCheckInput): Promise<ClaimDetailsResult> {
    if (this.isMockMode) {
      return this.parseGetDetailsXml(CHE_GET_DETAILS_RESPONSE);
    }

    const endpoint = process.env.AUDATEX_CHE_ENDPOINT || "https://vin-history-v2.eu.solera.com/service/ExternalVin";
    const country = input.country || process.env.AUDATEX_CHE_COUNTRY || "pl";
    const currency = input.currency || process.env.AUDATEX_CHE_CURRENCY || "PLN";

    const body = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:HistoryWSDL">
        <soapenv:Header/>
        <soapenv:Body>
          <urn:getDetailsRequest>
            <urn:requestParam>
              <urn:username>${process.env.AUDATEX_CHE_USERNAME || ""}</urn:username>
              <urn:password>${process.env.AUDATEX_CHE_PASSWORD || ""}</urn:password>
              <urn:country>${country}</urn:country>
              <urn:currency>${currency}</urn:currency>
              <urn:vin>${input.vin}</urn:vin>
              ${input.firstRegistration ? `<urn:firstRegistration>${input.firstRegistration}</urn:firstRegistration>` : ""}
              <urn:showIsMileage>true</urn:showIsMileage>
              <urn:showVinType>true</urn:showVinType>
            </urn:requestParam>
          </urn:getDetailsRequest>
        </soapenv:Body>
      </soapenv:Envelope>
    `;

    const responseText = await this.postSoapWithRetry(endpoint, body);
    return this.parseGetDetailsXml(responseText);
  }

  private parseHasHistoryXml(xmlText: string): ClaimCheckResult {
    const outerObj = xmlParser.parse(xmlText);
    const returnVal = outerObj["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"]?.["ns2:hasHistoryResponse"]?.["ns2:hasHistoryReturn"];

    if (!returnVal) {
      throw new NonRetryableError("AUDATEX_CHE_ERROR: Brak odpowiedzi hasHistoryReturn w komunikacie SOAP CHE.");
    }

    const innerXml = typeof returnVal === "string" ? returnVal : String(returnVal);
    const innerObj = xmlParser.parse(innerXml);
    const rootNode = innerObj["claim-history"];

    if (!rootNode) {
      throw new NonRetryableError("AUDATEX_CHE_ERROR: Wewnętrzny XML CDATA nie zawiera elementu claim-history.");
    }

    const hasHistory = String(rootNode["result"]) === "true";
    const photosStatus = rootNode["photosStatus"] || "NO_PHOTOS";

    return {
      hasHistory,
      isShortVin: String(rootNode["resultShortVIN"]) === "true",
      isFullVin: String(rootNode["resultFullVIN"]) === "true",
      isMileageAvailable: String(rootNode["isMileage"]) === "true",
      photosStatus,
      photosIdentifier: rootNode["photosIdentifier"] ? String(rootNode["photosIdentifier"]) : undefined,
      advice: rootNode["advice"] ? String(rootNode["advice"]) : undefined,
    };
  }

  private parseGetDetailsXml(xmlText: string): ClaimDetailsResult {
    const outerObj = xmlParser.parse(xmlText);
    const returnVal = outerObj["SOAP-ENV:Envelope"]?.["SOAP-ENV:Body"]?.["ns2:getDetailsResponse"]?.["ns2:getDetailsReturn"];

    if (!returnVal) {
      throw new NonRetryableError("AUDATEX_CHE_ERROR: Brak odpowiedzi getDetailsReturn w komunikacie SOAP CHE.");
    }

    const innerXml = typeof returnVal === "string" ? returnVal : String(returnVal);
    const innerObj = xmlParser.parse(innerXml);
    const resultNode = innerObj["claim-history"]?.["result"];

    if (!resultNode) {
      return { claims: [] };
    }

    const rawClaims = Array.isArray(resultNode["claim"])
      ? resultNode["claim"]
      : resultNode["claim"]
      ? [resultNode["claim"]]
      : [];

    const claims: DamageClaimDetail[] = rawClaims.map((c: any) => {
      const claimId = String(c["@_id"] || c["id"] || `claim-${Math.random().toString(36).substring(2, 9)}`);
      const claimInner = c["claim"] || {};
      const assessment = c["assessment"] || {};
      const vehicle = c["vehicle"] || {};
      const damage = c["damage"] || {};

      const mandateCode = String(assessment["mandate"]?.["code"] || claimInner["technical-control"]?.["code"] || "");
      const mandateDesc = this.translateMandateCode(mandateCode);

      const damagePositionsStr = String(assessment["damage-positions"] || "");
      const affectedZones = this.translateDamagePositions(damagePositionsStr, damage);

      const damageGroupsStr = String(assessment["damage-groups"] || "");
      const significantParts = this.translateSignificantParts(damageGroupsStr);

      const damageVal = parseFloat(assessment["damage-value"] || 0);

      return {
        claimId,
        accidentDate: claimInner["accident-date"] ? String(claimInner["accident-date"]) : undefined,
        creationDate: c["creation"] ? String(c["creation"]) : undefined,
        country: c["country"] ? String(c["country"]) : undefined,
        makeModel: vehicle["car-manufacturer"]
          ? `${vehicle["car-manufacturer"]} ${vehicle["car-model"] || ""}`.trim()
          : undefined,
        mileage: vehicle["mileage"] ? parseInt(vehicle["mileage"], 10) : undefined,
        damageValue: damageVal,
        currency: assessment["currency"] ? String(assessment["currency"]) : "PLN",
        isTotalLoss: mandateCode === "RW" || mandateCode === "SE" || mandateCode === "A0" || mandateCode === "1" || mandateCode === "6" || mandateCode === "15",
        mandateCode,
        mandateDescription: mandateDesc,
        affectedZones,
        significantParts,
      };
    });

    return { claims };
  }

  public async postSoapWithRetry(url: string, body: string): Promise<string> {
    let lastError: any = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const errText = await res.text();
          // Log raw technical details on server side ONLY
          console.error(`[AUDATEX_CHE_SOAP_ERROR ${res.status}]:`, errText);

          // Return sanitized user-safe error message to client without raw XML
          const sanitizedMessage = `AUDATEX_CHE_ERROR: Błąd serwera historii szkód Audatex (HTTP ${res.status}).`;
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
          lastError = new Error(`AUDATEX_TIMEOUT_ERROR: Przekroczono limit czasu oczekiwania SOAP CHE (${this.timeoutMs}ms).`);
        }
        if (attempt === this.maxRetries) break;
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }

    throw lastError || new Error(`AUDATEX_CHE_ERROR: Usługa Audatex CHE SOAP nie odpowiedziała.`);
  }

  public translateMandateCode(code: string): string {
    if (!code) return "Brak kodu mandatu";

    const dict: Record<string, string> = {
      "2": "Pojazd skradziony i nieodzyskany",
      "3": "Szkoda pożarowa",
      "3G": "Pożar – ustalona przyczyna",
      "3H": "Pożar – nieustalona przyczyna",
      "3I": "Pożar – wybuch",
      "4": "Zalanie / zatopienie",
      "5": "Szkoda szyby",
      "5J": "Szkoda szyby – uderzenie kamieniem",
      "5K": "Szkoda szyby – bez uderzenia kamieniem",
      "7": "Klęska żywiołowa",
      "9": "Inne zdarzenie",
      "A": "Kradzież (ARGOS)",
      "B": "Wada fabryczna / ukryta",
      "C": "Awaria mechaniczna",
      "D": "Szkoda komunikacyjna",
      "D1": "Kolizja drogowa",
      "D2": "Karambol / zderzenie łańcuchowe",
      "D3": "Wielokrotny wypad",
      "D4": "Utrata panowania nad pojazdem",
      "DE": "Anulowanie statusu szkody całkowitej",
      "DV": "Anulowanie statusu skradzionego",
      "E": "Szkoda parkingowa",
      "E1": "Kolizja parkingowa",
      "E2": "Zderzenie łańcuchowe na parkingu",
      "E3": "Stłuczka parkingowa wielokrotna",
      "E4": "Uderzenie w przeszkodę na parkingu",
      "F": "Usiłowanie kradzieży",
      "F5": "Usiłowanie kradzieży z włamaniem",
      "F6": "Usiłowanie kradzieży bez włamania",
      "H": "Pojazd odzyskany po kradzieży",
      "H5": "Pojazd odzyskany po kradzieży",
      "H6": "Pojazd odzyskany po kradzieży",
      "J": "Wandalizm",
      "K": "Zamach / zamieszki / terroryzm",
      "P": "Zjawisko atmosferyczne",
      "PA": "Szkoda burzowa / huragan",
      "PB": "Szkoda opadowa / śnieg",
      "PC": "Szkoda gradowa",
      "PD": "Tsunami / fala morska",
      "PE": "Powódź",
      "R": "Awaria mechaniczna",
      "SE": "Zgłoszenie szkody całkowitej",
      "SV": "Zgłoszenie kradzieży",
      "RW": "Aukcja AON – Szkoda całkowita",
      "FL": "Kalkulacja flotowa",
      "1": "USA: Szkoda całkowita (Total loss)",
      "6": "USA: Szkoda całkowita",
      "15": "USA: Szkoda całkowita",
      "22": "USA: Całkowity pożar",
      "A0": "Belgia: Szkoda całkowita",
      "27": "Belgia: Wandalizm",
      "30": "Belgia: Pożar",
      "40": "Belgia: Kradzież",
    };

    return dict[code] || `Kod mandatu: ${code}`;
  }

  public translateDamagePositions(positionsStr: string, damageNode: any): string[] {
    const zonesMap: Record<string, string> = {
      "01": "Przód lewa góra",
      "02": "Przód lewy środek",
      "03": "Przód lewy dół",
      "04": "Przód prawa góra",
      "05": "Przód prawy środek",
      "06": "Przód prawy dół",
      "07": "Przód środek góra",
      "08": "Przód środek środek",
      "09": "Przód środek dół",
      "10": "Środek lewy góra",
      "11": "Środek lewy środek",
      "12": "Środek lewy dół",
      "13": "Środek prawy góra",
      "14": "Środek prawy środek",
      "15": "Środek prawy dół",
      "16": "Dach / środek góra",
      "17": "Kabinowe wnętrze",
      "18": "Podwozie środek",
      "19": "Tył lewy góra",
      "20": "Tył lewy środek",
      "21": "Tył lewy dół",
      "22": "Tył prawy góra",
      "23": "Tył prawy środek",
      "24": "Tył prawy dół",
      "25": "Tył środek góra",
      "26": "Tył środek środek",
      "27": "Tył środek dół",
    };

    const results: string[] = [];

    if (positionsStr) {
      const tokens = positionsStr.split(",").map(t => t.trim());
      for (const t of tokens) {
        if (zonesMap[t]) results.push(zonesMap[t]);
      }
    }

    const gen = damageNode?.["general"];
    if (gen) {
      if (gen["front"] === "Y" && !results.includes("Przód (Ogólne)")) results.push("Przód (Ogólne)");
      if (gen["front-left"] === "Y" && !results.includes("Przód lewy (Ogólne)")) results.push("Przód lewy (Ogólne)");
      if (gen["front-right"] === "Y" && !results.includes("Przód prawy (Ogólne)")) results.push("Przód prawy (Ogólne)");
      if (gen["rear"] === "Y" && !results.includes("Tył (Ogólne)")) results.push("Tył (Ogólne)");
      if (gen["interior"] === "Y" && !results.includes("Wnętrze")) results.push("Wnętrze");
      if (gen["underbody"] === "Y" && !results.includes("Podwozie")) results.push("Podwozie");
      if (gen["mechanical"] === "Y" && !results.includes("Zespół mechaniczny")) results.push("Zespół mechaniczny");
    }

    const glass = damageNode?.["glass"];
    if (glass) {
      if (glass["front"] === "Y") results.push("Szyba przednia");
      if (glass["rear"] === "Y") results.push("Szyba tylna");
      if (glass["side-left"] === "Y") results.push("Szyby boczne lewe");
      if (glass["side-right"] === "Y") results.push("Szyby boczne prawe");
    }

    return results;
  }

  public translateSignificantParts(groupsStr: string): string[] {
    const groupsMap: Record<string, string> = {
      "001": "Systemy bezpieczeństwa biernego (Airbag / Pasy)",
      "002": "Systemy bezpieczeństwa czynnego (ABS / ESP)",
      "003": "Układ zawieszenia i jezdny",
      "004": "Elementy poszycia zewnętrznego nadwozia",
      "005": "Konstrukcja nośna nadwozia / rama",
      "006": "Oświetlenie zewnętrzne",
      "007": "Oszklenie nadwozia",
      "008": "Układ hamulcowy",
      "009": "Układ chłodzenia i klimatyzacji",
      "011": "Tapicerka i wykończenie wnętrza",
      "012": "Osprzęt silnika",
      "013": "Skrzynia biegów i układ przeniesienia napędu",
      "014": "Układ kierowniczy",
      "015": "Układ elektryczny / wysokie napięcie (EV / Hybrid)",
    };

    if (!groupsStr) return [];
    const tokens = groupsStr.split(",").map(t => t.trim());
    return tokens.map(t => groupsMap[t] || `Grupa części: ${t}`).filter(Boolean);
  }
}
