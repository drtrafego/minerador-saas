import { NextResponse } from "next/server";
import { handleDailyPlan } from "@/lib/queue/handlers/daily-plan";
import { getBoss } from "@/lib/queue/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron da automacao diaria (Vercel Cron, 08:00 BRT). Roda o handleDailyPlan com
 * o codigo SEMPRE atualizado do deploy: minera todos os combos configurados e
 * monta o plano de disparo por canal com roteamento por nicho. Enfileira
 * scrape.run e (em modo auto) campaign.send no pg-boss do banco; o worker da
 * VPS consome essas filas normalmente.
 *
 * Protegido por CRON_SECRET: a Vercel envia "Authorization: Bearer <secret>".
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET nao configurada no ambiente" },
      { status: 500 },
    );
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await handleDailyPlan();
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
  } catch (e) {
    console.error("[cron/daily-plan] erro", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  } finally {
    // Serverless: encerra o pg-boss (que inicia timers de manutencao) para a
    // funcao retornar sem ficar pendurada ate o timeout. Os jobs enfileirados
    // via boss.send ja foram persistidos no banco antes daqui.
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
