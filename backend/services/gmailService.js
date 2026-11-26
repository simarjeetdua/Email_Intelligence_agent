
import { executeComposioTool } from "../mcp/toolRunner.js";

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

  if (result?.data) {
    return result.data;
  }

  return result;
}

// =====================================
// EXTRACT EMAILS AND PAGINATION
// =====================================

function extractMessages(data) {
  if (Array.isArray(data)) return data;

  return (
    data?.messages ??
    data?.data?.messages ??
    data?.results ??
    []
  );
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
  maxResults = 5,
  pageToken
) {
  const args = {
    query,
    max_results: Math.min(Math.max(maxResults, 1), 5),
    include_payload: false,
    verbose: false,
    ids_only: false,
  };

  if (pageToken) {
    args.page_token = pageToken;
  }

  console.log("[Gmail] Fetching email metadata...");

  const result = await executeComposioTool(
    "GMAIL_FETCH_EMAILS",
    args
  );

  const data = parseResult(result);
  const messages = extractMessages(data);

  if (!Array.isArray(messages)) {
    throw new Error("Unexpected Gmail messages response");
  }

  return {
    messages,
    nextPageToken: extractNextPageToken(data),
  };
}

// =====================================
// FETCH ALL PAGES
// =====================================

export async function fetchAllEmails(query = "", maxResults = 5) {
  const allMessages = [];
  const seenTokens = new Set();

  let pageToken;

  do {
    const page = await fetchRecentEmails(
      query,
      maxResults,
      pageToken
    );

    if (!page || !Array.isArray(page.messages)) {
      throw new Error("Invalid Gmail pagination response");
    }

    allMessages.push(...page.messages);

    console.log(
      `[Gmail] Retrieved ${page.messages.length} emails. Total: ${allMessages.length}`
    );

    pageToken = page.nextPageToken;

    if (pageToken) {
      if (seenTokens.has(pageToken)) {
        throw new Error("Repeated Gmail pagination token");
      }

      seenTokens.add(pageToken);
    }
  } while (pageToken);

  console.log(
    `[Gmail] Total emails retrieved: ${allMessages.length}`
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
  } catch {
    return "";
  }
}

// =====================================
// EXTRACT EMAIL BODY
// =====================================

function extractBody(payload) {
  if (!payload) return "";

  if (
    payload.mimeType === "text/plain" &&
    payload.body?.data
  ) {
    return decodeBase64Url(payload.body.data);
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const body = extractBody(part);

      if (body.trim()) {
        return body;
      }
    }
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return "";
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

  const extractedBody =
    message.messageText ||
    message.message_text ||
    message.body ||
    message.text ||
    extractBody(payload) ||
    message.snippet ||
    "";

  return {
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
}
