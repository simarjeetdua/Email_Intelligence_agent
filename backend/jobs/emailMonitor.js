
import cron from "node-cron";

import Email from "../models/Email.js";
import Placement from "../models/Placement.js";
import MonitorState from "../models/MonitorState.js";

import {
  fetchAllEmails,
  normalizeEmail,
} from "../services/gmailService.js";

import { analyzePlacement } from "../ai/agents/placementAgent.js";

import {
  sendPlacementNotification,
} from "../services/telegramService.js";

// =====================================
// CONFIGURATION
// =====================================

const STATE_KEY = "gmail-email-monitor";

// New version forces one fresh historical scan
// for the newly discovered official TPO sender.
const HISTORY_STATE_KEY = "gmail-history-backfill-v2-crp";

const ALLOWED_TPO_SENDERS = [
  "directorcrp@svvv.edu.in",
  "santoshpatidar@svvv.edu.in",
  "crp@svvv.edu.in",
];

// Gmail OR query for all three official senders.
const HISTORICAL_QUERY =
  "{from:crp@svvv.edu.in from:directorcrp@svvv.edu.in from:santoshpatidar@svvv.edu.in} -in:sent -in:drafts";

const EMAILS_PER_PAGE = 10;
const OVERLAP_DAYS = 1;

let isRunning = false;
let scheduledTask = null;

// =====================================
// HELPER FUNCTIONS
// =====================================

function extractEmailAddress(sender = "") {
  const match = String(sender).match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );

  return match ? match[0].toLowerCase() : "";
}

function isAllowedSender(sender) {
  const address = extractEmailAddress(sender);

  return ALLOWED_TPO_SENDERS.includes(address);
}

function validUrl(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value.trim());

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function validDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatGmailDate(date) {
  const d = new Date(date);

  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");

  return `${year}/${month}/${day}`;
}

function normalizeBranches(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeRequirements(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .join("; ");
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return "";
}

function calculateOpportunityStatus(deadline) {
  if (!deadline) {
    return "unknown";
  }

  return deadline.getTime() < Date.now()
    ? "expired"
    : "active";
}

function getOpportunityType(analysis) {
  const allowedTypes = [
    "placement",
    "internship",
    "job",
  ];

  const type = String(
    analysis?.opportunityType || ""
  ).toLowerCase();

  if (!allowedTypes.includes(type)) {
    throw new Error(
      `Invalid opportunity type: ${type}`
    );
  }

  return type;
}

// =====================================
// UPDATE EMAIL STATUS
// =====================================

async function updateEmailStatus(messageId, data) {
  await Email.updateOne(
    { messageId },
    {
      $set: data,
      $unset: {
        error: "",
      },
    }
  );
}

// =====================================
// PROCESS SINGLE EMAIL
// =====================================

async function processEmail(rawMessage) {
  let email;

  try {
    // Normalize Gmail response.
    email = normalizeEmail(rawMessage);

    if (!email?.messageId) {
      console.error("[Monitor] Email missing message ID");
      return false;
    }

    // Verify sender.
    if (!isAllowedSender(email.sender)) {
      console.log("[Monitor] Unapproved sender. Skipping.");
      return true;
    }

    console.log("\n--------------------------------");
    console.log("[Monitor] Subject:", email.subject);
    console.log("[Monitor] Sender:", email.sender);
    console.log("[Monitor] Message ID:", email.messageId);

    // =====================================
    // CHECK EXISTING RECORDS
    // =====================================

    const existingEmail = await Email.findOne({
      messageId: email.messageId,
    });

    const existingPlacement = await Placement.findOne({
      emailId: email.messageId,
    });

    // Already notified? Do not send again.
    if (existingPlacement?.notificationSent) {
      console.log(
        "[Telegram] This email's opportunity was already notified."
      );

      await updateEmailStatus(email.messageId, {
        status: "processed",
        category: existingPlacement.opportunityType,
      });

      return true;
    }

    // Previously classified as not an opportunity.
    if (existingEmail?.status === "not_placement") {
      console.log(
        "[Monitor] Previously classified as non-placement. Skipping."
      );

      return true;
    }

    // Skip previously processed emails only when their
    // notification/placement state is already consistent.
    if (
      existingEmail?.status === "processed" &&
      existingPlacement?.notificationSent
    ) {
      return true;
    }

    // =====================================
    // MARK AS PROCESSING
    // =====================================

    await Email.findOneAndUpdate(
      { messageId: email.messageId },
      {
        $set: {
          messageId: email.messageId,
          threadId: email.threadId,
          sender: email.sender,
          subject: email.subject,
          receivedAt: email.receivedAt,
          snippet: email.snippet,
          status: "processing",
          error: null,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    // =====================================
    // MISTRAL AI ANALYSIS
    // =====================================

    console.log("[AI] Analyzing email...");
    console.log("[AI] Body characters:", email.body?.length || 0);

    const analysis = await analyzePlacement(email);

    if (!analysis) {
      throw new Error("Mistral returned empty analysis");
    }

    console.log("[AI] Opportunity:", analysis.isOpportunity);
    console.log("[AI] Type:", analysis.opportunityType);
    console.log("[AI] Company:", analysis.company);
    console.log("[AI] Confidence:", analysis.confidence);

    // =====================================
    // IGNORE NON-OPPORTUNITY EMAILS
    // =====================================

    if (
      !analysis.isOpportunity ||
      analysis.opportunityType === "other"
    ) {
      await updateEmailStatus(email.messageId, {
        status: "not_placement",
        category: "other",
        summary: analysis.summary || "",
        confidence: analysis.confidence || 0,
      });

      console.log(
        "[AI] Not a placement/internship/job opportunity."
      );

      return true;
    }

    // =====================================
    // VALIDATE ANALYSIS
    // =====================================

    const opportunityType = getOpportunityType(analysis);

    const deadline = validDate(analysis.deadline);

    const registrationUrl = validUrl(
      analysis.applicationUrl ||
      analysis.registrationUrl ||
      analysis.universityConfirmationUrl
    );

    const branches = normalizeBranches(
      analysis.branches
    );

    // Original Placement schema uses String for
    // eligibility.additionalRequirements.
    const additionalRequirements = normalizeRequirements(
      analysis.additionalRequirements
    );

    const status = calculateOpportunityStatus(deadline);

    // =====================================
    // SAVE PLACEMENT IN MONGODB
    // =====================================

    console.log("[MongoDB] Saving placement...");

    const placement = await Placement.findOneAndUpdate(
      {
        emailId: email.messageId,
      },
      {
        $set: {
          emailId: email.messageId,

          company: analysis.company || "Not specified",
          role: analysis.role || "Not specified",

          opportunityType,

          package: analysis.package || "",
          location: analysis.location || "",

          eligibility: {
            minimumCGPA: analysis.minimumCGPA || "",
            allowedBacklogs: analysis.allowedBacklogs || "",
            branches,
            additionalRequirements,
          },

          deadline,
          registrationUrl,

          summary: analysis.summary || "",
          confidence: analysis.confidence || 0,

          status,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

    if (!placement) {
      throw new Error("Failed to save placement in MongoDB");
    }

    console.log("[MongoDB] Placement saved.");
    console.log("[Placement] Company:", placement.company);
    console.log("[Placement] Status:", status);

    // =====================================
    // SEND TELEGRAM NOTIFICATION
    // =====================================

    if (!placement.notificationSent) {
      console.log("[Telegram] Sending notification...");

      await sendPlacementNotification(placement);

      // Mark notification sent only after Telegram succeeds.
      placement.notificationSent = true;
      placement.notificationSentAt = new Date();

      await placement.save();

      console.log(
        "[Telegram] Notification sent successfully."
      );
    } else {
      console.log(
        "[Telegram] Already notified. Duplicate skipped."
      );
    }

    // =====================================
    // MARK EMAIL AS PROCESSED
    // =====================================

    await updateEmailStatus(email.messageId, {
      status: "processed",
      category: opportunityType,
      summary: analysis.summary || "",
      confidence: analysis.confidence || 0,
      sender: email.sender,
      subject: email.subject,
      receivedAt: email.receivedAt,
      snippet: email.snippet,
    });

    console.log("[Monitor] Email processed successfully.");

    return true;

  } catch (error) {
    console.error(
      "[Monitor] Email processing failed:",
      error.message
    );

    if (email?.messageId) {
      try {
        await Email.updateOne(
          { messageId: email.messageId },
          {
            $set: {
              status: "failed",
              error: error.message,
            },
          }
        );
      } catch (dbError) {
        console.error(
          "[MongoDB] Failed to update email status:",
          dbError.message
        );
      }
    }

    return false;
  }
}

// =====================================
// HISTORICAL EMAIL BACKFILL
// =====================================

async function runHistoricalScan() {
  const completed = await MonitorState.findOne({
    key: HISTORY_STATE_KEY,
  });

  if (completed) {
    console.log("[History] Historical scan already completed.");
    return true;
  }

  console.log("\n========== HISTORICAL EMAIL BACKFILL ==========");

  console.log("[History] Searching all approved SVVV TPO senders...");
  console.log("[History] Query:", HISTORICAL_QUERY);

  // Fetch every Gmail page.
  const messages = await fetchAllEmails(
    HISTORICAL_QUERY,
    EMAILS_PER_PAGE
  );

  console.log(
    `[History] Total emails retrieved: ${messages.length}`
  );

  let successful = 0;
  let failed = 0;

  for (const message of messages) {
    const result = await processEmail(message);

    if (result) {
      successful++;
    } else {
      failed++;
    }
  }

  console.log("\n========== BACKFILL SUMMARY ==========");
  console.log("Emails scanned:", messages.length);
  console.log("Successfully processed:", successful);
  console.log("Failed:", failed);

  // Do not complete backfill if any email failed.
  if (failed > 0) {
    console.log(
      "[History] Some emails failed. Backfill will retry next run."
    );

    return false;
  }

  // Create checkpoint only after all messages succeed.
  await MonitorState.findOneAndUpdate(
    { key: HISTORY_STATE_KEY },
    {
      $set: {
        key: HISTORY_STATE_KEY,
        lastCheckedAt: new Date(),
      },
    },
    {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    }
  );

  console.log("[History] Historical backfill completed!");

  return true;
}

// =====================================
// INCREMENTAL EMAIL MONITOR
// =====================================

async function runNewEmailScan(state) {
  console.log("\n========== NEW SVVV EMAIL SCAN ==========");

  const scanStartedAt = new Date();

  // Gmail after: works with calendar dates.
  // Overlap by one day to avoid missing messages.
  const lastCheckedAt = validDate(state.lastCheckedAt) || new Date();

  const overlapDate = new Date(
    lastCheckedAt.getTime() -
    OVERLAP_DAYS * 24 * 60 * 60 * 1000
  );

  const query =
    `${HISTORICAL_QUERY} after:${formatGmailDate(overlapDate)}`;

  console.log("[Monitor] Gmail query:", query);

  const messages = await fetchAllEmails(
    query,
    EMAILS_PER_PAGE
  );

  console.log(
    `[Monitor] Retrieved ${messages.length} new/overlapping emails`
  );

  let successful = 0;
  let failed = 0;

  for (const message of messages) {
    const result = await processEmail(message);

    if (result) {
      successful++;
    } else {
      failed++;
    }
  }

  console.log("[Monitor] Incremental scan summary:", {
    retrieved: messages.length,
    successful,
    failed,
  });

  // Never advance checkpoint if processing failed.
  if (failed > 0) {
    console.log(
      "[Monitor] Some emails failed. Checkpoint not updated."
    );

    return;
  }

  state.lastCheckedAt = scanStartedAt;

  await state.save();

  console.log("[Monitor] New email scan completed successfully.");
}

// =====================================
// RUN EMAIL MONITOR
// =====================================

export async function runEmailMonitorOnce() {
  if (isRunning) {
    console.log("[Monitor] Previous scan still running.");
    return;
  }

  isRunning = true;

  try {
    console.log("\n========== EMAIL MONITOR ==========");

    // Get or create incremental checkpoint.
    let state = await MonitorState.findOne({
      key: STATE_KEY,
    });

    if (!state) {
      state = await MonitorState.create({
        key: STATE_KEY,
        lastCheckedAt: new Date(),
      });

      console.log(
        "[Monitor] Incremental checkpoint initialized."
      );
    }

    // Always finish historical backfill first.
    const historyCompleted = await runHistoricalScan();

    if (!historyCompleted) {
      console.log(
        "[Monitor] Historical backfill incomplete. Incremental scan postponed."
      );

      return;
    }

    // Process recently received emails.
    await runNewEmailScan(state);

  } catch (error) {
    console.error(
      "[Monitor] Scan error:",
      error.message
    );
  } finally {
    isRunning = false;
  }
}

// =====================================
// START SCHEDULER
// =====================================

export function startEmailMonitor() {
  if (scheduledTask) {
    console.log("[Monitor] Scheduler already running.");
    return;
  }

  const interval = Number(
    process.env.EMAIL_POLL_INTERVAL_MINUTES || 2
  );

  if (
    !Number.isInteger(interval) ||
    interval < 1 ||
    interval > 59
  ) {
    throw new Error(
      "EMAIL_POLL_INTERVAL_MINUTES must be between 1 and 59"
    );
  }

  console.log(
    `[Monitor] Starting SVVV Gmail monitor every ${interval} minutes`
  );

  // Run immediately.
  void runEmailMonitorOnce();

  // Continue monitoring.
  scheduledTask = cron.schedule(
    `*/${interval} * * * *`,
    () => {
      void runEmailMonitorOnce();
    }
  );
}

// =====================================
// STOP SCHEDULER
// =====================================

export function stopEmailMonitor() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;

    console.log("[Monitor] Scheduler stopped.");
  }
}
