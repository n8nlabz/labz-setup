const express = require("express");
const router = express.Router();
const { validateLogin, createJWT, verifyJWT, loadConfig } = require("../middleware/auth");

router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email e senha são obrigatórios" });
  }
  if (!validateLogin(email, password)) {
    return res.status(401).json({ error: "Email ou senha incorretos" });
  }
  const token = createJWT({ email });
  res.json({ success: true, token });
});

router.get("/check", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.json({ valid: false });
  }
  const payload = verifyJWT(auth.slice(7));
  res.json({ valid: !!payload });
});

module.exports = router;
