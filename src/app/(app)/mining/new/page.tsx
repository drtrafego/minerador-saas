import { MiningWizard } from "./wizard";

export default function NewMiningPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nova mineracao</h1>
        <p className="text-sm text-muted-foreground">
          Configure nicho, fonte e prompt de qualificacao em 3 passos.
        </p>
      </div>
      <MiningWizard />
    </div>
  );
}
