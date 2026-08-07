"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useUser } from "@stackframe/stack";
import { createOrganization } from "@/lib/actions/onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const user = useUser({ or: "redirect" });
  const [loading, setLoading] = useState(false);
  const [errorLog, setErrorLog] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (!name) {
      toast.error("Nome obrigatorio");
      return;
    }
    setLoading(true);
    setErrorLog(null);
    try {
      const teamId = await createOrganization(name);
      await user.setSelectedTeam(teamId);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error
        ? `${err.name}: ${err.message}\n${err.stack ?? ""}`
        : JSON.stringify(err, null, 2);
      setErrorLog(msg);
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bem-vindo</CardTitle>
        <CardDescription>
          Crie sua primeira organizacao para comecar
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome da organizacao</Label>
            <Input id="name" name="name" placeholder="Casal do Tráfego" required />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Criando..." : "Criar e continuar"}
          </Button>
          {errorLog && (
            <div className="w-full rounded border border-destructive/40 bg-destructive/10 p-3">
              <p className="mb-1 text-xs font-semibold text-destructive">Erro, copie e cole para o suporte:</p>
              <pre className="whitespace-pre-wrap break-all text-xs text-destructive select-all">{errorLog}</pre>
            </div>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
