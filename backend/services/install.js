const DockerService = require("./docker");
const crypto = require("crypto");
const fs = require("fs");

const CONFIG_PATH = "/opt/n8nlabz/config.json";

class InstallService {
  static genPass(len = 24) {
    return crypto.randomBytes(len).toString("base64url").slice(0, len);
  }

  static hostRule(domain) {
    var bt = String.fromCharCode(96);
    return "Host(" + bt + domain + bt + ")";
  }

  static loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      }
    } catch {}
    return {};
  }

  static getSuggestedSubdomains() {
    const config = this.loadConfig();
    const base = config.domain_base;
    if (!base) return {};
    return {
      domain_portainer: `portainer.${base}`,
      domain_n8n: `n8n.${base}`,
      domain_evolution: `evolution.${base}`,
      email_ssl: config.email_ssl || "",
    };
  }

  static isTraefikRunning() {
    const containers = DockerService.listContainers();
    return containers.some((c) => c.name.toLowerCase().includes("traefik") && c.state === "running");
  }

  static getTraefikPortainerCompose(c) {
    const traefikRunning = this.isTraefikRunning();

    // Se o Traefik já está rodando (instalado pelo install.sh), só instala Portainer
    if (traefikRunning) {
      return `version: "3.8"
services:
  portainer:
    image: portainer/portainer-ce:latest
    volumes:
      - portainer_data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - network_public
    deploy:
      placement:
        constraints:
          - node.role == manager
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.portainer.rule=${this.hostRule(c.domain_portainer)}"
        - "traefik.http.routers.portainer.entrypoints=websecure"
        - "traefik.http.routers.portainer.tls.certresolver=letsencrypt"
        - "traefik.http.services.portainer.loadbalancer.server.port=9000"
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.portainer.rule=${this.hostRule(c.domain_portainer)}"
      - "traefik.http.routers.portainer.entrypoints=websecure"
      - "traefik.http.routers.portainer.tls.certresolver=letsencrypt"
      - "traefik.http.services.portainer.loadbalancer.server.port=9000"

volumes:
  portainer_data:

networks:
  network_public:
    external: true
`;
    }

    // Instalação completa (Traefik + Portainer) para uso sem o install.sh
    return `version: "3.8"
services:
  traefik:
    image: traefik:v2.11
    command:
      - "--api.dashboard=false"
      - "--providers.docker=true"
      - "--providers.docker.swarmMode=${DockerService.isSwarmActive()}"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=network_public"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${c.email_ssl}"
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

  portainer:
    image: portainer/portainer-ce:latest
    volumes:
      - portainer_data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - network_public
    deploy:
      placement:
        constraints:
          - node.role == manager
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.portainer.rule=${this.hostRule(c.domain_portainer)}"
        - "traefik.http.routers.portainer.entrypoints=websecure"
        - "traefik.http.routers.portainer.tls.certresolver=letsencrypt"
        - "traefik.http.services.portainer.loadbalancer.server.port=9000"
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.portainer.rule=${this.hostRule(c.domain_portainer)}"
      - "traefik.http.routers.portainer.entrypoints=websecure"
      - "traefik.http.routers.portainer.tls.certresolver=letsencrypt"
      - "traefik.http.services.portainer.loadbalancer.server.port=9000"

volumes:
  traefik_certs:
  portainer_data:

networks:
  network_public:
    external: true
`;
  }

  static getN8nCompose(c) {
    const pgPass = c.pg_password || this.genPass();
    const encKey = this.genPass(32);
    return `version: "3.8"
services:
  n8n_editor:
    image: n8nio/n8n:latest
    environment:
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=n8n_postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=n8n
      - DB_POSTGRESDB_PASSWORD=${pgPass}
      - N8N_HOST=${c.domain_n8n}
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://${c.domain_n8n}
      - N8N_ENCRYPTION_KEY=${encKey}
      - GENERIC_TIMEZONE=America/Sao_Paulo
      - N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
      - NODES_EXCLUDE=[]
      - N8N_PUBLIC_API_DISABLED=false
    volumes:
      - n8n_data:/home/node/.n8n
    networks:
      - network_public
      - n8n_internal
    deploy:
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.n8n.rule=${this.hostRule(c.domain_n8n)}"
        - "traefik.http.routers.n8n.entrypoints=websecure"
        - "traefik.http.routers.n8n.tls.certresolver=letsencrypt"
        - "traefik.http.services.n8n.loadbalancer.server.port=5678"
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.n8n.rule=${this.hostRule(c.domain_n8n)}"
      - "traefik.http.routers.n8n.entrypoints=websecure"
      - "traefik.http.routers.n8n.tls.certresolver=letsencrypt"
      - "traefik.http.services.n8n.loadbalancer.server.port=5678"

  n8n_postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=n8n
      - POSTGRES_USER=n8n
      - POSTGRES_PASSWORD=${pgPass}
    volumes:
      - n8n_pg_data:/var/lib/postgresql/data
    networks:
      - n8n_internal
    deploy:
      placement:
        constraints:
          - node.role == manager

volumes:
  n8n_data:
  n8n_pg_data:

networks:
  network_public:
    external: true
  n8n_internal:
    driver: overlay
`;
  }

  static getEvolutionCompose(c) {
    const apiKey = c.evolution_key || this.genPass(32);
    return `version: "3.8"
services:
  evolution_api:
    image: atendai/evolution-api:latest
    environment:
      - SERVER_URL=https://${c.domain_evolution}
      - AUTHENTICATION_API_KEY=${apiKey}
      - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_URI=postgresql://evo:evo@evolution_postgres:5432/evolution
      - DATABASE_SAVE_DATA_INSTANCE=true
      - DATABASE_SAVE_DATA_NEW_MESSAGE=true
      - DATABASE_SAVE_MESSAGE_UPDATE=true
      - DATABASE_SAVE_DATA_CONTACTS=true
      - DATABASE_SAVE_DATA_CHATS=true
      - CACHE_REDIS_ENABLED=true
      - CACHE_REDIS_URI=redis://evolution_redis:6379
      - CACHE_REDIS_PREFIX_KEY=evo
      - CACHE_LOCAL_ENABLED=false
    volumes:
      - evo_instances:/evolution/instances
    networks:
      - network_public
      - evo_internal
    deploy:
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.evolution.rule=${this.hostRule(c.domain_evolution)}"
        - "traefik.http.routers.evolution.entrypoints=websecure"
        - "traefik.http.routers.evolution.tls.certresolver=letsencrypt"
        - "traefik.http.services.evolution.loadbalancer.server.port=8080"
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.evolution.rule=${this.hostRule(c.domain_evolution)}"
      - "traefik.http.routers.evolution.entrypoints=websecure"
      - "traefik.http.routers.evolution.tls.certresolver=letsencrypt"
      - "traefik.http.services.evolution.loadbalancer.server.port=8080"

  evolution_postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=evolution
      - POSTGRES_USER=evo
      - POSTGRES_PASSWORD=evo
    volumes:
      - evo_pg_data:/var/lib/postgresql/data
    networks:
      - evo_internal

  evolution_redis:
    image: redis:7-alpine
    volumes:
      - evo_redis_data:/data
    networks:
      - evo_internal

volumes:
  evo_instances:
  evo_pg_data:
  evo_redis_data:

networks:
  network_public:
    external: true
  evo_internal:
    driver: overlay
`;
  }

  static async installTool(toolId, config, onLog) {
    const log = (text, type = "default") => {
      const entry = { text, type, time: new Date().toLocaleTimeString("pt-BR", { hour12: false }).slice(0, 8) };
      if (onLog) onLog(entry);
      return entry;
    };

    const logs = [];
    const addLog = (text, type) => { const l = log(text, type); logs.push(l); };

    try {
      addLog("Verificando rede Docker...", "info");
      DockerService.ensureNetwork("network_public", "overlay");

      let compose, stackName;
      switch (toolId) {
        case "portainer_traefik":
          stackName = "infra";
          addLog("Gerando configuração Traefik + Portainer...", "info");
          compose = this.getTraefikPortainerCompose(config);
          break;
        case "n8n":
          stackName = "n8n";
          addLog("Gerando configuração n8n + PostgreSQL...", "info");
          compose = this.getN8nCompose(config);
          break;
        case "evolution":
          stackName = "evolution";
          addLog("Gerando configuração Evolution API...", "info");
          compose = this.getEvolutionCompose(config);
          break;
        default:
          throw new Error(`Ferramenta desconhecida: ${toolId}`);
      }

      addLog(`Deploy da stack "${stackName}"...`, "info");
      await DockerService.deployStack(stackName, compose);

      addLog("Aguardando containers...", "info");
      await new Promise((r) => setTimeout(r, 8000));

      addLog(`✅ ${toolId} instalado com sucesso!`, "success");
      return { success: true, stackName, logs };
    } catch (err) {
      addLog(`❌ Erro: ${err.message}`, "error");
      return { success: false, error: err.message, logs };
    }
  }

  static getInstalledTools() {
    const containers = DockerService.listContainers();
    const tools = new Set();
    containers.forEach((c) => {
      const n = c.name.toLowerCase();
      if (n.includes("n8n")) tools.add("n8n");
      if (n.includes("evolution")) tools.add("evolution");
      if (n.includes("traefik") || n.includes("portainer")) tools.add("portainer_traefik");
    });
    return Array.from(tools);
  }

  static async uninstallTool(toolId) {
    const map = { portainer_traefik: "infra", n8n: "n8n", evolution: "evolution" };
    const name = map[toolId];
    if (!name) throw new Error("Ferramenta desconhecida");
    return DockerService.removeStack(name);
  }
}

module.exports = InstallService;
