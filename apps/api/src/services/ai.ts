import { Context, Effect, Layer } from "effect";
import { createGroq } from "@ai-sdk/groq";

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
    apiKey: process.env.GROQ_API_KEY,
  }),
});
