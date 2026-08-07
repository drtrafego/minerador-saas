"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Bot, User, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "@/components/inbox/message-bubble";
import { sendManualMessage, toggleBotPause } from "../actions";

type Message = {
  id: string;
  direction: string;
  status: string;
  step: number;
  subject: string | null;
  body: string;
  errorReason: string | null;
  sentAt: Date | null;
  createdAt: Date;
  metadata?: Record<string, unknown> | null;
};

export function ChatActions({
  threadId,
  channel,
  botPaused,
  messages: initialMessages,
}: {
  threadId: string;
  channel: string;
  botPaused: boolean;
  messages: Message[];
}) {
  const [paused, setPaused] = useState(botPaused);
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [pendingSend, startSend] = useTransition();
  const [pendingToggle, startToggle] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const isWhatsApp = channel === "whatsapp";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleToggle() {
    const next = !paused;
    startToggle(async () => {
      const res = await toggleBotPause(threadId, next);
      if ("error" in res) {
        toast.error(String(res.error));
        return;
      }
      setPaused(next);
      toast.success(
        next ? "Bot pausado. Atendimento humano ativo." : "Bot reativado.",
      );
    });
  }

  function handleSend() {
    if (!body.trim()) return;
    const text = body.trim();
    setBody("");
    startSend(async () => {
      const res = await sendManualMessage(threadId, text);
      if ("error" in res) {
        toast.error(res.error);
        setBody(text);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          direction: "outbound",
          status: "sent",
          step: 0,
          subject: null,
          body: text,
          errorReason: null,
          sentAt: new Date(),
          createdAt: new Date(),
          metadata: { manual: true },
        },
      ]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controle bot/humano */}
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="flex items-center gap-2 text-sm">
          {paused ? (
            <User className="h-4 w-4 text-warning" />
          ) : (
            <Bot className="h-4 w-4 text-info" />
          )}
          <span
            className={
              paused
                ? "text-warning font-medium"
                : "text-info font-medium"
            }
          >
            {paused ? "Atendimento humano ativo" : "Bot ativo"}
          </span>
          {paused && (
            <span className="text-xs text-muted-foreground">
              bot não responde automaticamente
            </span>
          )}
        </div>
        <Button
          variant={paused ? "default" : "outline"}
          size="sm"
          onClick={handleToggle}
          disabled={pendingToggle}
        >
          {paused ? "Reativar bot" : "Assumir atendimento"}
        </Button>
      </div>

      {/* Área de conversa */}
      <div className="min-h-[200px] max-h-[520px] overflow-y-auto rounded-lg border bg-[#efeae2]/40 p-4 flex flex-col gap-2">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Sem mensagens ainda.
          </p>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              direction={msg.direction as "inbound" | "outbound"}
              body={msg.body}
              subject={msg.subject}
              timestamp={msg.sentAt ?? msg.createdAt}
              status={msg.status}
              isManual={
                msg.direction === "outbound" &&
                Boolean(msg.metadata?.manual)
              }
              errorReason={msg.errorReason}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input de envio (só WhatsApp) */}
      {isWhatsApp ? (
        <div className="flex gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escreva uma mensagem..."
            rows={3}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            onClick={handleSend}
            disabled={pendingSend || !body.trim()}
            className="self-end"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center">
          Envio manual disponível apenas para conversas WhatsApp.
        </p>
      )}
    </div>
  );
}
