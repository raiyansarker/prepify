import { Elysia } from "elysia";
import { createClerkClient } from "@clerk/backend";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
});

export const authMiddleware = new Elysia({ name: "auth" }).derive(
  { as: "scoped" },
  async ({ request, set }) => {
    const authResult = await clerkClient.authenticateRequest(request, {
      jwtKey: process.env.CLERK_JWT_KEY,
      authorizedParties: process.env.CLERK_AUTHORIZED_PARTIES?.split(","),
    });

    if (!authResult.isSignedIn) {
      return {
        auth: null as {
          userId: string;
          clerkId: string;
        } | null,
      };
    }

    return {
      auth: {
        userId: authResult.toAuth().userId,
        clerkId: authResult.toAuth().userId,
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
  .onBeforeHandle({ as: "scoped" }, ({ auth, set }) => {
    if (!auth) {
      set.status = 401;
      return {
        success: false,
        error: "Authentication required",
        code: "UNAUTHORIZED",
      };
    }
  });
