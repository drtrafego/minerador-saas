export type ScrapeRunPayload = {
  miningId: string;
  organizationId: string;
  // Ausente: processa todas as fontes da mineracao em paralelo (fluxo normal).
  // Presente: processa so aquela fonte (re-disparo individual).
  sourceId?: string;
};

export type NormalizedLead = {
  source: "google_places" | "instagram" | "manual" | "import" | "linkedin";
  externalId: string;
  displayName: string;
  handle?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  headline?: string | null;
  company?: string | null;
  rawData: Record<string, unknown>;
};

export type ScrapeIngestPayload = {
  organizationId: string;
  miningId: string;
  sourceType: "google_places" | "apify_instagram" | "linkedin_search";
  scrapingJobId: string;
  leads: NormalizedLead[];
};

export type QualifyBatchPayload = {
  organizationId: string;
  miningId: string;
  batchSize?: number;
};

// Envio de um toque de uma campanha de abordagem (outreach_campaigns) para um
// campaign_lead especifico.
export type CampaignSendPayload = {
  campaignLeadId: string;
};

export type AgentReplyPayload = {
  organizationId: string;
  threadId: string;
  inboundMessageId: string;
};

export type ReengageTickPayload = Record<string, never>;

// Cron diario da automacao de prospeccao: minera o combo do dia (rotacao) e
// monta a fila de disparo do dia por canal (whatsapp/email), respeitando o
// warm-up. Nao recebe payload (processa todas as orgs com automation_config).
export type DailyPlanPayload = Record<string, never>;
