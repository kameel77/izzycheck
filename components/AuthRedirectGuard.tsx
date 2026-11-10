"use client";

import { useEffect } from "react";

import { shouldRedirectToLogin } from "@/lib/auth-redirect";

let redirecting = false;

export function AuthRedirectGuard() {
  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!redirecting && shouldRedirectToLogin(res.status, url, window.location.href)) {
        redirecting = true;
        window.location.assign("/login");
      }
      return res;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
