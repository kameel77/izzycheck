/**
 * Ręczny test identyfikacji VIN na realnym Audatex (bez zapisu do bazy).
 * Użycie: npx tsx scripts/identify-vin.ts <VIN>
 * Wypisuje JSON w kontrakcie ExternalVinIdentification (czyta AUDATEX_* z `.env`).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AudatexValuationAdapter } from "../lib/audatex/valuation.ts";
import { toExternalVinIdentification } from "../lib/integrations/mamygo/mapper.ts";
import { validateVinRequest } from "../lib/integrations/mamygo/request.ts";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

async function main() {
  const validation = validateVinRequest({ vin: process.argv[2] });
  if (!validation.ok) {
    console.error(`Użycie: npx tsx scripts/identify-vin.ts <VIN>\n${validation.message}`);
    process.exit(1);
  }

  const raw = await new AudatexValuationAdapter().identifyVehicle(validation.vin);
  console.log(JSON.stringify(toExternalVinIdentification(validation.vin, raw), null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
