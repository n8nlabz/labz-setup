#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║           N8N LABZ Setup Panel - Instalador v2.0            ║
# ╚══════════════════════════════════════════════════════════════╝
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'
MAGENTA='\033[0;35m'

INSTALL_DIR="/opt/n8nlabz"
REPO_URL="https://github.com/n8nlabz/labz-setup.git"
CONFIG_FILE="$INSTALL_DIR/config.json"

banner() {
  clear
  echo -e "${RED}"
  echo '  ███╗   ██╗ █████╗ ███╗   ██╗    ██╗      █████╗ ██████╗ ███████╗'
  echo '  ████╗  ██║██╔══██╗████╗  ██║    ██║     ██╔══██╗██╔══██╗╚══███╔╝'
  echo '  ██╔██╗ ██║╚█████╔╝██╔██╗ ██║    ██║     ███████║██████╔╝  ███╔╝ '
  echo '  ██║╚██╗██║██╔══██╗██║╚██╗██║    ██║     ██╔══██║██╔══██╗ ███╔╝  '
  echo '  ██║ ╚████║╚█████╔╝██║ ╚████║    ███████╗██║  ██║██████╔╝███████╗'
  echo '  ╚═╝  ╚═══╝ ╚════╝ ╚═╝  ╚═══╝    ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝'
  echo -e "${NC}"
  echo -e "  ${BOLD}Setup Panel Installer v2.0${NC}"
  echo -e "  ${CYAN}Automação simplificada para sua VPS${NC}\n"
}

log_ok() { echo -e "  ${GREEN}✅${NC} $1"; }
log_info() { echo -e "  ${BLUE}ℹ${NC}  $1"; }
log_warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }
log_err() { echo -e "  ${RED}❌${NC} $1"; }
log_step() { echo -e "\n  ${MAGENTA}▸${NC} ${BOLD}$1${NC}"; }

# ── Root check ──
[ "$EUID" -ne 0 ] && { log_err "Execute como root: sudo bash install.sh"; exit 1; }

banner

# ── Perguntar domínio e email ──
log_step "Configuração de domínio"
echo ""

BASE_DOMAIN=""
while [ -z "$BASE_DOMAIN" ]; do
  printf "  Qual seu domínio base? (ex: seudominio.com): " >&2
  read BASE_DOMAIN < /dev/tty
  # Remover protocolo, espaços e barras
  BASE_DOMAIN=$(echo "$BASE_DOMAIN" | sed 's|https\?://||' | sed 's|/||g' | xargs)
  [ -z "$BASE_DOMAIN" ] && log_warn "Domínio base é obrigatório."
done

SSL_EMAIL=""
while [ -z "$SSL_EMAIL" ]; do
  printf "  Qual seu email para SSL? (Let's Encrypt): " >&2
  read SSL_EMAIL < /dev/tty
  SSL_EMAIL=$(echo "$SSL_EMAIL" | xargs)
  [ -z "$SSL_EMAIL" ] && log_warn "Email SSL é obrigatório."
done

DASHBOARD_DOMAIN="dashboard.${BASE_DOMAIN}"

echo ""
log_ok "Domínio base: ${BASE_DOMAIN}"
log_ok "Email SSL: ${SSL_EMAIL}"
log_ok "Painel: ${DASHBOARD_DOMAIN}"
echo ""

# ── Docker ──
log_step "Docker"
if command -v docker &>/dev/null; then
  log_ok "Docker $(docker --version | cut -d' ' -f3 | cut -d',' -f1)"
else
  log_info "Instalando Docker..."
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
  systemctl enable docker >/dev/null 2>&1 && systemctl start docker >/dev/null 2>&1
  log_ok "Docker instalado"
fi

# ── Swarm ──
log_step "Docker Swarm"
SWARM=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null)
if [ "$SWARM" = "active" ]; then
  log_ok "Swarm ativo"
else
  IP=$(curl -s --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')
  docker swarm init --advertise-addr "$IP" >/dev/null 2>&1
  log_ok "Swarm inicializado ($IP)"
fi

# ── Network ──
log_step "Rede Docker"
if docker network ls | grep -q network_public; then
  log_ok "network_public existe"
else
  docker network create --driver overlay --attachable network_public >/dev/null 2>&1
  log_ok "network_public criada"
fi

# ── Salvar config ──
log_step "Configuração"
mkdir -p "$INSTALL_DIR"/{backups,data}

cat > "$CONFIG_FILE" <<EOF
{
  "domain_base": "${BASE_DOMAIN}",
  "email_ssl": "${SSL_EMAIL}",
  "dashboard_domain": "${DASHBOARD_DOMAIN}",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

log_ok "Configuração salva em ${CONFIG_FILE}"

# ── Traefik ──
log_step "Traefik (Proxy Reverso + SSL)"
SWARM_MODE=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null)
IS_SWARM="false"
[ "$SWARM_MODE" = "active" ] && IS_SWARM="true"

TRAEFIK_COMPOSE="/tmp/traefik-compose.yml"
cat > "$TRAEFIK_COMPOSE" <<EOF
version: "3.8"
services:
  traefik:
    image: traefik:v2.11
    command:
      - "--api.dashboard=false"
      - "--providers.docker=true"
      - "--providers.docker.swarmMode=${IS_SWARM}"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=network_public"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${SSL_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--log.level=ERROR"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - traefik_certs:/letsencrypt
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - network_public
    deploy:
      placement:
        constraints:
          - node.role == manager

volumes:
  traefik_certs:

networks:
  network_public:
    external: true
EOF

log_info "Fazendo deploy do Traefik..."
if [ "$IS_SWARM" = "true" ]; then
  docker stack deploy -c "$TRAEFIK_COMPOSE" traefik >/dev/null 2>&1
else
  docker compose -f "$TRAEFIK_COMPOSE" -p traefik up -d >/dev/null 2>&1
fi
rm -f "$TRAEFIK_COMPOSE"
log_ok "Traefik rodando com SSL via Let's Encrypt"

# ── Download Panel ──
log_step "N8N LABZ Panel"

# Garantir que git está instalado
if ! command -v git &>/dev/null; then
  log_info "Instalando git..."
  apt-get install -y git >/dev/null 2>&1
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  log_info "Atualizando repositório..."
  cd "$INSTALL_DIR" && git pull >/dev/null 2>&1
  log_ok "Repositório atualizado"
else
  log_info "Clonando repositório..."
  # Preservar backups, config e tokens de instalação anterior
  if [ -d "$INSTALL_DIR" ]; then
    log_info "Preservando dados existentes..."
    TMP_PRESERVE="/tmp/n8nlabz-preserve-$$"
    mkdir -p "$TMP_PRESERVE"
    [ -f "$INSTALL_DIR/config.json" ] && cp "$INSTALL_DIR/config.json" "$TMP_PRESERVE/"
    [ -f "$INSTALL_DIR/tokens.json" ] && cp "$INSTALL_DIR/tokens.json" "$TMP_PRESERVE/"
    [ -d "$INSTALL_DIR/backups" ] && cp -r "$INSTALL_DIR/backups" "$TMP_PRESERVE/"
    rm -rf "$INSTALL_DIR"
  fi

  git clone "$REPO_URL" "$INSTALL_DIR" >/dev/null 2>&1 || {
    log_err "Falha ao clonar $REPO_URL"
    exit 1
  }

  # Restaurar dados preservados
  if [ -d "${TMP_PRESERVE:-/nonexistent}" ]; then
    [ -f "$TMP_PRESERVE/config.json" ] && cp "$TMP_PRESERVE/config.json" "$INSTALL_DIR/"
    [ -f "$TMP_PRESERVE/tokens.json" ] && cp "$TMP_PRESERVE/tokens.json" "$INSTALL_DIR/"
    [ -d "$TMP_PRESERVE/backups" ] && cp -r "$TMP_PRESERVE/backups" "$INSTALL_DIR/"
    rm -rf "$TMP_PRESERVE"
    log_ok "Dados anteriores restaurados"
  fi

  mkdir -p "$INSTALL_DIR"/{backups,data}
  log_ok "Repositório clonado em $INSTALL_DIR"
fi

# Verificar arquivos essenciais
if [ ! -f "$INSTALL_DIR/Dockerfile" ] || [ ! -d "$INSTALL_DIR/backend" ] || [ ! -d "$INSTALL_DIR/frontend" ]; then
  log_err "Arquivos essenciais não encontrados em $INSTALL_DIR (Dockerfile, backend/, frontend/)"
  exit 1
fi

# ── Build e deploy como container Docker ──
log_step "Build do painel Docker"

# Remover serviço systemd antigo se existir
if systemctl is-enabled n8nlabz-panel &>/dev/null 2>&1; then
  log_info "Removendo serviço systemd antigo..."
  systemctl stop n8nlabz-panel >/dev/null 2>&1 || true
  systemctl disable n8nlabz-panel >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/n8nlabz-panel.service
  systemctl daemon-reload >/dev/null 2>&1
fi

if [ -f "$INSTALL_DIR/Dockerfile" ]; then
  log_info "Buildando imagem Docker do painel..."
  cd "$INSTALL_DIR" && docker build -t n8nlabz-panel:latest . >/dev/null 2>&1
  log_ok "Imagem buildada"
else
  log_err "Dockerfile não encontrado em $INSTALL_DIR"
  exit 1
fi

# ── Deploy do painel atrás do Traefik ──
log_step "Deploy do painel"

PANEL_COMPOSE="/tmp/panel-compose.yml"
cat > "$PANEL_COMPOSE" <<EOF
version: "3.8"
services:
  n8nlabz_panel:
    image: n8nlabz-panel:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${INSTALL_DIR}/config.json:/opt/n8nlabz/config.json
      - ${INSTALL_DIR}/tokens.json:/opt/n8nlabz/tokens.json
      - ${INSTALL_DIR}/backups:/opt/n8nlabz/backups
    environment:
      - NODE_ENV=production
      - PORT=3080
    networks:
      - network_public
    deploy:
      placement:
        constraints:
          - node.role == manager
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.n8nlabz.rule=Host(\`${DASHBOARD_DOMAIN}\`)"
        - "traefik.http.routers.n8nlabz.entrypoints=websecure"
        - "traefik.http.routers.n8nlabz.tls.certresolver=letsencrypt"
        - "traefik.http.services.n8nlabz.loadbalancer.server.port=3080"
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.n8nlabz.rule=Host(\`${DASHBOARD_DOMAIN}\`)"
      - "traefik.http.routers.n8nlabz.entrypoints=websecure"
      - "traefik.http.routers.n8nlabz.tls.certresolver=letsencrypt"
      - "traefik.http.services.n8nlabz.loadbalancer.server.port=3080"

networks:
  network_public:
    external: true
EOF

# Garantir que tokens.json exista
touch "$INSTALL_DIR/tokens.json" 2>/dev/null || true

log_info "Fazendo deploy do painel..."
if [ "$IS_SWARM" = "true" ]; then
  docker stack deploy -c "$PANEL_COMPOSE" panel >/dev/null 2>&1
else
  docker compose -f "$PANEL_COMPOSE" -p panel up -d >/dev/null 2>&1
fi
rm -f "$PANEL_COMPOSE"
log_ok "Painel rodando em https://${DASHBOARD_DOMAIN}"

# ── Aguardar estabilização ──
log_info "Aguardando containers estabilizarem..."
sleep 8

# ── Summary ──
IP=$(curl -s --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')
echo ""
echo -e "  ═══════════════════════════════════════════════════════"
echo -e "  ${GREEN}${BOLD}✅ Instalação concluída!${NC}"
echo ""
echo -e "  ${BOLD}Acesse o painel:${NC}"
echo -e "  ${CYAN}➜  https://${DASHBOARD_DOMAIN}${NC}"
echo ""
echo -e "  ${BOLD}Domínio base:${NC} ${BASE_DOMAIN}"
echo -e "  ${BOLD}Subdomínios sugeridos:${NC}"
echo -e "  ${CYAN}  • Portainer:  portainer.${BASE_DOMAIN}${NC}"
echo -e "  ${CYAN}  • n8n:        n8n.${BASE_DOMAIN}${NC}"
echo -e "  ${CYAN}  • Evolution:  evolution.${BASE_DOMAIN}${NC}"
echo ""
echo -e "  ${YELLOW}⚠  Configure o DNS dos subdomínios apontando para: ${IP}${NC}"
echo ""
echo -e "  ${BOLD}No primeiro acesso:${NC}"
echo -e "  O painel gera um token admin automaticamente."
echo -e "  ${YELLOW}Guarde esse token! Ele é sua chave de acesso.${NC}"
echo ""
echo -e "  ${BOLD}Comandos úteis:${NC}"
echo -e "  ${CYAN}docker logs -f \$(docker ps -q -f name=n8nlabz_panel)${NC}  — Logs"
echo -e "  ${CYAN}docker ps -f name=n8nlabz${NC}                             — Status"
echo ""
echo -e "  ═══════════════════════════════════════════════════════"
echo -e "  ${RED}N8N LABZ${NC} — Comunidade de Automação"
echo -e "  ═══════════════════════════════════════════════════════"
echo ""
