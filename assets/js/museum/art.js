// Canvas painters: every wall text, label, poster and plaque in the museum is
// drawn here from the portfolio data and then used as a texture.

import { wrapText, clampLines, hashString, seededRandom, faGlyph, stripTags, formatDate, hexToRgba } from './util.js';

export const SERIF = '"Source Serif 4", Georgia, "Times New Roman", serif';
export const SANS = 'Inter, "Segoe UI", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", Consolas, monospace';

export const INK = '#1c1b19';
export const PAPER = '#f7f3ec';
export const MUTED = '#6d675e';
export const GOLD = '#b08d57';

/** Colour scheme per research topic, used by posters and the network. */
export const TOPIC_PALETTES = {
    'BIM & Interoperability': ['#1d4ed8', '#93c5fd', '#f59e0b', '#0b1734'],
    'XR & Game Engines': ['#7c3aed', '#c4b5fd', '#22d3ee', '#1e1238'],
    'Modular & DfMA': ['#e2581b', '#fdba74', '#0f766e', '#3a1406'],
    'AI & NLP': ['#0d9488', '#99f6e4', '#f43f5e', '#04302c'],
    '4D Simulation & Digital Twins': ['#d97706', '#fde68a', '#2563eb', '#3d1903'],
    'Client-Centered Design': ['#db2777', '#fbcfe8', '#16a34a', '#45071f'],
    'Structures & Geotechnics': ['#57534e', '#d6d3d1', '#b91c1c', '#1c1917']
};
const DEFAULT_PALETTE = ['#334155', '#cbd5e1', '#f59e0b', '#0f172a'];

export function paletteFor(topics) {
    return TOPIC_PALETTES[(topics || [])[0]] || DEFAULT_PALETTE;
}

/**
 * Supersampling for painted textures. Painters lay out in logical pixels;
 * the canvas is `scale` times larger (capped at 4096 a side) and the context
 * comes pre-scaled, so text stays sharp up close. Set from the quality mode.
 */
export const PAINT = { scale: 1.75 };

export function makeCanvas(w, h, scale = PAINT.scale) {
    const s = Math.max(0.25, Math.min(scale, 4096 / Math.max(w, h)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(w * s));
    canvas.height = Math.max(2, Math.round(h * s));
    if (s !== 1) canvas.getContext('2d').scale(canvas.width / w, canvas.height / h);
    return canvas;
}

const imageCache = new Map();

/** Load an image for canvas use; resolves null instead of rejecting. */
export function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imageCache.has(src)) return imageCache.get(src);
    const promise = new Promise((resolve) => {
        const img = new Image();
        if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
    imageCache.set(src, promise);
    return promise;
}

/** Try each source in turn; the first that loads (and is CORS-clean) wins. */
export async function loadFirstImage(sources) {
    for (const src of sources.filter(Boolean)) {
        const img = await loadImage(src);
        if (img && isCanvasSafe(img)) return img;
    }
    return null;
}

function isCanvasSafe(img) {
    try {
        const c = makeCanvas(2, 2).getContext('2d');
        c.drawImage(img, 0, 0, 2, 2);
        c.getImageData(0, 0, 1, 1);
        return true;
    } catch {
        return false;
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function setSpacing(ctx, px) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

function drawGlyph(ctx, iconClass, x, y, size, color, align = 'center') {
    const glyph = faGlyph(iconClass);
    if (!glyph) return false;
    ctx.save();
    ctx.font = `${glyph.weight} ${size}px ${glyph.family}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph.char, x, y);
    ctx.restore();
    return true;
}

/** Fit an image inside (x, y, w, h), keeping its aspect ratio. */
function drawContain(ctx, img, x, y, w, h) {
    const s = Math.min(w / img.width, h / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s;
    const sh = h / s;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// ---------------------------------------------------------------------------
// Text layout: blocks of text that shrink together until they fit a box.
// ---------------------------------------------------------------------------

function blockFont(block, size) {
    return `${block.italic ? 'italic ' : ''}${block.weight || 400} ${size}px ${block.family || SANS}`;
}

function measureBlocks(ctx, blocks, width, scale) {
    let height = 0;
    const laid = [];
    for (const block of blocks) {
        if (!block) continue;
        if (block.gap) {
            height += block.gap * scale;
            laid.push({ gap: block.gap * scale });
            continue;
        }
        if (block.rule) {
            laid.push({ rule: block.rule, color: block.color, height: block.rule * scale, width: block.width });
            height += block.rule * scale;
            continue;
        }
        const size = block.size * scale;
        ctx.font = blockFont(block, size);
        setSpacing(ctx, (block.spacing || 0) * scale);
        const indent = block.bullet ? size * 1.25 : 0;
        const text = block.upper ? String(block.text).toUpperCase() : String(block.text ?? '');
        let lines = wrapText(ctx, text, width - indent);
        if (block.maxLines) lines = clampLines(ctx, lines, block.maxLines, width - indent);
        const lineHeight = size * (block.lineHeight || 1.32);
        const after = (block.after ?? size * 0.45 / scale) * scale;
        laid.push({ block, size, lines, lineHeight, indent, after });
        height += lines.length * lineHeight + after;
    }
    return { height, laid };
}

function fitBlocks(ctx, blocks, width, height, minScale = 0.35) {
    let result = null;
    for (let scale = 1; scale >= minScale; scale -= 0.03) {
        result = measureBlocks(ctx, blocks, width, scale);
        if (result.height <= height) return result;
    }
    return result;
}

function drawLaid(ctx, laid, x, y, width, align = 'left') {
    let cy = y;
    for (const item of laid) {
        if (item.gap) {
            cy += item.gap;
            continue;
        }
        if (item.rule) {
            ctx.fillStyle = item.color || 'rgba(0,0,0,0.15)';
            const rw = item.width ? Math.min(width, item.width) : width;
            const rx = align === 'center' ? x + (width - rw) / 2 : x;
            ctx.fillRect(rx, cy, rw, Math.max(1, item.height * 0.25));
            cy += item.height;
            continue;
        }
        const { block, size, lines, lineHeight, indent, after } = item;
        ctx.font = blockFont(block, size);
        setSpacing(ctx, (block.spacing || 0) * (size / block.size));
        ctx.fillStyle = block.color || INK;
        ctx.textBaseline = 'top';
        const blockAlign = block.align || align;
        ctx.textAlign = blockAlign;
        const tx = blockAlign === 'center' ? x + width / 2 : blockAlign === 'right' ? x + width : x + indent;
        lines.forEach((line, i) => {
            if (block.bullet && i === 0) {
                ctx.save();
                ctx.fillStyle = block.bulletColor || block.color || INK;
                ctx.beginPath();
                ctx.arc(x + size * 0.38, cy + lineHeight * 0.5 - size * 0.08, size * 0.17, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            ctx.fillText(line, tx, cy + (lineHeight - size) / 2);
            cy += lineHeight;
        });
        cy += after;
    }
    setSpacing(ctx, 0);
    return cy;
}

/**
 * A wall panel of text: eyebrow, title, paragraphs, bullets and a footer.
 * Sizes are in canvas pixels; everything shrinks together to fit.
 * With `painted`, there is no card: the letters alone, on a transparent
 * canvas, weathered a little, to be laid on the wall as paint.
 */
export function paintTextPanel(opts) {
    const {
        width = 1200, height = 800, padding = 0.07, background = PAPER, ink = INK, muted = MUTED,
        accent = GOLD, eyebrow, title, subtitle, paragraphs = [], bullets = [], sections = [], footer,
        align = 'left', icon, border = true, titleSize = 64, bodySize = 30, painted = false,
        rule = hexToRgba('#000000', 0.18)
    } = opts;
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!painted) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
    }
    if (border && !painted) {
        ctx.strokeStyle = hexToRgba(accent.startsWith('#') ? accent : '#b08d57', 0.55);
        ctx.lineWidth = Math.max(2, width * 0.003);
        const inset = width * 0.018;
        ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
    }
    const pad = Math.round(Math.min(width, height) * padding);
    const blocks = [];
    if (icon) blocks.push({ gap: titleSize * 1.3 });
    if (eyebrow) blocks.push({ text: eyebrow, size: bodySize * 0.72, weight: 700, color: accent, upper: true, spacing: 4, after: bodySize * 0.6 });
    if (title) blocks.push({ text: title, size: titleSize, weight: 600, family: SERIF, color: ink, lineHeight: 1.12, after: titleSize * 0.35 });
    if (subtitle) blocks.push({ text: subtitle, size: bodySize * 1.02, italic: true, family: SERIF, color: muted, after: bodySize * 0.8 });
    if (title || subtitle) blocks.push({ rule: bodySize * 1.1, color: rule, width: width * 0.18 });
    for (const p of paragraphs) blocks.push({ text: p, size: bodySize, color: ink, lineHeight: 1.5, after: bodySize * 0.75 });
    for (const section of sections) {
        if (section.heading) blocks.push({ text: section.heading, size: bodySize * 0.74, weight: 700, color: accent, upper: true, spacing: 3, after: bodySize * 0.35 });
        for (const line of section.lines || []) {
            blocks.push({ text: line, size: bodySize * 0.92, color: ink, bullet: section.bullet !== false, bulletColor: accent, lineHeight: 1.36, after: bodySize * 0.3 });
        }
        blocks.push({ gap: bodySize * 0.55 });
    }
    for (const b of bullets) blocks.push({ text: b, size: bodySize * 0.92, color: ink, bullet: true, bulletColor: accent, lineHeight: 1.36, after: bodySize * 0.3 });
    const footerBlocks = footer ? [{ text: footer, size: bodySize * 0.7, color: muted, weight: 600, upper: true, spacing: 2 }] : [];
    const footerH = footer ? bodySize * 1.4 : 0;
    const fit = fitBlocks(ctx, blocks, width - pad * 2, height - pad * 2 - footerH);
    const startY = align === 'center' ? pad + Math.max(0, (height - pad * 2 - footerH - fit.height) / 2) : pad;
    if (icon) drawGlyph(ctx, icon, align === 'center' ? width / 2 : pad + titleSize * 0.55, startY + titleSize * 0.5, titleSize * 0.95, accent, 'center');
    drawLaid(ctx, fit.laid, pad, startY, width - pad * 2, align);
    if (footer) {
        const fFit = measureBlocks(ctx, footerBlocks, width - pad * 2, 1);
        drawLaid(ctx, fFit.laid, pad, height - pad - footerH * 0.7, width - pad * 2, align);
    }
    if (painted) weather(ctx, width, height, hashString(String(title || eyebrow || '')));
    return canvas;
}

/**
 * Hand-applied paint is never perfect: knock tiny flecks out of the letters
 * and thin the coverage in places, so they read as paint, not print.
 */
export function weather(ctx, width, height, seed = 7) {
    const rand = seededRandom(seed);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const flecks = Math.round((width * height) / 700);
    for (let i = 0; i < flecks; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.12 + rand() * 0.3})`;
        const r = 0.5 + rand() * 1.6;
        ctx.fillRect(rand() * width, rand() * height, r, r * (0.6 + rand()));
    }
    // Broad, faint patches where the brush carried less paint.
    for (let i = 0; i < 14; i++) {
        const x = rand() * width;
        const y = rand() * height;
        const r = Math.min(width, height) * (0.08 + rand() * 0.2);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(0,0,0,0.12)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
}

/** Mix two hex colours (t = 0 gives a, 1 gives b). */
export function mixHex(a, b, t) {
    const pa = parseInt(a.replace('#', ''), 16);
    const pb = parseInt(b.replace('#', ''), 16);
    const ch = (n, k) => (n >> k) & 255;
    const m = (k) => Math.round(ch(pa, k) + (ch(pb, k) - ch(pa, k)) * t);
    return `#${((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, '0')}`;
}

/** Relative luminance of a hex colour, 0..1. */
export function luminance(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    const lin = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** A caption painted straight onto the wall above a work. */
export function paintWallCaption({ eyebrow, title, line, ink = INK, muted = MUTED, accent = GOLD, width = 1200, height = 300 }) {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const H = height;
    const blocks = [];
    if (eyebrow) blocks.push({ text: eyebrow, size: H * 0.12, weight: 700, color: accent, upper: true, spacing: H * 0.014, maxLines: 1, after: H * 0.05 });
    blocks.push({ text: title, size: H * 0.26, weight: 600, family: SERIF, color: ink, lineHeight: 1.08, maxLines: 2, after: H * 0.045 });
    if (line) blocks.push({ text: line, size: H * 0.13, italic: true, family: SERIF, color: muted, maxLines: 2, lineHeight: 1.25, after: 0 });
    const padX = width * 0.02;
    const fit = fitBlocks(ctx, blocks, width - padX * 2, H * 0.94, 0.45);
    // Sit the text on a baseline just above the frame, as a sign-writer would.
    drawLaid(ctx, fit.laid, padX, Math.max(0, H - fit.height - H * 0.02), width - padX * 2, 'center');
    weather(ctx, width, height, hashString(String(title)));
    return canvas;
}

/** Museum wall label: the small card beside an artwork. */
export function paintLabel({ eyebrow, title, lines = [], note, accent = GOLD, width = 640, height = 420, dark = false }) {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = dark ? '#1d1c1a' : '#fbf9f5';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, width * 0.012, height);
    const ink = dark ? '#f4efe6' : INK;
    const muted = dark ? '#b8b0a3' : MUTED;
    const pad = Math.min(width * 0.075, height * 0.12);
    const blocks = [];
    if (eyebrow) blocks.push({ text: eyebrow, size: 22, weight: 700, color: accent, upper: true, spacing: 3, after: 12 });
    blocks.push({ text: title, size: 40, weight: 600, family: SERIF, color: ink, lineHeight: 1.15, maxLines: 4, after: 14 });
    for (const line of lines.filter(Boolean)) blocks.push({ text: line, size: 24, color: muted, lineHeight: 1.35, maxLines: 3, after: 6 });
    const noteH = note ? 40 : 0;
    const fit = fitBlocks(ctx, blocks, width - pad * 2, height - pad * 2 - noteH, 0.45);
    drawLaid(ctx, fit.laid, pad, pad, width - pad * 2);
    if (note) {
        ctx.font = `600 20px ${SANS}`;
        setSpacing(ctx, 2);
        ctx.fillStyle = accent;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.fillText(note.toUpperCase(), pad, height - pad * 0.75);
        setSpacing(ctx, 0);
    }
    return canvas;
}

// ---------------------------------------------------------------------------
// Generative publication posters
// ---------------------------------------------------------------------------

function posterPattern(ctx, type, rand, palette, x, y, w, h, light) {
    const [main, soft, pop, deep] = palette;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    if (type === 'journals') {
        // Bauhaus composition: circles, half-discs and bars.
        ctx.fillStyle = soft;
        ctx.globalAlpha = light ? 0.55 : 0.25;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        const r = h * (0.32 + rand() * 0.12);
        ctx.fillStyle = main;
        ctx.beginPath();
        ctx.arc(x + w * (0.3 + rand() * 0.4), y + h * (0.45 + rand() * 0.1), r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pop;
        ctx.beginPath();
        const hx = x + w * (0.15 + rand() * 0.7);
        ctx.arc(hx, y + h, h * (0.22 + rand() * 0.1), Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = light ? deep : '#f7f3ec';
        for (let i = 0; i < 3; i++) {
            const bw = w * (0.08 + rand() * 0.5);
            ctx.fillRect(x + rand() * (w - bw), y + h * (0.1 + rand() * 0.8), bw, h * 0.025);
        }
        ctx.strokeStyle = light ? deep : '#f7f3ec';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x + w * rand(), y + h * rand() * 0.5, h * (0.18 + rand() * 0.15), 0, Math.PI * 2);
        ctx.stroke();
    } else if (type === 'conferences') {
        // Modular grid: a factory floor of prefabricated units.
        const cols = 5 + Math.floor(rand() * 3);
        const cell = w / cols;
        const rows = Math.ceil(h / cell);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const v = rand();
                ctx.fillStyle = v < 0.18 ? pop : v < 0.5 ? main : v < 0.75 ? soft : (light ? '#ffffff' : deep);
                ctx.globalAlpha = v < 0.75 ? 1 : 0.6;
                const inset = cell * 0.06;
                ctx.fillRect(x + c * cell + inset, y + r * cell + inset, cell - inset * 2, cell - inset * 2);
                if (rand() < 0.22) {
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = light ? deep : '#f7f3ec';
                    ctx.beginPath();
                    ctx.arc(x + c * cell + cell / 2, y + r * cell + cell / 2, cell * 0.18, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        ctx.globalAlpha = 1;
    } else if (type === 'korean') {
        // Truchet tiles of quarter arcs.
        const cols = 4 + Math.floor(rand() * 2);
        const cell = w / cols;
        const rows = Math.ceil(h / cell);
        ctx.lineWidth = cell * 0.16;
        ctx.lineCap = 'butt';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cx = x + c * cell;
                const cy = y + r * cell;
                ctx.fillStyle = (r + c) % 2 ? soft : main;
                ctx.globalAlpha = light ? 0.9 : 0.75;
                ctx.fillRect(cx, cy, cell, cell);
                ctx.globalAlpha = 1;
                ctx.strokeStyle = rand() < 0.3 ? pop : (light ? deep : '#f7f3ec');
                const flip = rand() < 0.5;
                ctx.beginPath();
                if (flip) {
                    ctx.arc(cx, cy, cell / 2, 0, Math.PI / 2);
                    ctx.moveTo(cx + cell, cy + cell - cell / 2);
                    ctx.arc(cx + cell, cy + cell, cell / 2, -Math.PI / 2, Math.PI, true);
                } else {
                    ctx.arc(cx + cell, cy, cell / 2, Math.PI / 2, Math.PI);
                    ctx.moveTo(cx + cell / 2, cy + cell);
                    ctx.arc(cx, cy + cell, cell / 2, 0, -Math.PI / 2, true);
                }
                ctx.stroke();
            }
        }
    } else {
        // Reports: diagonal stripes cut by a triangle.
        ctx.fillStyle = soft;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = main;
        const step = w / (6 + Math.floor(rand() * 4));
        for (let i = -h; i < w + h; i += step * 2) {
            ctx.beginPath();
            ctx.moveTo(x + i, y);
            ctx.lineTo(x + i + step, y);
            ctx.lineTo(x + i + step - h, y + h);
            ctx.lineTo(x + i - h, y + h);
            ctx.closePath();
            ctx.fill();
        }
        ctx.fillStyle = pop;
        ctx.beginPath();
        ctx.moveTo(x + w * rand() * 0.3, y + h);
        ctx.lineTo(x + w * (0.4 + rand() * 0.3), y + h * 0.1);
        ctx.lineTo(x + w * (0.8 + rand() * 0.2), y + h);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

/**
 * The venue's real cover, standing on a blurred, darkened enlargement of
 * itself (a cheap blur: shrink, then scale back up with smoothing).
 */
function posterCover(ctx, cover, x, y, w, h) {
    const tiny = makeCanvas(24, Math.max(8, Math.round(24 * h / w)), 1);
    const tctx = tiny.getContext('2d');
    drawCover(tctx, cover, 0, 0, tiny.width, tiny.height);
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tiny, x, y, w, h);
    ctx.fillStyle = 'rgba(12,12,14,0.35)';
    ctx.fillRect(x, y, w, h);
    const ch = h - 28;
    const cw = Math.min(w - 28, ch * (cover.width / cover.height));
    const cx = x + (w - cw) / 2;
    const cy = y + (h - ch) / 2;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.restore();
    ctx.drawImage(cover, cx, cy, cw, ch);
}

export function paintPoster(pub, citedBy, cover = null) {
    const W = 540;
    const H = 720;
    // Posters are small and numerous: a lighter supersample keeps memory sane.
    const canvas = makeCanvas(W, H, Math.min(PAINT.scale, 1.6));
    const ctx = canvas.getContext('2d');
    const rand = seededRandom(hashString(pub.title + pub.year));
    const palette = paletteFor(pub.topics);
    const light = rand() < 0.55;
    const bg = light ? '#f4efe4' : palette[3];
    const ink = light ? INK : '#f7f3ec';
    const muted = light ? '#5f594f' : 'rgba(247,243,236,0.72)';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const pad = 34;
    // Header: type and year.
    ctx.textBaseline = 'top';
    ctx.font = `700 15px ${SANS}`;
    setSpacing(ctx, 3);
    ctx.fillStyle = light ? palette[0] : palette[1];
    ctx.textAlign = 'left';
    ctx.fillText(pub._typeLabel.toUpperCase(), pad, pad + 6);
    setSpacing(ctx, 0);
    ctx.font = `600 54px ${SERIF}`;
    ctx.fillStyle = ink;
    ctx.textAlign = 'right';
    ctx.fillText(String(pub.year || ''), W - pad, pad - 6);

    // Generative composition.
    const artY = pad + 70;
    const artH = 300;
    if (cover) posterCover(ctx, cover, pad, artY, W - pad * 2, artH);
    else posterPattern(ctx, pub._type, rand, palette, pad, artY, W - pad * 2, artH, light);

    // Title and venue.
    const textTop = artY + artH + 26;
    const badges = [];
    if (pub.impactFactor) badges.push(`IF ${pub.impactFactor}`);
    if (pub.quartile) badges.push(pub.quartile);
    if (pub.category) badges.push(pub.category);
    for (const b of pub.badges || []) badges.push(b);
    if (/best paper/i.test(pub.type || '')) badges.push('Best Paper Award');
    if (citedBy) badges.push(`Cited by ${citedBy.citations}`);
    const badgeH = badges.length ? 40 : 0;

    const blocks = [
        { text: pub.title, size: 31, weight: 600, family: SERIF, color: ink, lineHeight: 1.16, maxLines: 6, after: 14 },
        { text: (pub.journal || pub.conference || '') + (pub.volume ? `, ${pub.volume}` : ''), size: 16, weight: 600, color: muted, upper: true, spacing: 1.2, lineHeight: 1.3, maxLines: 3, after: 0 }
    ];
    const fit = fitBlocks(ctx, blocks, W - pad * 2, H - textTop - pad - badgeH, 0.5);
    drawLaid(ctx, fit.laid, pad, textTop, W - pad * 2);

    // Badges as pills along the bottom.
    let bx = pad;
    const by = H - pad - 28;
    ctx.font = `700 14px ${SANS}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const badge of badges) {
        const tw = ctx.measureText(badge).width + 22;
        if (bx + tw > W - pad) break;
        roundRect(ctx, bx, by, tw, 28, 14);
        const strong = /^Q1$|Best|Editor|Corresponding/i.test(badge);
        ctx.fillStyle = strong ? palette[2] : (light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.14)');
        ctx.fill();
        ctx.fillStyle = strong ? '#ffffff' : ink;
        ctx.fillText(badge, bx + 11, by + 15);
        bx += tw + 8;
    }
    return canvas;
}

// ---------------------------------------------------------------------------
// Panels for specific exhibits
// ---------------------------------------------------------------------------

export function paintNewsCard(item) {
    const W = 760;
    const H = 560;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f3eee3';
    ctx.fillRect(0, 0, W, H);
    // Newsprint texture: faint horizontal rules.
    ctx.fillStyle = 'rgba(0,0,0,0.035)';
    for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 1);
    const pad = 44;
    ctx.fillStyle = INK;
    ctx.fillRect(pad, pad + 54, W - pad * 2, 3);
    ctx.font = `700 18px ${SANS}`;
    setSpacing(ctx, 3);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = GOLD;
    ctx.fillText(String(item.type || 'News').toUpperCase(), pad + 40, pad + 34);
    setSpacing(ctx, 0);
    drawGlyph(ctx, item.icon || 'fas fa-newspaper', pad + 13, pad + 27, 24, GOLD);
    ctx.font = `600 30px ${SERIF}`;
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText(formatDate(item.date), W - pad, pad + 36);
    const blocks = [
        { text: item.title, size: 40, weight: 600, family: SERIF, color: INK, lineHeight: 1.16, maxLines: 4, after: 18 },
        { text: item.summary || '', size: 25, color: '#4a453d', lineHeight: 1.45, maxLines: 5 }
    ];
    const fit = fitBlocks(ctx, blocks, W - pad * 2, H - pad * 2 - 110, 0.5);
    drawLaid(ctx, fit.laid, pad, pad + 84, W - pad * 2);
    ctx.font = `600 17px ${SANS}`;
    setSpacing(ctx, 2);
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'left';
    ctx.fillText('CLICK TO READ MORE', pad, H - pad + 6);
    setSpacing(ctx, 0);
    return canvas;
}

export function paintDiploma(edu, logo) {
    const W = 1100;
    const H = 820;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, W * 0.75);
    grad.addColorStop(0, '#fbf6e9');
    grad.addColorStop(1, '#eadfc4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // Ornamental double border with corner rosettes.
    ctx.strokeStyle = '#9c7a3c';
    ctx.lineWidth = 6;
    ctx.strokeRect(30, 30, W - 60, H - 60);
    ctx.lineWidth = 2;
    ctx.strokeRect(46, 46, W - 92, H - 92);
    for (const [cx, cy] of [[46, 46], [W - 46, 46], [46, H - 46], [W - 46, H - 46]]) {
        ctx.fillStyle = '#9c7a3c';
        ctx.beginPath();
        ctx.arc(cx, cy, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f4ead2';
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fill();
    }
    let y = 82;
    if (logo) {
        const lh = 120;
        const lw = Math.min(260, (logo.width / logo.height) * lh);
        drawContain(ctx, logo, (W - lw) / 2, y, lw, lh);
        y += lh + 22;
    }
    const blocks = [
        { text: edu.institution, size: 26, weight: 700, color: '#7a5c26', upper: true, spacing: 3, align: 'center', after: 18 },
        { text: edu.degree, size: 62, weight: 600, family: SERIF, color: INK, align: 'center', lineHeight: 1.1, after: 16 },
        { text: `${edu.duration}${edu.gpa ? '  ·  GPA ' + edu.gpa : ''}`, size: 26, italic: true, family: SERIF, color: '#5b5140', align: 'center', after: 22 },
        { rule: 26, color: 'rgba(156,122,60,0.6)', width: 220 },
        edu.thesis ? { text: `“${edu.thesis}”`, size: 28, italic: true, family: SERIF, color: INK, align: 'center', lineHeight: 1.35, after: 12 } : null,
        edu.advisor ? { text: `Advisor: ${edu.advisor}`, size: 22, color: '#5b5140', align: 'center', after: 10 } : null,
        edu.award ? { text: `★ ${edu.award}`, size: 22, weight: 600, color: '#7a5c26', align: 'center', lineHeight: 1.35 } : null
    ];
    const fit = fitBlocks(ctx, blocks, W - 220, H - y - 90, 0.5);
    drawLaid(ctx, fit.laid, 110, y, W - 220, 'center');
    // Wax seal.
    ctx.fillStyle = '#8f1d1d';
    ctx.beginPath();
    ctx.arc(W - 150, H - 140, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W - 150, H - 140, 34, 0, Math.PI * 2);
    ctx.stroke();
    drawGlyph(ctx, 'fas fa-graduation-cap', W - 150, H - 140, 34, 'rgba(255,255,255,0.85)');
    return canvas;
}

export function paintExperience(exp, logo, accent) {
    const W = 900;
    const H = 1180;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fbf9f5';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 14);
    const pad = 64;
    let y = 64;
    if (logo) {
        roundRect(ctx, pad, y, 150, 150, 18);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 2;
        ctx.stroke();
        drawContain(ctx, logo, pad + 14, y + 14, 122, 122);
    } else {
        drawGlyph(ctx, exp.icon || 'fas fa-briefcase', pad + 75, y + 75, 80, accent);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 20px ${SANS}`;
    setSpacing(ctx, 3);
    ctx.fillStyle = accent;
    ctx.fillText(`${exp._kind || ''} experience`.toUpperCase(), pad + 180, y + 20);
    setSpacing(ctx, 0);
    ctx.font = `italic 26px ${SERIF}`;
    ctx.fillStyle = MUTED;
    const meta = wrapText(ctx, exp.duration || '', W - pad * 2 - 180);
    meta.forEach((line, i) => ctx.fillText(line, pad + 180, y + 56 + i * 32));
    ctx.font = `500 22px ${SANS}`;
    ctx.fillText(exp.location || '', pad + 180, y + 60 + meta.length * 32);
    y += 190;

    const blocks = [
        { text: exp.position, size: 56, weight: 600, family: SERIF, color: INK, lineHeight: 1.1, after: 12 },
        { text: exp.organization, size: 30, weight: 600, color: accent, after: 6 },
        exp.department ? { text: exp.department + (exp.course ? ` · ${exp.course}` : ''), size: 24, color: MUTED, after: 6 } : null,
        exp.Role ? { text: exp.Role, size: 24, italic: true, family: SERIF, color: MUTED, after: 6 } : null,
        { rule: 34, color: 'rgba(0,0,0,0.12)' },
        { text: 'Responsibilities', size: 20, weight: 700, color: accent, upper: true, spacing: 3, after: 14 },
        ...(exp.primary_responsibilities || []).map((r) => ({ text: r, size: 27, color: INK, bullet: true, bulletColor: accent, lineHeight: 1.38, after: 10 })),
        ...(exp.achievements?.length ? [
            { gap: 18 },
            { text: 'Achievements', size: 20, weight: 700, color: accent, upper: true, spacing: 3, after: 14 },
            ...exp.achievements.map((r) => ({ text: r, size: 27, color: INK, bullet: true, bulletColor: GOLD, lineHeight: 1.38, after: 10 }))
        ] : [])
    ];
    const fit = fitBlocks(ctx, blocks, W - pad * 2, H - y - 90, 0.5);
    drawLaid(ctx, fit.laid, pad, y, W - pad * 2);
    ctx.font = `600 18px ${SANS}`;
    setSpacing(ctx, 2);
    ctx.fillStyle = MUTED;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('CLICK FOR DETAILS', pad, H - 50);
    setSpacing(ctx, 0);
    return canvas;
}

/** The top tile of a skill column: logo, name and level. */
export function paintSkillTile(skill, logo, color) {
    const W = 360;
    const H = 460;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fbf9f5';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = color;
    ctx.fillRect(0, H - 16, W, 16);
    if (logo) {
        drawContain(ctx, logo, 70, 36, W - 140, 190);
    } else {
        ctx.fillStyle = color;
        ctx.font = `700 110px ${SERIF}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(skill.name).slice(0, 2), W / 2, 132);
    }
    const blocks = [
        { text: skill.name, size: 42, weight: 700, family: SERIF, color: INK, align: 'center', maxLines: 2, lineHeight: 1.05, after: 10 },
        { text: `${skill.level} · ${skill.percentage}%`, size: 25, weight: 600, color, align: 'center', after: 4 },
        skill.years ? { text: `${skill.years} yr${skill.years === 1 ? '' : 's'}`, size: 22, color: MUTED, align: 'center' } : null
    ];
    const fit = fitBlocks(ctx, blocks, W - 40, H - 260 - 30, 0.5);
    drawLaid(ctx, fit.laid, 20, 256, W - 40, 'center');
    return canvas;
}

export function paintMedalFace(award) {
    const S = 512;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(S * 0.38, S * 0.32, S * 0.05, S / 2, S / 2, S / 2);
    grad.addColorStop(0, '#fff3c4');
    grad.addColorStop(0.45, '#e2b45a');
    grad.addColorStop(1, '#9a6b1f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(90,60,10,0.55)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.39, 0, Math.PI * 2);
    ctx.stroke();
    // Laurel dots around the rim.
    ctx.fillStyle = 'rgba(90,60,10,0.45)';
    for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(S / 2 + Math.cos(a) * S * 0.465, S / 2 + Math.sin(a) * S * 0.465, 9, 4, a + Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
    }
    drawGlyph(ctx, award.icon || 'fas fa-award', S / 2, S * 0.36, 110, 'rgba(80,52,8,0.78)');
    ctx.fillStyle = 'rgba(80,52,8,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 54px ${SERIF}`;
    ctx.fillText(String(award.date || ''), S / 2, S * 0.62);
    ctx.font = `700 22px ${SANS}`;
    setSpacing(ctx, 3);
    const label = String(award.type || award.category || '').toUpperCase();
    ctx.fillText(label.length > 24 ? label.slice(0, 23) + '…' : label, S / 2, S * 0.73);
    setSpacing(ctx, 0);
    return canvas;
}

/**
 * Scholar metrics. Pass a wall palette ({ ink, muted, accent }) to paint the
 * figures straight onto the wall; without one it is a dark board.
 */
export function paintScholar(scholar, pubStats, pal = null) {
    const W = 1200;
    const H = 760;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const ink = pal?.ink || '#f4efe6';
    const muted = pal?.muted || '#b8b0a3';
    const accent = pal?.accent || '#e8c27a';
    if (!pal) {
        ctx.fillStyle = '#16181d';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(176,141,87,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeRect(22, 22, W - 44, H - 44);
    }
    drawGlyph(ctx, 'fas fa-graduation-cap', 110, 118, 54, pal ? accent : '#8ab4f8');
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 56px ${SERIF}`;
    ctx.fillText('Google Scholar', 160, 118);
    ctx.font = `600 20px ${SANS}`;
    setSpacing(ctx, 3);
    ctx.fillStyle = muted;
    ctx.fillText('CITATION METRICS', 162, 166);
    setSpacing(ctx, 0);
    const stats = [
        ['Citations', scholar?.citations],
        ['h-index', scholar?.hIndex],
        ['i10-index', scholar?.i10Index]
    ];
    stats.forEach(([label, value], i) => {
        const cx = 200 + i * 400;
        ctx.textAlign = 'center';
        ctx.fillStyle = accent;
        ctx.font = `600 150px ${SERIF}`;
        ctx.fillText(value == null ? '–' : Number(value).toLocaleString(), cx, 360);
        ctx.fillStyle = ink;
        ctx.font = `600 24px ${SANS}`;
        setSpacing(ctx, 3);
        ctx.fillText(label.toUpperCase(), cx, 470);
        setSpacing(ctx, 0);
    });
    ctx.fillStyle = pal ? muted : 'rgba(255,255,255,0.12)';
    ctx.fillRect(80, 540, W - 160, 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = ink;
    ctx.font = `italic 30px ${SERIF}`;
    if (pubStats) {
        ctx.fillText(`${pubStats.total} publications · cumulative journal impact factor ${pubStats.cumulativeIF}`, W / 2, 600);
    }
    ctx.font = `500 20px ${SANS}`;
    ctx.fillStyle = muted;
    ctx.fillText(scholar?.updated ? `Refreshed automatically · last update ${scholar.updated}` : 'Refreshed automatically from the live profile', W / 2, 660);
    if (pal) weather(ctx, W, H, 3);
    return canvas;
}

/** Citations per paper as bars; a wall palette paints it onto the wall. */
export function paintCitations(scholar, pal = null) {
    const W = 1400;
    const H = 900;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const INK_ = pal?.ink || INK;
    if (!pal) {
        ctx.fillStyle = '#f7f3ec';
        ctx.fillRect(0, 0, W, H);
    }
    const pad = 70;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 22px ${SANS}`;
    setSpacing(ctx, 4);
    ctx.fillStyle = pal?.accent || GOLD;
    ctx.fillText('GOOGLE SCHOLAR', pad, pad + 10);
    setSpacing(ctx, 0);
    ctx.font = `600 60px ${SERIF}`;
    ctx.fillStyle = INK_;
    ctx.fillText('Most cited works', pad, pad + 80);
    const papers = (scholar?.papers || []).slice(0, 8);
    const max = Math.max(1, ...papers.map((p) => p.citations || 0));
    const rowH = (H - pad * 2 - 130) / Math.max(papers.length, 1);
    papers.forEach((paper, i) => {
        const y = pad + 130 + i * rowH;
        ctx.font = `500 23px ${SANS}`;
        ctx.fillStyle = INK_;
        const title = clampLines(ctx, wrapText(ctx, paper.title, W - pad * 2 - 140), 1, W - pad * 2 - 140)[0];
        ctx.fillText(title, pad, y + 26);
        const bw = ((W - pad * 2 - 140) * (paper.citations || 0)) / max;
        ctx.fillStyle = i === 0 ? '#c2410c' : '#b08d57';
        ctx.fillRect(pad, y + 38, Math.max(6, bw), rowH * 0.28);
        ctx.font = `600 34px ${SERIF}`;
        ctx.fillStyle = INK_;
        ctx.textAlign = 'right';
        ctx.fillText(String(paper.citations), W - pad, y + 58);
        ctx.textAlign = 'left';
    });
    if (pal) weather(ctx, W, H, 5);
    return canvas;
}

/** Room banner above a gallery door: cover art with the room's name. */
export function paintBanner(room, cover) {
    const W = 1600;
    const H = 600;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = room.paint || '#333';
    ctx.fillRect(0, 0, W, H);
    if (cover) drawCover(ctx, cover, 0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(10,10,12,0.86)');
    grad.addColorStop(0.55, 'rgba(10,10,12,0.45)');
    grad.addColorStop(1, 'rgba(10,10,12,0.05)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 34px ${SANS}`;
    setSpacing(ctx, 8);
    ctx.fillStyle = '#e8c27a';
    ctx.fillText(`GALLERY ${room.numeral}`, 90, 220);
    setSpacing(ctx, 0);
    ctx.font = `600 150px ${SERIF}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(room.title, 84, 380);
    ctx.font = `italic 40px ${SERIF}`;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillText(room.tagline || '', 90, 460);
    return canvas;
}

export function paintFloorPlan(rooms, { width = 1400, height = 760, dark = false, highlight } = {}) {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    drawFloorPlan(ctx, rooms, width, height, { dark, highlight, labels: true, title: true });
    return canvas;
}

/** Draw the museum plan into a 2D context (also used by the live minimap). */
export function drawFloorPlan(ctx, rooms, width, height, { dark, highlight, labels = true, title = false, pad = 0.06 }) {
    const minX = -52;
    const maxX = 68;
    const minZ = -26;
    const maxZ = 26;
    const top = title ? height * 0.16 : 0;
    const p = Math.min(width, height) * pad;
    const scale = Math.min((width - p * 2) / (maxX - minX), (height - top - p * 2) / (maxZ - minZ));
    const ox = (width - (maxX - minX) * scale) / 2;
    const oy = top + (height - top - (maxZ - minZ) * scale) / 2;
    const map = (x, z) => [ox + (x - minX) * scale, oy + (z - minZ) * scale];
    ctx.fillStyle = dark ? '#121317' : '#f6f2ea';
    ctx.fillRect(0, 0, width, height);
    if (title) {
        ctx.fillStyle = dark ? '#f4efe6' : INK;
        ctx.font = `600 ${Math.round(height * 0.07)}px ${SERIF}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('Museum directory', p, height * 0.11);
        ctx.font = `600 ${Math.round(height * 0.025)}px ${SANS}`;
        ctx.fillStyle = GOLD;
        ctx.textAlign = 'right';
        ctx.fillText('YOU ARE IN THE LOBBY', width - p, height * 0.11);
    }
    for (const room of rooms) {
        const [x1, z1, x2, z2] = room.rect;
        const [ax, ay] = map(x1, z1);
        const [bx, by] = map(x2, z2);
        ctx.fillStyle = room.id === highlight ? hexToRgba(room.accent || '#b08d57', 0.55) : hexToRgba(room.accent || '#888888', dark ? 0.28 : 0.2);
        ctx.fillRect(ax, ay, bx - ax, by - ay);
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(1, scale * 0.25);
        ctx.strokeRect(ax, ay, bx - ax, by - ay);
        const name = labels === 'mini' ? (room.mini || room.short) : room.short;
        if (labels && name) {
            ctx.fillStyle = dark ? '#f4efe6' : INK;
            const fs = Math.max(7, Math.min(scale * 2.1, ((bx - ax) * 0.9) / (name.length * 0.6)));
            ctx.font = `600 ${fs}px ${SANS}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(name, (ax + bx) / 2, (ay + by) / 2);
        }
    }
    return { map, scale };
}

export function paintSocialTile(social) {
    const S = 420;
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = social.color || '#333';
    ctx.fillRect(0, 0, S, S);
    const grad = ctx.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    if (!social.icon || !drawGlyph(ctx, social.icon, S / 2, S * 0.42, 150, '#ffffff')) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 130px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(social.text || social.label.slice(0, 2), S / 2, S * 0.42);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 36px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(social.label, S / 2, S * 0.84);
    return canvas;
}

export function paintMapPlaque(location) {
    const W = 1200;
    const H = 900;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e9efe8';
    ctx.fillRect(0, 0, W, H);
    const rand = seededRandom(37246);
    // Stylised streets and blocks.
    ctx.strokeStyle = '#ffffff';
    for (let i = 0; i < 14; i++) {
        ctx.lineWidth = 6 + rand() * 18;
        ctx.beginPath();
        const vertical = i % 2 === 0;
        const t = rand() * (vertical ? W : H);
        if (vertical) {
            ctx.moveTo(t, 0);
            ctx.bezierCurveTo(t + rand() * 200 - 100, H * 0.3, t + rand() * 200 - 100, H * 0.7, t + rand() * 100 - 50, H);
        } else {
            ctx.moveTo(0, t);
            ctx.bezierCurveTo(W * 0.3, t + rand() * 200 - 100, W * 0.7, t + rand() * 200 - 100, W, t + rand() * 100 - 50);
        }
        ctx.stroke();
    }
    ctx.fillStyle = 'rgba(132,176,120,0.45)';
    for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse(rand() * W, rand() * H * 0.6, 60 + rand() * 120, 40 + rand() * 80, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
    }
    // Pin.
    const px = W * 0.5;
    const py = H * 0.36;
    ctx.fillStyle = 'rgba(194,65,12,0.18)';
    ctx.beginPath();
    ctx.arc(px, py + 40, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c2410c';
    ctx.beginPath();
    ctx.arc(px, py, 40, Math.PI, 0);
    ctx.lineTo(px, py + 90);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 15, 0, Math.PI * 2);
    ctx.fill();
    // Address card.
    const cy = H * 0.6;
    ctx.fillStyle = 'rgba(251,249,245,0.96)';
    ctx.fillRect(60, cy, W - 120, H - cy - 60);
    const blocks = [
        { text: location.eyebrow || 'Campus', size: 22, weight: 700, color: GOLD, upper: true, spacing: 3, after: 8 },
        { text: location.name, size: 50, weight: 600, family: SERIF, color: INK, after: 4 },
        { text: location.sub, size: 24, color: MUTED, after: 10 },
        { text: [location.korean, ...(location.lines || [])].filter(Boolean).join(' · '), size: 24, color: INK, lineHeight: 1.4 }
    ];
    const fit = fitBlocks(ctx, blocks, W - 200, H - cy - 120, 0.5);
    drawLaid(ctx, fit.laid, 100, cy + 30, W - 200);
    return canvas;
}

export function paintNameLectern(profile) {
    const W = 1000;
    const H = 520;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1b1a18';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(232,194,122,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, W - 40, H - 40);
    const blocks = [
        { text: 'The portfolio of', size: 30, italic: true, family: SERIF, color: '#cfc6b6', align: 'center', after: 10 },
        { text: profile.name, size: 92, weight: 600, family: SERIF, color: '#f8f1e2', align: 'center', lineHeight: 1.05, after: 16 },
        { text: profile.title, size: 30, weight: 600, color: '#e8c27a', align: 'center', upper: true, spacing: 3, after: 22 },
        { text: 'Click to read about me', size: 22, weight: 600, color: '#9b9488', align: 'center', upper: true, spacing: 2 }
    ];
    const fit = fitBlocks(ctx, blocks, W - 120, H - 120, 0.5);
    drawLaid(ctx, fit.laid, 60, 60 + Math.max(0, (H - 120 - fit.height) / 2), W - 120, 'center');
    return canvas;
}

/** Large lettering for the lobby (name above the entrance, signs). */
export function paintLettering({ text, sub, width = 2400, height = 500, color = INK, subColor = GOLD, background = null, size = 200 }) {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let fs = size;
    ctx.font = `600 ${fs}px ${SERIF}`;
    setSpacing(ctx, fs * 0.08);
    while (ctx.measureText(text).width > width * 0.94 && fs > 20) {
        fs -= 4;
        ctx.font = `600 ${fs}px ${SERIF}`;
        setSpacing(ctx, fs * 0.08);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, width / 2, sub ? height * 0.58 : height * 0.68);
    setSpacing(ctx, 0);
    if (sub) {
        const ss = Math.round(fs * 0.22);
        ctx.font = `600 ${ss}px ${SANS}`;
        setSpacing(ctx, ss * 0.35);
        ctx.fillStyle = subColor;
        ctx.fillText(sub.toUpperCase(), width / 2, height * 0.86);
        setSpacing(ctx, 0);
    }
    if (!background) weather(ctx, width, height, hashString(text));
    return canvas;
}

export function paintCollabLabel(name, detail, color) {
    const canvas = makeCanvas(512, 128);
    const ctx = canvas.getContext('2d');
    ctx.font = `600 40px ${SANS}`;
    const tw = Math.min(500, Math.max(ctx.measureText(name).width, 120) + 48);
    roundRect(ctx, (512 - tw) / 2, 14, tw, 100, 22);
    ctx.fillStyle = 'rgba(18,18,22,0.78)';
    ctx.fill();
    ctx.fillStyle = color || '#ffffff';
    ctx.fillRect((512 - tw) / 2 + 18, 30, 6, 68);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 256 + 6, 52, tw - 40);
    if (detail) {
        ctx.font = `500 24px ${SANS}`;
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.fillText(detail, 256 + 6, 90, tw - 40);
    }
    return canvas;
}

/** Fit a photo onto a mat of a fixed aspect ratio (portraits, remote images). */
export function composeContain(img, aspect, { mat = '#f4efe6', maxEdge = 1280, pad = 0 } = {}) {
    const w = aspect >= 1 ? maxEdge : Math.round(maxEdge * aspect);
    const h = aspect >= 1 ? Math.round(maxEdge / aspect) : maxEdge;
    const canvas = makeCanvas(w, h, 1);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = mat;
    ctx.fillRect(0, 0, w, h);
    const p = Math.round(Math.min(w, h) * pad);
    drawContain(ctx, img, p, p, w - p * 2, h - p * 2);
    return canvas;
}

export function composeCover(img, aspect, maxEdge = 1280) {
    const w = aspect >= 1 ? maxEdge : Math.round(maxEdge * aspect);
    const h = aspect >= 1 ? Math.round(maxEdge / aspect) : maxEdge;
    const canvas = makeCanvas(w, h, 1);
    drawCover(canvas.getContext('2d'), img, 0, 0, w, h);
    return canvas;
}

/** A copy of an image no larger than maxEdge (keeps GPU memory in check). */
export function downscale(img, maxEdge) {
    const s = maxEdge / Math.max(img.width, img.height);
    if (s >= 0.95) return img;
    const canvas = makeCanvas(Math.round(img.width * s), Math.round(img.height * s), 1);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
}

// ---------------------------------------------------------------------------
// Captions, screens and holograms
// ---------------------------------------------------------------------------

/** A plain wood grain, used for frames, bench tops and the desk. */
export function paintWoodGrain(base = '#7a5634') {
    const S = 512;
    const canvas = makeCanvas(S, S, 1);
    const ctx = canvas.getContext('2d');
    const rand = seededRandom(77);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
        const y = rand() * S;
        const a = rand() * 0.12;
        ctx.strokeStyle = rand() < 0.6 ? `rgba(40,22,8,${a})` : `rgba(255,228,190,${a * 0.5})`;
        ctx.lineWidth = 0.5 + rand() * 2.5;
        const amp = rand() * 4;
        const phase = rand() * 6;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= S; x += 16) ctx.lineTo(x, y + Math.sin((x / S) * Math.PI * 2 + phase) * amp);
        ctx.stroke();
    }
    return canvas;
}

/** Soft spotlight pool for the wall above and around a work (additive). */
export function paintWash() {
    const S = 512;
    const canvas = makeCanvas(S, S, 1);
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(S / 2, S * 0.22);
    ctx.scale(1, 1.45);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.5);
    grad.addColorStop(0, 'rgba(255,238,205,0.95)');
    grad.addColorStop(0.3, 'rgba(255,229,188,0.55)');
    grad.addColorStop(0.65, 'rgba(255,216,168,0.16)');
    grad.addColorStop(1, 'rgba(255,210,160,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-S, -S, S * 2, S * 2);
    ctx.restore();
    return canvas;
}

/** Round soft glow (halos, bias light, hologram sparks). */
export function paintGlow() {
    const S = 128;
    const canvas = makeCanvas(S, S, 1);
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    return canvas;
}

/** Vertical fade for light shafts and projector cones: bright at the bottom. */
export function paintBeam() {
    const canvas = makeCanvas(4, 256, 1);
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 256, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
    return canvas;
}

/** Floating card in the hologram: a country and the people working there. */
export function paintHoloCard({ title, stats, groups = [] }) {
    const W = 900;
    const pad = 40;
    const blocks = [
        { text: title, size: 54, weight: 600, family: SERIF, color: '#effcff', lineHeight: 1.1, after: 8 },
        { text: stats, size: 24, weight: 700, color: '#7fe3ff', upper: true, spacing: 3, after: 22 }
    ];
    for (const g of groups) {
        blocks.push({ text: g.heading, size: 22, weight: 700, color: '#5fd0f0', upper: true, spacing: 2, after: 6 });
        blocks.push({ text: g.names.join('  ·  '), size: 27, color: '#d8f6ff', lineHeight: 1.36, after: 16 });
    }
    const probe = makeCanvas(8, 8, 1).getContext('2d');
    const laid = measureBlocks(probe, blocks, W - pad * 2, 1);
    const H = Math.ceil(laid.height + pad * 2);
    const canvas = makeCanvas(W, H, Math.min(PAINT.scale, 1.5));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(3, 22, 30, 0.94)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(120, 230, 255, 0.05)';
    for (let y = 0; y < H; y += 5) ctx.fillRect(0, y, W, 1.5);
    ctx.strokeStyle = 'rgba(120, 230, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.strokeStyle = '#8eeeff';
    ctx.lineWidth = 5;
    const c = 34;
    for (const [x, y, dx, dy] of [[3, 3, 1, 1], [W - 3, 3, -1, 1], [3, H - 3, 1, -1], [W - 3, H - 3, -1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(x, y + dy * c);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * c, y);
        ctx.stroke();
    }
    drawLaid(ctx, laid.laid, pad, pad, W - pad * 2);
    return canvas;
}

/** Text layer of the lobby TV for one news item (the photo sits beneath). */
export function paintTVOverlay(item, index, total) {
    const W = 1600;
    const H = 900;
    const canvas = makeCanvas(W, H, Math.min(PAINT.scale, 1.3));
    const ctx = canvas.getContext('2d');
    const shade = ctx.createLinearGradient(0, H * 0.3, 0, H);
    shade.addColorStop(0, 'rgba(6,6,8,0)');
    shade.addColorStop(0.55, 'rgba(6,6,8,0.62)');
    shade.addColorStop(1, 'rgba(6,6,8,0.92)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
    const topShade = ctx.createLinearGradient(0, 0, 0, H * 0.2);
    topShade.addColorStop(0, 'rgba(6,6,8,0.6)');
    topShade.addColorStop(1, 'rgba(6,6,8,0)');
    ctx.fillStyle = topShade;
    ctx.fillRect(0, 0, W, H * 0.2);

    const pad = 70;
    // Channel bug, top left.
    roundRect(ctx, pad, 48, 150, 46, 8);
    ctx.fillStyle = '#e8c27a';
    ctx.fill();
    ctx.fillStyle = '#1d1708';
    ctx.font = `800 22px ${SANS}`;
    setSpacing(ctx, 4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEWS', pad + 75, 72);
    setSpacing(ctx, 0);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `600 24px ${SANS}`;
    ctx.fillText('Saddiq Ur Rehman · latest milestones', pad + 172, 72);
    ctx.textAlign = 'right';
    ctx.font = `500 26px ${MONO}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, W - pad, 72);

    const blocks = [
        { text: `${item.type || 'News'} · ${formatDate(item.date)}`, size: 26, weight: 700, color: '#e8c27a', upper: true, spacing: 4, after: 14 },
        { text: item.title, size: 62, weight: 600, family: SERIF, color: '#ffffff', lineHeight: 1.12, maxLines: 2, after: 14 },
        { text: item.summary || '', size: 30, color: 'rgba(255,255,255,0.82)', lineHeight: 1.4, maxLines: 2 }
    ];
    const fit = fitBlocks(ctx, blocks, W - pad * 2, H * 0.42, 0.6);
    drawLaid(ctx, fit.laid, pad, H * 0.885 - fit.height, W - pad * 2);
    return canvas;
}

/** The scrolling headline strip under the TV picture (wraps seamlessly). */
export function paintTicker(items) {
    const H = 48;
    const probe = makeCanvas(8, 8, 1).getContext('2d');
    const parts = [];
    let width = 0;
    for (const item of items) {
        const title = String(item.title || '');
        const text = title.length > 64 ? title.slice(0, 63) + '…' : title;
        probe.font = `700 18px ${SANS}`;
        const tw = probe.measureText(String(item.type || '').toUpperCase()).width + 14;
        probe.font = `500 22px ${SANS}`;
        const w = 40 + tw + probe.measureText(text).width + 30;
        if (width + w > 4000) break;
        parts.push({ type: String(item.type || '').toUpperCase(), text, tw, w });
        width += w;
    }
    const canvas = makeCanvas(Math.max(64, Math.ceil(width)), H, 1);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101113';
    ctx.fillRect(0, 0, canvas.width, H);
    ctx.textBaseline = 'middle';
    let x = 0;
    for (const p of parts) {
        ctx.fillStyle = '#e8c27a';
        ctx.save();
        ctx.translate(x + 20, H / 2);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-4, -4, 8, 8);
        ctx.restore();
        ctx.font = `700 18px ${SANS}`;
        ctx.fillText(p.type, x + 40, H / 2 + 1);
        ctx.font = `500 22px ${SANS}`;
        ctx.fillStyle = '#f4efe6';
        ctx.fillText(p.text, x + 40 + p.tw, H / 2 + 1);
        x += p.w;
    }
    return canvas;
}

/** The projector console in Gallery VIII: which view the hologram shows. */
export function paintConsole(mode) {
    const W = 1000;
    const H = 620;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0c1418';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(120,230,255,0.04)';
    for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);
    ctx.strokeStyle = 'rgba(120,230,255,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(18, 18, W - 36, H - 36);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 24px ${SANS}`;
    setSpacing(ctx, 5);
    ctx.fillStyle = '#7fe3ff';
    ctx.fillText('HOLOGRAM PROJECTOR', W / 2, 92);
    setSpacing(ctx, 0);
    ctx.font = `600 58px ${SERIF}`;
    ctx.fillStyle = '#effcff';
    ctx.fillText('Choose a view', W / 2, 168);
    const options = [['network', 'Co-author network', 'fas fa-circle-nodes'], ['map', 'World map', 'fas fa-earth-asia']];
    options.forEach(([id, label, icon], i) => {
        const x = 80 + i * 440;
        const on = id === mode;
        roundRect(ctx, x, 230, 400, 230, 26);
        ctx.fillStyle = on ? 'rgba(120,230,255,0.9)' : 'rgba(120,230,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,230,255,0.7)';
        ctx.lineWidth = 3;
        ctx.stroke();
        drawGlyph(ctx, icon, x + 200, 310, 74, on ? '#062028' : '#9eeeff');
        ctx.font = `700 34px ${SANS}`;
        ctx.fillStyle = on ? '#062028' : '#d8f6ff';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + 200, 420);
    });
    ctx.font = `600 22px ${SANS}`;
    setSpacing(ctx, 3);
    ctx.fillStyle = 'rgba(216,246,255,0.6)';
    ctx.fillText('CLICK TO SWITCH', W / 2, 540);
    setSpacing(ctx, 0);
    return canvas;
}

export { stripTags };
