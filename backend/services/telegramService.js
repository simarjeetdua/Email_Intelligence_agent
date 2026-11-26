
const TELEGRAM_API = "https://api.telegram.org";

/**
 * Send a message to your Telegram account.
 */
export async function sendTelegramMessage(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error(
      "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment variables"
    );
  }

  if (!message || typeof message !== "string") {
    throw new Error("Telegram message must be a non-empty string");
  }

  const response = await fetch(
    `${TELEGRAM_API}/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram API error: ${data.description || response.statusText}`
    );
  }

  return data.result;
}

/**
 * Format placement information into a Telegram notification.
 */
export function formatPlacementMessage(placement) {
  return `
🎯 NEW PLACEMENT OPPORTUNITY

🏢 Company: ${placement.company || "Not specified"}
💼 Role: ${placement.role || "Not specified"}
📌 Type: ${placement.opportunityType || "Placement"}
💰 Package: ${placement.package || "Not specified"}
📍 Location: ${placement.location || "Not specified"}

📚 ELIGIBILITY
CGPA: ${placement.eligibility?.minimumCGPA || "Not specified"}
Backlogs: ${placement.eligibility?.allowedBacklogs || "Not specified"}
Branches: ${placement.eligibility?.branches?.join(", ") || "Not specified"}

⏰ Deadline: ${
    placement.deadline
      ? new Date(placement.deadline).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        })
      : "Not specified"
  }

🔗 Registration: ${placement.registrationUrl || "Not provided"}

📝 Summary:
${placement.summary || "No summary available"}
  `.trim();
}

/**
 * Send a formatted placement notification.
 */
export async function sendPlacementNotification(placement) {
  const message = formatPlacementMessage(placement);
  return await sendTelegramMessage(message);
}
