
import "dotenv/config";

import { initializeComposio } from "./mcp/composioClient.js";

import {
  fetchRecentEmails,
  normalizeEmail,
} from "./services/gmailService.js";

async function testGmailBody() {
  try {
    await initializeComposio();

    const query =
      "from:directorcrp@svvv.edu.in subject:TCS";

    const result = await fetchRecentEmails(query, 1);

    if (!result.messages.length) {
      console.log("No matching TCS email found.");
      return;
    }

    const email = normalizeEmail(result.messages[0]);

    console.log("\n========== EMAIL BODY TEST ==========");

    console.log("Sender:", email.sender);
    console.log("Subject:", email.subject);
    console.log("Received:", email.receivedAt);

    console.log("\nBody characters:", email.body.length);
    console.log("\nActual email body:\n");
    console.log(email.body);

  } catch (error) {
    console.error("Gmail body test failed:", error);
  }
}

testGmailBody();
