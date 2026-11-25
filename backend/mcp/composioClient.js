import {composio} from "@composio/core"
import { LangchainProvider } from "@composio/langchain"
import {MultiServerMCPClient } from "@langchain/mcp-adapters"

let mcpClient
let availableTools

export async function initializeComposio(){
    const composio = new composio({
        apiKey: process.env.COMPOSIO_API_KEY,
        provider: new LangchainProvider()
    })
}

const session = await composio.create({
    
})