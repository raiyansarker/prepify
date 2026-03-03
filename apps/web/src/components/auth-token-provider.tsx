import { useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";

/**
 * Syncs the Clerk session token to window.__clerk_token
 * so that the Eden Treaty client can include it in requests.
 */
export function AuthTokenProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();

  useEffect(() => {
    let mounted = true;

    const syncToken = async () => {
      try {
        const token = await getToken();
        if (mounted) {
          window.__clerk_token = token ?? undefined;
        }
      } catch (err) {
        console.warn("Failed to refresh Clerk session token:", err);
        if (mounted) {
          window.__clerk_token = undefined;
        }
      }
    };

    // Sync immediately and on interval
    syncToken();
    const interval = setInterval(syncToken, 50_000); // refresh before 60s expiry

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [getToken]);

  return <>{children}</>;
}
