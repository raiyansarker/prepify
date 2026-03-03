import { createFileRoute } from "@tanstack/react-router";
import { SignIn } from "@clerk/clerk-react";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

function SignInPage() {
  return (
    <>
      <title>Sign In - Prepify</title>
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md space-y-6 px-4">
          <div className="text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary">
              <span className="text-xl font-bold text-primary-foreground">
                P
              </span>
            </div>
            <h1 className="mt-4 text-2xl font-bold">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to continue to Prepify
            </p>
          </div>
          <div className="flex justify-center">
            <SignIn
              routing="hash"
              afterSignInUrl="/dashboard"
              signUpUrl="/sign-up"
            />
          </div>
        </div>
      </div>
    </>
  );
}
