import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (existsSync(resolve(process.cwd(), ".env.local"))) {
  loadEnv({ path: ".env.local" });
} else {
  loadEnv();
}

import type { Job } from "pg-boss";
import { getBoss, QUEUES, POLLING_INTERVAL_SECONDS } from "@/lib/queue/client";
import { handleScrapeRun } from "@/lib/queue/handlers/scrape";
import { handleScrapeIngest } from "@/lib/queue/handlers/ingest";
import { handleQualifyBatch } from "@/lib/queue/handlers/qualify";
import { handleCampaignSend } from "@/lib/queue/handlers/campaign-send";
import { handleAgentReply } from "@/lib/queue/handlers/agent-reply";
import { handleReengageTick } from "@/lib/queue/handlers/reengage-tick";
import { handleDailyPlan } from "@/lib/queue/handlers/daily-plan";
import { closeAllWhatsAppSockets } from "@/lib/clients/whatsapp-qr";
import type {
  QualifyBatchPayload,
  ScrapeIngestPayload,
  ScrapeRunPayload,
  CampaignSendPayload,
  AgentReplyPayload,
  ReengageTickPayload,
  DailyPlanPayload,
} from "@/lib/queue/types";

async function main() {
  const boss = await getBoss();

  boss.on("error", (err: Error) => {
    console.error("[pg-boss] error", err);
  });

  const queuePolicy = {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
  };

  await boss.createQueue(QUEUES.scrapeRun, queuePolicy);
  await boss.createQueue(QUEUES.scrapeIngest, queuePolicy);
  await boss.createQueue(QUEUES.qualifyBatch, queuePolicy);
  await boss.createQueue(QUEUES.campaignSend, queuePolicy);
  await boss.createQueue(QUEUES.agentReply, queuePolicy);
  await boss.createQueue(QUEUES.reengageTick, queuePolicy);
  await boss.createQueue(QUEUES.dailyPlan, queuePolicy);

  // 1 job por mineracao; o handleScrapeRun roda as 3 fontes EM PARALELO por
  // dentro (Promise.allSettled). Assim o Google (Scrapling, lento) nao segura o
  // LinkedIn/Instagram (Apify, rapidos). batchSize 1 = uma mineracao por vez.
  await boss.work<ScrapeRunPayload>(
    QUEUES.scrapeRun,
    { batchSize: 1, pollingIntervalSeconds: POLLING_INTERVAL_SECONDS },
    async (jobs: Job<ScrapeRunPayload>[]) => {
      for (const job of jobs) {
        console.log(`[scrape.run] processando ${job.id}`);
        try {
          await handleScrapeRun(job.data);
          console.log(`[scrape.run] ok ${job.id}`);
        } catch (err) {
          console.error(`[scrape.run] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<ScrapeIngestPayload>(
    QUEUES.scrapeIngest,
    { batchSize: 1, pollingIntervalSeconds: POLLING_INTERVAL_SECONDS },
    async (jobs: Job<ScrapeIngestPayload>[]) => {
      for (const job of jobs) {
        console.log(`[scrape.ingest] processando ${job.id}`);
        try {
          await handleScrapeIngest(job.data);
          console.log(`[scrape.ingest] ok ${job.id}`);
        } catch (err) {
          console.error(`[scrape.ingest] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<QualifyBatchPayload>(
    QUEUES.qualifyBatch,
    { batchSize: 1, pollingIntervalSeconds: POLLING_INTERVAL_SECONDS },
    async (jobs: Job<QualifyBatchPayload>[]) => {
      for (const job of jobs) {
        console.log(`[qualify.batch] processando ${job.id}`);
        try {
          await handleQualifyBatch(job.data);
          console.log(`[qualify.batch] ok ${job.id}`);
        } catch (err) {
          console.error(`[qualify.batch] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<CampaignSendPayload>(
    QUEUES.campaignSend,
    { batchSize: 3, pollingIntervalSeconds: POLLING_INTERVAL_SECONDS },
    async (jobs: Job<CampaignSendPayload>[]) => {
      for (const job of jobs) {
        console.log(`[campaign.send] processando ${job.id}`);
        try {
          await handleCampaignSend(job.data);
          console.log(`[campaign.send] ok ${job.id}`);
        } catch (err) {
          console.error(`[campaign.send] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<AgentReplyPayload>(
    QUEUES.agentReply,
    { batchSize: 2, pollingIntervalSeconds: POLLING_INTERVAL_SECONDS },
    async (jobs: Job<AgentReplyPayload>[]) => {
      for (const job of jobs) {
        console.log(`[agent.reply] processando ${job.id}`);
        try {
          await handleAgentReply(job.data);
          console.log(`[agent.reply] ok ${job.id}`);
        } catch (err) {
          console.error(`[agent.reply] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<ReengageTickPayload>(
    QUEUES.reengageTick,
    { batchSize: 1, pollingIntervalSeconds: POLLING_INTERVAL_SECONDS },
    async (jobs: Job<ReengageTickPayload>[]) => {
      for (const job of jobs) {
        try {
          await handleReengageTick();
        } catch (err) {
          console.error(`[reengage.tick] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<DailyPlanPayload>(
    QUEUES.dailyPlan,
    { batchSize: 1, pollingIntervalSeconds: POLLING_INTERVAL_SECONDS },
    async (jobs: Job<DailyPlanPayload>[]) => {
      for (const job of jobs) {
        console.log(`[daily.plan] processando ${job.id}`);
        try {
          await handleDailyPlan();
          console.log(`[daily.plan] ok ${job.id}`);
        } catch (err) {
          console.error(`[daily.plan] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  try {
    await boss.schedule(QUEUES.reengageTick, "*/15 * * * *");
  } catch (err) {
    console.error("[worker] falha ao registrar cron reengage.tick", err);
  }

  // O cron daily.plan NAO e mais registrado aqui: a orquestracao diaria roda
  // no Vercel Cron (/api/cron/daily-plan, 08:00 BRT), com o codigo sempre
  // atualizado. O worker apenas consome as filas de trabalho (scrape.run,
  // qualify.batch, campaign.send, etc). O handler daily.plan abaixo fica
  // registrado por compatibilidade, mas sem schedule nunca recebe jobs.

  console.log("[worker] pronto, aguardando jobs");

  const shutdown = async () => {
    console.log("[worker] desligando");
    try {
      await closeAllWhatsAppSockets();
      await boss.stop({ graceful: true, close: true });
    } catch (err) {
      console.error("[worker] erro ao desligar", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] falha fatal", err);
  process.exit(1);
});
