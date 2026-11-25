
import "dotenv/config";

import { initializeComposio } from "./mcp/composioClient.js";
import {
  initializeEmailAgent,
  runEmailAgent,
} from "./ai/agents/emailReaderAgent.js";

import {
  sendTelegramMessage,
} from "./services/telegramService.js";

async function testAgent() {
  try {
    console.log("\nInitializing Composio MCP...");
    await initializeComposio();

    console.log("\nInitializing Email Agent...");
    initializeEmailAgent();

    // TEST 1: Gmail
    console.log("\n========== TEST 1: GMAIL ==========");

    const emailResponse = await runEmailAgent(
      "Fetch my 5 most recent emails and summarize each one. Show sender, subject, date and a short summary. Do not send any messages."
    );

    console.log("\nEMAIL RESULTS:\n");
    console.dir(emailResponse, { depth: null });

    // TEST 2: Telegram
    console.log("\n========== TEST 2: TELEGRAM ==========");

    const telegramResponse = await sendTelegramMessage(
      "Email Intelligence Agent is successfully connected to Gmail and Telegram!"
    );

    console.log("\nTELEGRAM MESSAGE SENT!");
    console.log("Message ID:", telegramResponse.message_id);

    console.log("\nAll tests completed.");

  } catch (error) {
    console.error("\nTEST FAILED:", error);
    process.exitCode = 1;
  }
}

testAgent();
