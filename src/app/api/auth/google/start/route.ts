import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/auth/guards";
import { createOAuthClientForOrg, GMAIL_SCOPES } from "@/lib/clients/gmail";
import { signState } from "@/lib/oauth/state";

export async function GET() {
  const { organizationId, user } = await requireOrg();

  const state = signState({ orgId: organizationId, userId: user.id });
  const oauth = await createOAuthClientForOrg(organizationId);
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    include_granted_scopes: true,
    state,
  });

  return NextResponse.redirect(url);
}
