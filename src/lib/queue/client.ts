import { PgBoss } from "pg-boss";

const globalForBoss = globalThis as unknown as {
  pgBoss?: PgBoss;
  pgBossReady?: Promise<PgBoss>;
};

function createBoss(): PgBoss {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL nao definida");
  }
  const schema = process.env.PGBOSS_SCHEMA ?? "pgboss";
  // Manutenção de fundo espaçada: supervise/maintenance/monitor são varreduras
  // periódicas que tocam o banco mesmo sem trabalho. Afrouxar reduz a carga
  // contínua (parte do que manteve o Neon free acordado 24/7 e estourou a cota).
  // O polling de jobs propriamente dito é configurado por fila no worker, via
  // POLLING_INTERVAL_SECONDS (opção pollingIntervalSeconds do boss.work).
  return new PgBoss({
    connectionString,
    schema,
    application_name: "minerador_claude",
    superviseIntervalSeconds: 120,
    maintenanceIntervalSeconds: 300,
    monitorIntervalSeconds: 120,
  });
}

export async function getBoss(): Promise<PgBoss> {
  if (globalForBoss.pgBoss) return globalForBoss.pgBoss;
  if (globalForBoss.pgBossReady) return globalForBoss.pgBossReady;

  const boss = createBoss();
  globalForBoss.pgBossReady = boss.start().then(() => {
    globalForBoss.pgBoss = boss;
    return boss;
  });

  return globalForBoss.pgBossReady;
}

// Intervalo de polling por fila (boss.work). O default do pg-boss é 2s, o que
// mantém o banco sob consulta constante. 5s corta ~60% das consultas sem
// prejudicar a responsividade do bot. Ajustável por env.
export const POLLING_INTERVAL_SECONDS = Number(
  process.env.PGBOSS_POLLING_INTERVAL_SECONDS ?? "5",
);

export const QUEUES = {
  scrapeRun: "scrape.run",
  scrapeIngest: "scrape.ingest",
  qualifyBatch: "qualify.batch",
  campaignSend: "campaign.send",
  agentReply: "agent.reply",
  reengageTick: "reengage.tick",
  dailyPlan: "daily.plan",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
