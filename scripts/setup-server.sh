#!/bin/bash
set -e

REPO_URL="https://github.com/SEU_USUARIO/minerador-saas.git"
INSTALL_DIR="/opt/minerador"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[ERRO]${NC} $1"; exit 1; }

echo ""
echo "======================================"
echo "  Minerador Claude — Setup do Servidor"
echo "======================================"
echo ""

# ─── 1. Docker ────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  warn "Docker nao encontrado. Instalando..."
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "$USER" || true
  ok "Docker instalado"
else
  ok "Docker $(docker --version | cut -d' ' -f3 | tr -d ',')"
fi

# ─── 2. Repositorio ───────────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  ok "Repositorio ja existe em $INSTALL_DIR"
  cd "$INSTALL_DIR"
  git pull origin master
else
  warn "Clonando repositorio..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  ok "Repositorio clonado"
fi

# ─── 3. Variaveis de ambiente ─────────────────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
  warn "Arquivo $ENV_FILE ja existe. Pulando criacao (delete-o para reconfigurar)."
else
  echo ""
  echo "Configure as variaveis de ambiente (nao serao exibidas na tela):"
  echo ""

  read -rsp "DATABASE_URL (postgresql://...): " DATABASE_URL; echo
  [ -z "$DATABASE_URL" ] && die "DATABASE_URL nao pode ser vazio"

  read -rsp "ANTHROPIC_API_KEY (sk-ant-...): " ANTHROPIC_API_KEY; echo
  [ -z "$ANTHROPIC_API_KEY" ] && die "ANTHROPIC_API_KEY nao pode ser vazio"

  read -rsp "CREDENTIALS_ENCRYPTION_KEY (mesma do Vercel): " CREDENTIALS_ENCRYPTION_KEY; echo
  [ -z "$CREDENTIALS_ENCRYPTION_KEY" ] && die "CREDENTIALS_ENCRYPTION_KEY nao pode ser vazio"

  SCRAPLING_SHARED_SECRET=$(openssl rand -hex 32)
  ok "SCRAPLING_SHARED_SECRET gerado automaticamente"

  cat > "$ENV_FILE" <<EOF
DATABASE_URL=${DATABASE_URL}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
CREDENTIALS_ENCRYPTION_KEY=${CREDENTIALS_ENCRYPTION_KEY}
NEXT_PUBLIC_APP_URL=https://seu-dominio.com
SCRAPLING_SHARED_SECRET=${SCRAPLING_SHARED_SECRET}
PGBOSS_SCHEMA=pgboss
NODE_ENV=production
EOF

  chmod 600 "$ENV_FILE"
  ok "Arquivo $ENV_FILE criado com permissoes restritas"
fi

# ─── 4. Subir containers ──────────────────────────────────────────────────────
echo ""
warn "Buildando e subindo containers (pode demorar alguns minutos na primeira vez)..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

echo ""
ok "Containers rodando:"
docker ps --format "  - {{.Names}} ({{.Status}})" | grep minerador || docker ps --format "  - {{.Names}} ({{.Status}})"

echo ""
echo "======================================"
echo "  Setup concluido!"
echo "======================================"
echo ""
echo "Comandos uteis:"
echo "  Logs do worker:    docker logs minerador_worker -f"
echo "  Logs do scrapling: docker logs minerador_scrapling -f"
echo "  Parar tudo:        docker compose -f $INSTALL_DIR/$COMPOSE_FILE down"
echo ""
