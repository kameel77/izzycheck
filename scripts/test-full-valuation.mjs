import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AudatexValuationAdapter } from "../lib/audatex/valuation.ts";

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

async function testFullValuation() {
  const adapter = new AudatexValuationAdapter();
  console.log("Mock Mode:", adapter.getIsMockMode());
  console.log("AUDATEX_CERTIFICATE_HASH:", process.env.AUDATEX_CERTIFICATE_HASH ? "SET" : "MISSING");
  console.log("AUDATEX_LICENCE_NUMBER:", process.env.AUDATEX_LICENCE_NUMBER ? "SET" : "MISSING");
  console.log("AUDATEX_VALUATION_ENDPOINT:", process.env.AUDATEX_VALUATION_ENDPOINT);
  console.log("AUDATEX_VALUATION_SERVICE_ENDPOINT:", process.env.AUDATEX_VALUATION_SERVICE_ENDPOINT);
  console.log("AUDATEX_VEHICLE_DATA_ENDPOINT:", process.env.AUDATEX_VEHICLE_DATA_ENDPOINT);

  try {
    const res = await adapter.evaluateVehicle({
      vin: "WBA4K51010BB10986",
      dateOfFirstReg: "2017-11-15",
      mileage: 245200,
      valuationDate: "2026-08-26",
    });

    console.log("Valuation succeeded:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Valuation failed with error:", err);
  }
}

testFullValuation();
