import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { sendCounters } from "@/db/schema/jobs";

export type OutreachChannel = "email" | "instagram_dm" | "whatsapp" | "linkedin_dm";

const DEFAULT_LIMITS: Record<OutreachChannel, number> = {
  email: 300,
  instagram_dm: 30,
  whatsapp: 200,
  linkedin_dm: 80,
};

export const DEFAULT_HOURLY_LIMITS: Record<OutreachChannel, number> = {
  email: 20,
  instagram_dm: 3,
  whatsapp: 20,
  linkedin_dm: 2,
};

export function getDailyLimit(
  _organizationId: string,
  channel: OutreachChannel,
): number {
  return DEFAULT_LIMITS[channel] ?? 50;
}

export function getHourlyLimit(
  _organizationId: string,
  channel: OutreachChannel,
): number {
  return DEFAULT_HOURLY_LIMITS[channel] ?? 10;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function dayBucket(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  return `d:${y}-${m}-${d}`;
}

export function hourBucket(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  return `h:${y}-${m}-${d}-${h}`;
}

export function getWarmupFactor(sessionCreatedAt: number | null): number {
  if (!sessionCreatedAt) return 1.0;
  const elapsedMs = Date.now() - sessionCreatedAt;
  const day = Math.floor(elapsedMs / (24 * 60 * 60 * 1000)) + 1;
  if (day <= 1) return 0.1;
  if (day === 2) return 0.17;
  if (day === 3) return 0.27;
  if (day === 4) return 0.4;
  if (day === 5) return 0.6;
  if (day === 6) return 0.8;
  return 1.0;
}

function isBrowserChannel(channel: OutreachChannel): boolean {
  return channel === "instagram_dm" || channel === "linkedin_dm";
}

export async function getBucketCount(
  organizationId: string,
  campaignId: string,
  channel: OutreachChannel,
  bucket: string,
): Promise<number> {
  const rows = await db
    .select({ count: sendCounters.count })
    .from(sendCounters)
    .where(
      and(
        eq(sendCounters.organizationId, organizationId),
        eq(sendCounters.campaignId, campaignId),
        eq(sendCounters.channel, channel),
        eq(sendCounters.bucket, bucket),
      ),
    )
    .limit(1);
  return rows[0]?.count ?? 0;
}

export async function incrementSendCount(
  organizationId: string,
  campaignId: string,
  channel: OutreachChannel,
  now: Date = new Date(),
): Promise<void> {
  const dBucket = dayBucket(now);
  const hBucket = hourBucket(now);
  await db.transaction(async (tx) => {
    for (const bucket of [dBucket, hBucket]) {
      await tx
        .insert(sendCounters)
        .values({
          organizationId,
          campaignId,
          channel,
          bucket,
          count: 1,
        })
        .onConflictDoUpdate({
          target: [
            sendCounters.organizationId,
            sendCounters.campaignId,
            sendCounters.channel,
            sendCounters.bucket,
          ],
          set: {
            count: sql`${sendCounters.count} + 1`,
            updatedAt: new Date(),
          },
        });
    }
  });
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; nextAvailableAt: Date; reason: "hour" | "day" };

function jitterSeconds(minSec: number, maxSec: number): number {
  return Math.floor(minSec + Math.random() * (maxSec - minSec));
}

function nextHourStart(now: Date): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d;
}

function nextDayMorning(now: Date): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(11, 0, 0, 0); // 08:00 BRT = 11:00 UTC
  return d;
}

export async function canSend(
  organizationId: string,
  campaignId: string,
  channel: OutreachChannel,
  options?: { sessionCreatedAt?: number | null },
): Promise<RateLimitDecision> {
  const now = new Date();
  const dailyRaw = getDailyLimit(organizationId, channel);
  const hourly = getHourlyLimit(organizationId, channel);

  let dailyLimit = dailyRaw;
  if (isBrowserChannel(channel)) {
    const factor = getWarmupFactor(options?.sessionCreatedAt ?? null);
    dailyLimit = Math.max(1, Math.floor(dailyRaw * factor));
  }

  const dBucket = dayBucket(now);
  const hBucket = hourBucket(now);

  const [dayCount, hourCount] = await Promise.all([
    getBucketCount(organizationId, campaignId, channel, dBucket),
    getBucketCount(organizationId, campaignId, channel, hBucket),
  ]);

  if (hourCount >= hourly) {
    const base = nextHourStart(now);
    base.setUTCSeconds(base.getUTCSeconds() + jitterSeconds(60, 180));
    return { allowed: false, nextAvailableAt: base, reason: "hour" };
  }

  if (dayCount >= dailyLimit) {
    const base = nextDayMorning(now);
    base.setUTCSeconds(base.getUTCSeconds() + jitterSeconds(60, 180));
    return { allowed: false, nextAvailableAt: base, reason: "day" };
  }

  return { allowed: true };
}
