/**
 * Handler do cron daily.plan (uma vez por dia, 07:00 BRT / 10:00 UTC).
 *
 * Para cada org com automation_config:
 *   1) Rotacao de mineracao: se mining_enabled, escolhe o proximo combo
 *      (niche/city/sourceType) em rotation_combos (round-robin), cria uma
 *      mining + mining_source e enfileira scrape.run. O dedup por
 *      (organization_id, source, external_id) em leads ja impede repetir lead.
 *   2) Fila de disparo do dia por canal (whatsapp, email): para cada canal
 *      com channel_warmup habilitado, calcula o restante do dia (cap do
 *      warm-up menos consumo ja feito) e seleciona ate esse tanto de leads
 *      elegiveis (qualified, com contato do canal, sem do_not_disturb, ainda
 *      nao abordados por aquele canal). Em dispatchMode='auto' ja enfileira
 *      via enrollLeadsIntoCampaign; em 'approval' so registra o plano
 *      (daily_send_plan + daily_send_plan_item) para o dono aprovar (Fase 3).
 *
 * Idempotente por (organization_id, plan_date, channel): se ja existe plano
 * do dia para aquele canal, nao duplica. Planos 'pending' de dias anteriores
 * viram 'expired'.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { minings, miningSources, miningSourceTypeEnum } from "@/db/schema/minings";
import {
  automationConfig,
  dailySendPlan,
  dailySendPlanItem,
  type AutomationConfig,
  type AutomationRotationCombo,
} from "@/db/schema/outreach-automation";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { ScrapeRunPayload } from "@/lib/queue/types";
import { dayBucket } from "@/lib/outreach/rate-limit";
import {
  capDiaWarmup,
  consumoHojeCanal,
  getChannelWarmup,
  type WarmupChannel,
} from "@/lib/outreach/warmup";
import { enrollLeadsIntoCampaign } from "@/lib/outreach/enroll";
import { enriquecerEmailsDoPool } from "@/lib/outreach/enrich-email";
import { generateIcpPrompt } from "@/lib/clients/anthropic";
import { ICP_TEMPLATES } from "@/lib/icp/templates";
import { horaLocalSaoPaulo } from "./reengage-tick";

const DISPATCH_CHANNELS: WarmupChannel[] = ["whatsapp", "email"];

type MiningSourceType = (typeof miningSourceTypeEnum.enumValues)[number];
const SUPPORTED_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "google_places",
  "instagram_hashtag",
  "linkedin_search",
]);

// "Hoje" em YYYY-MM-DD, usando a mesma nocao de dia (UTC) do dayBucket() de
// rate-limit.ts, ja usada em consumoHojeCanal/send_counters.
function hojeStr(now: Date): string {
  return dayBucket(now).slice(2);
}

// 08:00 BRT = 11:00 UTC. Se ja passou hoje, usa amanha.
function secondsUntil8hBRT(now: Date): number {
  const d = new Date(now);
  d.setUTCHours(11, 0, 0, 0);
  if (d.getTime() <= now.getTime()) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return Math.max(0, Math.floor((d.getTime() - now.getTime()) / 1000));
}

function normalizeSourceType(sourceType: string): MiningSourceType | null {
  return SUPPORTED_SOURCE_TYPES.has(sourceType)
    ? (sourceType as MiningSourceType)
    : null;
}

function buildSourceConfig(
  sourceType: MiningSourceType,
  combo: AutomationRotationCombo,
  fetchWebsiteEmail: boolean,
): Record<string, unknown> {
  if (sourceType === "google_places") {
    // fetchWebsiteEmail so quando o nicho e roteado ao canal de email: abre o
    // site de cada lead para garimpar email (advogado, clinica). Restaurante
    // (WhatsApp) fica desligado, so telefone.
    return {
      query: combo.niche,
      location: combo.city,
      maxResults: 60,
      fetchWebsiteEmail,
    };
  }
  if (sourceType === "instagram_hashtag") {
    return { search: combo.niche, maxResults: 30, onlyBrazil: true };
  }
  // linkedin_search
  return { query: combo.niche, location: combo.city, maxResults: 50 };
}

/**
 * Cria uma mining + mining_source a partir do combo do dia e enfileira
 * scrape.run (mesma mecanica de createMining/startMining em mining/actions.ts,
 * reescrita aqui porque essas actions dependem de requireOrg/cookies e nao
 * podem ser chamadas de dentro do worker).
 */
async function criarEIniciarMineracaoDoDia(
  organizationId: string,
  combo: AutomationRotationCombo,
  now: Date,
  fetchWebsiteEmail: boolean,
): Promise<void> {
  const sourceType = normalizeSourceType(combo.sourceType);
  if (!sourceType) {
    console.warn(
      `[daily.plan] sourceType nao suportado "${combo.sourceType}" org=${organizationId}, pulando mineracao`,
    );
    return;
  }

  const descricao = combo.city ? `${combo.niche} em ${combo.city}` : combo.niche;

  // ICP: usa o modelo pronto do nicho (sem LLM externa). Se nao houver template
  // para o nicho, tenta gerar via LLM; se isso falhar (org sem credencial), cai
  // num prompt generico para NAO travar a mineracao automatica.
  let qualificationPrompt: string;
  const template = ICP_TEMPLATES.find(
    (t) =>
      t.niche.toLowerCase() === combo.niche.toLowerCase() ||
      t.key.toLowerCase() === combo.niche.toLowerCase(),
  );
  if (template) {
    qualificationPrompt = template.prompt;
  } else {
    try {
      qualificationPrompt = await generateIcpPrompt({ organizationId, descricao });
    } catch {
      qualificationPrompt =
        `Voce avalia se o lead se encaixa como ${descricao}, com potencial para ` +
        `contratar trafego pago (Google e Meta Ads). Aprove quem tem estrutura ` +
        `profissional (site, perfil ativo, boas avaliacoes) e ticket relevante; ` +
        `rejeite perfis pessoais ou sem qualquer estrutura. Na duvida, prefira nota mais baixa.`;
    }
  }

  const sourceConfig = buildSourceConfig(sourceType, combo, fetchWebsiteEmail);
  const nome = `Automacao ${combo.niche}${combo.city ? ` - ${combo.city}` : ""} ${hojeStr(now)}`;

  const miningId = await db.transaction(async (tx) => {
    const [mining] = await tx
      .insert(minings)
      .values({
        organizationId,
        name: nome,
        niche: combo.niche,
        qualificationPrompt,
        qualificationModel: "gemini-2.5-flash",
        status: "draft",
      })
      .returning({ id: minings.id });
    if (!mining) throw new Error("falha ao criar mining da automacao");

    await tx.insert(miningSources).values({
      organizationId,
      miningId: mining.id,
      type: sourceType,
      config: sourceConfig,
    });

    return mining.id;
  });

  const boss = await getBoss();
  const payload: ScrapeRunPayload = { organizationId, miningId };
  await boss.send(QUEUES.scrapeRun, payload);

  await db
    .update(minings)
    .set({ status: "active", updatedAt: now })
    .where(eq(minings.id, miningId));

  console.log(
    `[daily.plan] mineracao criada org=${organizationId} mining=${miningId} combo=${JSON.stringify(combo)}`,
  );
}

// Buffer de dias de disparo que o pool de leads deve cobrir. Alvo do pool =
// (cap diario whatsapp + cap diario email do warm-up) * este buffer.
const BUFFER_DIAS_POOL = 3;
// Estimativa conservadora de leads uteis (qualified com contato) por cidade
// minerada, usada para dimensionar quantas cidades minerar por dia.
const LEADS_UTEIS_POR_CIDADE = 8;
// Teto de seguranca de cidades mineradas por dia (nao explodir custo/tempo).
const MAX_CIDADES_POR_DIA = 12;

// Pool "pronto para abordar" DE UM CANAL: leads qualified, com o contato daquele
// canal (telefone p/ whatsapp, email p/ email), sem opt-out e ainda NAO abordados
// NAQUELE canal. Calculado por canal (nao junta os dois) para que o deficit de um
// canal seja enxergado mesmo quando o outro esta cheio. Antes o pool juntava os
// canais, entao com muitos telefones sobrando o email nunca reabastecia.
async function contarPoolElegivelCanal(
  organizationId: string,
  channel: WarmupChannel,
  nichosEmail: string[],
): Promise<number> {
  const contato =
    channel === "whatsapp"
      ? sql`(l.phone IS NOT NULL AND l.phone <> '')`
      : sql`(l.email IS NOT NULL AND l.email <> '')`;
  const nicheClause =
    channel === "email" && nichosEmail.length > 0
      ? sql`AND lower(coalesce(m.niche, '')) IN (${sql.join(
          nichosEmail.map((n) => sql`${n}`),
          sql`, `,
        )})`
      : sql``;
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM leads l
    LEFT JOIN minings m ON m.id = l.mining_id
    WHERE l.organization_id = ${organizationId}
      AND l.deleted_at IS NULL
      AND l.qualification_status = 'qualified'
      AND l.do_not_disturb = FALSE
      AND ${contato}
      ${nicheClause}
      AND NOT EXISTS (
        SELECT 1 FROM campaign_leads cl
        JOIN outreach_campaigns oc ON oc.id = cl.outreach_campaign_id
        WHERE cl.lead_id = l.id AND oc.channel::text = ${channel}
      )
  `);
  return Array.from(rows)[0]?.n ?? 0;
}

// Mineracao ORIENTADA A DEMANDA + rotacao de cidades: minera apenas o suficiente
// para o pool cobrir alguns dias de disparo (alvo = cap diario dos canais *
// buffer). Se o pool ja esta cheio, nao minera. Se falta, minera as proximas N
// cidades do rodizio (rotation_combos, avancando rotationCursor), cobrindo o
// Brasil ao longo dos dias sem esgotar/repetir a mesma cidade todo dia.
async function rodarRotacaoMineracao(config: AutomationConfig, now: Date): Promise<void> {
  const combos = Array.isArray(config.rotationCombos) ? config.rotationCombos : [];
  if (combos.length === 0) {
    console.warn(
      `[daily.plan] org=${config.organizationId} mining_enabled mas rotation_combos vazio`,
    );
    return;
  }

  const routing = Array.isArray(config.nicheRouting) ? config.nicheRouting : [];
  const nichosEmail = routing
    .filter((r) => r.channel === "email")
    .map((r) => r.niche.toLowerCase());

  // Deficit calculado POR CANAL. Cada canal so e suprido pelo Google Maps (unica
  // fonte que entrega contato direto: telefone p/ whatsapp; site->email p/ email).
  // Assim o email reabastece mesmo com o whatsapp cheio (antes o pool juntava os
  // canais e o email secava enquanto sobrava telefone).
  const nCidadesPorCanal: Record<string, number> = {};
  for (const canal of DISPATCH_CHANNELS) {
    const w = await getChannelWarmup(config.organizationId, canal);
    if (!w?.enabled) continue;
    const alvo = Math.max(1, capDiaWarmup(w, now)) * BUFFER_DIAS_POOL;
    const pool = await contarPoolElegivelCanal(config.organizationId, canal, nichosEmail);
    const deficit = Math.max(0, alvo - pool);
    nCidadesPorCanal[canal] =
      deficit <= 0
        ? 0
        : Math.min(MAX_CIDADES_POR_DIA, Math.max(1, Math.ceil(deficit / LEADS_UTEIS_POR_CIDADE)));
    console.log(
      `[daily.plan] mineracao canal=${canal} org=${config.organizationId} pool=${pool} alvo=${alvo} deficit=${deficit} -> ${nCidadesPorCanal[canal]} cidade(s)`,
    );
  }

  // Filtro de combo por canal: Google Maps de nicho roteado a email supre email;
  // qualquer Google Maps supre whatsapp (telefone). Instagram/LinkedIn nao entram
  // no reabastecimento de contato direto.
  const supreEmail = (c: AutomationRotationCombo) =>
    normalizeSourceType(c.sourceType) === "google_places" &&
    nichosEmail.includes(c.niche.toLowerCase());
  const supreWhatsapp = (c: AutomationRotationCombo) =>
    normalizeSourceType(c.sourceType) === "google_places";

  const start = ((config.rotationCursor % combos.length) + combos.length) % combos.length;
  const usados = new Set<number>();
  const selecionados: AutomationRotationCombo[] = [];

  // Percorre os combos a partir do cursor (rotativo, cobre o Brasil ao longo dos
  // dias) e escolhe os que atendem cada canal deficitario, respeitando o teto.
  const coletar = (filtro: (c: AutomationRotationCombo) => boolean, n: number): void => {
    let faltam = n;
    for (let i = 0; i < combos.length && faltam > 0; i++) {
      const idx = (start + i) % combos.length;
      if (usados.has(idx)) continue;
      const c = combos[idx]!;
      if (filtro(c)) {
        usados.add(idx);
        selecionados.push(c);
        faltam--;
      }
    }
  };
  coletar(supreEmail, nCidadesPorCanal["email"] ?? 0);
  coletar(supreWhatsapp, nCidadesPorCanal["whatsapp"] ?? 0);

  const limitados = selecionados.slice(0, MAX_CIDADES_POR_DIA);
  if (limitados.length === 0) {
    console.log(
      `[daily.plan] pool cheio nos dois canais org=${config.organizationId}, nao minera`,
    );
    return;
  }

  const novoCursor = (start + limitados.length) % combos.length;
  await db
    .update(automationConfig)
    .set({ rotationCursor: novoCursor, updatedAt: now })
    .where(eq(automationConfig.id, config.id));

  for (const combo of limitados) {
    // Nicho roteado a email minera abrindo o site de cada lead para extrair email
    // (senao email nunca chega em volume via Maps).
    const fetchWebsiteEmail = nichosEmail.includes(combo.niche.toLowerCase());
    try {
      await criarEIniciarMineracaoDoDia(config.organizationId, combo, now, fetchWebsiteEmail);
    } catch (err) {
      console.error(
        `[daily.plan] falha ao criar mineracao org=${config.organizationId} combo=${JSON.stringify(combo)}`,
        err,
      );
    }
  }
}

type LeadElegivelRow = { id: string; niche: string | null };

// Leads qualified, com contato do canal, sem opt-out, ainda nao abordados por
// aquele canal (NOT EXISTS campaign_leads JOIN outreach_campaigns do canal).
// Traz tambem o nicho (via minings) para o planner escolher a campanha certa.
// Se nicheFilter for informado, restringe aos nichos roteados aquele canal.
async function leadsElegiveis(
  organizationId: string,
  channel: WarmupChannel,
  limit: number,
  nicheFilter: string[] | null,
): Promise<LeadElegivelRow[]> {
  if (limit <= 0) return [];

  const contatoDoCanal =
    channel === "whatsapp"
      ? sql`l.phone IS NOT NULL AND l.phone <> ''`
      : sql`l.email IS NOT NULL AND l.email <> ''`;

  const nicheClause =
    nicheFilter && nicheFilter.length > 0
      ? sql`AND lower(coalesce(m.niche, '')) IN (${sql.join(
          nicheFilter.map((n) => sql`${n}`),
          sql`, `,
        )})`
      : sql``;

  const result = await db.execute<LeadElegivelRow>(sql`
    SELECT l.id, m.niche AS niche
    FROM leads l
    LEFT JOIN minings m ON m.id = l.mining_id
    WHERE l.organization_id = ${organizationId}
      AND l.deleted_at IS NULL
      AND l.qualification_status = 'qualified'
      AND l.do_not_disturb = FALSE
      AND ${contatoDoCanal}
      ${nicheClause}
      AND NOT EXISTS (
        SELECT 1
        FROM campaign_leads cl
        JOIN outreach_campaigns oc ON oc.id = cl.outreach_campaign_id
        WHERE cl.lead_id = l.id AND oc.channel::text = ${channel}
      )
    ORDER BY l.qualified_at ASC NULLS LAST
    LIMIT ${limit}
  `);

  return Array.from(result).map((r) => ({ id: r.id, niche: r.niche }));
}

// Resolve o roteamento de um canal: nichos roteados (para filtrar leads) e o
// mapa nicho->campanha. Fallback = campanha unica do canal (config antigo).
function routingDoCanal(
  config: AutomationConfig,
  channel: WarmupChannel,
): {
  nicheFilter: string[] | null;
  campaignByNiche: Map<string, string>;
  fallbackCampaignId: string | null;
} {
  const routing = (Array.isArray(config.nicheRouting) ? config.nicheRouting : [])
    .filter((r) => r.channel === channel && r.campaignId);
  const fallbackCampaignId =
    (channel === "whatsapp" ? config.whatsappCampaignId : config.emailCampaignId) ?? null;
  if (routing.length === 0) {
    return { nicheFilter: null, campaignByNiche: new Map(), fallbackCampaignId };
  }
  return {
    nicheFilter: routing.map((r) => r.niche.toLowerCase()),
    campaignByNiche: new Map(routing.map((r) => [r.niche.toLowerCase(), r.campaignId])),
    fallbackCampaignId,
  };
}

// Campanha de abordagem de um lead: pelo nicho (roteamento) ou fallback do canal.
function campanhaDoLead(
  niche: string | null,
  campaignByNiche: Map<string, string>,
  fallbackCampaignId: string | null,
): string | null {
  if (niche) {
    const byNiche = campaignByNiche.get(niche.toLowerCase());
    if (byNiche) return byNiche;
  }
  return fallbackCampaignId;
}

// Monta (ou reaproveita, se ja existir) o plano do dia para um canal: calcula
// o restante do warm-up, seleciona leads elegiveis e, conforme dispatchMode,
// ja enfileira (auto) ou so registra para aprovacao (approval).
async function montarFilaCanal(
  config: AutomationConfig,
  channel: WarmupChannel,
  planDateStr: string,
  now: Date,
  quietDelaySeconds: number,
): Promise<void> {
  const organizationId = config.organizationId;

  const warmup = await getChannelWarmup(organizationId, channel);
  if (!warmup?.enabled) return;

  const [existing] = await db
    .select({ id: dailySendPlan.id })
    .from(dailySendPlan)
    .where(
      and(
        eq(dailySendPlan.organizationId, organizationId),
        eq(dailySendPlan.planDate, planDateStr),
        eq(dailySendPlan.channel, channel),
      ),
    )
    .limit(1);
  if (existing) {
    console.log(
      `[daily.plan] plano ja existe org=${organizationId} canal=${channel} data=${planDateStr}, pulando`,
    );
    return;
  }

  const capDia = capDiaWarmup(warmup, now);
  const consumo = await consumoHojeCanal(organizationId, channel, now);
  const restante = Math.max(0, capDia - consumo);
  if (restante <= 0) {
    console.log(
      `[daily.plan] sem restante org=${organizationId} canal=${channel} capDia=${capDia} consumo=${consumo}`,
    );
    return;
  }

  const { nicheFilter, campaignByNiche, fallbackCampaignId } = routingDoCanal(
    config,
    channel,
  );

  const rows = await leadsElegiveis(organizationId, channel, restante, nicheFilter);
  // Cada lead ja resolve sua campanha pelo nicho (ou fallback do canal). Leads
  // sem campanha resolvida ficam de fora do plano (nao ha para onde enviar).
  const itens = rows
    .map((r) => ({
      leadId: r.id,
      campaignId: campanhaDoLead(r.niche, campaignByNiche, fallbackCampaignId),
    }))
    .filter((it): it is { leadId: string; campaignId: string } => it.campaignId !== null);
  const planejado = itens.length;
  const custoEstimadoUsd =
    channel === "whatsapp" ? planejado * Number(warmup.costPerMsgUsd) : 0;
  // Campanha "representante" do plano (header): fallback do canal ou a 1a do lote.
  const headerCampaignId = fallbackCampaignId ?? itens[0]?.campaignId ?? null;

  if (config.dispatchMode === "auto") {
    if (planejado === 0) {
      console.log(
        `[daily.plan] auto org=${organizationId} canal=${channel} sem leads elegiveis com campanha, pulando`,
      );
      return;
    }

    const [plan] = await db
      .insert(dailySendPlan)
      .values({
        organizationId,
        planDate: planDateStr,
        channel,
        capDia,
        consumo,
        planejado,
        custoEstimadoUsd: custoEstimadoUsd.toFixed(4),
        status: "auto",
        outreachCampaignId: headerCampaignId,
        decidedAt: now,
      })
      .onConflictDoNothing({
        target: [dailySendPlan.organizationId, dailySendPlan.planDate, dailySendPlan.channel],
      })
      .returning({ id: dailySendPlan.id });
    if (!plan) return; // corrida concorrente: outro processo ja criou o plano do dia

    // Agrupa por campanha e enfileira cada grupo (cada nicho tem sua mensagem).
    // Quiet hours: se o cron rodou na janela 21h-8h BRT, atrasa ate as 8h BRT.
    const porCampanha = new Map<string, string[]>();
    for (const it of itens) {
      const arr = porCampanha.get(it.campaignId) ?? [];
      arr.push(it.leadId);
      porCampanha.set(it.campaignId, arr);
    }
    let enfileirados = 0;
    for (const [campaignId, leadIds] of porCampanha) {
      const result = await enrollLeadsIntoCampaign({
        organizationId,
        campaignId,
        leadIds,
        startAfterOffsetSeconds: quietDelaySeconds,
      });
      enfileirados += result.enfileirados;
    }
    console.log(
      `[daily.plan] auto org=${organizationId} canal=${channel} enfileirados=${enfileirados} campanhas=${porCampanha.size}`,
    );
    return;
  }

  // approval: so registra o plano + itens (com campanha por lead), sem
  // enfileirar nada. A aprovacao (outreach/plan) agrupa por campanha e envia.
  const [plan] = await db
    .insert(dailySendPlan)
    .values({
      organizationId,
      planDate: planDateStr,
      channel,
      capDia,
      consumo,
      planejado,
      custoEstimadoUsd: custoEstimadoUsd.toFixed(4),
      status: "pending",
      outreachCampaignId: headerCampaignId,
    })
    .onConflictDoNothing({
      target: [dailySendPlan.organizationId, dailySendPlan.planDate, dailySendPlan.channel],
    })
    .returning({ id: dailySendPlan.id });
  if (!plan) return;

  if (itens.length > 0) {
    await db.insert(dailySendPlanItem).values(
      itens.map((it) => ({
        planId: plan.id,
        leadId: it.leadId,
        outreachCampaignId: it.campaignId,
        status: "planned" as const,
      })),
    );
  }

  console.log(
    `[daily.plan] pending criado org=${organizationId} canal=${channel} planejado=${planejado}`,
  );
}

async function montarFilaDisparoDoDia(
  config: AutomationConfig,
  planDateStr: string,
  now: Date,
  quietDelaySeconds: number,
): Promise<void> {
  for (const channel of DISPATCH_CHANNELS) {
    try {
      await montarFilaCanal(config, channel, planDateStr, now, quietDelaySeconds);
    } catch (err) {
      console.error(
        `[daily.plan] falha ao montar fila canal=${channel} org=${config.organizationId}`,
        err,
      );
    }
  }
}

export async function handleDailyPlan(): Promise<void> {
  const now = new Date();
  const planDateStr = hojeStr(now);

  // Planos 'pending' de dias anteriores nao ficam pendurados: viram 'expired'.
  await db
    .update(dailySendPlan)
    .set({ status: "expired", decidedAt: now })
    .where(and(eq(dailySendPlan.status, "pending"), lt(dailySendPlan.planDate, planDateStr)));

  // Quiet hours (mesma janela 21h-8h BRT do reengage.tick): se estamos dentro
  // dela, o disparo 'auto' e atrasado ate as 8h BRT em vez de sair na hora.
  const hora = horaLocalSaoPaulo();
  const emQuietHours = hora >= 21 || hora < 8;
  const quietDelaySeconds = emQuietHours ? secondsUntil8hBRT(now) : 0;

  // Inicio do disparo: o dono quer o 1o toque saindo por volta das 09h BRT. O
  // cron roda 08h, entao adiamos 1h (chega em 09h) e somamos ate 1h de variacao
  // (09h..10h) para nao sair sempre no mesmo minuto exato (anti-padrao leve).
  // Somado ao jitter entre leads (sendInterval), fica imprevisivel dentro da
  // janela da manha, sem espalhar pra tarde.
  const BASE_INICIO_S = 3600; // 08h (cron) + 1h = 09h BRT
  const MAX_JITTER_INICIO_S = 3600; // + ate 1h de variacao (09h..10h)
  const jitterInicioSeconds = BASE_INICIO_S + Math.floor(Math.random() * MAX_JITTER_INICIO_S);
  const inicioDelaySeconds = quietDelaySeconds + jitterInicioSeconds;

  const configs = await db.select().from(automationConfig);
  if (configs.length === 0) {
    console.log("[daily.plan] nenhuma org com automation_config, nada a fazer");
    return;
  }

  for (const config of configs) {
    if (config.miningEnabled) {
      await rodarRotacaoMineracao(config, now);
    }
    // DISPARO PRIMEIRO. O disparo do dia usa o pool que JA existe e tem que sair
    // antes do enriquecimento, que e a parte lenta (abre dezenas de sites, ate
    // 8s cada). Se o enrich rodasse antes e estourasse o limite de tempo da
    // funcao serverless (maxDuration=300s), a funcao morreria ANTES de disparar
    // e o dia ficaria sem envio (foi o que zerou o dia 2026-07-31). O enrich so
    // reabastece o pool para os PROXIMOS dias, entao pode vir depois.
    await montarFilaDisparoDoDia(config, planDateStr, now, inicioDelaySeconds);
    // Enriquecimento best-effort DEPOIS do disparo: extrai email dos sites dos
    // leads que ainda nao tem, reabastecendo o pool para os proximos dias.
    // Limite conservador para caber no tempo da funcao; o 2o cron (tarde)
    // enriquece de novo. Timeout/erro aqui nao afeta o disparo, que ja saiu.
    try {
      await enriquecerEmailsDoPool(config.organizationId, 120);
    } catch (err) {
      console.error(`[daily.plan] falha ao enriquecer emails org=${config.organizationId}`, err);
    }
  }
}

// ===================== REFORCO DA TARDE (2o cron) =====================

// Conta as mensagens de hoje de um canal que falharam (error_reason not null),
// para repor exatamente esse tanto e o cap virar ENTREGA, nao so tentativa.
async function contarErrosHojeCanal(
  organizationId: string,
  channel: WarmupChannel,
  hoje: string,
): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM outreach_messages om
    JOIN outreach_threads t ON t.id = om.thread_id
    WHERE t.organization_id = ${organizationId}
      AND t.channel = ${channel}
      AND om.direction = 'outbound'
      AND om.error_reason IS NOT NULL
      AND om.created_at::date = ${hoje}::date
  `);
  return Array.from(rows)[0]?.n ?? 0;
}

// Para cada canal, dispara automaticamente tantos leads NOVOS do pool quantos
// falharam hoje (roteado por nicho). Reposicao do lote ja aprovado de manha,
// entao nao passa por aprovacao.
async function reforcarDisparoDoDia(config: AutomationConfig, now: Date): Promise<void> {
  const hoje = hojeStr(now);
  for (const channel of DISPATCH_CHANNELS) {
    const warmup = await getChannelWarmup(config.organizationId, channel);
    if (!warmup?.enabled) continue;

    const erros = await contarErrosHojeCanal(config.organizationId, channel, hoje);
    if (erros <= 0) continue;

    const { nicheFilter, campaignByNiche, fallbackCampaignId } = routingDoCanal(config, channel);
    const rows = await leadsElegiveis(config.organizationId, channel, erros, nicheFilter);
    const itens = rows
      .map((r) => ({
        leadId: r.id,
        campaignId: campanhaDoLead(r.niche, campaignByNiche, fallbackCampaignId),
      }))
      .filter((it): it is { leadId: string; campaignId: string } => it.campaignId !== null);
    if (itens.length === 0) continue;

    const porCampanha = new Map<string, string[]>();
    for (const it of itens) {
      const arr = porCampanha.get(it.campaignId) ?? [];
      arr.push(it.leadId);
      porCampanha.set(it.campaignId, arr);
    }
    let reposto = 0;
    for (const [campaignId, leadIds] of porCampanha) {
      const r = await enrollLeadsIntoCampaign({
        organizationId: config.organizationId,
        campaignId,
        leadIds,
      });
      reposto += r.enfileirados;
    }
    console.log(
      `[reforco] org=${config.organizationId} canal=${channel} erros=${erros} reposto=${reposto}`,
    );
  }
}

/**
 * Segundo cron (tarde): minera se o pool estiver baixo, enriquece emails e
 * REPOE os disparos que falharam de manha, para os 25/canal virarem entregas
 * de fato. Automatico (nao aguarda aprovacao, e reposicao do lote da manha).
 */
export async function handleDailyPlanReforco(): Promise<void> {
  const now = new Date();
  const configs = await db.select().from(automationConfig);
  if (configs.length === 0) return;

  for (const config of configs) {
    if (config.miningEnabled) {
      try {
        await rodarRotacaoMineracao(config, now);
      } catch (err) {
        console.error(`[reforco] falha mineracao org=${config.organizationId}`, err);
      }
    }
    // Reposicao dos disparos que falharam de manha PRIMEIRO (antes do enrich
    // lento), pelo mesmo motivo do cron da manha: garantir que a acao de disparo
    // aconteca dentro do tempo da funcao serverless.
    try {
      await reforcarDisparoDoDia(config, now);
    } catch (err) {
      console.error(`[reforco] falha disparo org=${config.organizationId}`, err);
    }
    try {
      await enriquecerEmailsDoPool(config.organizationId, 120);
    } catch (err) {
      console.error(`[reforco] falha enrich org=${config.organizationId}`, err);
    }
  }
}
