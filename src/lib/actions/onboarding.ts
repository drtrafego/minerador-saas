"use server";
import { stackServerApp } from "@/lib/auth/stack";
import { db } from "@/lib/db/client";
import { organization } from "@/db/schema";

export async function createOrganization(name: string): Promise<string> {
  const user = await stackServerApp.getUser({ or: "throw" });
  const team = await stackServerApp.createTeam({
    displayName: name,
    creatorUserId: user.id,
  });
  await db.insert(organization).values({ id: team.id, name }).onConflictDoNothing();
  return team.id;
}
