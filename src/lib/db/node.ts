import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const globalForPg = globalThis as unknown as {
  pgNode?: ReturnType<typeof postgres>;
  dbNode?: ReturnType<typeof drizzle<typeof schema>>;
};

function getDb() {
  if (globalForPg.dbNode) return globalForPg.dbNode;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL nao definida");
  }

  // search_path explicito: garante que queries SQL raw nao-qualificadas resolvam
  // para o schema minerador_scrapling (e nao para objetos antigos duplicados em public).
  const pg =
    globalForPg.pgNode ??
    postgres(connectionString, {
      max: 8,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      connection: { search_path: "minerador_scrapling,public" },
    });

  // Cacheia o pool e a instancia SEMPRE (inclusive em producao). Sem isso, cada
  // acesso ao Proxy db chamava getDb() e criava um NOVO pool postgres, vazando
  // conexoes ate estourar max_connections ("sorry, too many clients already").
  globalForPg.pgNode = pg;
  const instance = drizzle(pg, { schema });
  globalForPg.dbNode = instance;

  return instance;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export type Database = ReturnType<typeof drizzle<typeof schema>>;
