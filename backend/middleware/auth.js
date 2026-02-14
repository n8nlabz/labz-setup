const crypto = require("crypto");
const fs = require("fs");

const CONFIG_PATH = "/opt/n8nlabz/config.json";
const JWT_SECRET = process.env.JWT_SECRET || "n8nlabz_" + (fs.existsSync(CONFIG_PATH) ? require(CONFIG_PATH).installed_at || "secret" : "secret");

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function createJWT(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 })).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyJWT(token) {
  try {
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) return null;
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
    if (signature !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function validateLogin(email, password) {
  const config = loadConfig();
  if (!config.admin_email || !config.admin_password_hash) return false;
  return config.admin_email === email && config.admin_password_hash === sha256(password);
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido" });
  }
  const token = auth.slice(7);
  const payload = verifyJWT(token);
  if (!payload) return res.status(403).json({ error: "Token inválido ou expirado" });
  req.user = payload;
  next();
}

module.exports = { authMiddleware, createJWT, verifyJWT, validateLogin, sha256, loadConfig };
