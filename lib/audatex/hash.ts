import { createHash } from "crypto";

function sortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);

  return Object.keys(obj)
    .sort()
    .reduce((acc: any, key: string) => {
      acc[key] = sortObjectKeys(obj[key]);
      return acc;
    }, {});
}

export function computeRequestHash(payload: any): string {
  const normalizedObj = {
    vin: String(payload.vin || "").toUpperCase().replace(/[\s-]/g, ""),
    firstRegDate: payload.firstRegistrationDate || "",
    mileage: payload.mileage || 0,
    valuationDate: payload.valuationDate || "",
    manufactureDate: payload.manufactureDate || "",
    modules: sortObjectKeys(payload.modules || {}),
  };

  const canonicalString = JSON.stringify(sortObjectKeys(normalizedObj));
  return createHash("sha256").update(canonicalString).digest("hex");
}
