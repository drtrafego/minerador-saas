import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

import { connectWithQR } from "@/lib/clients/whatsapp-qr";

const args = process.argv.slice(2);
const orgIdx = args.indexOf("--org");
if (orgIdx === -1 || !args[orgIdx + 1]) {
  console.error("Uso: pnpm whatsapp:login --org <organizationId>");
  process.exit(1);
}
const organizationId = args[orgIdx + 1];

console.log(`Iniciando login WhatsApp para org: ${organizationId}`);
console.log("Escaneie o QR code abaixo com o WhatsApp...\n");

connectWithQR(organizationId)
  .then(() => {
    console.log("\nSessao WhatsApp salva com sucesso.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Erro:", err.message);
    process.exit(1);
  });
