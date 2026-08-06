import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("KRYTYCZNY BŁĄD KONFIGURACJI: Zmienna środowiskowa JWT_SECRET nie została skonfigurowana.");
  }
  return new TextEncoder().encode(secret);
}

export interface JWTPayload {
  userId: string;
  email: string;
  name: string;
  role: "OPERATOR" | "ADMIN";
}

declare global {
  var __mockCurrentUser: JWTPayload | null | undefined;
}

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

export async function createToken(payload: JWTPayload): Promise<string> {
  const secret = getJwtSecret();
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const secret = getJwtSecret();
    const verified = await jwtVerify(token, secret);
    return verified.payload as unknown as JWTPayload;
  } catch (err) {
    return null;
  }
}

export async function getCurrentUser(): Promise<JWTPayload | null> {
  if (globalThis.__mockCurrentUser !== undefined) {
    return globalThis.__mockCurrentUser;
  }
  const cookieStore = await cookies();
  const token = cookieStore.get("izzycheck_session")?.value;
  if (!token) return null;
  return await verifyToken(token);
}
