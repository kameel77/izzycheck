import { createHash } from "crypto";

export function computeRequestHash(payload: any): string {
  const normalized = JSON.stringify({
    vin: payload.vin,
    firstRegDate: payload.firstRegistrationDate,
    mileage: payload.mileage || 0,
    valuationDate: payload.valuationDate || "",
    manufactureDate: payload.manufactureDate || "",
    modules: payload.modules || {},
  });
  return createHash("sha256").update(normalized).digest("hex");
}
