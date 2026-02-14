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

echo -e "  👋 ${BOLD}Bem-vindo ao N8N LABZ Setup Panel!${NC}"
echo -e "  Vamos preparar sua VPS em poucos minutos."
echo -e "  Relaxa que é tudo automático 😎\n"

# ══════════════════════════════════════
# COLETA DE DADOS (3 perguntas)
# ══════════════════════════════════════
log_step "Configuração inicial"
echo ""

BASE_DOMAIN=""
while [ -z "$BASE_DOMAIN" ]; do
  printf "  📌 Qual seu domínio base? (ex: seudominio.com): " >&2
  read BASE_DOMAIN < /dev/tty
  BASE_DOMAIN=$(echo "$BASE_DOMAIN" | sed 's|https\?://||' | sed 's|/||g' | xargs)
  [ -z "$BASE_DOMAIN" ] && log_warn "Domínio base é obrigatório."
done

ADMIN_EMAIL=""
while [ -z "$ADMIN_EMAIL" ]; do
  printf "  📧 Seu email (para login e certificado SSL): " >&2
  read ADMIN_EMAIL < /dev/tty
  ADMIN_EMAIL=$(echo "$ADMIN_EMAIL" | xargs)
  [ -z "$ADMIN_EMAIL" ] && log_warn "Email é obrigatório."
done

ADMIN_PASS=""
while true; do
  printf "  🔒 Senha do administrador: " >&2
  read -s ADMIN_PASS < /dev/tty
  echo ""
  if [ -z "$ADMIN_PASS" ]; then
    log_warn "Senha é obrigatória."
    continue
  fi
  printf "  🔒 Confirme a senha: " >&2
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

DASHBOARD_DOMAIN="dashboard.${BASE_DOMAIN}"
PORTAINER_DOMAIN="portainer.${BASE_DOMAIN}"

echo ""
log_ok "Domínio base: ${BASE_DOMAIN}"
log_ok "Email: ${ADMIN_EMAIL}"
log_ok "Painel: ${DASHBOARD_DOMAIN}"
log_ok "Portainer: ${PORTAINER_DOMAIN}"
echo ""

# ══════════════════════════════════════
# ATUALIZAÇÃO DO SISTEMA
# ══════════════════════════════════════
log_step "🔧 Atualizando seu servidor..."
log_info "Isso garante que tudo funcione direitinho"
apt-get update >/dev/null 2>&1
apt-get upgrade -y >/dev/null 2>&1
log_ok "Servidor atualizado!"

log_info "Instalando dependências..."
apt-get install -y curl wget git jq >/dev/null 2>&1
log_ok "Dependências instaladas!"

# ══════════════════════════════════════
# DOCKER
# ══════════════════════════════════════
log_step "🐳 Docker"
if command -v docker &>/dev/null; then
  log_ok "Docker $(docker --version | cut -d' ' -f3 | cut -d',' -f1) já instalado"
else
  log_info "Instalando o Docker... (é ele que roda todas as ferramentas)"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
  systemctl enable docker >/dev/null 2>&1 && systemctl start docker >/dev/null 2>&1
  log_ok "Docker instalado!"
fi

# ── Swarm ──
log_step "🌐 Docker Swarm"
SWARM=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null)
if [ "$SWARM" = "active" ]; then
  log_ok "Swarm já está ativo"
else
  IP=$(curl -s --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')
  docker swarm init --advertise-addr "$IP" >/dev/null 2>&1
  log_ok "Swarm inicializado ($IP)"
fi

# ── Rede ──
log_step "🌐 Rede interna"
log_info "Configurando a rede interna... (pra suas ferramentas se comunicarem)"
if docker network ls | grep -q network_public; then
  log_ok "network_public já existe"
else
  docker network create --driver overlay --attachable network_public >/dev/null 2>&1
  log_ok "Rede network_public criada!"
fi

# ── Volumes ──
log_step "📁 Volumes Docker"
log_info "Criando volumes para armazenamento persistente..."
for vol in volume_swarm_certificates volume_swarm_shared portainer_data postgres_data n8n_redis evolution_instances evolution_redis; do
  docker volume create "$vol" >/dev/null 2>&1 || true
done
log_ok "Volumes criados!"

# ══════════════════════════════════════
# TRAEFIK v3.5.3
# ══════════════════════════════════════
log_step "🔒 Traefik (Proxy Reverso + SSL)"
log_info "Instalando o Traefik... (ele cuida dos certificados SSL automaticamente)"

TRAEFIK_COMPOSE="/tmp/traefik-compose.yml"
cat > "$TRAEFIK_COMPOSE" <<'TRAEFIKEOF'
version: "3.8"
services:
  traefik:
    image: traefik:v3.5.3
    command:
      - "--api.dashboard=false"
      - "--providers.swarm=true"
      - "--providers.docker.endpoint=unix:///var/run/docker.sock"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=network_public"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.web.http.redirections.entryPoint.to=websecure"
      - "--entrypoints.web.http.redirections.entryPoint.scheme=https"
      - "--entrypoints.web.http.redirections.entrypoint.permanent=true"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.transport.respondingTimeouts.idleTimeout=3600"
      - "--certificatesresolvers.letsencryptresolver.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencryptresolver.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencryptresolver.acme.storage=/etc/traefik/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencryptresolver.acme.email=__ADMIN_EMAIL__"
      - "--log.level=ERROR"
      - "--log.format=common"
      - "--log.filePath=/var/log/traefik/traefik.log"
      - "--accesslog=true"
      - "--accesslog.filepath=/var/log/traefik/access-log"
    volumes:
      - "vol_certificates:/etc/traefik/letsencrypt"
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
    networks:
      - network_public
    ports:
      - target: 80
        published: 80
        mode: host
      - target: 443
        published: 443
        mode: host
    deploy:
      placement:
        constraints:
          - node.role == manager
      labels:
        - "traefik.enable=true"
        - "traefik.http.middlewares.redirect-https.redirectscheme.scheme=https"
        - "traefik.http.middlewares.redirect-https.redirectscheme.permanent=true"
        - "traefik.http.routers.http-catchall.rule=Host(`{host:.+}`)"
        - "traefik.http.routers.http-catchall.entrypoints=web"
        - "traefik.http.routers.http-catchall.middlewares=redirect-https@docker"
        - "traefik.http.routers.http-catchall.priority=1"

volumes:
  vol_certificates:
    external: true
    name: volume_swarm_certificates

networks:
  network_public:
    external: true
    name: network_public
TRAEFIKEOF

sed -i "s|__ADMIN_EMAIL__|${ADMIN_EMAIL}|g" "$TRAEFIK_COMPOSE"

docker stack deploy -c "$TRAEFIK_COMPOSE" traefik >/dev/null 2>&1
rm -f "$TRAEFIK_COMPOSE"
log_ok "Traefik rodando com SSL via Let's Encrypt!"

# ══════════════════════════════════════
# PORTAINER + AGENT
# ══════════════════════════════════════
log_step "🐳 Portainer (Gerenciador de Containers)"
log_info "Instalando Portainer + Agent..."

PORTAINER_COMPOSE="/tmp/portainer-compose.yml"
cat > "$PORTAINER_COMPOSE" <<'PORTAINEREOF'
version: "3.8"
services:
  agent:
    image: portainer/agent:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /var/lib/docker/volumes:/var/lib/docker/volumes
    networks:
      - agent_network
    deploy:
      mode: global
      placement:
        constraints:
          - node.platform.os == linux

  portainer:
    image: portainer/portainer-ce:latest
    command: -H tcp://tasks.agent:9001 --tlsskipverify
    volumes:
      - portainer_data:/data
    networks:
      - network_public
      - agent_network
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints:
          - node.role == manager
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.portainer.rule=Host(`__PORTAINER_DOMAIN__`)"
        - "traefik.http.routers.portainer.entrypoints=websecure"
        - "traefik.http.routers.portainer.tls.certresolver=letsencryptresolver"
        - "traefik.http.services.portainer.loadbalancer.server.port=9000"
        - "traefik.docker.network=network_public"

volumes:
  portainer_data:
    external: true
    name: portainer_data

networks:
  network_public:
    external: true
    name: network_public
  agent_network:
    driver: overlay
    attachable: true
PORTAINEREOF

sed -i "s|__PORTAINER_DOMAIN__|${PORTAINER_DOMAIN}|g" "$PORTAINER_COMPOSE"

docker stack deploy -c "$PORTAINER_COMPOSE" portainer >/dev/null 2>&1
rm -f "$PORTAINER_COMPOSE"
log_ok "Portainer deployado!"

# ── Aguardar Portainer ficar online ──
log_info "Aguardando Portainer ficar online..."

MAX_WAIT=300
WAITED=0
PORTAINER_READY=false

while [ $WAITED -lt $MAX_WAIT ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:9000/api/status" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    PORTAINER_READY=true
    break
  fi
  sleep 5
  WAITED=$((WAITED + 5))
done

if [ "$PORTAINER_READY" = "true" ]; then
  log_ok "Portainer online!"

  # Auto-criar admin
  INIT_RESPONSE=$(curl -s -X POST "http://localhost:9000/api/users/admin/init" \
    -H "Content-Type: application/json" \
    -d "{\"Username\":\"admin\",\"Password\":\"${ADMIN_PASS}\"}" 2>/dev/null)

  if echo "$INIT_RESPONSE" | jq -e '.Id' >/dev/null 2>&1; then
    log_ok "Admin do Portainer configurado automaticamente"
  else
    log_warn "Portainer pode já ter um admin configurado"
  fi
else
  log_warn "Portainer não respondeu em 5 minutos. Configure o admin manualmente em https://${PORTAINER_DOMAIN}"
fi

# ══════════════════════════════════════
# PAINEL N8N LABZ
# ══════════════════════════════════════
log_step "📦 N8N LABZ Panel"

# Garantir que git está instalado
if ! command -v git &>/dev/null; then
  log_info "Instalando git..."
  apt-get install -y git >/dev/null 2>&1
fi

# Preservar backups existentes
TMP_BACKUPS="/tmp/n8nlabz-backups"
[ -d "$INSTALL_DIR/backups" ] && cp -r "$INSTALL_DIR/backups" "$TMP_BACKUPS"

if [ -d "$INSTALL_DIR/.git" ]; then
  log_info "Atualizando repositório..."
  cd "$INSTALL_DIR" && git pull >/dev/null 2>&1
  log_ok "Repositório atualizado"
else
  [ -d "$INSTALL_DIR" ] && rm -rf "$INSTALL_DIR"

  log_info "Clonando repositório..."
  git clone "$REPO_URL" "$INSTALL_DIR" >/dev/null 2>&1 || {
    log_err "Falha ao clonar $REPO_URL"
    exit 1
  }
  log_ok "Repositório clonado em $INSTALL_DIR"
fi

# Restaurar backups
[ -d "$TMP_BACKUPS" ] && cp -r "$TMP_BACKUPS" "$INSTALL_DIR/backups"
rm -rf "$TMP_BACKUPS"
mkdir -p "$INSTALL_DIR"/{backups,data}

# Salvar config
IP=$(curl -s --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')

cat > "$INSTALL_DIR/config.json" <<EOF
{
  "domain_base": "${BASE_DOMAIN}",
  "email_ssl": "${ADMIN_EMAIL}",
  "dashboard_domain": "${DASHBOARD_DOMAIN}",
  "admin_email": "${ADMIN_EMAIL}",
  "admin_password_hash": "${ADMIN_PASS_HASH}",
  "portainer_domain": "${PORTAINER_DOMAIN}",
  "portainer_username": "admin",
  "portainer_password": "${ADMIN_PASS}",
  "ip": "${IP}",
  "network_name": "network_public",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Inicializar credentials.json
if [ ! -f "$INSTALL_DIR/credentials.json" ]; then
  echo '{}' > "$INSTALL_DIR/credentials.json"
fi

log_ok "Configuração salva"

# Verificar arquivos essenciais
if [ ! -f "$INSTALL_DIR/Dockerfile" ] || [ ! -d "$INSTALL_DIR/backend" ] || [ ! -d "$INSTALL_DIR/frontend" ]; then
  log_err "Arquivos essenciais não encontrados em $INSTALL_DIR (Dockerfile, backend/, frontend/)"
  exit 1
fi

# ── Build ──
log_step "🔨 Build do painel"
log_info "Buildando imagem Docker... (pode demorar alguns minutos)"

# Remover serviço systemd antigo se existir
if systemctl is-enabled n8nlabz-panel &>/dev/null 2>&1; then
  systemctl stop n8nlabz-panel >/dev/null 2>&1 || true
  systemctl disable n8nlabz-panel >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/n8nlabz-panel.service
  systemctl daemon-reload >/dev/null 2>&1
fi

cd "$INSTALL_DIR" && docker build -t n8nlabz-panel:latest . >/dev/null 2>&1
log_ok "Imagem buildada!"

# ── Deploy do painel ──
log_step "🚀 Deploy do painel"

PANEL_COMPOSE="/tmp/panel-compose.yml"

cat > "$PANEL_COMPOSE" <<'COMPOSEEOF'
version: "3.8"
services:
  n8nlabz_panel:
    image: n8nlabz-panel:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - __INSTALL_DIR__/config.json:/opt/n8nlabz/config.json
      - __INSTALL_DIR__/credentials.json:/opt/n8nlabz/credentials.json
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
        - "traefik.http.routers.n8nlabz.tls.certresolver=letsencryptresolver"
        - "traefik.http.services.n8nlabz.loadbalancer.server.port=3080"

networks:
  network_public:
    external: true
    name: network_public
COMPOSEEOF

sed -i "s|__INSTALL_DIR__|${INSTALL_DIR}|g" "$PANEL_COMPOSE"
sed -i "s|__DASHBOARD_DOMAIN__|${DASHBOARD_DOMAIN}|g" "$PANEL_COMPOSE"

docker stack deploy -c "$PANEL_COMPOSE" panel >/dev/null 2>&1
rm -f "$PANEL_COMPOSE"
log_ok "Painel instalado!"

# ── Aguardar estabilização ──
log_info "Aguardando containers estabilizarem..."
sleep 10

# ══════════════════════════════════════
# RESUMO FINAL
# ══════════════════════════════════════
echo ""
echo -e "  ════════════════════════════════════════════════════════"
echo -e "  ${GREEN}${BOLD}  🚀 N8N LABZ Setup Panel instalado com sucesso!${NC}"
echo -e "  ════════════════════════════════════════════════════════"
echo ""
echo -e "  ${BOLD}🌐 Acesse o painel:${NC}"
echo -e "  ${CYAN}   https://${DASHBOARD_DOMAIN}${NC}"
echo ""
echo -e "  ${BOLD}🔑 Login:${NC}"
echo -e "  ${CYAN}   Email: ${ADMIN_EMAIL}${NC}"
echo -e "  ${CYAN}   Senha: (a que você definiu)${NC}"
echo ""
echo -e "  ${BOLD}🐳 Portainer:${NC}"
echo -e "  ${CYAN}   https://${PORTAINER_DOMAIN}${NC}"
echo -e "  ${CYAN}   Usuário: admin${NC}"
echo -e "  ${CYAN}   Senha: (mesma do painel)${NC}"
echo ""
echo -e "  ${YELLOW}⚠️  Configure o DNS dos subdomínios apontando para: ${IP}${NC}"
echo ""
echo -e "  ${BOLD}Subdomínios para configurar no DNS:${NC}"
echo -e "  ${CYAN}   dashboard.${BASE_DOMAIN}  →  ${IP}${NC}"
echo -e "  ${CYAN}   portainer.${BASE_DOMAIN}  →  ${IP}${NC}"
echo -e "  ${CYAN}   n8n.${BASE_DOMAIN}        →  ${IP}${NC}"
echo -e "  ${CYAN}   webhook.${BASE_DOMAIN}    →  ${IP}${NC}"
echo -e "  ${CYAN}   evolution.${BASE_DOMAIN}  →  ${IP}${NC}"
echo ""
echo -e "  ${BOLD}Comandos úteis:${NC}"
echo -e "  ${CYAN}  docker service ls${NC}                                    — Serviços"
echo -e "  ${CYAN}  docker logs -f \$(docker ps -q -f name=n8nlabz_panel)${NC} — Logs"
echo ""
echo -e "  ════════════════════════════════════════════════════════"
echo -e "  ${RED}N8N LABZ${NC} — Comunidade de Automação 🔥"
echo -e "  ════════════════════════════════════════════════════════"
echo ""
