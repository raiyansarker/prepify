import { createUploadClient } from "pushduck/client";
import type { AppUploadRouter } from "@repo/api/src/lib/upload";

export type { AppUploadRouter };

export const UPLOAD_API_URL = `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/upload`;

export const uploadClient = createUploadClient<AppUploadRouter>({
  endpoint: UPLOAD_API_URL,
  fetcher: (input, init) => {
    const token = window.__clerk_token;
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers });
  },
});
