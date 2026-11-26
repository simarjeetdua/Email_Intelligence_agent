
import { executeComposioTool } from "../mcp/toolRunner.js";

// =====================================
// CONFIGURATION
// =====================================

const MAX_EMAILS_PER_PAGE = 10;

// =====================================
// PARSE COMPOSIO RESPONSE
// =====================================

function parseResult(result) {
  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      throw new Error("Gmail returned an invalid JSON response");
    }
  }

  if (Array.isArray(result?.content)) {
    for (const item of result.content) {
      if (item.type === "text" && item.text) {
        try {
          return JSON.parse(item.text);
        } catch {
          continue;
        }
      }
    }
  }

  return result?.data ?? result;
}

// =====================================
// EXTRACT EMAILS AND PAGINATION
// =====================================

function extractMessages(data) {
  if (Array.isArray(data)) {
    return data;
  }

  const messages =
    data?.messages ??
    data?.data?.messages ??
    data?.results ??
    data?.data?.results ??
    [];

  return Array.isArray(messages) ? messages : [];
}

function extractNextPageToken(data) {
  return (
    data?.nextPageToken ??
    data?.next_page_token ??
    data?.data?.nextPageToken ??
    data?.data?.next_page_token ??
    null
  );
}

// =====================================
// FETCH ONE PAGE OF EMAILS
// =====================================

export async function fetchRecentEmails(
  query = "",
  maxResults = 10,
  pageToken
) {
  const safeMaxResults = Math.min(
    Math.max(Number(maxResults) || 1, 1),
    MAX_EMAILS_PER_PAGE
  );

  const args = {
    query,
    max_results: safeMaxResults,
    include_payload: true,
    verbose: true,
    ids_only: false,
  };

  if (pageToken) {
    args.page_token = pageToken;
  }

  console.log("[Gmail] Fetching detailed emails with payload...");
  console.log("[Gmail] Requested page size:", safeMaxResults);

  const result = await executeComposioTool(
    "GMAIL_FETCH_EMAILS",
    args
  );

  const data = parseResult(result);
  const messages = extractMessages(data);

  const nextPageToken = extractNextPageToken(data);

  console.log(
    `[Gmail] Detailed messages received: ${messages.length}`
  );

  return {
    messages,
    nextPageToken,
  };
}

// =====================================
// FETCH ALL PAGES
// =====================================

export async function fetchAllEmails(
  query = "",
  maxResults = 10
) {
  const allMessages = [];
  const seenTokens = new Set();

  let pageToken = null;
  let pageNumber = 0;

  do {
    pageNumber++;

    console.log(`\n[Gmail] Fetching page ${pageNumber}...`);

    const page = await fetchRecentEmails(
      query,
      maxResults,
      pageToken
    );

    allMessages.push(...page.messages);

    console.log(
      `[Gmail] Page ${pageNumber}: ${page.messages.length} emails`
    );

    console.log(
      `[Gmail] Total retrieved: ${allMessages.length}`
    );

    pageToken = page.nextPageToken;

    if (pageToken) {
      if (seenTokens.has(pageToken)) {
        throw new Error(
          "Repeated Gmail pagination token detected"
        );
      }

      seenTokens.add(pageToken);
    }
  } while (pageToken);

  console.log(
    `\n[Gmail] Total emails retrieved: ${allMessages.length}`
  );

  return allMessages;
}

// =====================================
// BASE64 URL DECODING
// =====================================

function decodeBase64Url(value) {
  if (!value) return "";

  try {
    let normalized = value
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    while (normalized.length % 4 !== 0) {
      normalized += "=";
    }

    return Buffer.from(normalized, "base64").toString("utf8");
  } catch (error) {
    console.error("[Gmail] Body decoding failed:", error.message);
    return "";
  }
}

// =====================================
// REMOVE HTML TAGS
// =====================================

function htmlToText(html) {
  if (!html) return "";

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// =====================================
// EXTRACT EMAIL BODY
// =====================================

function collectMimeBodies(
  payload,
  bodies = { plain: [], html: [] }
) {
  if (!payload) return bodies;

  const mimeType = payload.mimeType?.toLowerCase();
  const encodedBody = payload.body?.data;

  if (encodedBody) {
    const decoded = decodeBase64Url(encodedBody);

    if (mimeType === "text/plain") {
      bodies.plain.push(decoded);
    } else if (mimeType === "text/html") {
      bodies.html.push(decoded);
    }
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      collectMimeBodies(part, bodies);
    }
  }

  return bodies;
}

function extractBody(payload) {
  if (!payload) return "";

  const bodies = collectMimeBodies(payload);

  // Prefer plain text.
  const plainText = bodies.plain
    .filter(Boolean)
    .join("\n")
    .trim();

  if (plainText) {
    return plainText;
  }

  // Fall back to HTML.
  return bodies.html
    .filter(Boolean)
    .map(htmlToText)
    .join("\n")
    .trim();
}

// =====================================
// EMAIL HEADERS
// =====================================

function getHeader(headers, name) {
  if (!Array.isArray(headers)) return "";

  return (
    headers.find(
      (header) =>
        header.name?.toLowerCase() === name.toLowerCase()
    )?.value || ""
  );
}

// =====================================
// NORMALIZE EMAIL
// =====================================

export function normalizeEmail(message) {
  const payload = message.payload;
  const headers = payload?.headers || message.headers || [];

  const messageId =
    message.messageId ??
    message.message_id ??
    message.id;

  const sender =
    message.sender ||
    message.from ||
    getHeader(headers, "From") ||
    "Unknown sender";

  const subject =
    message.subject ||
    getHeader(headers, "Subject") ||
    "(No subject)";

  const receivedAt =
    message.messageTimestamp ??
    message.internalDate ??
    message.date ??
    getHeader(headers, "Date") ??
    new Date();

  const payloadBody = extractBody(payload);

  const extractedBody =
    message.messageText ||
    message.message_text ||
    message.body ||
    message.text ||
    payloadBody ||
    message.snippet ||
    "";

  const normalizedEmail = {
    messageId,
    threadId:
      message.threadId ??
      message.thread_id ??
      null,
    sender,
    subject,
    receivedAt: new Date(receivedAt),
    snippet: message.snippet || "",
    body: extractedBody,
  };

  console.log("[Gmail] Email normalized:", {
    subject: normalizedEmail.subject,
    sender: normalizedEmail.sender,
    bodyCharacters: normalizedEmail.body.length,
    hasFullBody: normalizedEmail.body.length > 0,
  });

  return normalizedEmail;
}
