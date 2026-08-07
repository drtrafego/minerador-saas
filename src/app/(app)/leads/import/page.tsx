import { requireOrg } from "@/lib/auth/guards";
import { listMinings } from "@/lib/db/queries/minings";
import { ImportWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const { organizationId } = await requireOrg();
  const campaigns = await listMinings(organizationId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Importar leads (CSV)</h1>
        <p className="text-sm text-muted-foreground">
          Cole CSV ou carregue um arquivo. Mapeie as colunas e importe em lote.
        </p>
      </div>
      <ImportWizard campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}
