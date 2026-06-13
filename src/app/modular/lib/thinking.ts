// Split a streamed completion into thinking and answer segments.
// Qwen3 emits inline <think>...</think> when the server passes reasoning
// through; the tag is unclosed while the stream is still in its thinking
// phase. Servers that separate reasoning (reasoning_content deltas) are
// handled by the caller accumulating that field directly.
export function splitThinking(raw: string): { thinking: string; answer: string } {
  const open = raw.indexOf('<think>');
  if (open === -1) return { thinking: '', answer: raw };
  const afterOpen = open + '<think>'.length;
  const close = raw.indexOf('</think>', afterOpen);
  if (close === -1) return { thinking: raw.slice(afterOpen), answer: raw.slice(0, open) };
  return {
    thinking: raw.slice(afterOpen, close),
    answer: raw.slice(0, open) + raw.slice(close + '</think>'.length),
  };
}

// Hold back a trailing partial '<think>'/'</think>' tag while streaming so it
// never flashes as visible text before the rest of the tag arrives.
export function trimPartialTag(s: string): string {
  const max = Math.min('</think>'.length - 1, s.length);
  for (let i = max; i > 0; i--) {
    const tail = s.slice(-i);
    if ('<think>'.startsWith(tail) || '</think>'.startsWith(tail)) return s.slice(0, -i);
  }
  return s;
}
