import { createUploadConfig } from "pushduck/server";
import { ulid } from "ulid";
import { MAX_FILE_SIZE_MB, MAX_IMAGE_SIZE_MB } from "@repo/shared";

// ============================================
// Pushduck R2 Upload Configuration
// ============================================

const { s3 } = createUploadConfig()
  .provider("cloudflareR2", {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    accountId: process.env.R2_ACCOUNT_ID!,
    bucket: process.env.R2_BUCKET!,
    region: "auto",
  })
  .paths({
    prefix: "uploads",
    generateKey: (file, metadata) => {
      const userId = metadata?.userId || "anonymous";
      const ext = file.name.includes(".")
        ? `.${file.name.split(".").pop()}`
        : "";
      return `${userId}/${ulid()}${ext}`;
    },
  })
  .build();

// ============================================
// Upload Router with routes for documents and images
// ============================================

export const uploadRouter = s3.createRouter({
  documentUpload: s3
    .file()
    .maxFileSize(`${MAX_FILE_SIZE_MB}MB`)
    .middleware(async ({ req }) => {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        throw new Error("Authorization required");
      }
      return { userId: "authenticated" };
    }),

  imageUpload: s3
    .image()
    .maxFileSize(`${MAX_IMAGE_SIZE_MB}MB`)
    .middleware(async ({ req }) => {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        throw new Error("Authorization required");
      }
      return { userId: "authenticated" };
    }),
});

export type AppUploadRouter = typeof uploadRouter;
