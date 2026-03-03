import { Context, Effect, Layer } from "effect";
import { createGroq } from "@ai-sdk/groq";
import { env } from "#/lib/env";

// ============================================
// AI Service
// ============================================

export type GroqProvider = ReturnType<typeof createGroq>;

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
