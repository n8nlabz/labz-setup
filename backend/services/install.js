const DockerService = require("./docker");
const crypto = require("crypto");
const fs = require("fs");

const CONFIG_PATH = "/opt/n8nlabz/config.json";
const CREDENTIALS_PATH = "/opt/n8nlabz/credentials.json";

class InstallService {
  // ─── Utilities ───

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
      domain_portainer: "portainer." + base,
      domain_n8n: "n8n." + base,
      domain_webhook: "webhook." + base,
      domain_evolution: "evolution." + base,
      email_ssl: config.email_ssl || "",
    };
  }

  // ─── Credentials Persistence ───

  static loadCredentials() {
    try {
      if (fs.existsSync(CREDENTIALS_PATH)) {
        return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
      }
    } catch {}
    return {};
  }

  static saveCredentials(toolId, creds) {
    const all = this.loadCredentials();
    all[toolId] = { ...creds, installed_at: new Date().toISOString() };
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(all, null, 2));
  }

  // ─── Portainer API Integration ───

  static getPortainerToken() {
    try {
      const config = this.loadConfig();
      const user = config.portainer_username || "admin";
      const pass = config.portainer_password;
      if (!pass) return null;
      const result = DockerService.run(
        "curl -s -X POST http://localhost:9000/api/auth " +
        '-H "Content-Type: application/json" ' +
        "-d '" + JSON.stringify({ Username: user, Password: pass }) + "'"
      );
      const parsed = JSON.parse(result);
      return parsed.jwt || null;
    } catch {
      return null;
    }
  }

  static getPortainerEndpointAndSwarm(token) {
    try {
      const endpoints = JSON.parse(
        DockerService.run(
          'curl -s http://localhost:9000/api/endpoints -H "Authorization: Bearer ' + token + '"'
        )
      );
      if (!endpoints || endpoints.length === 0) return null;
      const endpointId = endpoints[0].Id;
      const swarmInfo = JSON.parse(
        DockerService.run(
          "curl -s http://localhost:9000/api/endpoints/" + endpointId + '/docker/swarm -H "Authorization: Bearer ' + token + '"'
        )
      );
      return { endpointId, swarmId: swarmInfo.ID };
    } catch {
      return null;
    }
  }

  static async deployViaPortainer(stackName, composeContent) {
    const token = this.getPortainerToken();
    if (!token) throw new Error("Portainer token unavailable");
    const info = this.getPortainerEndpointAndSwarm(token);
    if (!info) throw new Error("Portainer endpoint unavailable");

    const payload = JSON.stringify({
      name: stackName,
      swarmID: info.swarmId,
      stackFileContent: composeContent,
      env: [],
    });

    const payloadPath = "/tmp/portainer-payload-" + stackName + ".json";
    fs.writeFileSync(payloadPath, payload);

    try {
      const result = DockerService.run(
        "curl -s -X POST " +
        '"http://localhost:9000/api/stacks/create/swarm/string?endpointId=' + info.endpointId + '" ' +
        '-H "Authorization: Bearer ' + token + '" ' +
        '-H "Content-Type: application/json" ' +
        "-d @" + payloadPath
      );
      const parsed = JSON.parse(result);
      if (parsed.Id) return { success: true, method: "portainer" };
      throw new Error(parsed.message || "Portainer API error");
    } finally {
      try { fs.unlinkSync(payloadPath); } catch {}
    }
  }

  static async deployStack(stackName, composeContent) {
    try {
      return await this.deployViaPortainer(stackName, composeContent);
    } catch {
      return await DockerService.deployStack(stackName, composeContent);
    }
  }

  // ─── Service Health Check ───

  static async waitForService(serviceName, timeout = 300000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const output = DockerService.run(
          "docker service ls --filter name=" + serviceName + " --format '{{.Replicas}}'"
        );
        const lines = output.split("\n").filter(Boolean);
        const allReady = lines.length > 0 && lines.every((line) => {
          const match = line.match(/(\d+)\/(\d+)/);
          return match && match[1] === match[2] && parseInt(match[1]) > 0;
        });
        if (allReady) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 5000));
    }
    return false;
  }

  // ─── PostgreSQL Shared ───

  static isPostgresInstalled() {
    const containers = DockerService.listContainers();
    return containers.some(
      (c) => c.name.toLowerCase().includes("postgres_postgres") && c.state === "running"
    );
  }

  static async ensurePostgres(onLog) {
    if (this.isPostgresInstalled()) {
      if (onLog) onLog("PostgreSQL compartilhado já está rodando.", "info");
      return;
    }
    if (onLog) onLog("Instalando PostgreSQL compartilhado...", "info");
    const pgRootPass = this.genPass();
    const compose = this.getPostgresCompose(pgRootPass);
    await this.deployStack("postgres", compose);

    if (onLog) onLog("Aguardando PostgreSQL ficar pronto...", "info");
    await this.waitForService("postgres_postgres", 120000);
    // Give postgres a moment to fully initialize
    await new Promise((r) => setTimeout(r, 5000));

    this.saveCredentials("postgres", {
      host: "postgres_postgres",
      port: 5432,
      user: "postgres",
      password: pgRootPass,
      databases: [],
    });
    if (onLog) onLog("PostgreSQL compartilhado instalado!", "success");
  }

  static async createDatabase(dbName, dbUser, dbPassword, onLog) {
    const containers = DockerService.listContainers();
    const pgContainer = containers.find(
      (c) => c.name.toLowerCase().includes("postgres_postgres") && c.state === "running"
    );
    if (!pgContainer) throw new Error("Container PostgreSQL não encontrado");

    const creds = this.loadCredentials();
    const pgPass = creds.postgres?.password;
    if (!pgPass) throw new Error("Senha do PostgreSQL não encontrada");

    try {
      // Create database if not exists
      DockerService.execInContainer(
        pgContainer.id,
        "PGPASSWORD='" + pgPass + "' psql -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname='" + dbName + "'\" | grep -q 1 || " +
        "PGPASSWORD='" + pgPass + "' psql -U postgres -c \"CREATE DATABASE " + dbName + "\""
      );
      // Create user if not exists
      DockerService.execInContainer(
        pgContainer.id,
        "PGPASSWORD='" + pgPass + "' psql -U postgres -tc \"SELECT 1 FROM pg_roles WHERE rolname='" + dbUser + "'\" | grep -q 1 || " +
        "PGPASSWORD='" + pgPass + "' psql -U postgres -c \"CREATE USER " + dbUser + " WITH PASSWORD '" + dbPassword + "'\""
      );
      // Grant privileges
      DockerService.execInContainer(
        pgContainer.id,
        "PGPASSWORD='" + pgPass + "' psql -U postgres -c \"GRANT ALL PRIVILEGES ON DATABASE " + dbName + " TO " + dbUser + "\""
      );

      // Update credentials with new database
      const allCreds = this.loadCredentials();
      if (allCreds.postgres && !allCreds.postgres.databases.includes(dbName)) {
        allCreds.postgres.databases.push(dbName);
        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(allCreds, null, 2));
      }

      if (onLog) onLog("Banco '" + dbName + "' criado.", "info");
    } catch (err) {
      if (onLog) onLog("Aviso ao criar banco: " + err.message, "info");
    }
  }

  // ─── Traefik Check ───

  static isTraefikRunning() {
    const containers = DockerService.listContainers();
    return containers.some(
      (c) => c.name.toLowerCase().includes("traefik") && c.state === "running"
    );
  }

  // ─── Compose Templates ───

  static getPostgresCompose(pgRootPass) {
    return 'version: "3.8"\n' +
      "services:\n" +
      "  postgres:\n" +
      "    image: postgres:16\n" +
      "    environment:\n" +
      "      - POSTGRES_USER=postgres\n" +
      "      - POSTGRES_PASSWORD=" + pgRootPass + "\n" +
      "      - TZ=America/Sao_Paulo\n" +
      "    volumes:\n" +
      "      - postgres_data:/var/lib/postgresql/data\n" +
      "    networks:\n" +
      "      - network_public\n" +
      "    deploy:\n" +
      "      mode: replicated\n" +
      "      replicas: 1\n" +
      "      placement:\n" +
      "        constraints:\n" +
      "          - node.role == manager\n" +
      "      resources:\n" +
      "        limits:\n" +
      '          cpus: "1"\n' +
      "          memory: 1024M\n" +
      "\n" +
      "volumes:\n" +
      "  postgres_data:\n" +
      "    external: true\n" +
      "    name: postgres_data\n" +
      "\n" +
      "networks:\n" +
      "  network_public:\n" +
      "    external: true\n" +
      "    name: network_public\n";
  }

  static getPortainerCompose(c) {
    return 'version: "3.8"\n' +
      "services:\n" +
      "  agent:\n" +
      "    image: portainer/agent:latest\n" +
      "    volumes:\n" +
      "      - /var/run/docker.sock:/var/run/docker.sock\n" +
      "      - /var/lib/docker/volumes:/var/lib/docker/volumes\n" +
      "    networks:\n" +
      "      - agent_network\n" +
      "    deploy:\n" +
      "      mode: global\n" +
      "      placement:\n" +
      "        constraints:\n" +
      "          - node.platform.os == linux\n" +
      "\n" +
      "  portainer:\n" +
      "    image: portainer/portainer-ce:latest\n" +
      "    command: -H tcp://tasks.agent:9001 --tlsskipverify\n" +
      "    volumes:\n" +
      "      - portainer_data:/data\n" +
      "    networks:\n" +
      "      - network_public\n" +
      "      - agent_network\n" +
      "    deploy:\n" +
      "      mode: replicated\n" +
      "      replicas: 1\n" +
      "      placement:\n" +
      "        constraints:\n" +
      "          - node.role == manager\n" +
      "      labels:\n" +
      '        - "traefik.enable=true"\n' +
      '        - "traefik.http.routers.portainer.rule=' + this.hostRule(c.domain_portainer) + '"\n' +
      '        - "traefik.http.routers.portainer.entrypoints=websecure"\n' +
      '        - "traefik.http.routers.portainer.tls.certresolver=letsencryptresolver"\n' +
      '        - "traefik.http.services.portainer.loadbalancer.server.port=9000"\n' +
      '        - "traefik.docker.network=network_public"\n' +
      "\n" +
      "volumes:\n" +
      "  portainer_data:\n" +
      "    external: true\n" +
      "    name: portainer_data\n" +
      "\n" +
      "networks:\n" +
      "  network_public:\n" +
      "    external: true\n" +
      "    name: network_public\n" +
      "  agent_network:\n" +
      "    driver: overlay\n" +
      "    attachable: true\n";
  }

  static getN8nSimpleCompose(c) {
    var pgHost = "postgres_postgres";
    return 'version: "3.8"\n' +
      "services:\n" +
      "  n8n_editor:\n" +
      "    image: n8nio/n8n:latest\n" +
      "    environment:\n" +
      "      - DB_TYPE=postgresdb\n" +
      "      - DB_POSTGRESDB_HOST=" + pgHost + "\n" +
      "      - DB_POSTGRESDB_PORT=5432\n" +
      "      - DB_POSTGRESDB_DATABASE=n8n_db\n" +
      "      - DB_POSTGRESDB_USER=n8n_user\n" +
      "      - DB_POSTGRESDB_PASSWORD=" + c.pg_password + "\n" +
      "      - N8N_ENCRYPTION_KEY=" + c.encryption_key + "\n" +
      "      - N8N_HOST=" + c.domain_n8n + "\n" +
      "      - N8N_EDITOR_BASE_URL=https://" + c.domain_n8n + "/\n" +
      "      - WEBHOOK_URL=https://" + c.domain_n8n + "\n" +
      "      - N8N_PROTOCOL=https\n" +
      "      - N8N_PROXY_HOPS=1\n" +
      "      - NODE_ENV=production\n" +
      "      - N8N_REINSTALL_MISSING_PACKAGES=true\n" +
      "      - N8N_COMMUNITY_PACKAGES_ENABLED=true\n" +
      "      - N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true\n" +
      "      - N8N_PUBLIC_API_DISABLED=false\n" +
      "      - GENERIC_TIMEZONE=America/Sao_Paulo\n" +
      "      - TZ=America/Sao_Paulo\n" +
      "      - N8N_METRICS=true\n" +
      "      - EXECUTIONS_DATA_PRUNE=true\n" +
      "      - EXECUTIONS_DATA_MAX_AGE=336\n" +
      "      - NODE_FUNCTION_ALLOW_BUILTIN=*\n" +
      "      - NODE_FUNCTION_ALLOW_EXTERNAL=moment,lodash\n" +
      "      - N8N_ONBOARDING_FLOW_DISABLED=true\n" +
      "    networks:\n" +
      "      - network_public\n" +
      "    deploy:\n" +
      "      mode: replicated\n" +
      "      replicas: 1\n" +
      "      placement:\n" +
      "        constraints:\n" +
      "          - node.role == manager\n" +
      "      resources:\n" +
      "        limits:\n" +
      '          cpus: "1"\n' +
      "          memory: 1024M\n" +
      "      labels:\n" +
      '        - "traefik.enable=true"\n' +
      '        - "traefik.http.routers.n8n_editor.rule=' + this.hostRule(c.domain_n8n) + '"\n' +
      '        - "traefik.http.routers.n8n_editor.entrypoints=websecure"\n' +
      '        - "traefik.http.routers.n8n_editor.tls.certresolver=letsencryptresolver"\n' +
      '        - "traefik.http.routers.n8n_editor.service=n8n_editor"\n' +
      '        - "traefik.http.services.n8n_editor.loadbalancer.server.port=5678"\n' +
      '        - "traefik.http.services.n8n_editor.loadbalancer.passHostHeader=1"\n' +
      "\n" +
      "networks:\n" +
      "  network_public:\n" +
      "    external: true\n" +
      "    name: network_public\n";
  }

  static getN8nQueueCompose(c) {
    var pgHost = "postgres_postgres";
    var sharedEnv =
      "      - DB_TYPE=postgresdb\n" +
      "      - DB_POSTGRESDB_HOST=" + pgHost + "\n" +
      "      - DB_POSTGRESDB_PORT=5432\n" +
      "      - DB_POSTGRESDB_DATABASE=n8n_db\n" +
      "      - DB_POSTGRESDB_USER=n8n_user\n" +
      "      - DB_POSTGRESDB_PASSWORD=" + c.pg_password + "\n" +
      "      - N8N_ENCRYPTION_KEY=" + c.encryption_key + "\n" +
      "      - EXECUTIONS_MODE=queue\n" +
      "      - QUEUE_BULL_REDIS_HOST=n8n_n8n_redis\n" +
      "      - QUEUE_BULL_REDIS_PORT=6379\n" +
      "      - QUEUE_BULL_REDIS_DB=1\n" +
      "      - GENERIC_TIMEZONE=America/Sao_Paulo\n" +
      "      - TZ=America/Sao_Paulo\n" +
      "      - N8N_FIX_MIGRATIONS=true\n";

    var smtpEnv = "";
    if (c.smtp_host) {
      smtpEnv =
        "      - N8N_SMTP_SENDER=" + (c.smtp_email || "") + "\n" +
        "      - N8N_SMTP_USER=" + (c.smtp_user || "") + "\n" +
        "      - N8N_SMTP_PASS=" + (c.smtp_pass || "") + "\n" +
        "      - N8N_SMTP_HOST=" + c.smtp_host + "\n" +
        "      - N8N_SMTP_PORT=" + (c.smtp_port || "587") + "\n" +
        "      - N8N_SMTP_SSL=false\n";
    }

    var webhookDomain = c.domain_webhook || c.domain_n8n;

    return 'version: "3.8"\n' +
      "services:\n" +
      "  n8n_editor:\n" +
      "    image: n8nio/n8n:latest\n" +
      "    command: start\n" +
      "    networks:\n" +
      "      - network_public\n" +
      "    environment:\n" +
      sharedEnv +
      "      - N8N_HOST=" + c.domain_n8n + "\n" +
      "      - N8N_EDITOR_BASE_URL=https://" + c.domain_n8n + "/\n" +
      "      - WEBHOOK_URL=https://" + webhookDomain + "/\n" +
      "      - N8N_PROTOCOL=https\n" +
      "      - N8N_PROXY_HOPS=1\n" +
      "      - NODE_ENV=production\n" +
      "      - EXECUTIONS_TIMEOUT=3600\n" +
      "      - EXECUTIONS_TIMEOUT_MAX=7200\n" +
      "      - OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=true\n" +
      "      - N8N_RUNNERS_ENABLED=true\n" +
      "      - N8N_RUNNERS_MODE=internal\n" +
      "      - N8N_REINSTALL_MISSING_PACKAGES=true\n" +
      "      - N8N_COMMUNITY_PACKAGES_ENABLED=true\n" +
      "      - N8N_PUBLIC_API_DISABLED=false\n" +
      "      - N8N_METRICS=true\n" +
      "      - EXECUTIONS_DATA_PRUNE=true\n" +
      "      - EXECUTIONS_DATA_MAX_AGE=336\n" +
      "      - NODE_FUNCTION_ALLOW_BUILTIN=*\n" +
      "      - NODE_FUNCTION_ALLOW_EXTERNAL=moment,lodash\n" +
      "      - N8N_ONBOARDING_FLOW_DISABLED=true\n" +
      smtpEnv +
      "    deploy:\n" +
      "      mode: replicated\n" +
      "      replicas: 1\n" +
      "      placement:\n" +
      "        constraints:\n" +
      "          - node.role == manager\n" +
      "      resources:\n" +
      "        limits:\n" +
      '          cpus: "1"\n' +
      "          memory: 1024M\n" +
      "      labels:\n" +
      '        - "traefik.enable=true"\n' +
      '        - "traefik.http.routers.n8n_editor.rule=' + this.hostRule(c.domain_n8n) + '"\n' +
      '        - "traefik.http.routers.n8n_editor.entrypoints=websecure"\n' +
      '        - "traefik.http.routers.n8n_editor.priority=10"\n' +
      '        - "traefik.http.routers.n8n_editor.tls.certresolver=letsencryptresolver"\n' +
      '        - "traefik.http.routers.n8n_editor.service=n8n_editor"\n' +
      '        - "traefik.http.services.n8n_editor.loadbalancer.server.port=5678"\n' +
      '        - "traefik.http.services.n8n_editor.loadbalancer.passHostHeader=1"\n' +
      "\n" +
      "  n8n_webhook:\n" +
      "    image: n8nio/n8n:latest\n" +
      "    command: webhook\n" +
      "    networks:\n" +
      "      - network_public\n" +
      "    environment:\n" +
      sharedEnv +
      "      - N8N_HOST=" + c.domain_n8n + "\n" +
      "      - N8N_EDITOR_BASE_URL=https://" + c.domain_n8n + "/\n" +
      "      - WEBHOOK_URL=https://" + webhookDomain + "/\n" +
      "      - N8N_PROTOCOL=https\n" +
      "      - NODE_ENV=production\n" +
      "    deploy:\n" +
      "      mode: replicated\n" +
      "      replicas: 1\n" +
      "      placement:\n" +
      "        constraints:\n" +
      "          - node.role == manager\n" +
      "      resources:\n" +
      "        limits:\n" +
      '          cpus: "1"\n' +
      "          memory: 1024M\n" +
      "      labels:\n" +
      '        - "traefik.enable=true"\n' +
      '        - "traefik.http.routers.n8n_webhook.rule=' + this.hostRule(webhookDomain) + '"\n' +
      '        - "traefik.http.routers.n8n_webhook.entrypoints=websecure"\n' +
      '        - "traefik.http.routers.n8n_webhook.priority=5"\n' +
      '        - "traefik.http.routers.n8n_webhook.tls.certresolver=letsencryptresolver"\n' +
      '        - "traefik.http.routers.n8n_webhook.service=n8n_webhook"\n' +
      '        - "traefik.http.services.n8n_webhook.loadbalancer.server.port=5678"\n' +
      '        - "traefik.http.services.n8n_webhook.loadbalancer.passHostHeader=1"\n' +
      "\n" +
      "  n8n_worker:\n" +
      "    image: n8nio/n8n:latest\n" +
      "    command: worker --concurrency=10\n" +
      "    networks:\n" +
      "      - network_public\n" +
      "    environment:\n" +
      sharedEnv +
      "      - N8N_REINSTALL_MISSING_PACKAGES=true\n" +
      "      - NODE_FUNCTION_ALLOW_BUILTIN=*\n" +
      "      - NODE_FUNCTION_ALLOW_EXTERNAL=moment,lodash\n" +
      "    deploy:\n" +
      "      mode: replicated\n" +
      "      replicas: 1\n" +
      "      placement:\n" +
      "        constraints:\n" +
      "          - node.role == manager\n" +
      "      resources:\n" +
      "        limits:\n" +
      '          cpus: "1"\n' +
      "          memory: 1024M\n" +
      "\n" +
      "  n8n_redis:\n" +
      "    image: redis:latest\n" +
      '    command: ["redis-server", "--appendonly", "yes", "--port", "6379"]\n' +
      "    volumes:\n" +
      "      - n8n_redis:/data\n" +
      "    networks:\n" +
      "      - network_public\n" +
      "    deploy:\n" +
      "      placement:\n" +
      "        constraints:\n" +
      "          - node.role == manager\n" +
      "      resources:\n" +
      "        limits:\n" +
      '          cpus: "1"\n' +
      "          memory: 1024M\n" +
      "\n" +
      "volumes:\n" +
      "  n8n_redis:\n" +
      "    external: true\n" +
      "    name: n8n_redis\n" +
      "\n" +
      "networks:\n" +
      "  network_public:\n" +
      "    external: true\n" +
      "    name: network_public\n";
  }

  static getEvolutionCompose(c) {
    var pgHost = "postgres_postgres";
    return 'version: "3.8"\n' +
      "services:\n" +
      "  evolution_api:\n" +
      "    image: atendai/evolution-api:latest\n" +
      "    volumes:\n" +
      "      - evolution_instances:/evolution/instances\n" +
      "    networks:\n" +
      "      - network_public\n" +
      "    environment:\n" +
      "      - SERVER_URL=https://" + c.domain_evolution + "\n" +
      "      - AUTHENTICATION_API_KEY=" + c.evolution_key + "\n" +
      "      - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true\n" +
      "      - DEL_INSTANCE=false\n" +
      "      - QRCODE_LIMIT=1902\n" +
      "      - LANGUAGE=pt-BR\n" +
      "      - CONFIG_SESSION_PHONE_CLIENT=N8NLABZ\n" +
      "      - CONFIG_SESSION_PHONE_NAME=Chrome\n" +
      "      - DATABASE_ENABLED=true\n" +
      "      - DATABASE_PROVIDER=postgresql\n" +
      "      - DATABASE_CONNECTION_URI=postgresql://evolution_user:" + c.pg_password + "@" + pgHost + ":5432/evolution_db\n" +
      "      - DATABASE_CONNECTION_CLIENT_NAME=evolution\n" +
      "      - DATABASE_SAVE_DATA_INSTANCE=true\n" +
      "      - DATABASE_SAVE_DATA_NEW_MESSAGE=true\n" +
      "      - DATABASE_SAVE_MESSAGE_UPDATE=true\n" +
      "      - DATABASE_SAVE_DATA_CONTACTS=true\n" +
      "      - DATABASE_SAVE_DATA_CHATS=true\n" +
      "      - DATABASE_SAVE_DATA_LABELS=true\n" +
      "      - DATABASE_SAVE_DATA_HISTORIC=true\n" +
      "      - N8N_ENABLED=true\n" +
      "      - EVOAI_ENABLED=true\n" +
      "      - OPENAI_ENABLED=true\n" +
      "      - DIFY_ENABLED=true\n" +
      "      - TYPEBOT_ENABLED=true\n" +
      "      - TYPEBOT_API_VERSION=latest\n" +
      "      - CHATWOOT_ENABLED=true\n" +
      "      - CACHE_REDIS_ENABLED=true\n" +
      "      - CACHE_REDIS_URI=redis://evolution_evolution_redis:6379/1\n" +
      "      - CACHE_REDIS_PREFIX_KEY=evolution\n" +
      "      - CACHE_REDIS_SAVE_INSTANCES=false\n" +
      "      - CACHE_LOCAL_ENABLED=false\n" +
      "      - S3_ENABLED=false\n" +
      "      - TELEMETRY=false\n" +
      "      - WEBSOCKET_ENABLED=false\n" +
      "      - RABBITMQ_ENABLED=false\n" +
      "      - WEBHOOK_GLOBAL_ENABLED=false\n" +
      "      - PROVIDER_ENABLED=false\n" +
      "      - WA_BUSINESS_TOKEN_WEBHOOK=evolution\n" +
      "      - WA_BUSINESS_URL=https://graph.facebook.com\n" +
      "      - WA_BUSINESS_VERSION=v23.0\n" +
      "      - WA_BUSINESS_LANGUAGE=pt_BR\n" +
      "    deploy:\n" +
      "      mode: replicated\n" +
      "      replicas: 1\n" +
      "      placement:\n" +
      "        constraints:\n" +
      "          - node.role == manager\n" +
      "      labels:\n" +
      '        - "traefik.enable=true"\n' +
      '        - "traefik.http.routers.evolution.rule=' + this.hostRule(c.domain_evolution) + '"\n' +
      '        - "traefik.http.routers.evolution.entrypoints=websecure"\n' +
      '        - "traefik.http.routers.evolution.tls.certresolver=letsencryptresolver"\n' +
      '        - "traefik.http.routers.evolution.service=evolution"\n' +
      '        - "traefik.http.services.evolution.loadbalancer.server.port=8080"\n' +
      '        - "traefik.http.services.evolution.loadbalancer.passHostHeader=true"\n' +
      "\n" +
      "  evolution_redis:\n" +
      "    image: redis:latest\n" +
      '    command: ["redis-server", "--appendonly", "yes", "--port", "6379"]\n' +
      "    volumes:\n" +
      "      - evolution_redis:/data\n" +
      "    networks:\n" +
      "      - network_public\n" +
      "    deploy:\n" +
      "      placement:\n" +
      "        constraints:\n" +
      "          - node.role == manager\n" +
      "      resources:\n" +
      "        limits:\n" +
      '          cpus: "1"\n' +
      "          memory: 1024M\n" +
      "\n" +
      "volumes:\n" +
      "  evolution_instances:\n" +
      "    external: true\n" +
      "    name: evolution_instances\n" +
      "  evolution_redis:\n" +
      "    external: true\n" +
      "    name: evolution_redis\n" +
      "\n" +
      "networks:\n" +
      "  network_public:\n" +
      "    external: true\n" +
      "    name: network_public\n";
  }

  // ─── Core Install ───

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

      let compose, stackName, credentials = {};

      switch (toolId) {
        case "portainer": {
          stackName = "portainer";
          addLog("Gerando configuração Portainer + Agent...", "info");
          compose = this.getPortainerCompose(config);
          credentials = {
            url: "https://" + config.domain_portainer,
            domain: config.domain_portainer,
            username: "admin",
            password: config.admin_password || "Configurar no primeiro acesso",
          };
          break;
        }

        case "n8n": {
          addLog("Verificando dependências...", "info");
          await this.ensurePostgres((text, type) => addLog(text, type));

          const mode = config.n8n_mode || "simple";
          stackName = "n8n";
          const n8nDbPass = this.genPass();
          const encKey = this.genPass(32);

          addLog("Criando banco de dados n8n...", "info");
          await this.createDatabase("n8n_db", "n8n_user", n8nDbPass, (text, type) => addLog(text, type));

          const composeConfig = { ...config, pg_password: n8nDbPass, encryption_key: encKey };

          if (mode === "queue") {
            addLog("Gerando configuração n8n (modo avançado com filas)...", "info");
            compose = this.getN8nQueueCompose(composeConfig);
            credentials = {
              editor_url: "https://" + config.domain_n8n,
              webhook_url: "https://" + (config.domain_webhook || config.domain_n8n),
              domain: config.domain_n8n,
              domain_webhook: config.domain_webhook || config.domain_n8n,
              note: "Email e senha são criados no primeiro acesso ao n8n",
              mode: "queue",
              db_password: n8nDbPass,
              encryption_key: encKey,
            };
          } else {
            addLog("Gerando configuração n8n (modo simples)...", "info");
            compose = this.getN8nSimpleCompose(composeConfig);
            credentials = {
              editor_url: "https://" + config.domain_n8n,
              webhook_url: "https://" + config.domain_n8n,
              domain: config.domain_n8n,
              note: "Email e senha são criados no primeiro acesso ao n8n",
              mode: "simple",
              db_password: n8nDbPass,
              encryption_key: encKey,
            };
          }

          if (config.smtp_host) {
            credentials.smtp = {
              email: config.smtp_email,
              host: config.smtp_host,
              port: config.smtp_port || "587",
            };
          }
          break;
        }

        case "evolution": {
          addLog("Verificando dependências...", "info");
          await this.ensurePostgres((text, type) => addLog(text, type));

          stackName = "evolution";
          const evoDbPass = this.genPass();
          const apiKey = config.evolution_key || this.genPass(32);

          addLog("Criando banco de dados Evolution...", "info");
          await this.createDatabase("evolution_db", "evolution_user", evoDbPass, (text, type) => addLog(text, type));

          addLog("Gerando configuração Evolution API...", "info");
          compose = this.getEvolutionCompose({ ...config, pg_password: evoDbPass, evolution_key: apiKey });
          credentials = {
            base_url: "https://" + config.domain_evolution,
            manager_url: "https://" + config.domain_evolution + "/manager",
            domain: config.domain_evolution,
            api_key: apiKey,
            db_password: evoDbPass,
          };
          break;
        }

        default:
          throw new Error("Ferramenta desconhecida: " + toolId);
      }

      addLog('Deploy da stack "' + stackName + '"...', "info");
      const deployResult = await this.deployStack(stackName, compose);
      addLog("Deploy iniciado via " + (deployResult.method || "docker-cli") + ".", "info");

      addLog("Aguardando serviços ficarem prontos...", "info");
      const ready = await this.waitForService(stackName + "_", 180000);
      if (!ready) {
        addLog("Timeout aguardando serviço, mas o deploy foi iniciado.", "info");
      }

      this.saveCredentials(toolId, credentials);
      addLog("Credenciais salvas.", "info");

      addLog(toolId + " instalado com sucesso!", "success");
      return { success: true, stackName, logs, credentials };
    } catch (err) {
      addLog("Erro: " + err.message, "error");
      return { success: false, error: err.message, logs };
    }
  }

  // ─── Detection ───

  static getInstalledTools() {
    const containers = DockerService.listContainers();
    const tools = new Set();
    containers.forEach((c) => {
      const n = c.name.toLowerCase();
      if (n.includes("portainer_portainer")) tools.add("portainer");
      if (n.includes("n8n_n8n_editor") || n.includes("n8n_n8n")) tools.add("n8n");
      if (n.includes("evolution_evolution_api") || n.includes("evolution_evolution")) tools.add("evolution");
    });
    return Array.from(tools);
  }

  // ─── Uninstall ───

  static async uninstallTool(toolId) {
    const map = { portainer: "portainer", n8n: "n8n", evolution: "evolution" };
    const name = map[toolId];
    if (!name) throw new Error("Ferramenta desconhecida");
    const result = await DockerService.removeStack(name);

    // Remove credentials
    const creds = this.loadCredentials();
    delete creds[toolId];
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));

    return result;
  }
}

module.exports = InstallService;
