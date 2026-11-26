
import cron from "node-cron";

import Email from "../models/Email.js";
import Placement from "../models/Placement.js";
import MonitorState from "../models/MonitorState.js";

import {
  fetchAllEmails,
  normalizeEmail,
} from "../services/gmailService.js";

import {
  analyzePlacement,
} from "../ai/agents/placementAgent.js";

import {
  sendPlacementNotification,
} from "../services/telegramService.js";

// =====================================
// CONFIGURATION
// =====================================

const STATE_KEY = "gmail-email-monitor";
const HISTORY_STATE_KEY = "gmail-history-backfill";

const HISTORICAL_QUERY = "-in:sent -in:drafts";

let isRunning = false;
let scheduledTask = null;

// =====================================
// HELPER FUNCTIONS
// =====================================

function validUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(value);

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

// =====================================
// PROCESS SINGLE EMAIL
// =====================================

async function processEmail(rawMessage) {
  let email;

  try {
    email = normalizeEmail(rawMessage);

    if (!email?.messageId) {
      console.log("[Monitor] Missing message ID");
      return false;
    }

    console.log("\n--------------------------------");
    console.log("[Monitor] Subject:", email.subject);
    console.log("[Monitor] Sender:", email.sender);

    // Check existing email.
    const existing = await Email.findOne({
      messageId: email.messageId,
    });

    // Skip successfully processed emails.
    if (
      existing &&
      ["processed", "not_placement"].includes(existing.status)
    ) {
      console.log("[Monitor] Already processed. Skipping.");
      return true;
    }

    // Mark email as processing.
    await Email.findOneAndUpdate(
      { messageId: email.messageId },
      {
        $set: {
          ...email,
          status: "processing",
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

    const analysis = await analyzePlacement(email);

    if (!analysis) {
      throw new Error("Mistral returned empty analysis");
    }

    console.log("[AI] Opportunity:", analysis.isOpportunity);
    console.log("[AI] Type:", analysis.opportunityType);
    console.log("[AI] Confidence:", analysis.confidence);

    // =====================================
    // IGNORE NON-PLACEMENT EMAILS
    // =====================================

    if (
      !analysis.isOpportunity ||
      analysis.opportunityType === "other"
    ) {
      await Email.updateOne(
        { messageId: email.messageId },
        {
          $set: {
            status: "not_placement",
            category: "other",
            summary: analysis.summary,
            confidence: analysis.confidence,
          },
          $unset: {
            error: "",
          },
        }
      );

      console.log("[AI] Not a placement email. Ignored.");

      return true;
    }

    // =====================================
    // VALIDATE OPPORTUNITY TYPE
    // =====================================

    const allowedTypes = [
      "placement",
      "internship",
      "job",
    ];

    if (!allowedTypes.includes(analysis.opportunityType)) {
      throw new Error(
        `Invalid opportunity type: ${analysis.opportunityType}`
      );
    }

    const registrationUrl = validUrl(
      analysis.registrationUrl
    );

    const deadline = validDate(
      analysis.deadline
    );

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
          company: analysis.company,
          role: analysis.role,
          opportunityType: analysis.opportunityType,
          package: analysis.package,
          location: analysis.location,

          eligibility: {
            minimumCGPA: analysis.minimumCGPA,
            allowedBacklogs: analysis.allowedBacklogs,
            branches: analysis.branches || [],
            additionalRequirements:
              analysis.additionalRequirements,
          },

          deadline,
          registrationUrl,
          summary: analysis.summary,
          confidence: analysis.confidence,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    // =====================================
    // SEND TELEGRAM NOTIFICATION
    // =====================================

    if (!placement.notificationSent) {
      console.log("[Telegram] Sending notification...");

      await sendPlacementNotification(placement);

      placement.notificationSent = true;
      placement.notificationSentAt = new Date();

      await placement.save();

      console.log(
        "[Telegram] Placement notification sent successfully!"
      );
    } else {
      console.log(
        "[Telegram] Already notified. Skipping duplicate."
      );
    }

    // =====================================
    // MARK EMAIL AS PROCESSED
    // =====================================

    await Email.updateOne(
      { messageId: email.messageId },
      {
        $set: {
          status: "processed",
          category: analysis.opportunityType,
          summary: analysis.summary,
          confidence: analysis.confidence,
          sender: email.sender,
          subject: email.subject,
          receivedAt: email.receivedAt,
          snippet: email.snippet,
        },
        $unset: {
          error: "",
        },
      }
    );

    console.log("[Monitor] Placement processed successfully.");

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
// HISTORICAL EMAIL SCAN
// =====================================

async function runHistoricalScan() {
  const completed = await MonitorState.findOne({
    key: HISTORY_STATE_KEY,
  });

  // Historical scan already completed.
  if (completed) {
    return true;
  }

  console.log("\n========== HISTORICAL EMAIL SCAN ==========");

  console.log("[History] Fetching previously received emails...");

  // Fetch every Gmail page.
  const messages = await fetchAllEmails(
    HISTORICAL_QUERY,
    500
  );

  console.log(
    `[History] Total historical emails: ${messages.length}`
  );

  let allSuccessful = true;

  for (const message of messages) {
    const success = await processEmail(message);

    if (!success) {
      allSuccessful = false;
    }
  }

  // Mark history scan complete only when every email
  // has been processed successfully.
  if (!allSuccessful) {
    console.log(
      "[History] Some emails failed. Historical scan will retry."
    );

    return false;
  }

  await MonitorState.create({
    key: HISTORY_STATE_KEY,
    lastCheckedAt: new Date(),
  });

  console.log(
    "[History] Historical scan completed successfully!"
  );

  return true;
}

// =====================================
// INCREMENTAL EMAIL MONITOR
// =====================================

async function runNewEmailScan(state) {
  console.log("\n========== NEW EMAIL SCAN ==========");

  // Capture checkpoint before fetching.
  const scanStartedAt = new Date();

  // Gmail after: uses calendar dates, not Unix timestamps.
  // Overlap by one day to avoid missing messages.
  const overlapDate = new Date(
    state.lastCheckedAt.getTime() - 24 * 60 * 60 * 1000
  );

  const query =
    `${HISTORICAL_QUERY} after:${formatGmailDate(overlapDate)}`;

  console.log("[Monitor] Gmail query:", query);

  // Fetch all pages, not just the first 50/500 messages.
  const messages = await fetchAllEmails(
    query,
    500
  );

  console.log(
    `[Monitor] Retrieved ${messages.length} emails`
  );

  let allSuccessful = true;

  for (const message of messages) {
    const success = await processEmail(message);

    if (!success) {
      allSuccessful = false;
    }
  }

  if (!allSuccessful) {
    console.log(
      "[Monitor] Some emails failed. Checkpoint not updated."
    );

    return;
  }

  // Advance checkpoint only after successful processing.
  state.lastCheckedAt = scanStartedAt;

  await state.save();

  console.log(
    "[Monitor] New email scan completed successfully."
  );
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

    // Create incremental checkpoint before historical scan.
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

    // First complete the historical scan.
    const historyCompleted = await runHistoricalScan();

    if (!historyCompleted) {
      console.log(
        "[Monitor] Historical scan incomplete. New scan postponed."
      );

      return;
    }

    // Then fetch newly received emails.
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
    `[Monitor] Starting Gmail monitor every ${interval} minutes`
  );

  // Run immediately.
  runEmailMonitorOnce();

  // Continue monitoring.
  scheduledTask = cron.schedule(
    `*/${interval} * * * *`,
    () => {
      runEmailMonitorOnce();
    }
  );
}
