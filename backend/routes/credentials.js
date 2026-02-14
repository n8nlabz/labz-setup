const express = require("express");
const router = express.Router();
const InstallService = require("../services/install");

router.get("/", (req, res) => {
  try {
    res.json(InstallService.loadCredentials());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
