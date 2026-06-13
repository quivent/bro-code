import { marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

const renderer = new Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  let highlighted: string;
  if (lang && hljs.getLanguage(lang)) {
    highlighted = hljs.highlight(text, { language: lang }).value;
  } else {
    highlighted = hljs.highlightAuto(text).value;
  }
  const cls = lang ? ` class="hljs language-${lang}"` : ' class="hljs"';
  return `<pre><code${cls}>${highlighted}</code></pre>`;
};
marked.setOptions({ renderer });

export function renderMd(md: string): string {
  // Convert specific ANSI for Sovereign Frame colors before markdown
  let processed = md
    .replace(/\x1b\[36m/g, '<span class="ansi-cyan">')
    .replace(/\x1b\[35m/g, '<span class="ansi-magenta">')
    .replace(/\x1b\[0m/g, '</span>');
  const html = DOMPurify.sanitize(marked.parse(processed) as string);
  // Wrap code blocks with a copy button (post-sanitize so DOMPurify can't strip it)
  return html
    .replace(/<pre(\s[^>]*)?>/g, '<div class="code-wrap"><button class="code-copy" type="button">copy</button><pre$1>')
    .replace(/<\/pre>/g, '</pre></div>');
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightMdSource(src: string): string {
  if (!src) return '';
  const lines = src.split('\n');
  let inFence = false;
  let fenceMarker = '';

  return lines.map((line) => {
    const trimmedStart = line.trimStart();

    if (trimmedStart.startsWith('```') || trimmedStart.startsWith('~~~')) {
      inFence = !inFence;
      fenceMarker = trimmedStart[0];
      return `<span class="md-marker">${esc(line)}</span>`;
    }
    if (inFence) {
      return `<span class="md-code">${esc(line)}</span>`;
    }

    if (/^(\*\*\*+|___+|---+)$/.test(line.trim())) {
      return `<span class="md-hr">${esc(line)}</span>`;
    }

    const headingMatch = line.match(/^(#{1,6})(\s+)(.*)$/);
    if (headingMatch) {
      const hashes = headingMatch[1];
      const space = headingMatch[2];
      const text = headingMatch[3];
      return `<span class="md-marker">${esc(hashes)}</span>${space}<span class="md-h">${esc(text)}</span>`;
    }

    const bqMatch = line.match(/^(>\s?)(.*)$/);
    if (bqMatch) {
      return `<span class="md-marker">${esc(bqMatch[1])}</span><span class="md-quote">${esc(bqMatch[2])}</span>`;
    }

    let out = esc(line);

    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      '<span class="md-marker">[</span><span class="md-link-text">$1</span><span class="md-marker">]($2)</span>');

    out = out.replace(/`([^`]+)`/g,
      '<span class="md-marker">`</span><span class="md-code">$1</span><span class="md-marker">`</span>');

    out = out.replace(/\*\*(.+?)\*\*/g,
      '<span class="md-marker">**</span><strong class="md-bold">$1</strong><span class="md-marker">**</span>');

    out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
      '<span class="md-marker">*</span><em class="md-italic">$1</em><span class="md-marker">*</span>');
    out = out.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g,
      '<span class="md-marker">_</span><em class="md-italic">$1</em><span class="md-marker">_</span>');

    out = out.replace(/^(\s*)([-*+]\s+)(\[[ xX]\])(\s+)(.*)$/,
      '$1<span class="md-marker">$2$3</span>$4<span class="md-task">$5</span>');

    out = out.replace(/^(\s*)([-*+]|\d+\.)(\s+)(.*)$/,
      '$1<span class="md-marker">$2</span>$3<span class="md-list-item">$4</span>');

    return out;
  }).join('\n');
}

export function flashBtn(btn: HTMLElement, ok: boolean) {
  const orig = 'copy';
  btn.textContent = ok ? 'copied' : 'failed';
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}
