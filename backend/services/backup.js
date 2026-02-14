const DockerService = require("./docker");
const InstallService = require("./install");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const BACKUP_DIR = "/opt/n8nlabz/backups";
const CONFIG_PATH = "/opt/n8nlabz/config.json";
const CREDENTIALS_PATH = "/opt/n8nlabz/credentials.json";
const MAX_BACKUPS = 7;

class BackupService {
  static wsClients = new Set();

  static ensureDir() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  static broadcast(msg) {
    const data = JSON.stringify(msg);
    this.wsClients.forEach((ws) => {
      try { ws.send(data); } catch {}
    });
  }

  // ─── Smart Backup ───

  static async createBackup() {
    this.ensureDir();
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const tmpDir = "/tmp/n8nlabz-backup-" + ts;
    const filename = "backup-" + ts + ".tar.gz";
    const backupPath = path.join(BACKUP_DIR, filename);

    try {
      DockerService.run("mkdir -p " + tmpDir);
      this.broadcast({ type: "backup", status: "started", filename });

      // 1. pg_dump all databases
      this.broadcast({ type: "backup", step: "PostgreSQL dump..." });
      const pgDumped = await this.dumpPostgres(tmpDir);

      // 2. Evolution instances
      this.broadcast({ type: "backup", step: "Evolution instances..." });
      const evoDumped = this.dumpEvolutionInstances(tmpDir);

      // 3. Config files
      this.broadcast({ type: "backup", step: "Configurações..." });
      this.copyConfigs(tmpDir);

      // 4. Compress
      this.broadcast({ type: "backup", step: "Compactando..." });
      DockerService.run("tar -czf " + backupPath + " -C " + tmpDir + " .", { timeout: 300000 });

      // 5. Rotate
      this.rotateBackups();

      // Cleanup tmp
      DockerService.run("rm -rf " + tmpDir);

      const stats = fs.statSync(backupPath);
      const result = {
        success: true,
        filename,
        size: stats.size,
        sizeFormatted: this.fmtBytes(stats.size),
        date: new Date().toISOString(),
        includes: { postgres: pgDumped, evolution: evoDumped, configs: true },
      };

      this.broadcast({ type: "backup", status: "completed", ...result });
      return result;
    } catch (err) {
      DockerService.run("rm -rf " + tmpDir);
      this.broadcast({ type: "backup", status: "error", error: err.message });
      throw new Error("Erro ao criar backup: " + err.message);
    }
  }

  static async dumpPostgres(tmpDir) {
    const containers = DockerService.listContainers();
    const pgContainer = containers.find(
      (c) => c.name.toLowerCase().includes("postgres_postgres") && c.state === "running"
    );
    if (!pgContainer) return false;

    const creds = InstallService.loadCredentials();
    const pgPass = creds.postgres?.password;
    if (!pgPass) return false;

    try {
      DockerService.run("mkdir -p " + tmpDir + "/postgres");

      // List databases (exclude templates and postgres system db)
      const dbList = DockerService.execInContainer(
        pgContainer.id,
        "PGPASSWORD='" + pgPass + "' psql -U postgres -t -A -c \"SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres'\""
      ).trim();

      if (!dbList) return false;

      const databases = dbList.split("\n").filter(Boolean);
      for (const db of databases) {
        try {
          DockerService.execInContainer(
            pgContainer.id,
            "PGPASSWORD='" + pgPass + "' pg_dump -U postgres -Fc " + db + " > /tmp/dump_" + db + ".sql"
          );
          DockerService.copyFromContainer(pgContainer.id, "/tmp/dump_" + db + ".sql", tmpDir + "/postgres/" + db + ".sql");
          DockerService.execInContainer(pgContainer.id, "rm -f /tmp/dump_" + db + ".sql");
          this.broadcast({ type: "backup", step: "Banco " + db + " exportado." });
        } catch (e) {
          this.broadcast({ type: "backup", step: "Aviso: " + db + " - " + e.message });
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  static dumpEvolutionInstances(tmpDir) {
    try {
      // Check if evolution_instances volume has data
      const result = DockerService.run(
        "docker run --rm -v evolution_instances:/data alpine sh -c 'ls /data 2>/dev/null | head -1'",
        { timeout: 30000 }
      );
      if (!result) return false;

      DockerService.run("mkdir -p " + tmpDir + "/evolution");
      DockerService.run(
        "docker run --rm -v evolution_instances:/data -v " + tmpDir + "/evolution:/backup alpine " +
        "sh -c 'cd /data && tar -czf /backup/instances.tar.gz . 2>/dev/null'",
        { timeout: 120000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  static copyConfigs(tmpDir) {
    DockerService.run("mkdir -p " + tmpDir + "/configs");
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        fs.copyFileSync(CONFIG_PATH, tmpDir + "/configs/config.json");
      }
    } catch {}
    try {
      if (fs.existsSync(CREDENTIALS_PATH)) {
        fs.copyFileSync(CREDENTIALS_PATH, tmpDir + "/configs/credentials.json");
      }
    } catch {}
  }

  // ─── Restore ───

  static async restoreBackup(filePath) {
    const tmpDir = "/tmp/n8nlabz-restore-" + Date.now();

    try {
      DockerService.run("mkdir -p " + tmpDir);
      this.broadcast({ type: "restore", status: "started" });

      // Extract
      this.broadcast({ type: "restore", step: "Extraindo backup..." });
      DockerService.run("tar -xzf " + filePath + " -C " + tmpDir, { timeout: 300000 });

      // 1. Restore postgres dumps
      this.broadcast({ type: "restore", step: "Restaurando bancos de dados..." });
      const pgRestored = await this.restorePostgres(tmpDir);

      // 2. Restore evolution instances
      this.broadcast({ type: "restore", step: "Restaurando Evolution instances..." });
      const evoRestored = this.restoreEvolutionInstances(tmpDir);

      // 3. Restore configs
      this.broadcast({ type: "restore", step: "Restaurando configurações..." });
      this.restoreConfigs(tmpDir);

      // Cleanup
      DockerService.run("rm -rf " + tmpDir);
      try { fs.unlinkSync(filePath); } catch {}

      const result = {
        success: true,
        message: "Backup restaurado com sucesso!",
        restored: { postgres: pgRestored, evolution: evoRestored, configs: true },
      };
      this.broadcast({ type: "restore", status: "completed", ...result });
      return result;
    } catch (err) {
      DockerService.run("rm -rf " + tmpDir);
      this.broadcast({ type: "restore", status: "error", error: err.message });
      throw new Error("Erro ao restaurar: " + err.message);
    }
  }

  static async restorePostgres(tmpDir) {
    const pgDir = tmpDir + "/postgres";
    if (!fs.existsSync(pgDir)) return false;

    const containers = DockerService.listContainers();
    const pgContainer = containers.find(
      (c) => c.name.toLowerCase().includes("postgres_postgres") && c.state === "running"
    );
    if (!pgContainer) return false;

    const creds = InstallService.loadCredentials();
    const pgPass = creds.postgres?.password;
    if (!pgPass) return false;

    try {
      const dumps = fs.readdirSync(pgDir).filter((f) => f.endsWith(".sql"));
      for (const dump of dumps) {
        const dbName = dump.replace(".sql", "");
        try {
          DockerService.copyToContainer(pgContainer.id, pgDir + "/" + dump, "/tmp/restore_" + dump);
          // Drop and recreate to ensure clean restore
          DockerService.execInContainer(
            pgContainer.id,
            "PGPASSWORD='" + pgPass + "' psql -U postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='" + dbName + "' AND pid <> pg_backend_pid()\" 2>/dev/null; " +
            "PGPASSWORD='" + pgPass + "' dropdb -U postgres --if-exists " + dbName + " 2>/dev/null; " +
            "PGPASSWORD='" + pgPass + "' createdb -U postgres " + dbName + " 2>/dev/null; " +
            "PGPASSWORD='" + pgPass + "' pg_restore -U postgres -d " + dbName + " /tmp/restore_" + dump + " 2>/dev/null"
          );
          DockerService.execInContainer(pgContainer.id, "rm -f /tmp/restore_" + dump);
          this.broadcast({ type: "restore", step: "Banco " + dbName + " restaurado." });
        } catch (e) {
          this.broadcast({ type: "restore", step: "Aviso: " + dbName + " - " + e.message });
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  static restoreEvolutionInstances(tmpDir) {
    const evoFile = tmpDir + "/evolution/instances.tar.gz";
    if (!fs.existsSync(evoFile)) return false;

    try {
      DockerService.run(
        "docker run --rm -v evolution_instances:/data -v " + tmpDir + "/evolution:/backup alpine " +
        "sh -c 'cd /data && tar -xzf /backup/instances.tar.gz 2>/dev/null'",
        { timeout: 120000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  static restoreConfigs(tmpDir) {
    const configDir = tmpDir + "/configs";
    if (!fs.existsSync(configDir)) return;
    try {
      if (fs.existsSync(configDir + "/config.json")) {
        fs.copyFileSync(configDir + "/config.json", CONFIG_PATH);
      }
    } catch {}
    try {
      if (fs.existsSync(configDir + "/credentials.json")) {
        fs.copyFileSync(configDir + "/credentials.json", CREDENTIALS_PATH);
      }
    } catch {}
  }

  // ─── List / Delete / Download ───

  static listBackups() {
    this.ensureDir();
    try {
      return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".tar.gz")).sort().reverse().map((filename) => {
        const fp = path.join(BACKUP_DIR, filename);
        const stats = fs.statSync(fp);
        return {
          filename,
          size: stats.size,
          sizeFormatted: this.fmtBytes(stats.size),
          date: stats.mtime.toISOString(),
        };
      });
    } catch { return []; }
  }

  static deleteBackup(filename) {
    const fp = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(fp)) throw new Error("Backup não encontrado");
    fs.unlinkSync(fp);
    return { success: true };
  }

  static getBackupPath(filename) {
    return path.join(BACKUP_DIR, filename);
  }

  // ─── Rotation ───

  static rotateBackups() {
    try {
      const backups = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.endsWith(".tar.gz"))
        .sort()
        .reverse();

      if (backups.length > MAX_BACKUPS) {
        const toDelete = backups.slice(MAX_BACKUPS);
        toDelete.forEach((f) => {
          try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
        });
      }
    } catch {}
  }

  // ─── Scheduler ───

  static initScheduler() {
    cron.schedule("0 3 * * *", async () => {
      console.log("[BACKUP] Auto-backup iniciado...");
      try {
        const result = await this.createBackup();
        console.log("[BACKUP] Auto-backup concluído: " + result.filename);
      } catch (err) {
        console.error("[BACKUP] Erro no auto-backup: " + err.message);
      }
    }, { timezone: "America/Sao_Paulo" });

    console.log("[BACKUP] Agendamento diário às 03:00 (America/Sao_Paulo) ativo.");
  }

  // ─── Utils ───

  static fmtBytes(b) {
    if (b === 0) return "0 B";
    const k = 1024;
    const s = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
  }
}

module.exports = BackupService;
