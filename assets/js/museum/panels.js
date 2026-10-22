// Detail panels: the full story behind every exhibit, rendered as HTML so
// it stays readable, linkable and accessible.

import { escapeHtml, formatAuthors, formatDate, stripTags } from './util.js';
import { PUB_TYPES, SELF, isFirstAuthor, isCorresponding, pubVenue, textureInfo } from './data.js';
import { ROOMS, ROOM_BY_ID } from './world.js';
import { paintPoster, drawFloorPlan } from './art.js';

const e = escapeHtml;

export class Panels {
    constructor({ data, museum, onNavigate, onShowExhibit, onOpenExhibit, onVisitors, onAction }) {
        this.data = data;
        this.museum = museum;
        this.onNavigate = onNavigate;
        this.onShowExhibit = onShowExhibit;
        this.onOpenExhibit = onOpenExhibit;
        this.onVisitors = onVisitors;
        this.onAction = onAction;
        this.el = document.getElementById('panel');
        this.body = document.getElementById('panel-body');
        this.titleEl = document.getElementById('panel-title');
        this.eyebrowEl = document.getElementById('panel-eyebrow');
        this.backBtn = document.getElementById('panel-back');
        this.showBtn = document.getElementById('panel-show');
        this.stack = [];
        this.pubFilters = { type: 'all', role: 'all', year: 'all', topics: new Set(), query: '' };
        this.maps = [];
        document.getElementById('panel-close').addEventListener('click', () => this.close());
        this.backBtn.addEventListener('click', () => this.back());
        this.showBtn.addEventListener('click', () => {
            const current = this.stack[this.stack.length - 1];
            if (current) this.onShowExhibit(current);
        });
        this.body.addEventListener('click', (ev) => this.handleClick(ev));
        this.body.addEventListener('error', (ev) => {
            const img = ev.target;
            if (img.tagName === 'IMG' && img.dataset.fallback && img.src !== new URL(img.dataset.fallback, location.href).href) {
                img.src = img.dataset.fallback;
            }
        }, true);
    }

    get isOpen() {
        return this.el.classList.contains('is-open');
    }

    open(exhibit, { push = false } = {}) {
        if (!exhibit) return;
        if (exhibit.kind === 'link') {
            window.open(exhibit.payload.href, '_blank', 'noopener');
            return;
        }
        if (exhibit.kind === 'visitors') {
            this.onVisitors();
            return;
        }
        if (!push) this.stack = [];
        this.stack.push(exhibit);
        this.render(exhibit);
        this.el.classList.add('is-open');
        this.el.setAttribute('aria-hidden', 'false');
        document.body.classList.add('panel-open');
        this.el.querySelector('.panel-scroll').scrollTop = 0;
        requestAnimationFrame(() => document.getElementById('panel-close').focus({ preventScroll: true }));
    }

    close() {
        this.disposeMaps();
        this.el.classList.remove('is-open');
        this.el.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('panel-open');
        this.stack = [];
    }

    back() {
        if (this.stack.length < 2) return;
        this.stack.pop();
        this.render(this.stack[this.stack.length - 1]);
    }

    render(exhibit) {
        this.disposeMaps();
        const room = ROOM_BY_ID[exhibit.room];
        const renderer = RENDERERS[exhibit.kind] || RENDERERS.fallback;
        const out = renderer.call(this, exhibit.payload, exhibit);
        this.eyebrowEl.textContent = out.eyebrow ?? (room ? (room.numeral ? `Gallery ${room.numeral} · ${room.title}` : room.title) : '');
        this.titleEl.textContent = out.title ?? exhibit.title;
        this.body.innerHTML = out.html;
        this.backBtn.hidden = this.stack.length < 2;
        this.showBtn.hidden = !exhibit.view || exhibit.virtual;
        this.el.style.setProperty('--panel-accent', room?.accent || '#b08d57');
        out.after?.(this.body);
    }

    handleClick(ev) {
        const target = ev.target.closest('[data-exhibit],[data-room],[data-zoom],[data-copy],[data-pub-key],[data-action]');
        if (!target) return;
        if (target.dataset.exhibit) {
            ev.preventDefault();
            const exhibit = this.museum.byId.get(target.dataset.exhibit);
            if (exhibit) this.open(exhibit, { push: true });
        } else if (target.dataset.pubKey) {
            ev.preventDefault();
            const exhibit = this.museum.byId.get(`pub-${target.dataset.pubKey}`);
            if (exhibit) this.open(exhibit, { push: true });
        } else if (target.dataset.room) {
            ev.preventDefault();
            this.close();
            this.onNavigate(target.dataset.room);
        } else if (target.dataset.zoom) {
            ev.preventDefault();
            openLightbox(target.dataset.zoom, target.dataset.alt || '', target.dataset.fallback);
        } else if (target.dataset.copy) {
            ev.preventDefault();
            copyText(target.dataset.copy).then((ok) => flash(target, ok ? 'Copied' : 'Copy failed'));
        } else if (target.dataset.action === 'visitors') {
            ev.preventDefault();
            this.onVisitors();
        } else if (target.dataset.action) {
            ev.preventDefault();
            this.onAction?.(target.dataset.action);
        }
    }

    /** Small optimized copy for inline images; the original stays for zoom. */
    img(src, alt, { fallback, cls = 'panel-image', zoom = true } = {}) {
        if (!src) return '';
        const info = textureInfo(this.data, src);
        const shown = info?.src || src;
        const fb = fallback ? (textureInfo(this.data, fallback)?.src || fallback) : '';
        const zoomAttr = zoom ? ` data-zoom="${e(src)}" data-alt="${e(alt)}"${fb ? ` data-fallback="${e(fb)}"` : ''}` : '';
        return `<button type="button" class="${cls}"${zoomAttr} aria-label="${e(alt ? 'Enlarge: ' + alt : 'Enlarge image')}">
            <img src="${e(shown)}" alt="${e(alt)}" loading="lazy" decoding="async"${fb ? ` data-fallback="${e(fb)}"` : ''}>
            ${zoom ? '<span class="zoom-hint"><i class="fas fa-expand" aria-hidden="true"></i></span>' : ''}
        </button>`;
    }

    disposeMaps() {
        for (const map of this.maps) map.remove();
        this.maps = [];
    }

    exhibitList(exhibits) {
        return `<ul class="exhibit-list">${exhibits.map((x) => `
            <li><button type="button" data-exhibit="${e(x.id)}">
                <i class="${e(x.icon || 'fas fa-circle')}" aria-hidden="true"></i>
                <span><strong>${e(x.title)}</strong>${x.subtitle ? `<small>${e(x.subtitle)}</small>` : ''}</span>
            </button></li>`).join('')}</ul>`;
    }

    pubRow(pub) {
        const cited = this.data.citationsFor(pub);
        return `<li class="pub-row">
            <button type="button" data-pub-key="${e(pub._key)}">
                <span class="pub-row-type">${e(pub._typeLabel)} · ${e(pub.year)}</span>
                <strong>${e(pub.title)}</strong>
                <small>${formatAuthors(pub.authors, SELF)}</small>
                <small class="pub-row-venue">${e(pubVenue(pub))}</small>
                <span class="badge-row">${pubBadges(pub, cited, true)}</span>
            </button>
        </li>`;
    }
}

// ---------------------------------------------------------------------------

function chips(list, cls = 'chip') {
    return (list || []).filter(Boolean).map((t) => `<span class="${cls}">${e(t)}</span>`).join('');
}

function badge(label, variant = '') {
    return `<span class="badge ${variant}">${e(label)}</span>`;
}

function pubBadges(pub, cited, compact) {
    const out = [];
    if (pub.impactFactor) out.push(badge(`IF: ${pub.impactFactor}`, 'badge-if'));
    if (pub.quartile) out.push(badge(pub.quartile, pub.quartile === 'Q1' ? 'badge-q1' : 'badge-q'));
    if (pub.category) out.push(badge(pub.category, 'badge-cat'));
    for (const b of pub.badges || []) out.push(badge(b, /editor/i.test(b) ? 'badge-gold' : 'badge-role'));
    if (/best paper/i.test(pub.type || '')) out.push(badge('Best Paper Award', 'badge-gold'));
    if (cited && !compact) {
        out.push(`<a class="badge badge-cited" href="${e(cited.citedByUrl)}" target="_blank" rel="noopener"><i class="fas fa-graduation-cap" aria-hidden="true"></i> Cited by ${e(cited.citations)}</a>`);
    } else if (cited) {
        out.push(badge(`Cited by ${cited.citations}`, 'badge-cited'));
    }
    return out.join('');
}

function linkButton(href, label, icon = 'fas fa-external-link-alt', variant = '') {
    if (!href) return '';
    return `<a class="btn ${variant}" href="${e(href)}" target="_blank" rel="noopener"><i class="${e(icon)}" aria-hidden="true"></i> ${e(label)}</a>`;
}

function section(title, inner) {
    if (!inner) return '';
    return `<section class="panel-section"><h3>${e(title)}</h3>${inner}</section>`;
}

function bulletList(items) {
    if (!items?.length) return '';
    return `<ul class="bullets">${items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>`;
}

function metaGrid(rows) {
    const filled = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (!filled.length) return '';
    return `<dl class="meta-grid">${filled.map(([k, v, raw]) => `<dt>${e(k)}</dt><dd>${raw ? v : e(v)}</dd>`).join('')}</dl>`;
}

function bar(label, value, max, note) {
    const pct = max ? Math.round((value / max) * 100) : 0;
    return `<div class="bar-row"><div class="bar-label"><span>${e(label)}</span><span>${e(note ?? value)}</span></div>
        <div class="bar"><span style="width:${pct}%"></span></div></div>`;
}

// ---------------------------------------------------------------------------
// Renderers, one per exhibit kind. `this` is the Panels instance.
// ---------------------------------------------------------------------------

const RENDERERS = {
    profile(profile) {
        return RENDERERS.about.call(this, profile);
    },

    about(profile) {
        const s = this.data.scholar;
        const portraits = (profile.portraits || []).map((p) => this.img(p.src, p.alt, { cls: 'portrait-thumb' })).join('');
        const html = `
            <div class="portrait-row">${portraits}</div>
            <p class="lead">${e(profile.title)}</p>
            ${(profile.about || []).map((p) => `<p>${e(p)}</p>`).join('')}
            ${s ? section('Google Scholar', `
                <a class="scholar-grid" href="${e(s.profileUrl)}" target="_blank" rel="noopener me">
                    <span><strong>${e(s.citations)}</strong>Citations</span>
                    <span><strong>${e(s.hIndex)}</strong>h-index</span>
                    <span><strong>${e(s.i10Index)}</strong>i10-index</span>
                </a>`) : ''}
            ${section('Research interests', this.exhibitList(this.museum.exhibits.filter((x) => x.kind === 'interest')))}
            ${section('Profiles', socialLinks(profile.social))}
        `;
        return { eyebrow: 'About me', title: profile.name, html };
    },

    interest(interest) {
        let related = '';
        if (interest.room) {
            const room = ROOM_BY_ID[interest.room];
            related = `<p><button type="button" class="btn" data-room="${e(room.id)}"><i class="${e(room.icon)}" aria-hidden="true"></i> Visit the ${e(room.title)} gallery</button></p>
                ${section('Related projects', this.exhibitList(this.museum.exhibits.filter((x) => x.kind === 'project')))}`;
        } else {
            const pubs = this.data.pubList.filter((p) => !interest.topic || (p.topics || []).includes(interest.topic));
            related = section(`Related publications (${pubs.length})`, `<ul class="pub-list">${pubs.map((p) => this.pubRow(p)).join('')}</ul>`);
        }
        return {
            eyebrow: 'Research interest',
            html: `${this.img(interest.image, interest.title)}
                <p class="lead">${e(interest.description)}</p>
                ${interest.topic ? `<p class="muted">Topic: ${chips([interest.topic])}</p>` : ''}
                ${related}`
        };
    },

    news(item) {
        const images = (item.images || []).map((img) => `
            <figure>${this.img(img.src, img.alt, { fallback: img.fallback })}
            ${img.caption ? `<figcaption>${e(img.caption)}</figcaption>` : ''}</figure>`).join('');
        return {
            eyebrow: `${item.type} · ${formatDate(item.date)}`,
            html: `
                ${item.importance === 'high' ? '<p><span class="badge badge-gold"><i class="fas fa-star" aria-hidden="true"></i> Highlight</span></p>' : ''}
                <p class="lead">${e(item.summary)}</p>
                <p>${e(item.details)}</p>
                ${images}
                ${item.link ? `<p>${linkButton(item.link, item.linkLabel || 'Read more')}</p>` : ''}`
        };
    },

    scholar(scholar) {
        const s = scholar || this.data.scholar;
        if (!s) return { html: '<p>Google Scholar metrics are unavailable right now.</p>' };
        const max = Math.max(1, ...(s.papers || []).map((p) => p.citations || 0));
        const stats = this.data.pubStats;
        return {
            eyebrow: 'Google Scholar',
            title: 'Citation metrics',
            html: `
                <a class="scholar-grid" href="${e(s.profileUrl)}" target="_blank" rel="noopener me">
                    <span><strong>${e(s.citations)}</strong>Citations</span>
                    <span><strong>${e(s.hIndex)}</strong>h-index</span>
                    <span><strong>${e(s.i10Index)}</strong>i10-index</span>
                </a>
                <p class="muted">Refreshed automatically from the live profile every 6 hours${s.updated ? ` · last update ${e(s.updated)}` : ''}.</p>
                <p>${stats.total} publications · cumulative journal impact factor <strong>${stats.cumulativeIF}</strong> across ${stats.journalCount} journal articles.</p>
                ${section('Citations per paper', (s.papers || []).map((p) => `
                    <a class="bar-link" href="${e(p.citedByUrl)}" target="_blank" rel="noopener">${bar(p.title, p.citations, max)}</a>`).join(''))}
                <p>${linkButton(s.profileUrl, 'Open Google Scholar profile', 'fas fa-graduation-cap')}</p>`
        };
    },

    directory() {
        const rooms = ROOMS.filter((r) => r.nav);
        return {
            eyebrow: 'Visitor information',
            title: 'Museum directory',
            html: `
                <canvas class="plan-canvas" width="880" height="420" aria-label="Floor plan of the museum"></canvas>
                <ul class="room-list">${rooms.map((r) => `
                    <li><button type="button" data-room="${e(r.id)}">
                        <i class="${e(r.icon)}" aria-hidden="true"></i>
                        <span><strong>${r.numeral ? `${e(r.numeral)} · ` : ''}${e(r.title)}</strong><small>${e(r.tagline)}</small></span>
                        <i class="fas fa-arrow-right" aria-hidden="true"></i>
                    </button></li>`).join('')}</ul>
                ${section('How to visit', controlsHelp())}`,
            after: (root) => {
                const canvas = root.querySelector('.plan-canvas');
                const dark = document.documentElement.dataset.theme === 'dark';
                drawFloorPlan(canvas.getContext('2d'), ROOMS, canvas.width, canvas.height, { dark, highlight: null, labels: true });
            }
        };
    },

    room(room) {
        const exhibits = this.museum.exhibits.filter((x) => x.room === room.id && x.catalogue !== false);
        return {
            eyebrow: room.numeral ? `Gallery ${room.numeral}` : 'Gallery guide',
            title: room.title,
            html: `
                ${room.cover ? this.img(room.cover, room.title, { zoom: false }) : ''}
                <p class="lead">${e(room.tagline)}</p>
                <p><button type="button" class="btn" data-room="${e(room.id)}"><i class="fas fa-person-walking" aria-hidden="true"></i> Walk into ${e(room.title)}</button></p>
                ${section(`In this gallery (${exhibits.length})`, this.exhibitList(exhibits))}`
        };
    },

    education(edu) {
        return {
            eyebrow: 'Education',
            title: edu.degree,
            html: `
                ${edu.logo ? `<img class="org-logo" src="${e(textureInfo(this.data, edu.logo)?.src || edu.logo)}" alt="${e(edu.institution)} logo">` : ''}
                <p class="lead"><a href="${e(edu.website)}" target="_blank" rel="noopener">${e(edu.institution)}</a></p>
                ${metaGrid([
                    ['Duration', edu.duration],
                    ['GPA', edu.gpa],
                    ['Advisor', edu.advisorUrl ? `<a href="${e(edu.advisorUrl)}" target="_blank" rel="noopener">${e(edu.advisor)}</a>` : e(edu.advisor), true],
                    ['Thesis', edu.thesis],
                    ['Award', edu.award]
                ])}`
        };
    },

    experience(exp) {
        const logo = exp.logo ? `<img class="org-logo" src="${e(textureInfo(this.data, exp.logo)?.src || exp.logo)}" alt="${e(exp.organization)} logo">` : '';
        return {
            eyebrow: `${exp._kind} experience`,
            title: exp.position,
            html: `
                ${logo}
                <p class="lead">${exp.website ? `<a href="${e(exp.website)}" target="_blank" rel="noopener">${e(exp.organization)}</a>` : e(exp.organization)}</p>
                ${metaGrid([
                    ['Department', exp.department],
                    ['Course', exp.course],
                    ['Unit', exp.unit_website ? `<a href="${e(exp.unit_website)}" target="_blank" rel="noopener">${e(exp.unit || exp.unit_website)}</a>` : e(exp.unit || ''), true],
                    ['Duration', exp.duration],
                    ['Location', exp.location],
                    ['Role', exp.Role]
                ])}
                ${section('Primary responsibilities', bulletList(exp.primary_responsibilities))}
                ${section('Achievements', bulletList(exp.achievements))}`
        };
    },

    publication(pub) {
        const cited = this.data.citationsFor(pub);
        const cover = this.data.venueCover(pub);
        const poster = cover ? (textureInfo(this.data, cover)?.src || cover) : paintPoster(pub, cited).toDataURL('image/webp', 0.85);
        const links = [
            pub.doi ? linkButton(pub.doi, /doi\.org/.test(pub.doi) ? 'View paper (DOI)' : 'View paper', 'fas fa-file-alt') : '',
            pub.link ? linkButton(pub.link, pub.linkLabel || 'Link') : ''
        ].join('');
        return {
            eyebrow: `${pub._typeLabel} · ${pub.year}`,
            html: `
                <div class="pub-head">
                    <img class="poster-thumb" src="${e(poster)}" alt="${cover ? `Cover of ${e(pubVenue(pub))}` : 'Generated poster for this publication'}">
                    <div>
                        <p class="authors">${formatAuthors(pub.authors, SELF)}</p>
                        <p class="lead">${e(pubVenue(pub))}</p>
                        <p class="badge-row">${pubBadges(pub, cited, false)}</p>
                    </div>
                </div>
                ${metaGrid([
                    ['Year', pub.year],
                    ['Volume', pub.volume],
                    ['Pages', pub.pages],
                    ['Location', pub.location],
                    ['Date', pub.date],
                    ['Type', pub.type],
                    ['Language', pub.language],
                    ['Authorship', isFirstAuthor(pub) ? 'First author' : 'Co-author'],
                    ['Corresponding', isCorresponding(pub) ? 'Yes' : '']
                ])}
                ${pub.abstract ? section('Abstract', `<p>${e(pub.abstract)}</p>`) : ''}
                ${pub.topics?.length ? section('Topics', `<p>${chips(pub.topics)}</p>`) : ''}
                ${links ? `<p class="btn-row">${links}</p>` : ''}
                <p><button type="button" class="btn btn-ghost" data-exhibit="pub-index"><i class="fas fa-list" aria-hidden="true"></i> All publications</button></p>`
        };
    },

    pubIndex() {
        const stats = this.data.pubStats;
        const years = [...new Set(this.data.pubList.map((p) => String(p.year)))].sort().reverse();
        const topics = [...new Set(this.data.pubList.flatMap((p) => p.topics || []))].sort();
        const f = this.pubFilters;
        const html = `
            <div class="stats-grid">
                <span><strong>${stats.total}</strong>Total</span>
                ${PUB_TYPES.map((t) => `<span><strong>${stats.byType[t.id]}</strong>${e(t.label)}</span>`).join('')}
            </div>
            <p class="muted"><i class="fas fa-chart-line" aria-hidden="true"></i> Cumulative journal impact factor: <strong>${stats.cumulativeIF}</strong> across ${stats.journalCount} journal articles</p>
            <div class="filters">
                <div class="seg" role="tablist" aria-label="Publication type">
                    <button type="button" data-f-type="all" class="${f.type === 'all' ? 'active' : ''}">All</button>
                    ${PUB_TYPES.map((t) => `<button type="button" data-f-type="${t.id}" class="${f.type === t.id ? 'active' : ''}">${e(t.label.replace('International ', 'Intl. '))}</button>`).join('')}
                </div>
                <label class="search"><i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                    <input type="search" id="pub-search" placeholder="Search title, author, venue" value="${e(f.query)}" autocomplete="off" aria-label="Search publications"></label>
                <div class="filter-row">
                    <label>Authorship <select id="pub-role">
                        ${[['all', 'All'], ['first', 'First author'], ['co', 'Co-author'], ['corresponding', 'Corresponding author']].map(([v, l]) => `<option value="${v}"${f.role === v ? ' selected' : ''}>${l}</option>`).join('')}
                    </select></label>
                    <label>Year <select id="pub-year"><option value="all">All years</option>
                        ${years.map((y) => `<option value="${e(y)}"${f.year === y ? ' selected' : ''}>${e(y)}</option>`).join('')}
                    </select></label>
                    <button type="button" class="btn btn-ghost btn-sm" id="pub-reset">Clear all</button>
                </div>
                <div class="topic-chips">${topics.map((t) => `<button type="button" class="chip${f.topics.has(t) ? ' active' : ''}" data-f-topic="${e(t)}">${e(t)}</button>`).join('')}</div>
            </div>
            <p class="muted" id="pub-count" role="status"></p>
            <div id="pub-results"></div>`;
        return {
            eyebrow: 'Reading desk',
            title: 'Publications',
            html,
            after: (root) => {
                const results = root.querySelector('#pub-results');
                const count = root.querySelector('#pub-count');
                const draw = () => {
                    const list = this.data.pubList.filter((p) => pubMatches(p, f));
                    count.textContent = `${list.length} of ${this.data.pubList.length} publications`;
                    results.innerHTML = PUB_TYPES.map((t) => {
                        const items = list.filter((p) => p._type === t.id);
                        if (!items.length) return '';
                        return `<h3 class="list-heading">${e(t.label)} <span>${items.length}</span></h3><ul class="pub-list">${items.map((p) => this.pubRow(p)).join('')}</ul>`;
                    }).join('') || '<p class="muted">No publications match these filters.</p>';
                };
                root.querySelectorAll('[data-f-type]').forEach((b) => b.addEventListener('click', () => {
                    f.type = b.dataset.fType;
                    root.querySelectorAll('[data-f-type]').forEach((x) => x.classList.toggle('active', x === b));
                    draw();
                }));
                root.querySelectorAll('[data-f-topic]').forEach((b) => b.addEventListener('click', () => {
                    const t = b.dataset.fTopic;
                    if (f.topics.has(t)) f.topics.delete(t); else f.topics.add(t);
                    b.classList.toggle('active', f.topics.has(t));
                    draw();
                }));
                root.querySelector('#pub-search').addEventListener('input', (ev) => {
                    f.query = ev.target.value.trim().toLowerCase();
                    draw();
                });
                root.querySelector('#pub-role').addEventListener('change', (ev) => { f.role = ev.target.value; draw(); });
                root.querySelector('#pub-year').addEventListener('change', (ev) => { f.year = ev.target.value; draw(); });
                root.querySelector('#pub-reset').addEventListener('click', () => {
                    Object.assign(f, { type: 'all', role: 'all', year: 'all', query: '' });
                    f.topics.clear();
                    this.render(this.stack[this.stack.length - 1]);
                });
                draw();
            }
        };
    },

    project(p) {
        const stages = (p.workflow_stages || []).map((s) => `<li><strong>${e(s.stage)}</strong><span>${e(s.description)}</span></li>`).join('');
        return {
            eyebrow: `Research project · ${p.status}`,
            html: `
                ${this.img(p.image, p.title)}
                ${metaGrid([
                    ['Duration', p.duration],
                    ['Role', p.role],
                    ['Status', p.status],
                    ['Funding', p.funding_source],
                    ['Supervisor', p.supervisor]
                ])}
                <p>${e(p.description)}</p>
                ${section('Problem', bulletList(p.problem))}
                ${section('Objectives', bulletList(p.objectives))}
                ${section('Methodology', bulletList(p.methodology))}
                ${stages ? section('Workflow stages', `<ol class="stages">${stages}</ol>`) : ''}
                ${section('Contribution', bulletList(p.contribution))}
                ${section('Technologies', p.technologies?.length ? `<p>${chips(p.technologies)}</p>` : '')}
                ${section('Outputs', bulletList(p.outputs))}`
        };
    },

    skill({ skill, category, color }) {
        return {
            eyebrow: category.title,
            title: skill.name,
            html: `
                <div class="skill-head" style="--skill:${e(color)}">
                    ${skillIcon(this.data, skill)}
                    <div>${bar(skill.level, skill.percentage, 100, `${skill.percentage}%`)}
                    <p class="muted">${skill.years ? `${e(skill.years)} year${skill.years === 1 ? '' : 's'} of experience` : ''}</p></div>
                </div>
                <p>${e(skill.description)}</p>
                ${section(`More in ${category.title}`, skillBars(this.data, category, color, skill.name))}`
        };
    },

    skillCategory({ category, color }) {
        return {
            eyebrow: 'Skills',
            title: category.title,
            html: `<div style="--skill:${e(color)}">${skillBars(this.data, category, color)}</div>`
        };
    },

    tool(tool) {
        const dark = document.documentElement.dataset.theme === 'dark';
        const logo = tool.logo?.light ? `<img class="tool-logo" src="${e(dark && tool.logo.dark ? tool.logo.dark : tool.logo.light)}" alt="${e(tool.logo.alt || tool.title)}">` : '';
        const badges = (tool.badges || []).map((b) => badge(b.label, `badge-${b.variant || 'impact-factor'}`)).join('');
        const actions = (tool.actions || []).map((a) => linkButton(a.href, a.label, a.icon || 'fas fa-link', a.variant ? `btn-${a.variant}` : '')).join('');
        return {
            eyebrow: 'Tools',
            html: `
                ${logo}
                <p class="lead">${e(tool.description)}</p>
                ${badges ? `<p class="badge-row">${badges}</p>` : ''}
                ${actions ? `<p class="btn-row">${actions}</p>` : ''}
                ${(tool.sections || []).map((s) => toolSection.call(this, s)).join('')}`
        };
    },

    award(a) {
        return {
            eyebrow: a.category,
            html: `
                <div class="award-head"><i class="${e(a.icon || 'fas fa-award')}" aria-hidden="true"></i>
                <div><p class="lead">${e(a.issuer)}</p><p class="muted">${e(a.type)} · ${e(a.date)}</p></div></div>
                <p>${e(a.description)}</p>`
        };
    },

    certificate(c) {
        return {
            eyebrow: `${c.category} · ${formatDate(c.date)}`,
            html: `
                ${this.img(c.image, c.title)}
                ${metaGrid([
                    ['Issuer', c.issuer],
                    ['Date', formatDate(c.date)],
                    ['Category', c.category],
                    ['Credential ID', c.credential_id]
                ])}
                <p>${e(c.description)}</p>
                ${c.skills?.length ? section('Skills', `<p>${chips(c.skills)}</p>`) : ''}
                ${c.verification_url ? `<p>${linkButton(c.verification_url, 'Verify credential', 'fas fa-check-circle')}</p>` : ''}`
        };
    },

    reviewing(groups) {
        return {
            eyebrow: 'Activities',
            title: 'Editorial & review activities',
            html: (groups || []).map((g) => section(g.publisher, `<ul class="bullets">${(g.roles || []).map((r) => `<li><strong>${e(r.venue)}</strong> - ${e(r.role)}</li>`).join('')}</ul>`)).join('')
        };
    },

    seminar(s) {
        return {
            eyebrow: `Seminars & presentations · ${s.type}`,
            html: `
                ${this.img(s.image, s.title)}
                ${metaGrid([['Role', s.role], ['Organizer', s.organizer], ['Date', s.date], ['Location', s.location]])}
                <p>${e(s.description)}</p>
                ${s.topics?.length ? section('Topics', `<p>${chips(s.topics)}</p>`) : ''}`
        };
    },

    collab(payload) {
        const c = this.data.collaborations;
        if (!c) return { html: '<p>Collaboration data is unavailable.</p>' };
        const maxA = Math.max(...c.byAuthor.map((a) => a.papers));
        const maxU = Math.max(...c.byUniversity.map((a) => a.papers));
        const maxC = Math.max(...c.byCountry.map((a) => a.papers));
        const start = payload?.tab || 'author';
        const tab = (id, label, icon) => `<button type="button" role="tab" data-tab="${id}" class="${start === id ? 'active' : ''}" aria-selected="${start === id}"><i class="${icon}" aria-hidden="true"></i> ${label}</button>`;
        const mode = this.museum.collab?.mode || 'network';
        return {
            eyebrow: 'Activities',
            title: 'Collaborations / network',
            html: `
                <div class="stats-grid">
                    <span><strong>${c.byAuthor.length}</strong>Co-authors</span>
                    <span><strong>${c.byUniversity.length}</strong>Organizations</span>
                    <span><strong>${c.byCountry.length}</strong>Countries</span>
                </div>
                <div class="holo-switch">
                    <span><i class="fas fa-cube" aria-hidden="true"></i> Hologram in Gallery VIII</span>
                    <div class="seg seg-compact">
                        <button type="button" data-action="collab-network" class="${mode === 'network' ? 'active' : ''}"><i class="fas fa-circle-nodes" aria-hidden="true"></i> Network</button>
                        <button type="button" data-action="collab-map" class="${mode === 'map' ? 'active' : ''}"><i class="fas fa-earth-asia" aria-hidden="true"></i> World map</button>
                    </div>
                </div>
                <div class="seg" role="tablist">
                    ${tab('author', 'Co-authors', 'fas fa-user')}
                    ${tab('university', 'Organizations', 'fas fa-building-columns')}
                    ${tab('country', 'Countries', 'fas fa-earth-asia')}
                </div>
                <div data-pane="author"${start === 'author' ? '' : ' hidden'}>${[...c.byAuthor].sort((a, b) => b.papers - a.papers).map((a) => bar(a.name, a.papers, maxA, `${a.papers} · ${a.university || a.Industry || ''}, ${a.country}`)).join('')}</div>
                <div data-pane="university"${start === 'university' ? '' : ' hidden'}>${[...c.byUniversity].sort((a, b) => b.papers - a.papers).map((u) => bar(u.name, u.papers, maxU, `${u.papers} papers · ${u.authors} co-authors · ${u.country}`)).join('')}</div>
                <div data-pane="country"${start === 'country' ? '' : ' hidden'}>
                    <div class="mini-map" id="collab-map" aria-label="Map of collaborating countries"></div>
                    ${[...c.byCountry].sort((a, b) => b.papers - a.papers).map((x) => bar(x.name, x.papers, maxC, `${x.papers} papers · ${x.authors} co-authors`)).join('')}
                </div>
                <p class="muted">Based on the co-authored publications listed on this site. In the network, sphere size shows the number of joint publications and colour shows the country; the faint lines connect co-authors who have also published with each other. The globe places every co-author by country, with arcs from Kyung Hee University; drag it to spin it.</p>`,
            after: (root) => {
                root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
                    root.querySelectorAll('[data-tab]').forEach((x) => {
                        x.classList.toggle('active', x === b);
                        x.setAttribute('aria-selected', String(x === b));
                    });
                    root.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
                    if (b.dataset.tab === 'country') this.mountCollabMap(root.querySelector('#collab-map'));
                }));
                root.querySelectorAll('[data-action^="collab-"]').forEach((b) => b.addEventListener('click', () => {
                    root.querySelectorAll('[data-action^="collab-"]').forEach((x) => x.classList.toggle('active', x === b));
                }));
                if (start === 'country') this.mountCollabMap(root.querySelector('#collab-map'));
            }
        };
    },

    contact(contact) {
        return RENDERERS.location.call(this, contact, null, true);
    },

    location(contact, _exhibit, lead = false) {
        const loc = contact.location || {};
        const profile = this.data.profile;
        return {
            eyebrow: 'Contact',
            title: 'Contact information',
            html: `
                ${lead ? `<p class="lead">${e(contact.lead)}</p>` : `<p>${e(contact.lead)}</p>`}
                <div class="contact-card">
                    <i class="fas fa-envelope" aria-hidden="true"></i>
                    <div><strong>${e(contact.emailLabel)}</strong>
                    <a href="${e(contact.emailCompose)}" target="_blank" rel="noopener noreferrer">${e(contact.email)}</a>
                    <small>${e(contact.emailNote)}</small></div>
                    <button type="button" class="icon-btn" data-copy="${e(contact.email)}" aria-label="Copy academic email address"><i class="fas fa-copy" aria-hidden="true"></i></button>
                </div>
                ${section('Location', `
                    <div class="mini-map tall" id="contact-map" aria-label="Map of Kyung Hee University"></div>
                    <p class="eyebrow-text">${e(loc.eyebrow)}</p>
                    <p class="lead">${e(loc.name)}</p>
                    <p class="muted">${e(loc.sub)}</p>
                    <address><span lang="ko">${e(loc.korean)}</span><br>${(loc.lines || []).map(e).join('<br>')}</address>
                    <p class="btn-row">
                        ${linkButton(loc.directions, 'Get Directions', 'fas fa-location-arrow')}
                        <button type="button" class="btn btn-ghost" data-copy="${e(loc.copy)}"><i class="fas fa-copy" aria-hidden="true"></i> Copy Address</button>
                    </p>`)}
                ${section('Profiles', socialLinks(profile.social))}
                <p><button type="button" class="btn btn-ghost" data-action="visitors"><i class="fas fa-flag" aria-hidden="true"></i> Show visitors</button></p>
                <p class="muted small">${e(profile.copyright)}</p>`,
            after: (root) => this.mountContactMap(root.querySelector('#contact-map'), loc)
        };
    },

    fallback(payload, exhibit) {
        return { html: `<p>${e(exhibit.subtitle || '')}</p>` };
    }
};

Panels.prototype.mountContactMap = async function (el, loc) {
    if (!el || !loc.lat) return;
    const L = await loadLeaflet();
    if (!L || !el.isConnected) return;
    const map = L.map(el, { center: [loc.lat, loc.lng], zoom: 17, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);
    L.marker([loc.lat, loc.lng]).addTo(map);
    L.circle([loc.lat, loc.lng], { color: '#3498db', fillColor: '#3498db', fillOpacity: 0.2, radius: 100 }).addTo(map);
    setTimeout(() => map.invalidateSize(), 250);
    this.maps.push(map);
};

Panels.prototype.mountCollabMap = async function (el) {
    if (!el || el.dataset.ready) return;
    el.dataset.ready = '1';
    const L = await loadLeaflet();
    const c = this.data.collaborations;
    if (!L || !el.isConnected) return;
    const map = L.map(el, { center: [20, 105], zoom: 2, scrollWheelZoom: false, worldCopyJump: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 10
    }).addTo(map);
    const home = [c.center.lat, c.center.lng];
    for (const country of c.byCountry) {
        const at = [country.lat, country.lng];
        L.circleMarker(at, { radius: 6 + Math.sqrt(country.papers) * 3, color: '#b678c0', fillOpacity: 0.55 })
            .bindTooltip(`${country.name}: ${country.papers} papers, ${country.authors} co-authors`).addTo(map);
        if (country.lat !== c.center.lat) L.polyline([home, at], { color: '#b678c0', weight: 2, opacity: 0.6 }).addTo(map);
    }
    map.fitBounds(c.byCountry.map((x) => [x.lat, x.lng]), { padding: [30, 30] });
    setTimeout(() => map.invalidateSize(), 200);
    this.maps.push(map);
};

function toolSection(s) {
    switch (s.type) {
        case 'info':
            // Paragraphs may contain trusted inline HTML (<strong>, <code>).
            return section(s.title, (s.paragraphs || []).map((p) => `<p>${p}</p>`).join(''));
        case 'features':
            return section(s.title, `<ul class="feature-list">${(s.items || []).map((it) => `<li><i class="${e(it.icon || 'fas fa-check')}" aria-hidden="true"></i><span>${it.html}</span></li>`).join('')}</ul>`);
        case 'featureGrid':
            return (s.cards || []).map((card) => `<div class="feature-card">
                <div class="feature-card-head"><i class="${e(card.icon || 'fas fa-cube')}" aria-hidden="true"></i>
                <div><strong>${e(card.title)}</strong><small>${e(card.subtitle || '')}</small><small class="muted">${e(card.duration || '')}</small></div></div>
                ${(card.capabilities || []).length ? `<div class="caps">${card.capabilities.map((c) => `<span><i class="${e(c.icon || 'fas fa-check')}" aria-hidden="true"></i>${e(c.label)}</span>`).join('')}</div>` : ''}
            </div>`).join('');
        case 'code':
            return section(s.title, `${(s.paragraphs || []).map((p) => `<p>${p}</p>`).join('')}<pre class="code"><code>${e(s.code || '')}</code></pre>`);
        case 'media':
            if (s.media === 'video') {
                return section(s.title, `<div class="video"><iframe src="${e(s.src)}" title="${e(s.iframeTitle || s.title || '')}" loading="lazy" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>`);
            }
            return section(s.title, this.img(s.src, s.alt || s.title));
        default:
            return '';
    }
}

function skillIcon(data, skill) {
    const icon = skill.icon || '';
    if (icon && (icon.includes('/') || icon.includes('.'))) {
        return `<img class="skill-icon" src="${e(textureInfo(data, icon)?.src || icon)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'skill-icon skill-initials',textContent:${e(JSON.stringify(String(skill.name).slice(0, 2)))}}))">`;
    }
    return `<span class="skill-icon"><i class="${e(icon || 'fas fa-check')}" aria-hidden="true"></i></span>`;
}

function skillBars(data, category, color, current) {
    return `<ul class="skill-list">${(category.skills || []).map((s) => `
        <li class="${s.name === current ? 'current' : ''}" style="--skill:${e(color)}">
            ${skillIcon(data, s)}
            <div>${bar(`${s.name} · ${s.level}`, s.percentage, 100, `${s.percentage}%`)}
            <small>${e(s.description)}${s.years ? ` · ${e(s.years)} yr${s.years === 1 ? '' : 's'}` : ''}</small></div>
        </li>`).join('')}</ul>`;
}

function socialLinks(social) {
    return `<div class="social-links">${(social || []).map((s) => `
        <a href="${e(s.href)}" target="_blank" rel="noopener me" style="--brand:${e(s.color || '#444')}">
            ${s.icon ? `<i class="${e(s.icon)}" aria-hidden="true"></i>` : `<span class="scopus-letter">${e(s.text || '')}</span>`}
            <span>${e(s.label)}</span></a>`).join('')}</div>`;
}

export function controlsHelp() {
    return `<ul class="help-list">
        <li><span class="help-ico"><i class="fas fa-person-walking" aria-hidden="true"></i></span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to walk, <kbd>Shift</kbd> to hurry</span></li>
        <li><span class="help-ico"><i class="fas fa-arrows-up-down-left-right" aria-hidden="true"></i></span><span>Drag with the left or right mouse button to look around, standing still or walking. Scroll to step forward or back.</span></li>
        <li><span class="help-ico"><i class="fas fa-hand-pointer" aria-hidden="true"></i></span><span>Click the floor to walk there. Click any work to read about it. Drag the globe in Gallery VIII to spin it.</span></li>
        <li><span class="help-ico"><i class="fas fa-mobile-screen" aria-hidden="true"></i></span><span>On touch screens the joystick walks, a finger drag looks and a tap selects.</span></li>
        <li><span class="help-ico"><i class="fas fa-keyboard" aria-hidden="true"></i></span><span><kbd>1</kbd>–<kbd>0</kbd> rooms · <kbd>M</kbd> map · <kbd>C</kbd> catalogue · <kbd>V</kbd> hologram view · <kbd>Esc</kbd> close</span></li>
    </ul>`;
}

export function pubMatches(pub, f) {
    if (f.type !== 'all' && pub._type !== f.type) return false;
    if (f.role === 'first' && !isFirstAuthor(pub)) return false;
    if (f.role === 'co' && isFirstAuthor(pub)) return false;
    if (f.role === 'corresponding' && !isCorresponding(pub)) return false;
    if (f.year !== 'all' && String(pub.year) !== f.year) return false;
    if (f.topics.size && !(pub.topics || []).some((t) => f.topics.has(t))) return false;
    if (f.query) {
        const hay = [pub.title, (pub.authors || []).join(' '), pub.journal, pub.conference, pub.year].filter(Boolean).join(' ').toLowerCase();
        if (!f.query.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

let leafletPromise = null;
export function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
        css.integrity = 'sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==';
        css.crossOrigin = 'anonymous';
        css.referrerPolicy = 'no-referrer';
        document.head.appendChild(css);
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
        script.integrity = 'sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==';
        script.crossOrigin = 'anonymous';
        script.referrerPolicy = 'no-referrer';
        script.onload = () => resolve(window.L);
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
    });
    return leafletPromise;
}

export async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through */ }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
}

function flash(el, text) {
    const tip = document.createElement('span');
    tip.className = 'flash-tip';
    tip.textContent = text;
    el.appendChild(tip);
    setTimeout(() => tip.remove(), 1400);
}

export function openLightbox(src, alt, fallback) {
    const box = document.getElementById('lightbox');
    const img = box.querySelector('img');
    img.onerror = () => {
        if (fallback && !img.src.endsWith(fallback)) img.src = fallback;
    };
    img.src = src;
    img.alt = alt || '';
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('is-open'));
    box.querySelector('button').focus();
}

export function closeLightbox() {
    const box = document.getElementById('lightbox');
    box.classList.remove('is-open');
    setTimeout(() => {
        box.hidden = true;
        box.querySelector('img').removeAttribute('src');
    }, 200);
}

export { stripTags };
