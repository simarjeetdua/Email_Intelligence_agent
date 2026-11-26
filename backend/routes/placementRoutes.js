
import express from "express";
import Placement from "../models/Placement.js";

const router = express.Router();

// Get all detected opportunities.
router.get("/", async (req, res) => {
  try {
    const placements = await Placement.find()
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      count: placements.length,
      placements,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
