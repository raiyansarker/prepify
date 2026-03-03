import { treaty } from "@elysiajs/eden";
import type { App } from "@repo/api/src/index";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export const api = treaty<App>(API_URL, {
  fetch: {
    credentials: "include",
  },
  headers: () => {
    // Clerk token will be injected via useAuth hook
    const token = window.__clerk_token;
    if (token) {
      return {
        Authorization: `Bearer ${token}`,
      };
    }
    return {};
  },
});

// Augment window to store the Clerk token
declare global {
  interface Window {
    __clerk_token?: string;
  }
}
