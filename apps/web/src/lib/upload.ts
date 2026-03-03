import type { AppUploadRouter } from "@repo/api/src/lib/upload";

export type { AppUploadRouter };

export const UPLOAD_API_URL = `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/upload`;
