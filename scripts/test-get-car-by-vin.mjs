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

async function testGetCarByVin(vin, firstReg) {
  const endpoint = process.env.AUDATEX_VALUATION_ENDPOINT || "https://te5adxwseu.taxexpert.cz/TE5_AUDAVIN_Service.asmx";
  const marketCode = "PL";
  const language = "PL";

  const body = `
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:te5="http://TE5.ibs-expert.cz/">
      <soapenv:Header/>
      <soapenv:Body>
        <te5:GetCarByVinWs>
          <te5:vin>${vin}</te5:vin>
          <te5:language>${language}</te5:language>
          <te5:marketCode>${marketCode}</te5:marketCode>
          <te5:dateOfFirstReg>${firstReg}</te5:dateOfFirstReg>
          <te5:certificateHash>${process.env.AUDATEX_CERTIFICATE_HASH || ""}</te5:certificateHash>
          <te5:licenceNumber>${process.env.AUDATEX_LICENCE_NUMBER || ""}</te5:licenceNumber>
        </te5:GetCarByVinWs>
      </soapenv:Body>
    </soapenv:Envelope>
  `;

  console.log("Endpoint:", endpoint);
  console.log("CertificateHash present:", Boolean(process.env.AUDATEX_CERTIFICATE_HASH));
  console.log("LicenceNumber present:", Boolean(process.env.AUDATEX_LICENCE_NUMBER));

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://TE5.ibs-expert.cz/GetCarByVinWs",
    },
    body,
  });

  console.log("HTTP Status:", res.status, res.statusText);
  const text = await res.text();
  console.log("Response text:\n", text);
}

testGetCarByVin("WBA4K51010BB10986", "2017-11-15").catch(console.error);
