import { Elysia } from "elysia";
import { createClerkClient } from "@clerk/backend";
import { env } from "#/lib/env";

const clerkClient = createClerkClient({
  secretKey: env().clerk.secretKey,
  publishableKey: env().clerk.publishableKey,
});

export { clerkClient };

export const authMiddleware = new Elysia({ name: "auth" }).derive(
  { as: "global" },
  async ({ request }) => {
    // Create a minimal headers-only Request for Clerk authentication.
    // Clerk only needs headers (Authorization / cookies) — passing the
    // original request would consume the body ReadableStream, preventing
    // Elysia from parsing it later on POST/PATCH/DELETE routes.
    const authRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
    });

    const authResult = await clerkClient.authenticateRequest(authRequest, {
      jwtKey: env().clerk.jwtKey,
      authorizedParties: env().clerk.authorizedParties,
    });

    if (!authResult.isSignedIn) {
      return {
        auth: null as { userId: string } | null,
      };
    }

    return {
      auth: {
        userId: authResult.toAuth().userId,
      },
    };
  },
);

/**
 * Guard that requires authentication.
 * Use this on routes that must have a signed-in user.
 */
export const requireAuth = new Elysia({ name: "requireAuth" })
  .use(authMiddleware)
  .onBeforeHandle({ as: "global" }, ({ auth, set }) => {
    if (!auth) {
      set.status = 401;
      return {
        success: false,
        error: "Authentication required",
        code: "UNAUTHORIZED",
      };
    }
  });
