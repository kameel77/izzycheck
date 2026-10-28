import type { PrismaClient } from "@prisma/client";
import { hashApiToken, parseBearerToken } from "./token.ts";

export interface AuthenticatedApiClient {
  id: string;
  organizationId: string;
}

/** Klient API po tokenie z nagłówka Authorization; null dla braku, nieznanego tokenu albo nieaktywnego klienta/organizacji. */
export async function authenticateApiClient(
  db: PrismaClient,
  authorizationHeader: string | null | undefined,
): Promise<AuthenticatedApiClient | null> {
  const token = parseBearerToken(authorizationHeader);
  if (!token) return null;

  const client = await db.apiClient.findUnique({
    where: { tokenHash: hashApiToken(token) },
    select: { id: true, organizationId: true, isActive: true, organization: { select: { isActive: true } } },
  });
  if (!client || !client.isActive || !client.organization.isActive) return null;

  return { id: client.id, organizationId: client.organizationId };
}
