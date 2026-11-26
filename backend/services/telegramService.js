
const TELEGRAM_API = "https://api.telegram.org";

function getOpportunityStatus(placement) {
  if (!placement.deadline) {
    return "STATUS UNKNOWN";
  }

  return new Date(placement.deadline).getTime() < Date.now()
    ? "EXPIRED"
    : "ACTIVE / UPCOMING";
}

function formatDate(date) {
  if (!date) return "Not specified";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return "Not specified";
  }

  return parsed.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });
}

function formatRequirements(requirements) {
  if (Array.isArray(requirements)) {
    return requirements.length
      ? requirements.map((item) => `• ${item}`).join("\n")
      : "Not specified";
  }

  return requirements || "Not specified";
}

export async function sendTelegramMessage(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error("Missing Telegram environment variables");
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

export function formatPlacementMessage(placement) {
  const status = getOpportunityStatus(placement);

  const eligibility = placement.eligibility || {};

  const applicationUrl =
    placement.applicationUrl ||
    placement.registrationUrl ||
    "Not provided";

  const universityUrl =
    placement.universityConfirmationUrl;

  return `
🎯 SVVV PLACEMENT ALERT

${status === "EXPIRED" ? "⚠️ HISTORICAL / EXPIRED OPPORTUNITY" : "📢 PLACEMENT OPPORTUNITY"}

🏢 Company: ${placement.company || "Not specified"}
💼 Role: ${placement.role || "Not specified"}
📌 Type: ${placement.opportunityType || "Placement"}
💰 Package: ${placement.package || "Not specified"}
📍 Location: ${placement.location || "Not specified"}

📚 ELIGIBILITY

CGPA: ${eligibility.minimumCGPA || "Not specified"}
Backlogs: ${eligibility.allowedBacklogs || "Not specified"}
Branches: ${eligibility.branches?.join(", ") || "Not specified"}

Additional requirements:
${formatRequirements(eligibility.additionalRequirements)}

⏰ Deadline: ${formatDate(placement.deadline)}
${placement.deadlineText ? `Original deadline: ${placement.deadlineText}` : ""}

🔗 Company application:
${applicationUrl}

${universityUrl ? `🔗 University registration:\n${universityUrl}` : ""}

📝 SUMMARY
${placement.summary || "No summary available"}

Confidence: ${placement.confidence ?? "Not specified"}
  `.trim();
}

export async function sendPlacementNotification(placement) {
  const message = formatPlacementMessage(placement);
  return await sendTelegramMessage(message);
}
