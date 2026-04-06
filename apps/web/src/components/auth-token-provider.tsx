import { useAuth } from "@clerk/clerk-react";
import { useEffect, useState } from "react";

/**
 * Exposes Clerk's getToken() function globally so that API clients
 * can fetch a fresh token on every request — eliminating stale-token 401s.
 *
 * Clerk's getToken() internally caches valid tokens and only hits the
 * network when the cached token is about to expire, so calling it on
 * every request is cheap and expected.
 *
 * Blocks rendering of children until the first token fetch succeeds,
 * preventing 401s from early API calls.
 */
export function AuthTokenProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Expose the getToken function globally so API clients can call it
    window.__clerk_getToken = getToken;

    // Verify the token is available before rendering children
    const init = async () => {
      try {
        await getToken();
      } catch (err) {
        console.warn("Failed initial Clerk token fetch:", err);
      }
      if (mounted) {
        setIsReady(true);
      }
    };

    init();

    return () => {
      mounted = false;
      // Clean up the global reference
      window.__clerk_getToken = undefined;
    };
  }, [getToken]);

  // Don't render children until the first token fetch completes.
  // This ensures no queries fire before the auth token is available.
  if (!isReady) return null;

  return <>{children}</>;
}
