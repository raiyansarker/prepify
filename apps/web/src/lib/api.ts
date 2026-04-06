import { treaty } from "@elysiajs/eden";
import type { App } from "@repo/api/src/index";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

if (!import.meta.env.VITE_API_URL && import.meta.env.DEV) {
  console.warn(
    "[api] VITE_API_URL is not set — falling back to http://localhost:3001",
  );
}

export const api = treaty<App>(API_URL, {
  fetch: {
    credentials: "include",
  },
  headers: async () => {
    // Fetch a fresh token on every request — Clerk caches internally
    const token = await window.__clerk_getToken?.();
    if (token) {
      return {
        Authorization: `Bearer ${token}`,
      };
    }
    return {};
  },
});

// Augment window to store the Clerk getToken function
declare global {
  interface Window {
    __clerk_getToken?: () => Promise<string | null>;
  }
}
