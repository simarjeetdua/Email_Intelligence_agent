
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
const HISTORY_STATE_KEY = "gmail-history-backfill";

const ALLOWED_TPO_SENDERS = [
  "directorcrp@svvv.edu.in",
  "santoshpatidar@svvv.edu.in",
];

const HISTORICAL_QUERY =
  "{from:directorcrp@svvv.edu.in from:santoshpatidar@svvv.edu.in} -in:sent -in:drafts";

// gmailService currently limits detailed fetches to one email per page.
const EMAILS_PER_PAGE = 1;

let isRunning = false;
let scheduledTask = null;

// =====================================
// HELPERS
// =====================================

function extractEmailAddress(sender = "") {
  const match = String(sender).match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );

  return match ? match[0].toLowerCase() : "";
}

function isAllowedSender(sender) {
  return ALLOWED_TPO_SENDERS.includes(
    extractEmailAddress(sender)
  );
}

function cleanString(value) {
  if (value === null || value === undefined) return null;

  const cleaned = String(value).trim();

  if (!cleaned || cleaned.toLowerCase() === "null") {
    return null;
  }

  return cleaned;
}

function validUrl(value) {
  const cleaned = cleanString(value);

  if (!cleaned) return null;

  try {
    const url = new URL(cleaned);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

// A date-only deadline is treated as the end of that day
// in India, rather than midnight at the beginning.
function validDate(value) {
  const cleaned = cleanString(value);

  if (!cleaned) return null;

  let date;

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    date = new Date(`${cleaned}T23:59:59.999+05:30`);
  } else {
    date = new Date(cleaned);
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

function getOpportunityStatus(deadline) {
  if (!deadline) return "unknown";

  return new Date(deadline).getTime() < Date.now()
    ? "expired"
    : "active";
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
      console.log("[Monitor] Missing message ID.");
      return false;
    }

    if (!isAllowedSender(email.sender)) {
      console.log("[Monitor] Sender not approved. Skipping.");
      return true;
    }

    console.log("\n--------------------------------");
    console.log("[Monitor] Subject:", email.subject);
    console.log("[Monitor] Sender:", email.sender);

    // Check if this exact Gmail message already has a
    // successfully notified placement record.
    const existingPlacement = await Placement.findOne({
      emailId: email.messageId,
    });

    if (existingPlacement?.notificationSent === true) {
      console.log(
        "[Telegram] This email's opportunity was already notified. Skipping."
      );

      await Email.updateOne(
        { messageId: email.messageId },
        {
          $set: {
            status: "processed",
            category: existingPlacement.opportunityType,
          },
        }
      );

      return true;
    }

    // IMPORTANT:
    // Do not skip "not_placement" records.
    // Historical emails previously ignored must be analyzed again.
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
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      }
    );

    // =====================================
    // MISTRAL ANALYSIS
    // =====================================

    console.log("[AI] Analyzing email...");
    console.log("[AI] Body characters:", email.body?.length || 0);

    const analysis = await analyzePlacement(email);

    if (!analysis) {
      throw new Error("Mistral returned empty analysis");
    }

    console.log("[AI] Opportunity:", analysis.isOpportunity);
    console.log("[AI] Type:", analysis.opportunityType);
    console.log("[AI] Confidence:", analysis.confidence);

    // =====================================
    // IGNORE NON-OPPORTUNITIES
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

      console.log("[AI] Not a placement opportunity.");
      return true;
    }

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

    // =====================================
    // NORMALIZE EXTRACTED DATA
    // =====================================

    const applicationUrl = validUrl(
      analysis.applicationUrl
    );

    const universityConfirmationUrl = validUrl(
      analysis.universityConfirmationUrl
    );

    const legacyRegistrationUrl = validUrl(
      analysis.registrationUrl
    );

    const registrationUrl =
      applicationUrl ||
      universityConfirmationUrl ||
      legacyRegistrationUrl;

    const deadline = validDate(analysis.deadline);

    const collegeSubmissionDeadline = validDate(
      analysis.collegeSubmissionDeadline
    );

    const status = getOpportunityStatus(deadline);

    // =====================================
    // SAVE PLACEMENT
    // =====================================

    console.log("[MongoDB] Saving placement...");

    const placement = await Placement.findOneAndUpdate(
      { emailId: email.messageId },
      {
        $set: {
          company: cleanString(analysis.company),
          role: cleanString(analysis.role),
          opportunityType: analysis.opportunityType,
          package: cleanString(analysis.package),
          location: cleanString(analysis.location),

          eligibility: {
            minimumCGPA: cleanString(analysis.minimumCGPA),
            allowedBacklogs: cleanString(analysis.allowedBacklogs),
            branches: Array.isArray(analysis.branches)
              ? analysis.branches
              : [],
            additionalRequirements: Array.isArray(
              analysis.additionalRequirements
            )
              ? analysis.additionalRequirements
              : [],
          },

          deadline,
          deadlineText: cleanString(analysis.deadlineText),

          collegeSubmissionDeadline,
          collegeSubmissionDeadlineText: cleanString(
            analysis.collegeSubmissionDeadlineText
          ),

          applicationUrl,
          universityConfirmationUrl,
          registrationUrl,

          summary: analysis.summary,
          confidence: analysis.confidence,
          status,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      }
    );

    console.log("[MongoDB] Placement saved.");
    console.log("[Placement] Status:", placement.status);

    // =====================================
    // TELEGRAM NOTIFICATION
    // =====================================

    if (!placement.notificationSent) {
      console.log("[Telegram] Sending notification...");

      await sendPlacementNotification(placement);

      // Mark notified only after Telegram confirms success.
      placement.notificationSent = true;
      placement.notificationSentAt = new Date();

      await placement.save();

      console.log("[Telegram] Notification sent successfully.");
    } else {
      console.log("[Telegram] Already notified. Skipping.");
    }

    // =====================================
    // MARK EMAIL PROCESSED
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

  console.log("[History] Searching all SVVV TPO emails...");
  console.log("[History] Query:", HISTORICAL_QUERY);

  const messages = await fetchAllEmails(
    HISTORICAL_QUERY,
    EMAILS_PER_PAGE
  );

  console.log(
    `[History] Total emails retrieved: ${messages.length}`
  );

  let allSuccessful = true;

  let opportunityCount = 0;
  let failureCount = 0;

  for (const message of messages) {
    const success = await processEmail(message);

    if (!success) {
      allSuccessful = false;
      failureCount++;
    } else {
      opportunityCount++;
    }
  }

  console.log("\n========== BACKFILL SUMMARY ==========");
  console.log("Emails scanned:", messages.length);
  console.log("Successfully processed:", opportunityCount);
  console.log("Failed:", failureCount);

  if (!allSuccessful) {
    console.log(
      "[History] Some emails failed. Backfill will retry on the next run."
    );

    return false;
  }

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

  console.log("[History] Historical backfill completed.");

  return true;
}

// =====================================
// INCREMENTAL EMAIL SCAN
// =====================================

async function runNewEmailScan(state) {
  console.log("\n========== NEW SVVV EMAIL SCAN ==========");

  const scanStartedAt = new Date();

  const previousCheck = new Date(
    state.lastCheckedAt || scanStartedAt
  );

  const overlapDate = new Date(
    previousCheck.getTime() - 24 * 60 * 60 * 1000
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

  state.lastCheckedAt = scanStartedAt;
  await state.save();

  console.log("[Monitor] New email scan completed.");
}

// =====================================
// RUN MONITOR ONCE
// =====================================

export async function runEmailMonitorOnce() {
  if (isRunning) {
    console.log("[Monitor] Previous scan still running.");
    return;
  }

  isRunning = true;

  try {
    console.log("\n========== EMAIL MONITOR ==========");

    let state = await MonitorState.findOne({
      key: STATE_KEY,
    });

    if (!state) {
      state = await MonitorState.create({
        key: STATE_KEY,
        lastCheckedAt: new Date(),
      });

      console.log("[Monitor] Incremental checkpoint initialized.");
    }

    // Historical backfill first.
    const historyCompleted = await runHistoricalScan();

    if (!historyCompleted) {
      console.log(
        "[Monitor] Historical backfill incomplete. New scan postponed."
      );
      return;
    }

    // Then process new incoming emails.
    await runNewEmailScan(state);

  } catch (error) {
    console.error("[Monitor] Scan error:", error.message);
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
  runEmailMonitorOnce();

  // Continue monitoring.
  scheduledTask = cron.schedule(
    `*/${interval} * * * *`,
    () => {
      runEmailMonitorOnce();
    }
  );
}
