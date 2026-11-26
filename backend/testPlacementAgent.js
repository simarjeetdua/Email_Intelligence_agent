
import "dotenv/config";

import { initializeComposio } from "./mcp/composioClient.js";

import { fetchRecentEmails, normalizeEmail } from "./services/gmailService.js";

import { analyzePlacement } from "./ai/agents/placementAgent.js";

async function testPlacementAgent() {
  try {
    await initializeComposio();

    const result = await fetchRecentEmails(
      "from:directorcrp@svvv.edu.in subject:TCS",
      1
    );

    if (!result.messages.length) {
      console.log("TCS email not found.");
      return;
    }

    const email = normalizeEmail(result.messages[0]);

    console.log("\nRunning Mistral placement analysis...\n");

    const analysis = await analyzePlacement(email);

    console.log("\n========== MISTRAL RESULT ==========");
    console.dir(analysis, { depth: null });

  } catch (error) {
    console.error("Placement test failed:", error);
  }
}

testPlacementAgent();
