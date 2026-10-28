import type { ApiUsageOutcome, PrismaClient } from "@prisma/client";
import { authenticateApiClient } from "../../api-clients/auth.ts";
import { parseBearerToken } from "../../api-clients/token.ts";
import { VinNotFoundError, type VehicleIdentificationRaw } from "../../audatex/types.ts";
import { isRateLimited } from "../../rate-limit.ts";
import { toExternalVinIdentification } from "./mapper.ts";
import { validateVinRequest, vinForUsageLog } from "./request.ts";

export const VIN_IDENTIFICATION_ENDPOINT = "POST /api/v1/vehicles/vin-identification";

/** Wynik identyfikacji z cache jest ważny 30 dni. */
export const VIN_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface VinIdentificationDeps {
  db: PrismaClient;
  identify: (vin: string) => Promise<VehicleIdentificationRaw>;
  now?: () => Date;
  /** false w trybie mock: fixture nie może trafić do cache ani być z niego czytany. Domyślnie true. */
  useCache?: boolean;
}

export interface VinIdentificationResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

function errorResponse(status: number, error: string, message: string, headers?: Record<string, string>): VinIdentificationResponse {
  return { status, body: { error, message }, headers };
}

/** Komunikat błędu do logów aplikacji: VIN ani token nie mogą się w nich znaleźć (np. w komunikacie Prismy). */
function scrubbedMessage(err: unknown, ...secrets: Array<string | null>): string {
  let message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message;
}

interface UsageRecord {
  vin: string | null;
  httpStatus: number;
  outcome: ApiUsageOutcome;
  billable: boolean;
  cacheHit: boolean;
  upstreamMs: number | null;
}

/**
 * Obsługa POST /api/v1/vehicles/vin-identification (route tylko skleja request z tą funkcją).
 * Kolejność: token -> rate limit -> walidacja -> cache -> Audatex -> mapowanie.
 * Każda ścieżka po poprawnym tokenie zostawia wpis ApiUsage (rozliczenia miesięczne).
 */
export async function handleVinIdentification(
  deps: VinIdentificationDeps,
  request: { authorization: string | null; body: unknown },
): Promise<VinIdentificationResponse> {
  const { db, identify } = deps;
  const now = deps.now ?? (() => new Date());
  const useCache = deps.useCache ?? true;

  let client: Awaited<ReturnType<typeof authenticateApiClient>>;
  try {
    client = await authenticateApiClient(db, request.authorization);
  } catch (err) {
    // Bez wpisu w ApiUsage (nie wiadomo czyj to klient); ani token, ani VIN nie trafiają do logów.
    console.error("[API_VIN_AUTH_ERROR]", scrubbedMessage(err, parseBearerToken(request.authorization), vinForUsageLog(request.body)));
    return errorResponse(500, "INTERNAL_ERROR", "Wystąpił błąd wewnętrzny.");
  }
  if (!client) {
    // Bez wpisu w ApiUsage (nie wiadomo czyj to klient) i bez tokenu w logach.
    console.warn("[API_VIN_UNAUTHORIZED] Odrzucono żądanie z brakującym lub nieprawidłowym tokenem API.");
    return errorResponse(401, "UNAUTHORIZED", "Brak lub nieprawidłowy token API.");
  }

  const usage: UsageRecord = {
    vin: vinForUsageLog(request.body),
    httpStatus: 500,
    outcome: "INTERNAL_ERROR",
    billable: false,
    cacheHit: false,
    upstreamMs: null,
  };

  try {
    const rate = isRateLimited("api-vin", client.id, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (rate.limited) {
      usage.httpStatus = 429;
      usage.outcome = "REJECTED";
      return errorResponse(429, "RATE_LIMITED", `Przekroczono limit ${RATE_LIMIT_MAX} żądań na minutę.`, {
        "Retry-After": String(Math.max(1, Math.ceil(rate.resetMs / 1000))),
      });
    }

    const validation = validateVinRequest(request.body);
    if (!validation.ok) {
      usage.httpStatus = 400;
      usage.outcome = "REJECTED";
      return errorResponse(400, "INVALID_REQUEST", validation.message);
    }
    const vin = validation.vin;
    usage.vin = vin;

    let raw: VehicleIdentificationRaw;
    const cached = useCache ? await db.vinIdentificationCache.findUnique({ where: { vin } }) : null;
    if (cached && now().getTime() - cached.fetchedAt.getTime() < VIN_CACHE_TTL_MS) {
      usage.cacheHit = true;
      raw = {
        ibsCode: cached.ibsCode,
        fittedEquipmentCodes: JSON.parse(cached.fittedEquipmentCodes) as string[],
        vinXml: cached.vinXml,
        classificationXml: cached.classificationXml,
      };
    } else {
      const startedAt = Date.now();
      try {
        raw = await identify(vin);
      } catch (err) {
        usage.upstreamMs = Date.now() - startedAt;
        if (err instanceof VinNotFoundError) {
          usage.httpStatus = 404;
          usage.outcome = "NOT_FOUND";
          return errorResponse(404, "VIN_NOT_FOUND", "Nie rozpoznano pojazdu dla podanego numeru VIN.");
        }
        console.error("[API_VIN_UPSTREAM_ERROR]", scrubbedMessage(err, vin));
        usage.httpStatus = 502;
        usage.outcome = "UPSTREAM_ERROR";
        return errorResponse(502, "UPSTREAM_ERROR", "Usługa identyfikacji pojazdów jest chwilowo niedostępna.");
      }
      usage.upstreamMs = Date.now() - startedAt;

      // Zapis cache nie może zepsuć udanej odpowiedzi (Audatex został już odpytany).
      if (useCache) {
        try {
          const data = {
            ibsCode: raw.ibsCode,
            fittedEquipmentCodes: JSON.stringify(raw.fittedEquipmentCodes),
            vinXml: raw.vinXml,
            classificationXml: raw.classificationXml,
            fetchedAt: now(),
          };
          await db.vinIdentificationCache.upsert({ where: { vin }, create: { vin, ...data }, update: data });
        } catch (cacheErr) {
          console.error("[API_VIN_CACHE_ERROR]", scrubbedMessage(cacheErr, vin));
        }
      }
    }

    const body = toExternalVinIdentification(vin, raw, now());
    usage.httpStatus = 200;
    usage.outcome = "IDENTIFIED";
    usage.billable = true;
    return { status: 200, body };
  } catch (err) {
    console.error("[API_VIN_INTERNAL_ERROR]", scrubbedMessage(err, usage.vin));
    usage.httpStatus = 500;
    usage.outcome = "INTERNAL_ERROR";
    usage.billable = false;
    return errorResponse(500, "INTERNAL_ERROR", "Wystąpił błąd wewnętrzny.");
  } finally {
    // Błąd zapisu logu rozliczeniowego nie zmienia odpowiedzi, ale musi być widoczny w logach.
    try {
      await db.apiUsage.create({
        data: {
          apiClientId: client.id,
          organizationId: client.organizationId,
          endpoint: VIN_IDENTIFICATION_ENDPOINT,
          ...usage,
        },
      });
    } catch (usageErr) {
      console.error("[API_USAGE_LOG_ERROR]", scrubbedMessage(usageErr, usage.vin));
    }
    // lastUsedAt jest tylko informacyjne: jego błąd nie może odebrać wpisu rozliczeniowego (osobny zapis).
    try {
      await db.apiClient.update({ where: { id: client.id }, data: { lastUsedAt: now() } });
    } catch (touchErr) {
      console.error("[API_CLIENT_TOUCH_ERROR]", scrubbedMessage(touchErr, usage.vin));
    }
  }
}
