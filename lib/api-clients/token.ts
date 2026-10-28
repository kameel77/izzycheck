import { createHash, randomBytes } from "node:crypto";

export const API_TOKEN_PREFIX = "izc_";

/** Token klienta API: `izc_` + 32 losowe bajty base64url. Pokazywany użytkownikowi raz, w bazie tylko hash. */
export function generateApiToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Pierwsze 8 znaków tokenu, do identyfikacji klienta w panelu (nie wystarcza do odtworzenia tokenu). */
export function tokenPrefixOf(token: string): string {
  return token.slice(0, 8);
}

/** Wyciąga token z nagłówka `Authorization: Bearer <token>`; null, gdy nagłówek ma inny kształt. */
export function parseBearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match ? match[1] : null;
}
