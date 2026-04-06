import { Context, Effect, Layer } from "effect";
import { createGroq } from "@ai-sdk/groq";
import { env } from "#/lib/env";

// ============================================
// AI Service
// ============================================

export type GroqProvider = ReturnType<typeof createGroq>;

/** Kimi K2 model ID on Groq — used for exam question generation */
export const KIMI_K2_MODEL = "moonshotai/kimi-k2-instruct-0905" as const;

export class AiService extends Context.Tag("AiService")<
  AiService,
  {
    readonly provider: GroqProvider;
  }
>() {}

export const AiServiceLive = Layer.succeed(AiService, {
  provider: createGroq({
    apiKey: env().ai.groqApiKey,
  }),
});
