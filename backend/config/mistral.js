import {ChatMistralAI} from "@langchain/mistralai"

const mistral = new ChatMistralAI({
  apiKey: process.env.MISTRAL_API_KEY,
  model: "mistral-small-latest",
  temperature: 0
});

export default mistral;