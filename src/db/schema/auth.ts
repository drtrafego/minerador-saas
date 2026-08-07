import { text, timestamp } from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";

// Stack Auth gerencia users/sessions na cloud deles.
// Mantemos apenas a tabela organization para guardar o team ID do Stack Auth
// como chave primaria, vinculando todos os dados da aplicacao ao time correto.
export const organization = ms.table("organization", {
  id: text("id").primaryKey(), // Stack Auth team ID
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
