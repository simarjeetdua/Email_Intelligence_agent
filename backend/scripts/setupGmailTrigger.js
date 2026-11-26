
import "dotenv/config";
import composio from "../config/composio.js";

async function setupGmailTrigger() {
  try {
    const webhookUrl =
      `${process.env.PUBLIC_API_URL}/webhooks/composio`;

    console.log("Registering Composio webhook...");

    const subscription =
      await composio.triggers.setWebhookSubscription({
        webhookUrl,
        version: "V3",
      });

    console.log("Webhook registered:", subscription.webhookUrl);

    // Inspect the trigger's required configuration.
    const triggerType = await composio.triggers.getType(
      "GMAIL_NEW_GMAIL_MESSAGE"
    );

    console.log("\nGmail trigger configuration:");
    console.dir(triggerType.config, { depth: null });

    console.log("\nRegistering Gmail trigger...");

    const trigger = await composio.triggers.create(
      process.env.COMPOSIO_USER_ID,
      "GMAIL_NEW_GMAIL_MESSAGE",
      {
        triggerConfig: {
          labelIds: "INBOX",
        },
      }
    );

    console.log("\nGmail trigger created!");
    console.log({
      triggerId: trigger.triggerId,
      type: trigger.type,
      pollingInterval: trigger.pollingInterval,
      fallbackReason: trigger.fallbackReason,
    });

    // Store the subscription secret in .env securely.
    console.log(
      "\nWebhook signing secret:",
      subscription.secret
    );

    console.log(
      "\nAdd this secret to COMPOSIO_WEBHOOK_SECRET in .env"
    );

  } catch (error) {
    console.error("Trigger setup failed:", error);
    process.exitCode = 1;
  }
}

setupGmailTrigger();
