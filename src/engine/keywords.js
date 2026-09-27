// Qualitative keyword lexicon → quantitative target ranges.
//
// Each keyword is a weighted set of trapezoidal membership functions over the
// spatial parameters in metrics.js. A trapezoid [a, b, c, d] scores 0 below a,
// ramps to 1 on [b, c] and back to 0 at d. The ranges are taken from, or
// bracketed by, the studies listed in SOURCES (details + DOIs in
// research/RESEARCH.md). This is the literature prior ("teacher") that the
// tree model in model.js is fitted to, and later re-calibrated with survey data.

export const SOURCES = {
  benedikt1979: 'Benedikt (1979) To take hold of space: isovists and isovist fields. EPB 6(1).',
  wiener2007: 'Wiener, Franz et al. (2007) Isovist analysis captures properties of space relevant for locomotion and experience. Perception 36(7).',
  franz2005: 'Franz & Wiener (2005) Exploring isovist-based correlates of spatial behavior and experience. SSS5.',
  turner2001: 'Turner, Doxa, O’Sullivan & Penn (2001) From isovists to visibility graphs. EPB 28(1).',
  ewing2009: 'Ewing & Handy (2009) Measuring the unmeasurable: urban design qualities related to walkability. J. Urban Design 14(1).',
  yilmaz2025: 'Yilmaz et al. (2025) Natural features and H/W ratios: psycho-physiological responses to street canyons. Building & Environment.',
  asgarzadeh2012: 'Asgarzadeh et al. (2012) Investigating oppressiveness and spaciousness in relation to building, trees, sky and ground surface. Landscape & Urban Planning.',
  li2015: 'Li et al. (2015) Assessing street-level urban greenery using Google Street View and a modified green view index. UF&UG 14(3).',
  bardhan2025: 'Bardhan et al. (2025) Visible greenery and bluespace in street view imagery and mental health: systematic review. Environ. Research.',
  dubey2016: 'Dubey et al. (2016) Deep learning the city: quantifying urban perception at a global scale (Place Pulse 2.0). ECCV.',
  quercia2014: 'Quercia, Schifanella & Aiello (2014) The shortest path to happiness: beautiful, quiet and happy routes. ACM HT.',
  lawson2001: 'Lawson (2001) Building Aerodynamics; Lawson comfort criteria (4/6/8/10 m/s at 5 % exceedance).',
  brode2012: 'Bröde et al. (2012) Deriving the operational procedure for the Universal Thermal Climate Index (UTCI). Int J Biometeorol 56.',
  mehta2024: 'Mehta, Rawal & Shukla (2024) UTCI of urban outdoor spaces, CBD Ahmedabad.',
  gehl1987: 'Gehl (1987/2011) Life Between Buildings; edge effect, social field of vision.',
  mehta2007: 'Mehta (2007) Lively streets: determining environmental characteristics to support social behavior. JPER 27(2).',
  jacobs1961: 'Jacobs (1961) The Death and Life of Great American Cities (eyes on the street).',
  appleton1975: 'Appleton (1975) The Experience of Landscape (prospect–refuge); Dosen & Ostwald (2016) meta-analysis.',
  psathiti2017: 'Psathiti & Sailer (2017) A prospect-refuge approach to seat preference. SSS11.',
  kaplan1989: 'Kaplan & Kaplan (1989) The Experience of Nature (coherence, complexity, legibility, mystery).',
  lynch1960: 'Lynch (1960) The Image of the City (imageability, legibility).',
  hillier1993: 'Hillier et al. (1993) Natural movement. EPB 20(1).',
  iso12913: 'ISO/TS 12913-2 (2018) Soundscape: pleasantness–eventfulness; road-traffic sound lowers pleasantness.',
  taylor2011: 'Taylor et al. (2011) Perceptual and physiological responses to fractals; skyline D 1.3–1.5 preferred.',
  whyte1980: 'Whyte (1980) The Social Life of Small Urban Spaces (sittable space, water, trees, food).',
  pouh2022: 'Shah (2022) Pursuit of Urban Happiness, Generative Techniques for Urban Place Making (UR2001), CEPT University: 8 measured happy places, programme rules, strategy bands.',
  matsuda2002: 'Matsuda et al. (2002) Collective form of buildings and outdoor spaces in Manek Chowk area, Ahmedabad.',
};

import { EVIDENCE_LEXICON } from './evidence-lexicon.js';

const T = (a, b, c, d) => [a, b, c, d];
const INF = 1e9;

// weight = relative importance inside the keyword (normalised at runtime).
export const KEYWORDS_CURATED = {
  happy: {
    label: 'Happy / joyful',
    blurb: 'The POUH target feeling: a green, comfortable, moderately enclosed space with people-oriented edges.',
    terms: [
      { f: 'gvi', t: T(0.08, 0.18, 0.4, 0.55), w: 1.2, src: ['li2015', 'bardhan2025', 'quercia2014'] },
      { f: 'enclosureHW', t: T(0.2, 0.5, 1.5, 3), w: 0.9, src: ['yilmaz2025', 'ewing2009'] },
      { f: 'svf', t: T(0.15, 0.3, 0.65, 0.85), w: 0.6, src: ['asgarzadeh2012', 'yilmaz2025'] },
      { f: 'utci', t: T(-INF, -INF, 32, 38), w: 1.0, src: ['brode2012', 'mehta2024'] },
      { f: 'activeFrontage', t: T(0.1, 0.35, 1, INF), w: 0.8, src: ['mehta2007', 'gehl1987'] },
      { f: 'seating', t: T(0, 3, 30, INF), w: 0.6, src: ['whyte1980', 'mehta2007'] },
      { f: 'isovistArea', t: T(80, 300, 2500, 6000), w: 0.5, src: ['wiener2007', 'gehl1987'] },
      { f: 'roadDist', t: T(2, 12, INF, INF), w: 0.4, src: ['iso12913', 'quercia2014'] },
      // POUH happy-place envelope (p. 19–26): min–max outer, interquartile core.
      { f: 'sunHours', t: T(5.5, 6.9, 10.5, 12), w: 0.7, src: ['pouh2022'] },
      { f: 'isovistPct', t: T(4, 24, 56, 90), w: 0.6, src: ['pouh2022', 'wiener2007'] },
      { f: 'shade', t: T(0.4, 0.5, 0.91, 1.01), w: 0.7, src: ['pouh2022'] },
    ],
  },
  calm: {
    label: 'Calm / serene',
    blurb: 'Low eventfulness: greenery and water, sheltered from wind and traffic, few distractions.',
    terms: [
      { f: 'gvi', t: T(0.12, 0.25, 0.6, INF), w: 1.0, src: ['li2015', 'kaplan1989'] },
      { f: 'roadDist', t: T(5, 20, INF, INF), w: 1.0, src: ['iso12913'] },
      { f: 'activeFrontage', t: T(-INF, -INF, 0.3, 0.7), w: 0.6, src: ['iso12913', 'mehta2007'] },
      { f: 'wind', t: T(-INF, -INF, 2.2, 3.3), w: 0.5, src: ['lawson2001'] },
      { f: 'occlusions', t: T(-INF, -INF, 6, 14), w: 0.5, src: ['franz2005'] },
      { f: 'waterView', t: T(0, 0.1, 1, INF), w: 0.5, src: ['whyte1980', 'bardhan2025'] },
      { f: 'skylineVar', t: T(-INF, -INF, 8, 16), w: 0.4, src: ['taylor2011'] },
    ],
  },
  lively: {
    label: 'Lively / vibrant',
    blurb: 'Eventful: active edges, places to linger, visual complexity, well-connected views.',
    terms: [
      { f: 'activeFrontage', t: T(0.25, 0.55, 1, INF), w: 1.2, src: ['mehta2007', 'gehl1987', 'ewing2009'] },
      { f: 'seating', t: T(1, 6, 30, INF), w: 0.9, src: ['mehta2007', 'whyte1980'] },
      { f: 'occlusions', t: T(3, 7, 16, 26), w: 0.6, src: ['ewing2009', 'franz2005'] },
      { f: 'isovistArea', t: T(150, 500, 3000, 7000), w: 0.6, src: ['hillier1993', 'turner2001'] },
      { f: 'enclosureHW', t: T(0.3, 0.6, 1.6, 3), w: 0.6, src: ['ewing2009'] },
      { f: 'shade', t: T(0.2, 0.45, 1, INF), w: 0.5, src: ['mehta2007', 'mehta2024'] },
      { f: 'edgeDist', t: T(-INF, -INF, 8, 20), w: 0.4, src: ['gehl1987'] },
    ],
  },
  safe: {
    label: 'Safe / secure',
    blurb: 'Prospect with surveillance: long clear views, eyes on the street, few hidden corners.',
    terms: [
      { f: 'openness', t: T(0.05, 0.2, 0.7, 0.95), w: 0.8, src: ['appleton1975', 'wiener2007'] },
      { f: 'isovistArea', t: T(100, 400, 5000, INF), w: 0.8, src: ['wiener2007', 'dubey2016'] },
      { f: 'activeFrontage', t: T(0.1, 0.4, 1, INF), w: 1.0, src: ['jacobs1961', 'dubey2016'] },
      { f: 'occlusions', t: T(-INF, -INF, 6, 14), w: 0.8, src: ['franz2005', 'appleton1975'] },
      { f: 'jaggedness', t: T(-INF, -INF, 45, 90), w: 0.5, src: ['wiener2007'] },
      { f: 'gvi', t: T(0.03, 0.1, 0.35, 0.55), w: 0.4, src: ['dubey2016', 'li2015'] },
    ],
  },
  intimate: {
    label: 'Intimate / cosy',
    blurb: 'Room-like: small convex space, strong enclosure, close edges — the pol courtyard (chowk) quality.',
    terms: [
      { f: 'enclosureHW', t: T(0.7, 1.2, 3, 5), w: 1.0, src: ['yilmaz2025', 'ewing2009', 'matsuda2002'] },
      { f: 'isovistArea', t: T(30, 80, 400, 900), w: 1.0, src: ['wiener2007', 'gehl1987'] },
      { f: 'roundness', t: T(0.3, 0.5, 1, INF), w: 0.7, src: ['franz2005'] },
      { f: 'edgeDist', t: T(-INF, -INF, 4, 10), w: 0.5, src: ['gehl1987', 'psathiti2017'] },
      { f: 'svf', t: T(0.05, 0.15, 0.45, 0.65), w: 0.5, src: ['asgarzadeh2012'] },
    ],
  },
  spacious: {
    label: 'Spacious / open',
    blurb: 'Large, bright, far-reaching views with low enclosure.',
    terms: [
      { f: 'isovistArea', t: T(800, 2500, INF, INF), w: 1.0, src: ['wiener2007', 'benedikt1979'] },
      { f: 'svf', t: T(0.45, 0.65, 1, INF), w: 0.9, src: ['asgarzadeh2012'] },
      { f: 'openness', t: T(0.15, 0.4, 1, INF), w: 0.8, src: ['franz2005'] },
      { f: 'enclosureHW', t: T(-INF, -INF, 0.4, 1), w: 0.7, src: ['yilmaz2025'] },
    ],
  },
  restorative: {
    label: 'Restorative / green',
    blurb: 'Attention restoration: abundant visible greenery, water, distance from traffic, coherent form.',
    terms: [
      { f: 'gvi', t: T(0.15, 0.3, 0.6, INF), w: 1.4, src: ['kaplan1989', 'bardhan2025', 'li2015'] },
      { f: 'waterView', t: T(0, 0.15, 1, INF), w: 0.6, src: ['bardhan2025'] },
      { f: 'roadDist', t: T(5, 20, INF, INF), w: 0.7, src: ['iso12913'] },
      { f: 'skylineVar', t: T(1, 4, 12, 20), w: 0.3, src: ['taylor2011'] },
      { f: 'utci', t: T(-INF, -INF, 32, 38), w: 0.5, src: ['brode2012'] },
    ],
  },
  mysterious: {
    label: 'Mysterious / exploratory',
    blurb: 'Kaplan’s mystery: partly hidden vistas that promise more information around the corner.',
    terms: [
      { f: 'occlusions', t: T(6, 12, 30, INF), w: 1.2, src: ['kaplan1989', 'franz2005'] },
      { f: 'jaggedness', t: T(35, 60, 200, INF), w: 0.9, src: ['wiener2007'] },
      { f: 'openness', t: T(-INF, 0.02, 0.25, 0.5), w: 0.5, src: ['franz2005'] },
      { f: 'isovistArea', t: T(60, 150, 1500, 4000), w: 0.4, src: ['wiener2007'] },
    ],
  },
  comfortable: {
    label: 'Thermally comfortable / cool',
    blurb: 'Shade and breeze against Ahmedabad’s 40 °C design day.',
    terms: [
      { f: 'utci', t: T(-INF, -INF, 30, 36), w: 1.4, src: ['brode2012', 'mehta2024'] },
      { f: 'shade', t: T(0.35, 0.65, 1, INF), w: 1.0, src: ['mehta2024'] },
      { f: 'wind', t: T(0.4, 1.0, 3.0, 4.5), w: 0.6, src: ['lawson2001', 'brode2012'] },
      { f: 'svf', t: T(0.05, 0.2, 0.5, 0.75), w: 0.4, src: ['mehta2024'] },
    ],
  },
  legible: {
    label: 'Legible / imageable',
    blurb: 'Easy to read and remember: coherent convex space, distinctive skyline, visible landmarks.',
    terms: [
      { f: 'roundness', t: T(0.2, 0.4, 1, INF), w: 0.8, src: ['lynch1960', 'franz2005'] },
      { f: 'occlusions', t: T(-INF, 1, 8, 15), w: 0.7, src: ['kaplan1989'] },
      { f: 'skylineVar', t: T(3, 6, 15, 25), w: 0.6, src: ['lynch1960', 'taylor2011'] },
      { f: 'isovistArea', t: T(150, 500, INF, INF), w: 0.6, src: ['lynch1960', 'turner2001'] },
      { f: 'activeFrontage', t: T(0, 0.2, 1, INF), w: 0.4, src: ['ewing2009'] },
    ],
  },
  sociable: {
    label: 'Sociable / gathering',
    blurb: 'Places to sit at the edge, in shade, with a view of activity (Whyte, Gehl, prospect–refuge seating).',
    terms: [
      { f: 'seating', t: T(2, 8, 30, INF), w: 1.2, src: ['whyte1980', 'psathiti2017'] },
      { f: 'edgeDist', t: T(-INF, 1, 6, 15), w: 0.7, src: ['gehl1987', 'psathiti2017'] },
      { f: 'shade', t: T(0.3, 0.6, 1, INF), w: 0.8, src: ['mehta2007'] },
      { f: 'activeFrontage', t: T(0.1, 0.3, 1, INF), w: 0.7, src: ['mehta2007'] },
      { f: 'isovistArea', t: T(100, 250, 2000, 5000), w: 0.5, src: ['gehl1987'] },
      { f: 'wind', t: T(-INF, -INF, 2.2, 3.3), w: 0.4, src: ['lawson2001'] },
    ],
  },
};

KEYWORDS_CURATED.active = {
  label: 'Active / playful',
  blurb: 'Room to move and play: open, sunny, visible spaces (POUH gym + plaza + kids combination).',
  terms: [
    { f: 'isovistPct', t: T(40, 60, 85, 100), w: 1.0, src: ['pouh2022'] },
    { f: 'sunHours', t: T(8, 10, 12, 13), w: 0.8, src: ['pouh2022'] },
    { f: 'shade', t: T(0.3, 0.45, 0.6, 0.8), w: 0.8, src: ['pouh2022'] },
    { f: 'openness', t: T(0.05, 0.2, 1, INF), w: 0.5, src: ['franz2005'] },
    { f: 'utci', t: T(-INF, -INF, 34, 40), w: 0.5, src: ['brode2012'] },
  ],
};

// Final lexicon = curated terms (core papers + POUH) re-weighted by the
// corpus evidence matrix, plus terms the corpus supports that were missing.
// See scripts/apply-evidence.js and research/RESEARCH.md § 5b.
export const KEYWORDS = Object.fromEntries(Object.entries(KEYWORDS_CURATED).map(([k, def]) => {
  const ev = EVIDENCE_LEXICON[k];
  if (!ev) return [k, def];
  const terms = def.terms.map((t) => {
    const a = ev.adjust.find((x) => x.f === t.f);
    return a ? { ...t, w: +(t.w * a.factor).toFixed(3), corpus: { support: a.support, against: a.against, conflict: a.conflict, papers: a.papers } } : t;
  });
  for (const x of ev.added) terms.push({ f: x.f, t: x.t, w: x.w, src: x.src, corpus: { support: x.n, against: 0, added: true, consistency: x.consistency, params: x.params, papers: x.papers } });
  return [k, { ...def, terms }];
}));

export const KEYWORD_KEYS = Object.keys(KEYWORDS);

export function trapezoid(v, [a, b, c, d]) {
  if (v < a || v > d) return 0;
  if (v >= b && v <= c) return 1;
  if (v < b) return b === a ? 1 : (v - a) / (b - a);
  return d === c ? 1 : (d - v) / (d - c);
}

// Literature prior score 0–100 for one keyword and one metric record.
export function priorScore(keyword, m) {
  const def = KEYWORDS[keyword];
  let s = 0, w = 0;
  for (const term of def.terms) {
    s += term.w * trapezoid(m[term.f], term.t);
    w += term.w;
  }
  return (100 * s) / w;
}

// Per-term breakdown used for the "quantitative proof" panel.
export function explainPrior(keyword, m) {
  const def = KEYWORDS[keyword];
  const wsum = def.terms.reduce((s, t) => s + t.w, 0);
  return def.terms.map((term) => ({
    feature: term.f,
    value: m[term.f],
    target: term.t,
    membership: trapezoid(m[term.f], term.t),
    weight: term.w / wsum,
    sources: term.src,
    corpus: term.corpus || null,
  }));
}
