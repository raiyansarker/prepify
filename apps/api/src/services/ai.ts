import { Context, Effect, Layer } from "effect";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// ============================================
// AI Service
// ============================================

export type AiProvider = ReturnType<typeof createOpenAICompatible>;

export class AiService extends Context.Tag("AiService")<
  AiService,
  {
    readonly provider: AiProvider;
    readonly embeddingProvider: AiProvider;
  }
>() {}

export const AiServiceLive = Layer.succeed(AiService, {
  provider: createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
  }),
  embeddingProvider: createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
  }),
});
