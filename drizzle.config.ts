import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://REMOVIDO_POR_SEGURANCA:REMOVIDO_POR_SEGURANCA@host/minerador",
  },
  strict: true,
  verbose: true,
});
