// Small helpers shared by the museum modules.

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Stable 32-bit hash of a string, used to seed generative art. */
export function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Deterministic PRNG (mulberry32). */
export function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Strip the trusted inline HTML some data fields carry (<strong>, <code>). */
export function stripTags(html) {
    const div = document.createElement('div');
    div.innerHTML = String(html ?? '');
    return div.textContent || '';
}

/** Break text into lines that fit maxWidth with the context's current font. */
export function wrapText(ctx, text, maxWidth) {
    const lines = [];
    for (const paragraph of String(text ?? '').split('\n')) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        let line = '';
        for (const word of words) {
            const test = line ? line + ' ' + word : word;
            if (ctx.measureText(test).width <= maxWidth || !line) {
                line = test;
            } else {
                lines.push(line);
                line = word;
            }
        }
        lines.push(line);
    }
    return lines;
}

/** Trim lines to maxLines, ending the last one with an ellipsis. */
export function clampLines(ctx, lines, maxLines, maxWidth) {
    if (lines.length <= maxLines) return lines;
    const out = lines.slice(0, maxLines);
    let last = out[maxLines - 1];
    while (last.length && ctx.measureText(last + '…').width > maxWidth) {
        last = last.slice(0, -1);
    }
    out[maxLines - 1] = last.trimEnd() + '…';
    return out;
}

export async function fetchJSON(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
}

const glyphCache = new Map();

/**
 * Resolve a Font Awesome class list ("fas fa-cube") to the glyph and font
 * needed to draw it on a canvas, by letting the stylesheet render it once.
 */
export function faGlyph(classes) {
    if (!classes) return null;
    if (glyphCache.has(classes)) return glyphCache.get(classes);
    const el = document.createElement('i');
    el.className = classes;
    el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
    document.body.appendChild(el);
    const before = getComputedStyle(el, '::before');
    const content = before.content;
    const family = before.fontFamily || getComputedStyle(el).fontFamily;
    const weight = before.fontWeight || getComputedStyle(el).fontWeight;
    el.remove();
    let char = '';
    if (content && content !== 'none' && content !== 'normal') {
        char = content.replace(/^["']|["']$/g, '');
    }
    const glyph = char ? { char, family, weight } : null;
    glyphCache.set(classes, glyph);
    return glyph;
}

export function formatAuthors(authors, self = 'Saddiq Ur Rehman') {
    return (authors || [])
        .map((a) => (String(a).includes(self) ? `<strong>${escapeHtml(a)}</strong>` : escapeHtml(a)))
        .join(', ');
}

export function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Month-precision label for "2026/10" or "2026-10-06" style dates. */
export function formatDate(value) {
    const str = String(value || '');
    const m = str.match(/^(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?$/);
    if (!m) return str;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[Number(m[2]) - 1] || m[2];
    return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}
