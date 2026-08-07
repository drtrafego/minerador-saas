import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import {
  createOAuthClientForOrg,
  upsertGmailCredential,
  type GmailOAuthPayload,
} from "@/lib/clients/gmail";
import { verifyState } from "@/lib/oauth/state";

function redirectWithError(reason: string) {
  const url = new URL("/settings/credentials", getBaseUrl());
  url.searchParams.set("google_oauth_error", reason);
  return NextResponse.redirect(url);
}

function redirectOk() {
  const url = new URL("/settings/credentials", getBaseUrl());
  url.searchParams.set("google_oauth", "connected");
  return NextResponse.redirect(url);
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirectWithError(oauthError);
  }
  if (!code || !stateRaw) {
    return redirectWithError("missing_code");
  }

  const state = verifyState(stateRaw);
  if (!state) {
    return redirectWithError("invalid_state");
  }

  try {
    const oauth = await createOAuthClientForOrg(state.orgId);
    const { tokens } = await oauth.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      return redirectWithError("missing_tokens");
    }

    oauth.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth });
    const profile = await oauth2.userinfo.get();
    const email = profile.data.email;
    if (!email) {
      return redirectWithError("missing_email");
    }

    const payload: GmailOAuthPayload = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt:
        tokens.expiry_date ?? Date.now() + 55 * 60 * 1000,
      email,
      scope: tokens.scope ?? "",
      tokenType: tokens.token_type ?? "Bearer",
      idToken: tokens.id_token ?? undefined,
    };

    await upsertGmailCredential(state.orgId, payload);
    return redirectOk();
  } catch (err) {
    console.error("[google/callback] erro", err);
    return redirectWithError("exchange_failed");
  }
}
