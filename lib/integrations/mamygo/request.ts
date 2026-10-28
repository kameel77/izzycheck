const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export type VinRequestValidation =
  | { ok: true; vin: string }
  | { ok: false; message: string };

/** Walidacja body POST /api/v1/vehicles/vin-identification: `{ vin, country?, language? }`. */
export function validateVinRequest(body: unknown): VinRequestValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Treść żądania musi być obiektem JSON." };
  }
  const { vin, country, language } = body as Record<string, unknown>;

  if (typeof vin !== "string") {
    return { ok: false, message: "Pole vin jest wymagane." };
  }
  const normalizedVin = vin.trim().toUpperCase();
  if (!VIN_RE.test(normalizedVin)) {
    return { ok: false, message: "Numer VIN musi mieć 17 znaków (A-Z bez I, O, Q oraz cyfry)." };
  }

  if (country !== undefined && country !== null && !(typeof country === "string" && country.trim().toUpperCase() === "PL")) {
    return { ok: false, message: "Obsługiwany jest wyłącznie kraj PL." };
  }
  if (language !== undefined && language !== null && !(typeof language === "string" && language.trim().toLowerCase() === "pl")) {
    return { ok: false, message: "Obsługiwany jest wyłącznie język pl." };
  }

  return { ok: true, vin: normalizedVin };
}

/** VIN do zapisu w ApiUsage dla żądań odrzuconych przed/po walidacją: obcięty do 32 znaków; null, gdy to nie tekst. */
export function vinForUsageLog(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const vin = (body as Record<string, unknown>).vin;
  if (typeof vin !== "string") return null;
  const trimmed = vin.trim().toUpperCase().slice(0, 32);
  return trimmed === "" ? null : trimmed;
}
