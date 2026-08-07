import { StackServerApp } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  urls: {
    afterSignIn: "/dashboard",
    afterSignUp: "/onboarding",
    afterSignOut: "/sign-in",
    signIn: "/sign-in",
    signUp: "/sign-up",
  },
});
