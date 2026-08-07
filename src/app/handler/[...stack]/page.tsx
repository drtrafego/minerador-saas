import { StackHandler } from "@stackframe/stack";
import { stackServerApp } from "@/lib/auth/stack";

export default function Handler(props: unknown) {
  return (
    <StackHandler
      fullPage
      app={stackServerApp}
      routeProps={props as Record<string, unknown>}
    />
  );
}
