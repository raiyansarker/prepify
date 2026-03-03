import { Context, Effect, Layer } from "effect";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createHuggingFace } from "@ai-sdk/huggingface";

// ============================================
// AI Service
// ============================================

export type GroqProvider = ReturnType<typeof createGroq>;
export type OpenRouterProvider = ReturnType<typeof createOpenRouter>;
export type HuggingFaceProvider = ReturnType<typeof createHuggingFace>;

export class AiService extends Context.Tag("AiService")<
  AiService,
  {
    readonly provider: GroqProvider;
    readonly embeddingProvider: HuggingFaceProvider;
  }
>() {}

export const AiServiceLive = Layer.succeed(AiService, {
  provider: createGroq({
    apiKey: process.env.GROQ_API_KEY,
  }),
  embeddingProvider: createHuggingFace({
    apiKey: process.env.HUGGINGFACE_API_KEY,
  }),
});
