import { z } from "zod";

export const flashcardSchema = z.object({
  front: z
    .string()
    .min(1)
    .describe("A concise recall prompt or question for the front of the card"),
  back: z
    .string()
    .min(1)
    .describe("A clear, concise answer for the back of the card"),
  difficulty: z
    .enum(["easy", "medium", "hard"])
    .describe("Estimated study difficulty for this card"),
});

export const flashcardGenerationResponseSchema = z.object({
  cards: z
    .array(flashcardSchema)
    .min(10)
    .max(30)
    .describe("AI-generated flashcards for the source material"),
});

export type FlashcardOutput = z.infer<typeof flashcardSchema>;
