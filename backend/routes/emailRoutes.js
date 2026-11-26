
import express from "express";
import Email from "../models/Email.js";
import { runEmailMonitorOnce } from "../jobs/emailMonitor.js";

const router = express.Router();

// Get processed email history.
router.get("/", async (req, res) => {
  try {
    const emails = await Email.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({
      success: true,
      count: emails.length,
      emails,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Manually trigger Gmail scanning.
router.post("/scan", async (req, res) => {
  try {
    await runEmailMonitorOnce();

    res.json({
      success: true,
      message: "Gmail scan completed",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
