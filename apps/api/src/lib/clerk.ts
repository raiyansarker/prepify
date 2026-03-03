import { clerkClient } from "#/middleware/auth";
import { apiLogger } from "#/lib/logger";

// ============================================
// Clerk User Details (fetched on demand)
// ============================================

export type ClerkUserDetails = {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
};

/**
 * Fetch user details from Clerk API by user ID.
 * Use this when you need display info (name, avatar, email).
 * Returns null on failure (logged, non-fatal).
 */
export async function getUserDetails(
  userId: string,
): Promise<ClerkUserDetails | null> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const email =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
        ?.emailAddress ?? user.emailAddresses[0]?.emailAddress;

    return {
      id: user.id,
      email: email ?? "",
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      avatar: user.imageUrl ?? null,
    };
  } catch (error) {
    apiLogger.warn(
      { err: error, userId },
      "Failed to fetch user details from Clerk",
    );
    return null;
  }
}
