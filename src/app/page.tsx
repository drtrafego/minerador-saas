import { redirect } from "next/navigation";
import { stackServerApp } from "@/lib/auth/stack";

export default async function Home() {
  const user = await stackServerApp.getUser();
  if (!user) redirect("/sign-in");
  if (!user.selectedTeam) redirect("/onboarding");
  redirect("/dashboard");
}
