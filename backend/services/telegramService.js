
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
  const eligibility = placement.eligibility || {};

  const status =
    placement.status === "expired"
      ? "⚠️ EXPIRED — HISTORICAL OPPORTUNITY"
      : placement.status === "active"
        ? "🟢 ACTIVE / UPCOMING"
        : "ℹ️ DEADLINE UNKNOWN";

  const formatDate = (date) => {
    if (!date) return "Not specified";

    return new Date(date).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    });
  };

  const requirements = Array.isArray(
    eligibility.additionalRequirements
  )
    ? eligibility.additionalRequirements.join("\n• ")
    : eligibility.additionalRequirements || "Not specified";

  return `
🎯 SVVV PLACEMENT ALERT

${status}

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
• ${requirements}

⏰ Student registration deadline:
${placement.deadlineText || formatDate(placement.deadline)}

⏰ College submission deadline:
${placement.collegeSubmissionDeadlineText || formatDate(placement.collegeSubmissionDeadline)}

🔗 Company application:
${placement.applicationUrl || placement.registrationUrl || "Not provided"}

🔗 University confirmation:
${placement.universityConfirmationUrl || "Not provided"}

📝 SUMMARY
${placement.summary || "No summary available"}
  `.trim();
}

