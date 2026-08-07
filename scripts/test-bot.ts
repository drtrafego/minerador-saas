/**
 * Testa o bot inbound simulando um webhook do WhatsApp.
 * Uso: pnpm tsx scripts/test-bot.ts [mensagem] [--uazapi]
 *
 * Exemplos:
 *   pnpm tsx scripts/test-bot.ts "Oi, tudo bem?"
 *   pnpm tsx scripts/test-bot.ts "Quero saber mais" --uazapi
 */

import "dotenv/config";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://seu-dominio.com";
const msg = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? "Oi, vi que vocês trabalham com marketing. Podem me ajudar?";
const useUazApi = process.argv.includes("--uazapi");

async function testMeta() {
  const payload = {
    entry: [{
      changes: [{
        value: {
          phone_number_id: process.env.TEST_PHONE_NUMBER_ID ?? "COLOQUE_O_PHONE_NUMBER_ID_AQUI",
          messages: [{
            id: `wamid.test.${Date.now()}`,
            from: process.env.TEST_FROM_NUMBER ?? "5511999999999",
            type: "text",
            text: { body: msg },
            timestamp: Math.floor(Date.now() / 1000).toString(),
          }],
        },
      }],
    }],
  };

  console.log("Enviando webhook Meta Cloud API...");
  const res = await fetch(`${APP_URL}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  console.log("Status:", res.status, body);
}

async function testUazApi() {
  const payload = {
    event: "message",
    data: {
      id: `uazapi.test.${Date.now()}`,
      from: process.env.TEST_FROM_NUMBER ?? "5511999999999",
      body: msg,
      type: "text",
    },
  };

  console.log("Enviando webhook UazAPI...");
  const res = await fetch(`${APP_URL}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  console.log("Status:", res.status, body);
}

if (useUazApi) {
  testUazApi().catch(console.error);
} else {
  testMeta().catch(console.error);
}
