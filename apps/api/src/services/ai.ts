import { Context, Effect, Layer } from "effect";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// ============================================
// AI Service
// ============================================

export type GroqProvider = ReturnType<typeof createGroq>;
export type OpenRouterProvider = ReturnType<typeof createOpenRouter>;

export class AiService extends Context.Tag("AiService")<
  AiService,
  {
    readonly provider: GroqProvider;
    readonly embeddingProvider: OpenRouterProvider;
  }
>() {}

export const AiServiceLive = Layer.succeed(AiService, {
  provider: createGroq({
    apiKey: process.env.GROQ_API_KEY,
  }),
  embeddingProvider: createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  }),
});
