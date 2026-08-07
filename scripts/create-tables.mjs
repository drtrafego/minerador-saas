import postgres from '../node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/index.js';

const DB = 'postgresql://REMOVIDO_POR_SEGURANCA:REMOVIDO_POR_SEGURANCA@host/neondb?sslmode=require';
const sql = postgres(DB);

const tables = [
  [`organization`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."organization" ("id" text PRIMARY KEY NOT NULL,"name" text NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`credentials`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."credentials" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"provider" "minerador_scrapling"."credential_provider" NOT NULL,"encrypted_data" text NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`campaigns`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."campaigns" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"name" text NOT NULL,"status" "minerador_scrapling"."campaign_status" DEFAULT 'draft' NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`campaign_sources`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."campaign_sources" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"campaign_id" text NOT NULL,"source_type" "minerador_scrapling"."campaign_source_type" NOT NULL,"config" jsonb DEFAULT '{}'::jsonb NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`leads`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."leads" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"campaign_id" text,"source" "minerador_scrapling"."lead_source" NOT NULL,"external_id" text NOT NULL,"display_name" text NOT NULL,"handle" text,"email" text,"phone" text,"website" text,"city" text,"region" text,"country" text,"company" text,"headline" text,"linkedin_url" text,"profile_picture_url" text,"follower_count" integer,"rating" numeric,"review_count" integer,"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,"qualification_status" "minerador_scrapling"."lead_qualification_status" DEFAULT 'pending' NOT NULL,"qualification_score" integer,"qualification_notes" text,"temperature" "minerador_scrapling"."lead_temperature","created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`outreach_threads`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."outreach_threads" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"campaign_id" text,"lead_id" text NOT NULL,"channel" "minerador_scrapling"."outreach_channel" NOT NULL,"status" "minerador_scrapling"."outreach_thread_status" DEFAULT 'queued' NOT NULL,"last_message_at" timestamp with time zone,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`outreach_messages`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."outreach_messages" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"thread_id" text NOT NULL,"direction" "minerador_scrapling"."outreach_message_direction" NOT NULL,"channel" "minerador_scrapling"."outreach_channel" NOT NULL,"status" "minerador_scrapling"."outreach_message_status" DEFAULT 'pending' NOT NULL,"body" text NOT NULL,"external_id" text,"sent_at" timestamp with time zone,"created_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`outreach_queue`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."outreach_queue" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"thread_id" text NOT NULL,"channel" "minerador_scrapling"."outreach_channel" NOT NULL,"status" "minerador_scrapling"."outreach_queue_status" DEFAULT 'pending' NOT NULL,"scheduled_at" timestamp with time zone NOT NULL,"body" text NOT NULL,"attempt" integer DEFAULT 0 NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`scraping_jobs`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."scraping_jobs" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"campaign_id" text,"status" "minerador_scrapling"."job_status" DEFAULT 'pending' NOT NULL,"source_type" "minerador_scrapling"."campaign_source_type" NOT NULL,"config" jsonb DEFAULT '{}'::jsonb NOT NULL,"result" jsonb,"error" text,"started_at" timestamp with time zone,"finished_at" timestamp with time zone,"created_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`qualification_jobs`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."qualification_jobs" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"campaign_id" text,"status" "minerador_scrapling"."job_status" DEFAULT 'pending' NOT NULL,"lead_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,"result" jsonb,"error" text,"started_at" timestamp with time zone,"finished_at" timestamp with time zone,"created_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`send_counters`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."send_counters" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"campaign_id" text NOT NULL,"channel" "minerador_scrapling"."outreach_channel" NOT NULL,"day" date NOT NULL,"count" integer DEFAULT 0 NOT NULL)`],
  [`events`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."events" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"type" text NOT NULL,"entity_type" text,"entity_id" text,"data" jsonb DEFAULT '{}'::jsonb NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`webhooks_log`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."webhooks_log" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"provider" text NOT NULL,"event" text NOT NULL,"payload" jsonb NOT NULL,"signature" text,"created_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`activities`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."activities" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"lead_id" text NOT NULL,"type" "minerador_scrapling"."activity_type" NOT NULL,"note" text,"created_by" text,"created_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`browser_runs`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."browser_runs" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text NOT NULL,"status" "minerador_scrapling"."browser_run_status" DEFAULT 'ok' NOT NULL,"provider" text NOT NULL,"result" jsonb,"error" text,"created_at" timestamp with time zone DEFAULT now() NOT NULL)`],
  [`agent_configs`, `CREATE TABLE IF NOT EXISTS "minerador_scrapling"."agent_configs" ("id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"organization_id" text UNIQUE NOT NULL,"system_prompt" text NOT NULL,"enabled" boolean DEFAULT true NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL)`],
];

let ok = 0, fail = 0;
for (const [name, stmt] of tables) {
  try {
    await sql.unsafe(stmt);
    console.log('OK:', name);
    ok++;
  } catch(e) {
    console.error('FAIL:', name, '-', e.message.slice(0, 100));
    fail++;
  }
}

console.log(`\nResultado: ${ok} criadas, ${fail} falhas`);
await sql.end();
