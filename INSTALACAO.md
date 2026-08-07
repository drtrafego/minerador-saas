# Manual de Instalação

Guia passo a passo para colocar o Minerador SaaS para funcionar do zero, incluindo o que é cada chave e onde conseguir. Se você nunca mexeu com isso, siga na ordem que dá certo.

---

## Parte 1. O que é (explicação básica)

O Minerador é um robô de prospecção. Ele faz sozinho o caminho que um vendedor faria na mão:

1. **Procura clientes** em três lugares: Google Maps, LinkedIn e Instagram.
2. **Pega o contato** de cada um (telefone, email, site).
3. **Deixa a inteligência artificial decidir** quem tem cara de bom cliente.
4. **Manda a mensagem de abordagem** por email ou WhatsApp, no ritmo certo para não ser bloqueado.
5. **Responde quem responde**, com um agente de IA.

Você opera tudo por um painel no navegador. Cada conta (organização) tem suas próprias chaves, campanhas e leads, separados dos outros.

---

## Parte 2. O que você vai precisar

**Ferramentas (instale antes):**

- **Docker** e Docker Compose (para subir o banco e o serviço de scraping). Instalação: https://get.docker.com
- **Node.js 20 ou maior** e **pnpm** (para rodar o painel). O pnpm se instala com `npm install -g pnpm`.
- Um editor de texto para preencher o arquivo de chaves.

**Onde rodar:**

- Para **testar**, serve o seu próprio computador.
- Para **valer** (rodando o dia todo sozinho), o ideal é um **servidor VPS Linux** (qualquer provedor de nuvem barato serve).

**Contas e chaves:** detalhadas na Parte 4. A única obrigatória para o sistema ligar é a da **Anthropic** (a IA). As dos canais (WhatsApp, email) você cadastra depois, no painel.

---

## Parte 3. Instalação passo a passo

### Opção A. Testar no seu computador

```bash
# 1. Baixe o projeto
git clone https://github.com/SEU_USUARIO/minerador-saas.git
cd minerador-saas

# 2. Crie o arquivo de chaves a partir do modelo
cp .env.example .env.local

# 3. Abra o .env.local e preencha as chaves (veja a Parte 4)

# 4. Suba o banco de dados e o serviço de scraping
docker compose -f docker-compose.dev.yml up -d

# 5. Instale as dependencias e prepare o banco
pnpm install
pnpm db:migrate

# 6. Ligue o painel
pnpm dev
```

Em **outro terminal**, ligue o motor que processa as tarefas (mineração, envio, etc.):

```bash
pnpm worker
```

Pronto. Abra `http://localhost:3000`, crie sua conta, crie a organização e vá em Configurações para cadastrar as credenciais dos canais (Parte 5).

> A primeira vez que o Docker montar o serviço de scraping demora alguns minutos, porque ele baixa o navegador (Chromium). Da segunda vez em diante é rápido.

### Opção B. Rodar num servidor (produção)

No servidor, existe um script que faz quase tudo sozinho:

```bash
git clone https://github.com/SEU_USUARIO/minerador-saas.git /opt/minerador
cd /opt/minerador
bash scripts/setup-server.sh
```

O script instala o Docker, pede as chaves de forma interativa (elas não aparecem na tela) e sobe tudo. Para o painel em si (a parte web), o recomendado é hospedar numa plataforma serverless que faz deploy automático a partir do repositório.

---

## Parte 4. As chaves: o que é cada uma e onde pegar

Abra o arquivo `.env` (ou `.env.local`) e preencha. Existem dois tipos de chave.

### Tipo 1: segredos que VOCÊ inventa (só gerar)

Estes são senhas aleatórias que você mesmo cria. Em qualquer terminal Linux ou Mac, rode `openssl rand -hex 32` e cole o resultado. Gere um valor diferente para cada uma:

| Variável | Para que serve |
|----------|----------------|
| `CREDENTIALS_ENCRYPTION_KEY` | Criptografa as credenciais no banco. **Anote e guarde**: precisa ser a mesma no painel e no servidor. Se trocar, tudo que estava salvo para de abrir. |
| `BETTER_AUTH_SECRET` | Protege o login. |
| `SCRAPLING_SHARED_SECRET` | Senha entre o painel e o serviço de scraping. |
| `FORMS_WEBHOOK_SECRET` | Protege o recebimento de formulários. |
| `WHATSAPP_VERIFY_TOKEN` | Usado ao ligar o webhook do WhatsApp. |
| `BREVO_WEBHOOK_SECRET` | Usado ao ligar o webhook de email (Brevo). |

### Tipo 2: chaves de serviços externos (você pega no site do serviço)

| Variável | Onde pegar |
|----------|-----------|
| `ANTHROPIC_API_KEY` | **Obrigatória.** É a chave da IA. Crie uma conta em `console.anthropic.com`, vá em Settings, API Keys, e gere uma chave (começa com `sk-ant-`). Coloque créditos na conta. |
| `DATABASE_URL` | É o endereço do banco Postgres. No modo de teste (Opção A), o Docker já sobe um banco e o valor padrão do `.env.example` já funciona. Para produção, use um Postgres próprio (um serviço gerenciado gratuito como Neon ou Supabase resolve) e cole a string de conexão que eles fornecem. |
| `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET` | **Só se for enviar email pelo Gmail.** Crie um projeto no Google Cloud Console, ative a API do Gmail, e gere credenciais OAuth. Pode deixar em branco se for usar outro provedor de email. |

As demais variáveis (`SCRAPLING_URL`, `PGBOSS_SCHEMA`, `APP_URL`, etc.) já vêm com um valor padrão que funciona. Só mexa nelas se souber o que está fazendo.

---

## Parte 5. Credenciais dos canais (no painel, não no arquivo)

Depois que o sistema estiver rodando, você cadastra as credenciais de cada canal **dentro do painel**, em Configurações, Credenciais. O que cada uma serve:

| Canal | O que é / onde pegar |
|-------|----------------------|
| **Anthropic** | A mesma chave `sk-ant-` da Parte 4. Obrigatória para qualificar leads e para o bot responder. |
| **WhatsApp** | Depende do provedor que escolher: uma API de WhatsApp hospedada (tipo UazAPI) ou a API oficial da Meta (WhatsApp Cloud API, criada no portal de desenvolvedores da Meta). Você cola o token e o número. |
| **Email (Gmail)** | Autorização da conta Google, se preencheu o OAuth na Parte 4. |
| **Email (Brevo)** | Uma conta no Brevo dá um remetente e uma API para enviar em volume. Bom para email frio. |
| **LinkedIn / Instagram** | A sessão da conta (avançado, e o mais frágil; comece pelos outros canais). |

Regra de ouro: comece só com **Anthropic + um canal** (WhatsApp OU email). Ligue o resto depois que o básico funcionar.

---

## Parte 6. Primeira campanha (teste)

1. No painel, vá em Campanhas e crie uma nova.
2. Escolha a fonte: Google Maps é a mais fácil e a que mais entrega contato.
3. Escreva o perfil de cliente ideal (o texto que a IA usa para aprovar ou reprovar cada lead).
4. Defina a mensagem de abordagem e o follow-up.
5. Crie e comece. Acompanhe os leads chegando e sendo qualificados.

Comece com um volume baixo (poucos leads por dia) até ter certeza de que a mensagem está boa e nada está sendo bloqueado.

---

## Parte 7. Problemas comuns

- **Erro de descriptografia (unable to authenticate data):** a `CREDENTIALS_ENCRYPTION_KEY` está diferente entre o painel e o servidor. Use exatamente o mesmo valor nos dois.
- **O scraping não retorna nada na primeira vez:** o container do scraping ainda está baixando o navegador. Espere alguns minutos e tente de novo.
- **O painel liga mas nada é minerado nem enviado:** você esqueceu de ligar o worker (`pnpm worker`). Ele é o motor; sem ele, nada roda.
- **Email caindo em spam:** aqueça o remetente (comece com pouco volume e suba aos poucos) e configure os registros de email do seu domínio (SPF, DKIM).

---

## Parte 8. Nota sobre a pasta `agente/`

A pasta `agente/` é um microserviço opcional e avançado (um agente de vendas conversacional mais completo, com base de conhecimento própria). **Não é necessário para o básico funcionar**: o sistema já tem um bot de resposta embutido. Só monte o `agente/` quando quiser um SDR mais sofisticado, seguindo o README dentro daquela pasta.
