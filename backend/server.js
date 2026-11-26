
import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import connectDB from "./config/db.js";
import { initializeComposio } from "./mcp/composioClient.js";
import { startEmailMonitor } from "./jobs/emailMonitor.js";
import {inspectComposioTool} from "./mcp/toolRunner.js";

// Routes
import emailRoutes from "./routes/emailRoutes.js";
import placementRoutes from "./routes/placementRoutes.js";


const app = express();

const PORT = process.env.PORT || 5000;

// =====================================
// MIDDLEWARE
// =====================================

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(morgan("dev"));

// =====================================
// API ROUTES
// =====================================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Email Intelligence Agent API is running",
  });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/emails", emailRoutes);
app.use("/api/placements", placementRoutes);

// =====================================
// 404 HANDLER
// =====================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
  });
});

// =====================================
// GLOBAL ERROR HANDLER
// =====================================

app.use((error, req, res, next) => {
  console.error("[Server Error]", error);

  res.status(error.status || 500).json({
    success: false,
    message: error.message || "Internal server error",
  });
});

// =====================================
// SERVER INITIALIZATION
// =====================================

async function startServer() {
  try {
    console.log("\n================================");
    console.log("EMAIL INTELLIGENCE AGENT");
    console.log("================================\n");

    // 1. Connect MongoDB
    console.log("[1/3] Connecting to MongoDB...");
    await connectDB();
    console.log("[MongoDB] Connected successfully");

    // 2. Initialize Composio MCP
    console.log("\n[2/3] Initializing Composio MCP...");
    await initializeComposio();
    console.log("[Composio] Initialized successfully");

    inspectComposioTool("GMAIL_FETCH_EMAILS");

    // 3. Start Express server
    const server = app.listen(PORT, () => {
      console.log(`\n[Server] Running at http://localhost:${PORT}`);
    });

    // 4. Start Gmail monitoring
    console.log("\n[3/3] Starting Gmail monitor...");
    startEmailMonitor();

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n[Server] ${signal} received. Shutting down...`);

      server.close(async () => {
        console.log("[Server] HTTP server closed");

        try {
          const mongoose = await import("mongoose");
          await mongoose.default.connection.close();

          console.log("[MongoDB] Connection closed");
        } catch (error) {
          console.error("[Shutdown] MongoDB close error:", error.message);
        }

        process.exit(0);
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

  } catch (error) {
    console.error("\n[Startup Error]", error);
    process.exit(1);
  }
}

startServer();
