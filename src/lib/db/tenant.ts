import "server-only";
import { and, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export function tenantDb(organizationId: string) {
  if (!organizationId) {
    throw new Error("organizationId obrigatorio");
  }

  return {
    orgId: organizationId,

    scopeWhere(orgColumn: AnyPgColumn, extra?: SQL): SQL {
      const base = eq(orgColumn, organizationId);
      return extra ? (and(base, extra) as SQL) : base;
    },
  };
}

export type TenantDb = ReturnType<typeof tenantDb>;
