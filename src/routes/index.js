const express = require("express");
const chatRoutes = require("./chat");
const adminRoutes = require("./admin");

const router = express.Router();

router.use("/chat", chatRoutes);
router.use("/admin", adminRoutes);

router.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

router.get("/", (req, res) => {
  res.json({ message: "Welcome to Vherifai API" });
});

module.exports = router;
