"use client";

import { useTransition, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveWhatsAppMeta, saveUazAPI, deleteWhatsAppCredential, savePreferredProvider } from "./actions";

/* ─── Meta WABA ────────────────────────────────────────────────── */
export function WhatsAppMetaForm({
  configured,
  phoneNumberIdPreview,
  wabaIdPreview,
  hasAppSecret,
  webhookUrl,
}: {
  configured: boolean;
  phoneNumberIdPreview: string | null;
  wabaIdPreview: string | null;
  hasAppSecret: boolean;
  webhookUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [delPending, delStart] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveWhatsAppMeta(fd);
      if ("ok" in res && res.ok) {
        toast.success("WhatsApp Meta salvo");
        setOpen(false);
      } else {
        toast.error("Erro ao salvar. Verifique os campos.");
      }
    });
  }

  function remove() {
    if (!confirm("Remover credencial WhatsApp Meta?")) return;
    const fd = new FormData();
    fd.set("provider", "whatsapp_api");
    delStart(async () => {
      await deleteWhatsAppCredential(fd);
      toast.success("Removido");
    });
  }

  return (
    <div className="space-y-4">
      {configured && !open ? (
        <div className="flex items-center justify-between">
          <div className="space-y-0.5 text-sm">
            <p className="font-medium">Phone Number ID: {phoneNumberIdPreview}</p>
            {wabaIdPreview && (
              <p className="text-xs text-muted-foreground">WABA ID: {wabaIdPreview}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {hasAppSecret ? "App Secret: configurado" : "App Secret: não configurado"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Atualizar</Button>
            <Button variant="destructive" size="sm" onClick={remove} disabled={delPending}>
              {delPending ? "..." : "Remover"}
            </Button>
          </div>
        </div>
      ) : !open ? (
        <Button onClick={() => setOpen(true)}>Conectar Meta WABA</Button>
      ) : null}

      {open && (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="phoneNumberId">Phone Number ID</Label>
            <Input id="phoneNumberId" name="phoneNumberId" placeholder="123456789012345" required />
            <p className="text-xs text-muted-foreground">
              Meta Business &gt; WhatsApp &gt; Configuração &gt; Phone Number ID
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="accessToken">Access Token</Label>
            <Input id="accessToken" name="accessToken" type="password" placeholder="EAAxxxxxxx..." required />
            <p className="text-xs text-muted-foreground">
              Token permanente do System User com permissão whatsapp_business_messaging
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="verifyToken">Verify Token (webhook)</Label>
            <Input id="verifyToken" name="verifyToken" placeholder="meu_token_secreto" required />
            <p className="text-xs text-muted-foreground">
              Qualquer texto que você escolher. Use o mesmo ao configurar o webhook na Meta.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wabaId">
              WABA ID{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (recomendado para templates)
              </span>
            </Label>
            <Input id="wabaId" name="wabaId" placeholder="123456789012345" />
            <p className="text-xs text-muted-foreground">
              Meta Business &gt; WhatsApp &gt; Visão geral &gt; WhatsApp Business Account ID.
              Necessário para listar templates aprovados.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="appSecret">
              App Secret{" "}
              <span className="text-xs font-normal text-muted-foreground">(opcional, recomendado)</span>
            </Label>
            <Input id="appSecret" name="appSecret" type="password" placeholder="..." />
            <p className="text-xs text-muted-foreground">
              Meta for Developers &gt; Seu App &gt; Configurações &gt; App Secret.
              Usado para validar assinatura HMAC do webhook (segurança extra).
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <div className="rounded-md bg-muted px-3 py-2 text-xs">
        <span className="text-muted-foreground">URL do Webhook para a Meta: </span>
        <span className="font-mono select-all">{webhookUrl}</span>
      </div>
    </div>
  );
}

/* ─── UazAPI ────────────────────────────────────────────────────── */
export function WhatsAppUazAPIForm({
  configured,
  baseUrl,
  status,
  webhookUrl,
}: {
  configured: boolean;
  baseUrl: string | null;
  status: "connected" | "disconnected" | "connecting" | null;
  webhookUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [delPending, delStart] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveUazAPI(fd);
      if ("ok" in res && res.ok) {
        toast.success("UazAPI salvo");
        setOpen(false);
      } else {
        toast.error("Erro ao salvar. Verifique os campos.");
      }
    });
  }

  function remove() {
    if (!confirm("Remover credencial UazAPI?")) return;
    const fd = new FormData();
    fd.set("provider", "whatsapp_uazapi");
    delStart(async () => {
      await deleteWhatsAppCredential(fd);
      toast.success("Removido");
    });
  }

  const statusLabel = status === "connected" ? "Conectado" : status === "connecting" ? "Conectando..." : "Desconectado";

  return (
    <div className="space-y-4">
      {configured && !open ? (
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <p className="font-medium">{baseUrl}</p>
            <p className="text-xs text-muted-foreground">{statusLabel}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Atualizar</Button>
            <Button variant="destructive" size="sm" onClick={remove} disabled={delPending}>
              {delPending ? "..." : "Remover"}
            </Button>
          </div>
        </div>
      ) : !open ? (
        <Button onClick={() => setOpen(true)}>Conectar UazAPI</Button>
      ) : null}

      {open && (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="baseUrl">URL da instância</Label>
            <Input id="baseUrl" name="baseUrl" placeholder="https://focus.uazapi.com" type="url" required />
            <p className="text-xs text-muted-foreground">URL base do seu servidor UazAPI ou cloud UazAPI</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="instanceToken">Instance Token</Label>
            <Input id="instanceToken" name="instanceToken" type="password" placeholder="seu_token_aqui" required />
            <p className="text-xs text-muted-foreground">Token de autenticação da instância no painel UazAPI</p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </form>
      )}

      <div className="rounded-md bg-muted px-3 py-2 text-xs">
        <span className="text-muted-foreground">URL do Webhook para o UazAPI: </span>
        <span className="font-mono select-all">{webhookUrl}</span>
      </div>
    </div>
  );
}

/* ─── Provider preferido ─────────────────────────────────────────── */
export function PreferredProviderForm({
  current,
}: {
  current: "auto" | "meta" | "uazapi";
}) {
  const [pending, start] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const fd = new FormData();
    fd.set("preferredProvider", e.target.value);
    start(async () => {
      await savePreferredProvider(fd);
      toast.success("Provider salvo");
    });
  }

  return (
    <div className="flex items-center gap-3">
      <select
        defaultValue={current}
        onChange={onChange}
        disabled={pending}
        className="rounded-md border bg-background px-3 py-1.5 text-sm"
      >
        <option value="auto">Auto (Meta primeiro, depois UazAPI)</option>
        <option value="meta">Somente Meta Cloud API</option>
        <option value="uazapi">Somente UazAPI</option>
      </select>
      {pending && <span className="text-xs text-muted-foreground">Salvando...</span>}
    </div>
  );
}
