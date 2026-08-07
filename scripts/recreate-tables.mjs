import postgres from '../node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/index.js';

const DB = 'postgresql://REMOVIDO_POR_SEGURANCA:REMOVIDO_POR_SEGURANCA@host/neondb?sslmode=require';
const sql = postgres(DB);
const S = '"minerador_scrapling"';

async function run(label, stmt) {
  try { await sql.unsafe(stmt); console.log('OK:', label); }
  catch(e) { console.error('FAIL:', label, '-', e.message.slice(0, 120)); }
}

// 1. Drop todas as tabelas na ordem correta (FK constraints)
const drops = [
  'browser_runs','outreach_queue','outreach_messages','outreach_threads',
  'send_counters','qualification_jobs','scraping_jobs','activities',
  'pipeline_stages','leads','campaign_sources','campaigns','agent_configs',
  'webhooks_log','events','credentials','organization',
];
for (const t of drops) {
  await run(`DROP ${t}`, `DROP TABLE IF EXISTS ${S}."${t}" CASCADE`);
}

// 2. Recriar na ordem correta
await run('organization', `CREATE TABLE ${S}."organization" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
)`);

await run('credentials', `CREATE TABLE ${S}."credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "provider" ${S}."credential_provider" NOT NULL,
  "label" text NOT NULL,
  "ciphertext" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx credentials', `CREATE INDEX ON ${S}."credentials"("organization_id","provider")`);

await run('campaigns', `CREATE TABLE ${S}."campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "niche" text,
  "status" ${S}."campaign_status" NOT NULL DEFAULT 'draft',
  "icp" jsonb,
  "qualification_prompt" text,
  "qualification_model" text NOT NULL DEFAULT 'claude-sonnet-4-5',
  "daily_limit" integer NOT NULL DEFAULT 30,
  "initial_copy" text,
  "follow_up_sequence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "smart_follow_up" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx campaigns', `CREATE INDEX ON ${S}."campaigns"("organization_id","status")`);

await run('campaign_sources', `CREATE TABLE ${S}."campaign_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "campaign_id" uuid NOT NULL REFERENCES ${S}."campaigns"("id") ON DELETE CASCADE,
  "type" ${S}."campaign_source_type" NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_run_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx campaign_sources', `CREATE INDEX ON ${S}."campaign_sources"("organization_id","campaign_id")`);

await run('leads', `CREATE TABLE ${S}."leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "campaign_id" uuid REFERENCES ${S}."campaigns"("id") ON DELETE SET NULL,
  "source" ${S}."lead_source" NOT NULL,
  "external_id" text NOT NULL,
  "display_name" text NOT NULL,
  "handle" text,
  "website" text,
  "phone" text,
  "email" text,
  "city" text,
  "region" text,
  "country" text,
  "linkedin_url" text,
  "headline" text,
  "company" text,
  "raw_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "qualification_status" ${S}."lead_qualification_status" NOT NULL DEFAULT 'pending',
  "qualification_reason" text,
  "qualification_score" integer,
  "qualified_at" timestamptz,
  "temperature" ${S}."lead_temperature",
  "pipeline_stage_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
)`);
await run('idx leads unique', `CREATE UNIQUE INDEX "leads_org_source_external_idx" ON ${S}."leads"("organization_id","source","external_id")`);
await run('idx leads status', `CREATE INDEX "leads_org_campaign_status_idx" ON ${S}."leads"("organization_id","campaign_id","qualification_status")`);

await run('pipeline_stages', `CREATE TABLE ${S}."pipeline_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text NOT NULL DEFAULT '#64748b',
  "position" integer NOT NULL,
  "is_won" boolean NOT NULL DEFAULT false,
  "is_lost" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx pipeline_stages', `CREATE INDEX ON ${S}."pipeline_stages"("organization_id","position")`);
await run('idx pipeline_stages name', `CREATE UNIQUE INDEX ON ${S}."pipeline_stages"("organization_id","name")`);

await run('activities', `CREATE TABLE ${S}."activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "lead_id" uuid NOT NULL REFERENCES ${S}."leads"("id") ON DELETE CASCADE,
  "type" ${S}."activity_type" NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "due_at" timestamptz,
  "completed_at" timestamptz,
  "created_by_user_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx activities lead', `CREATE INDEX ON ${S}."activities"("lead_id")`);
await run('idx activities org due', `CREATE INDEX ON ${S}."activities"("organization_id","due_at")`);

await run('agent_configs', `CREATE TABLE ${S}."agent_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL UNIQUE REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT false,
  "business_name" text,
  "business_info" text,
  "tone" text NOT NULL DEFAULT 'profissional e direto',
  "system_prompt_override" text,
  "rules" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "handoff_keywords" jsonb NOT NULL DEFAULT '["humano","atendente","pessoa real","parar","stop"]'::jsonb,
  "preferred_provider" text NOT NULL DEFAULT 'auto',
  "max_auto_replies" integer NOT NULL DEFAULT 6,
  "model" text NOT NULL DEFAULT 'claude-sonnet-4-5',
  "temperature" integer NOT NULL DEFAULT 70,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);

await run('outreach_threads', `CREATE TABLE ${S}."outreach_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "campaign_id" uuid REFERENCES ${S}."campaigns"("id") ON DELETE SET NULL,
  "lead_id" uuid NOT NULL REFERENCES ${S}."leads"("id") ON DELETE CASCADE,
  "channel" ${S}."outreach_channel" NOT NULL,
  "status" ${S}."outreach_thread_status" NOT NULL DEFAULT 'queued',
  "current_step" integer NOT NULL DEFAULT 0,
  "last_message_at" timestamptz,
  "last_outbound_at" timestamptz,
  "last_inbound_at" timestamptz,
  "external_thread_id" text,
  "followup_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
)`);
await run('idx threads', `CREATE INDEX ON ${S}."outreach_threads"("organization_id","campaign_id","status")`);
await run('idx threads lead', `CREATE INDEX ON ${S}."outreach_threads"("organization_id","lead_id")`);

await run('outreach_messages', `CREATE TABLE ${S}."outreach_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "thread_id" uuid NOT NULL REFERENCES ${S}."outreach_threads"("id") ON DELETE CASCADE,
  "direction" ${S}."outreach_message_direction" NOT NULL,
  "status" ${S}."outreach_message_status" NOT NULL DEFAULT 'pending',
  "step" integer NOT NULL DEFAULT 0,
  "subject" text,
  "body" text NOT NULL,
  "external_message_id" text,
  "error_reason" text,
  "metadata" jsonb,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx messages', `CREATE INDEX ON ${S}."outreach_messages"("organization_id","thread_id")`);

await run('outreach_queue', `CREATE TABLE ${S}."outreach_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "thread_id" uuid NOT NULL REFERENCES ${S}."outreach_threads"("id") ON DELETE CASCADE,
  "message_id" uuid REFERENCES ${S}."outreach_messages"("id") ON DELETE SET NULL,
  "channel" ${S}."outreach_channel" NOT NULL,
  "step" integer NOT NULL DEFAULT 0,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" ${S}."outreach_queue_status" NOT NULL DEFAULT 'pending',
  "scheduled_at" timestamptz NOT NULL,
  "locked_until" timestamptz,
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx queue', `CREATE INDEX ON ${S}."outreach_queue"("organization_id","status","scheduled_at")`);

await run('browser_runs', `CREATE TABLE ${S}."browser_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "credential_id" uuid REFERENCES ${S}."credentials"("id") ON DELETE SET NULL,
  "channel" ${S}."outreach_channel" NOT NULL,
  "status" ${S}."browser_run_status" NOT NULL,
  "thread_id" uuid REFERENCES ${S}."outreach_threads"("id") ON DELETE SET NULL,
  "message_id" uuid REFERENCES ${S}."outreach_messages"("id") ON DELETE SET NULL,
  "duration_ms" integer,
  "error_reason" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx browser_runs', `CREATE INDEX ON ${S}."browser_runs"("organization_id","channel","created_at" DESC)`);

await run('scraping_jobs', `CREATE TABLE ${S}."scraping_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "campaign_id" uuid REFERENCES ${S}."campaigns"("id") ON DELETE SET NULL,
  "source_type" text NOT NULL,
  "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" ${S}."job_status" NOT NULL DEFAULT 'pending',
  "leads_found" integer NOT NULL DEFAULT 0,
  "leads_inserted" integer NOT NULL DEFAULT 0,
  "error" text,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx scraping_jobs', `CREATE INDEX ON ${S}."scraping_jobs"("organization_id","campaign_id","status")`);

await run('qualification_jobs', `CREATE TABLE ${S}."qualification_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "campaign_id" uuid REFERENCES ${S}."campaigns"("id") ON DELETE SET NULL,
  "lead_id" uuid NOT NULL,
  "status" ${S}."job_status" NOT NULL DEFAULT 'pending',
  "model" text,
  "prompt_tokens" integer,
  "completion_tokens" integer,
  "cost_usd" numeric(10,6),
  "result" jsonb,
  "error" text,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx qualification_jobs', `CREATE INDEX ON ${S}."qualification_jobs"("organization_id","status")`);

await run('send_counters', `CREATE TABLE ${S}."send_counters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "campaign_id" uuid NOT NULL REFERENCES ${S}."campaigns"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "bucket" text NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx send_counters', `CREATE UNIQUE INDEX ON ${S}."send_counters"("organization_id","campaign_id","channel","bucket")`);

await run('events', `CREATE TABLE ${S}."events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "actor_user_id" text,
  "type" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "data" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx events', `CREATE INDEX ON ${S}."events"("organization_id","type","created_at")`);

await run('webhooks_log', `CREATE TABLE ${S}."webhooks_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text REFERENCES ${S}."organization"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "signature" text,
  "processed_at" timestamptz,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
)`);
await run('idx webhooks_log', `CREATE INDEX ON ${S}."webhooks_log"("provider","event")`);

console.log('\nConcluido.');
await sql.end();
