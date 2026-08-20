#!/usr/bin/env node
/**
 * scripts/dump-classification-params.mjs
 * 
 * Diagnostic script for Audatex GetClassificationByIBSCode SOAP service.
 * Used to verify real vendor Description keys across languages (PL vs EN)
 * and diverse vehicle powertrains (Petrol, Diesel, EV).
 * 
 * Usage:
 *   node scripts/dump-classification-params.mjs
 *   node scripts/dump-classification-params.mjs --ibs=965392 --lang=PL
 *   node scripts/dump-classification-params.mjs --ibs=965392 --lang=EN
 */

import { XMLParser } from "fast-xml-parser";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");

if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

// Default sample IBS codes to test across powertrains if not specified via CLI
const SAMPLE_VEHICLES = [
  { label: "Petrol / Benzyna (e.g. BMW 428i)", ibsCode: "965392", month: "04", year: "2021" },
  { label: "Diesel / Olej napędowy (Sample)", ibsCode: "912345", month: "06", year: "2020" },
  { label: "Electric / Elektryczny (Sample)", ibsCode: "987654", month: "10", year: "2022" },
];

async function callClassification(ibsCode, language, marketCode, month, year) {
  const endpoint = process.env.AUDATEX_VEHICLE_DATA_ENDPOINT || "https://te5wseu.taxexpert.cz/TE5_VehicleData.asmx";
  const certHash = process.env.AUDATEX_CERTIFICATE_HASH || "";
  const licenceNo = process.env.AUDATEX_LICENCE_NUMBER || "";

  const monthXml = month ? `<ManufacturedMonth>${month}</ManufacturedMonth>` : "";
  const yearXml = year ? `<ManufacturedYear>${year}</ManufacturedYear>` : "";

  const soapBody = `
    <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <SOAP-ENV:Header/>
      <SOAP-ENV:Body>
        <GetClassificationByIBSCode xmlns="http://TE5.ibs-expert.cz/">
          <marketCode>${marketCode}</marketCode>
          <language>${language}</language>
          ${monthXml}
          ${yearXml}
          <IBSCode>${ibsCode}</IBSCode>
          <certificateHash>${certHash}</certificateHash>
          <licenceNumber>${licenceNo}</licenceNumber>
        </GetClassificationByIBSCode>
      </SOAP-ENV:Body>
    </SOAP-ENV:Envelope>
  `;

  console.log(`\n======================================================`);
  console.log(`Calling GetClassificationByIBSCode [IBS: ${ibsCode}, Lang: ${language}, Market: ${marketCode}]`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`======================================================`);

  if (!certHash && process.env.AUDATEX_MOCK_MODE === "true") {
    console.log("⚠️ AUDATEX_MOCK_MODE=true or no credentials configured. Returning mock/fixture analysis.");
    return null;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://TE5.ibs-expert.cz/GetClassificationByIBSCode",
    },
    body: soapBody,
  });

  if (!res.ok) {
    console.error(`❌ HTTP Error: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error(`Response body:\n${text}`);
    return null;
  }

  const xml = await res.text();
  const parsed = parser.parse(xml);
  const resultNode = parsed["soap:Envelope"]?.["soap:Body"]?.["GetClassificationByIBSCodeResponse"]?.["GetClassificationByIBSCodeResult"]?.["ResultedTypes"];

  const params = resultNode?.["CarInfo"]?.["Parameteres"]?.["Parameter"];
  const paramsList = Array.isArray(params) ? params : params ? [params] : [];

  console.log(`\nFound ${paramsList.length} parameters:`);
  console.table(
    paramsList.map((p) => ({
      Id: p["Id"],
      Description: p["Description"],
      Value: p["Value"],
    }))
  );

  return { xml, paramsList };
}

async function run() {
  const args = process.argv.slice(2);
  const customIbs = args.find((a) => a.startsWith("--ibs="))?.split("=")[1];
  const customLang = args.find((a) => a.startsWith("--lang="))?.split("=")[1];

  const languages = customLang ? [customLang.toUpperCase()] : ["PL", "EN"];
  const targets = customIbs
    ? [{ label: `Custom IBS ${customIbs}`, ibsCode: customIbs, month: "01", year: "2022" }]
    : SAMPLE_VEHICLES;

  console.log("🚀 Starting Audatex Classification Parameters Inspection...");

  for (const target of targets) {
    console.log(`\n--- Inspecting: ${target.label} (IBS: ${target.ibsCode}) ---`);
    for (const lang of languages) {
      try {
        await callClassification(target.ibsCode, lang, "PL", target.month, target.year);
      } catch (err) {
        console.error(`Error calling for IBS ${target.ibsCode} in ${lang}:`, err.message);
      }
    }
  }

  console.log("\n✅ Parameter dump script completed.");
}

run().catch(console.error);
