const express = require("express");
const router = express.Router();
const InstallService = require("../services/install");

router.get("/status", (req, res) => {
  try { res.json({ installed: InstallService.getInstalledTools() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/suggestions", (req, res) => {
  try { res.json(InstallService.getSuggestedSubdomains()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/:toolId", async (req, res) => {
  try {
    const config = { ...req.body };
    if (req.body.n8n_mode) config.n8n_mode = req.body.n8n_mode;

    const onLog = (entry) => {
      if (req.app.locals.broadcast) {
        req.app.locals.broadcast({ type: "install_log", toolId: req.params.toolId, ...entry });
      }
    };

    const result = await InstallService.installTool(req.params.toolId, config, onLog);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/:toolId", async (req, res) => {
  try {
    const result = await InstallService.uninstallTool(req.params.toolId);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
