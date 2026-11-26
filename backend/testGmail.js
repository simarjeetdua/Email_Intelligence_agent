
import "dotenv/config";

import { initializeComposio } from "./mcp/composioClient.js";
import { fetchAllEmails } from "./services/gmailService.js";

async function testGmail() {
  try {
    await initializeComposio();

    console.log("\n========== HISTORICAL GMAIL TEST ==========");

    // Search all mail except spam and trash.
    const emails = await fetchAllEmails(
      "-in:spam -in:trash",
      500
    );

    console.log("\nTotal emails retrieved:", emails.length);

    console.log("\nSample emails:");

    for (const email of emails.slice(0, 5)) {
      console.log({
        id: email.id,
        subject: email.subject,
        sender: email.sender,
        snippet: email.snippet,
      });
    }

  } catch (error) {
    console.error("[Test Error]", error);
  } finally {
    process.exit(0);
  }
}

testGmail();
