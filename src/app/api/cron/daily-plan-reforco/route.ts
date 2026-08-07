import { NextResponse } from "next/server";
import { handleDailyPlanReforco } from "@/lib/queue/handlers/daily-plan";
import { getBoss } from "@/lib/queue/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Segundo cron da automacao (tarde, ~14h BRT). Repoe os disparos que falharam
 * de manha (email invalido, whatsapp bloqueado): minera se o pool estiver
 * baixo, enriquece emails e dispara automaticamente tantos leads novos quantos
 * falharam, para os 25/canal virarem entregas de fato. Protegido por CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET nao configurada" }, { status: 500 });
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await handleDailyPlanReforco();
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
  } catch (e) {
    console.error("[cron/daily-plan-reforco] erro", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  } finally {
    try {
      const boss = await getBoss();
      await boss.stop({ graceful: false });
    } catch {
      // ignore
    }
    const g = globalThis as unknown as { pgBoss?: unknown; pgBossReady?: unknown };
    g.pgBoss = undefined;
    g.pgBossReady = undefined;
  }
}
