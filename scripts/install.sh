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

echo -e "  ${BOLD}Bem-vindo ao instalador do N8N LABZ Setup Panel!${NC}"
echo -e "  Vamos configurar tudo em poucos minutos.\n"

# ── Perguntar domínio e email ──
log_step "Configuração de domínio"
echo ""

BASE_DOMAIN=""
while [ -z "$BASE_DOMAIN" ]; do
  printf "  Qual seu domínio base? (ex: seudominio.com): " >&2
  read BASE_DOMAIN < /dev/tty
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

# ── Credenciais do admin ──
log_step "Credenciais de acesso ao painel"
echo ""

ADMIN_EMAIL=""
while [ -z "$ADMIN_EMAIL" ]; do
  printf "  Email do administrador: " >&2
  read ADMIN_EMAIL < /dev/tty
  ADMIN_EMAIL=$(echo "$ADMIN_EMAIL" | xargs)
  [ -z "$ADMIN_EMAIL" ] && log_warn "Email do admin é obrigatório."
done

ADMIN_PASS=""
while true; do
  printf "  Senha do administrador: " >&2
  read -s ADMIN_PASS < /dev/tty
  echo ""
  if [ -z "$ADMIN_PASS" ]; then
    log_warn "Senha é obrigatória."
    continue
  fi
  printf "  Confirme a senha: " >&2
  read -s ADMIN_PASS2 < /dev/tty
  echo ""
  if [ "$ADMIN_PASS" != "$ADMIN_PASS2" ]; then
    log_warn "As senhas não coincidem. Tente novamente."
    ADMIN_PASS=""
    continue
  fi
  break
done

ADMIN_PASS_HASH=$(echo -n "$ADMIN_PASS" | sha256sum | cut -d' ' -f1)

echo ""
log_ok "Admin: ${ADMIN_EMAIL}"
log_ok "Senha configurada com sucesso"
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

# ── Salvar config temporariamente ──
log_step "Configuração"
TMP_CONFIG="/tmp/n8nlabz-config.json"
TMP_BACKUPS="/tmp/n8nlabz-backups"

cat > "$TMP_CONFIG" <<EOF
{
  "domain_base": "${BASE_DOMAIN}",
  "email_ssl": "${SSL_EMAIL}",
  "dashboard_domain": "${DASHBOARD_DOMAIN}",
  "admin_email": "${ADMIN_EMAIL}",
  "admin_password_hash": "${ADMIN_PASS_HASH}",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Preservar backups de instalação anterior
[ -d "$INSTALL_DIR/backups" ] && cp -r "$INSTALL_DIR/backups" "$TMP_BACKUPS"

log_ok "Configuração preparada"

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
  # Remover diretório existente (config/backups já salvos em /tmp)
  [ -d "$INSTALL_DIR" ] && rm -rf "$INSTALL_DIR"

  log_info "Clonando repositório..."
  git clone "$REPO_URL" "$INSTALL_DIR" >/dev/null 2>&1 || {
    log_err "Falha ao clonar $REPO_URL"
    exit 1
  }
  log_ok "Repositório clonado em $INSTALL_DIR"
fi

# Restaurar config e backups
cp "$TMP_CONFIG" "$INSTALL_DIR/config.json"
[ -d "$TMP_BACKUPS" ] && cp -r "$TMP_BACKUPS" "$INSTALL_DIR/backups"
rm -f "$TMP_CONFIG"
rm -rf "$TMP_BACKUPS"
mkdir -p "$INSTALL_DIR"/{backups,data}
log_ok "Configuração restaurada em $INSTALL_DIR"

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

cat > "$PANEL_COMPOSE" <<'COMPOSEEOF'
version: "3.8"
services:
  n8nlabz_panel:
    image: n8nlabz-panel:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - __INSTALL_DIR__/config.json:/opt/n8nlabz/config.json
      - __INSTALL_DIR__/backups:/opt/n8nlabz/backups
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
        - "traefik.http.routers.n8nlabz.rule=Host(`__DASHBOARD_DOMAIN__`)"
        - "traefik.http.routers.n8nlabz.entrypoints=websecure"
        - "traefik.http.routers.n8nlabz.tls.certresolver=letsencrypt"
        - "traefik.http.services.n8nlabz.loadbalancer.server.port=3080"
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.n8nlabz.rule=Host(`__DASHBOARD_DOMAIN__`)"
      - "traefik.http.routers.n8nlabz.entrypoints=websecure"
      - "traefik.http.routers.n8nlabz.tls.certresolver=letsencrypt"
      - "traefik.http.services.n8nlabz.loadbalancer.server.port=3080"

networks:
  network_public:
    external: true
COMPOSEEOF

sed -i "s|__INSTALL_DIR__|${INSTALL_DIR}|g" "$PANEL_COMPOSE"
sed -i "s|__DASHBOARD_DOMAIN__|${DASHBOARD_DOMAIN}|g" "$PANEL_COMPOSE"

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

# ── DNS ──
IP=$(curl -s --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')

echo ""
echo -e "  ═══════════════════════════════════════════════════════"
echo -e "  ${YELLOW}${BOLD}⚠  Configuração de DNS${NC}"
echo ""
echo -e "  ${BOLD}Antes de acessar o painel, configure o DNS:${NC}"
echo ""
echo -e "  ${CYAN}  dashboard.${BASE_DOMAIN}  →  ${IP}${NC}"
echo -e "  ${CYAN}  portainer.${BASE_DOMAIN}   →  ${IP}${NC}"
echo -e "  ${CYAN}  n8n.${BASE_DOMAIN}         →  ${IP}${NC}"
echo -e "  ${CYAN}  evolution.${BASE_DOMAIN}    →  ${IP}${NC}"
echo ""
echo -e "  ${BOLD}Crie registros tipo A apontando para: ${IP}${NC}"
echo -e "  ═══════════════════════════════════════════════════════"
echo ""

DNS_OK=""
while [ -z "$DNS_OK" ]; do
  printf "  Já configurou o DNS? (sim/não): " >&2
  read DNS_OK < /dev/tty
  DNS_OK=$(echo "$DNS_OK" | xargs | tr '[:upper:]' '[:lower:]')
  case "$DNS_OK" in
    sim|s|yes|y)
      echo ""
      log_ok "DNS configurado!"
      ;;
    nao|não|n|no)
      echo ""
      log_warn "Configure o DNS antes de acessar o painel."
      log_info "Você pode configurar depois e acessar quando estiver pronto."
      ;;
    *)
      log_warn "Responda sim ou não."
      DNS_OK=""
      ;;
  esac
done

# ── Summary ──
echo ""
echo -e "  ═══════════════════════════════════════════════════════"
echo -e "  ${GREEN}${BOLD}✅ Instalação concluída!${NC}"
echo ""
echo -e "  ${BOLD}Acesse o painel:${NC}"
echo -e "  ${CYAN}➜  https://${DASHBOARD_DOMAIN}${NC}"
echo ""
echo -e "  ${BOLD}Login:${NC}"
echo -e "  ${CYAN}  Email: ${ADMIN_EMAIL}${NC}"
echo -e "  ${CYAN}  Senha: (a que você definiu)${NC}"
echo ""
echo -e "  ${BOLD}Domínio base:${NC} ${BASE_DOMAIN}"
echo -e "  ${BOLD}Subdomínios sugeridos:${NC}"
echo -e "  ${CYAN}  • Portainer:  portainer.${BASE_DOMAIN}${NC}"
echo -e "  ${CYAN}  • n8n:        n8n.${BASE_DOMAIN}${NC}"
echo -e "  ${CYAN}  • Evolution:  evolution.${BASE_DOMAIN}${NC}"
echo ""
echo -e "  ${YELLOW}⚠  Configure o DNS dos subdomínios apontando para: ${IP}${NC}"
echo ""
echo -e "  ${BOLD}Comandos úteis:${NC}"
echo -e "  ${CYAN}docker logs -f \$(docker ps -q -f name=n8nlabz_panel)${NC}  — Logs"
echo -e "  ${CYAN}docker ps -f name=n8nlabz${NC}                             — Status"
echo ""
echo -e "  ═══════════════════════════════════════════════════════"
echo -e "  ${RED}N8N LABZ${NC} — Comunidade de Automação"
echo -e "  ═══════════════════════════════════════════════════════"
echo ""
