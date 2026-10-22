// Loads every data/*.json file the museum shows and derives the lookups the
// exhibits and panels share.

import { fetchJSON } from './util.js';

export const SELF = 'Saddiq Ur Rehman';

/** Publication types: `keys` are the publications.json arrays each reads. */
export const PUB_TYPES = [
    { id: 'journals', keys: ['journals'], label: 'International Journals', short: 'Journal Article' },
    { id: 'conferences', keys: ['conferences'], label: 'International Conferences', short: 'Conference Paper' },
    { id: 'korean', keys: ['korean_conferences', 'korean'], label: 'Korean Conferences', short: 'Korean Conference' },
    { id: 'reports', keys: ['technical_reports', 'reports'], label: 'Technical Reports', short: 'Technical Report' }
];

const FILES = {
    profile: 'data/profile.json',
    news: 'data/news.json',
    experience: 'data/experience.json',
    publications: 'data/publications.json',
    projects: 'data/projects.json',
    skills: 'data/skills.json',
    certificates: 'data/certificates.json',
    seminars: 'data/seminars.json',
    collaborations: 'data/collaborations.json',
    software: 'data/software.json',
    textures: 'data/museum-textures.json',
    venues: 'data/venues.json',
    worldDots: 'data/world-dots.json'
};

function titleKey(title) {
    return String(title || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function loadAllData(onProgress) {
    const entries = Object.entries(FILES);
    let done = 0;
    const results = await Promise.all(entries.map(async ([key, url]) => {
        try {
            return [key, await fetchJSON(url)];
        } catch (error) {
            console.warn('Could not load', url, error);
            return [key, null];
        } finally {
            done += 1;
            onProgress?.(done / (entries.length + 1));
        }
    }));
    const data = Object.fromEntries(results);

    // Scholar metrics are rewritten by a GitHub Action; never serve a stale copy.
    try {
        data.scholar = await fetchJSON('data/scholar.json?v=' + Date.now(), { cache: 'no-store' });
    } catch {
        data.scholar = null;
    }
    onProgress?.(1);
    return derive(data);
}

function derive(data) {
    data.profile ||= { name: SELF, about: [], researchInterests: [], education: [], reviewing: [], social: [] };
    data.news ||= [];
    data.textures ||= {};

    const pubs = data.publications || {};
    data.pubList = [];
    for (const type of PUB_TYPES) {
        const key = type.keys.find((k) => Array.isArray(pubs[k]));
        (key ? pubs[key] : []).forEach((pub, index) => {
            data.pubList.push({ ...pub, _type: type.id, _typeLabel: type.short, _key: `${type.id}:${index}` });
        });
    }

    const citations = new Map();
    for (const paper of data.scholar?.papers || []) {
        if (Number.isInteger(paper.citations) && paper.citations > 0) citations.set(titleKey(paper.title), paper);
    }
    data.citationsFor = (pub) => citations.get(titleKey(pub.title)) || null;

    const covers = new Map(Object.entries(data.venues?.covers || {}).map(([name, src]) => [titleKey(name), src]));
    data.venueCover = (pub) => covers.get(titleKey(pub.journal || pub.conference)) || null;

    const journals = data.pubList.filter((p) => p._type === 'journals');
    const cumulativeIF = journals.reduce((sum, p) => sum + (Number(p.impactFactor) || 0), 0);
    data.pubStats = {
        total: data.pubList.length,
        byType: Object.fromEntries(PUB_TYPES.map((t) => [t.id, data.pubList.filter((p) => p._type === t.id).length])),
        cumulativeIF: (Math.round(cumulativeIF * 10) / 10).toFixed(1),
        journalCount: journals.length
    };

    data.highlights = data.news.slice(0, 4);
    data.newsRest = data.news.slice(4);

    const exp = data.experience || {};
    data.experienceList = [
        ...(exp.academic_experience || []).map((e) => ({ ...e, _kind: 'Academic' })),
        ...(exp.industry_experience || []).map((e) => ({ ...e, _kind: 'Industry' }))
    ];

    data.projectList = [
        ...(data.projects?.research_projects || []),
        ...(data.projects?.collaboration_projects || []),
        ...(data.projects?.student_projects || [])
    ];

    data.skillCategories = Object.entries(data.skills || {}).map(([id, cat]) => ({ id, ...cat }));
    data.tools = data.software?.tools || [];
    data.awards = data.certificates?.awards || [];
    data.certs = data.certificates?.certifications || [];
    data.seminarList = data.seminars?.seminars || [];
    return data;
}

/** The gallery-sized copy of a local image, with its original dimensions. */
export function textureInfo(data, src) {
    if (!src) return null;
    const entry = data.textures[src];
    if (entry) return { src: entry.src, original: src, w: entry.w, h: entry.h };
    return { src, original: src, w: 0, h: 0 };
}

export function isFirstAuthor(pub) {
    return String((pub.authors || [])[0] || '').includes(SELF);
}

export function isCorresponding(pub) {
    return pub.corresponding === true || (pub.badges || []).some((b) => /corresponding/i.test(b));
}

export function pubVenue(pub) {
    return pub.journal || pub.conference || '';
}
