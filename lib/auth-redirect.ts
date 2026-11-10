// Decides whether a 401 from a client-side fetch means the session expired and the user should be sent to /login.
import { isPublicPath } from "./auth-routes.ts";

export function shouldRedirectToLogin(status: number, requestUrl: string, currentUrl: string): boolean {
  if (status !== 401) return false;
  try {
    const current = new URL(currentUrl);
    const request = new URL(requestUrl, current);
    if (request.origin !== current.origin) return false;
    if (!request.pathname.startsWith("/api/")) return false;
    if (request.pathname === "/api/auth/login") return false;
    return !isPublicPath(current.pathname);
  } catch {
    return false;
  }
}
