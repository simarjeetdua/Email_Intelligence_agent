
import "dotenv/config";

import { initializeComposio } from "./mcp/composioClient.js";
import { executeComposioTool } from "./mcp/toolRunner.js";

async function run() {
  await initializeComposio();

  const queries = [
    "from:svvv.edu.in",
    "svvv placement",
    '"Corporate Relations and Placement"',
    "placement internship recruitment",
    "from:directorcrp@svvv.edu.in OR from:santoshpatidar@svvv.edu.in",
  ];

  for (const query of queries) {
    console.log("\n==================================");
    console.log("QUERY:", query);

    const result = await executeComposioTool(
      "GMAIL_FETCH_EMAILS",
      {
        query,
        max_results: 10,
        include_payload: false,
        verbose: false,
        ids_only: false,
      }
    );

    console.log(result);
  }
}

run().catch(console.error);
