import { CHUNK_SIZE, CHUNK_OVERLAP } from "@repo/shared";

// ============================================
// Text Chunking Utility
// ============================================

export interface TextChunk {
  content: string;
  chunkIndex: number;
  metadata: {
    startChar: number;
    endChar: number;
  };
}

/**
 * Split text into overlapping chunks for embedding.
 *
 * Strategy: split on sentence boundaries (period, newline, etc.) when possible,
 * falling back to word boundaries, to keep chunks semantically coherent.
 */
export function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  chunkOverlap: number = CHUNK_OVERLAP,
): TextChunk[] {
  // Normalize whitespace
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();

  if (!cleaned) return [];

  // If the entire text fits in one chunk, return it
  if (cleaned.length <= chunkSize) {
    return [
      {
        content: cleaned,
        chunkIndex: 0,
        metadata: { startChar: 0, endChar: cleaned.length },
      },
    ];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < cleaned.length) {
    let end = Math.min(start + chunkSize, cleaned.length);

    // If we're not at the end, try to break at a sentence boundary
    if (end < cleaned.length) {
      const slice = cleaned.slice(start, end);

      // Look for the last sentence-ending punctuation followed by a space
      const sentenceBreak = findLastBreak(slice, /[.!?]\s/g);
      if (sentenceBreak !== -1 && sentenceBreak > chunkSize * 0.3) {
        end = start + sentenceBreak + 2; // include the punctuation and space
      } else {
        // Fall back to last newline
        const newlineBreak = slice.lastIndexOf("\n");
        if (newlineBreak !== -1 && newlineBreak > chunkSize * 0.3) {
          end = start + newlineBreak + 1;
        } else {
          // Fall back to last space
          const spaceBreak = slice.lastIndexOf(" ");
          if (spaceBreak !== -1 && spaceBreak > chunkSize * 0.3) {
            end = start + spaceBreak + 1;
          }
          // Otherwise just cut at chunkSize
        }
      }
    }

    const content = cleaned.slice(start, end).trim();
    if (content) {
      chunks.push({
        content,
        chunkIndex,
        metadata: { startChar: start, endChar: end },
      });
      chunkIndex++;
    }

    // Move start forward by (end - overlap), ensuring progress
    const step = end - start - chunkOverlap;
    start += Math.max(step, 1);
  }

  return chunks;
}

/**
 * Find the last match position of a regex in a string.
 */
function findLastBreak(text: string, pattern: RegExp): number {
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    lastIndex = match.index;
  }
  return lastIndex;
}
