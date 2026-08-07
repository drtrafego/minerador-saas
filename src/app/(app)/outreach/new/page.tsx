import { NewOutreachForm } from "./form";
import { listApprovedMetaTemplates } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewOutreachPage() {
  const { available, error, templates } = await listApprovedMetaTemplates();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nova campanha</h1>
        <p className="text-sm text-muted-foreground">
          Defina nome, canal e a sequencia inicial de abordagem.
        </p>
      </div>
      <NewOutreachForm
        templates={templates}
        templatesAvailable={available}
        templatesError={error}
      />
    </div>
  );
}
