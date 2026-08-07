import "server-only";
import { redirect } from "next/navigation";
import { stackServerApp } from "./stack";

export async function getSession() {
  return stackServerApp.getUser();
}

export async function requireUser() {
  const user = await stackServerApp.getUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireOrg() {
  const user = await requireUser();
  const team = user.selectedTeam;
  if (!team) redirect("/onboarding");
  return {
    user: {
      id: user.id,
      name: user.displayName ?? "",
      email: user.primaryEmail ?? "",
    },
    organizationId: team.id,
  };
}
