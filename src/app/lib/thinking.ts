/**
 * Thinking parser ported from gemma-code.
 * Handles <think>...</think> blocks from reasoning models (e.g. Qwen3, DeepSeek-R1).
 * Supports streaming where the closing tag may arrive later.
 */

// Split a streamed completion into thinking and answer segments.
// Returns the visible thinking (if any) and the final answer.
export function splitThinking(raw: string): { thinking: string; answer: string } {
  const open = raw.indexOf('<think>');
  if (open === -1) return { thinking: '', answer: raw };

  const afterOpen = open + '<think>'.length;
  const close = raw.indexOf('</think>', afterOpen);

  if (close === -1) {
    // Still in thinking phase or partial
    return {
      thinking: raw.slice(afterOpen),
      answer: raw.slice(0, open)   // keep prefix if any (usually empty)
    };
  }

  return {
    thinking: raw.slice(afterOpen, close),
    answer: raw.slice(0, open) + raw.slice(close + '</think>'.length)
  };
}

// Hold back a trailing partial '<think>' or '</think>' tag while streaming
// so it never flashes as visible text.
export function trimPartialTag(s: string): string {
  const max = Math.min('</think>'.length - 1, s.length);
  for (let i = max; i > 0; i--) {
    const tail = s.slice(-i);
    if ('<think>'.startsWith(tail) || '</think>'.startsWith(tail)) {
      return s.slice(0, -i);
    }
  }
  return s;
}
