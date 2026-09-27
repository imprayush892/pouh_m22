// Pursuit of Urban Happiness (POUH) knowledge base.
// Source: Shah, P. (2022) "Pursuit of Urban Happiness", Generative Techniques
// for Urban Place Making (UR2001), CEPT University, Monsoon 2022. Page numbers
// refer to the printed portfolio. Values are transcribed as published; where
// the portfolio encodes a range as a highlighted tercile of a bar, the tercile
// bounds are used (e.g. sun hours bar 6–12 h, middle third → 8–10 h).

export const POUH_SITE = {
  name: 'Nagbhudar ni pol, walled city of Ahmedabad',
  description:
    'Patch connecting two attractor points, Manek Chowk and Raipur Chakla, with Sankdi Sheri as secondary street; ' +
    'densely populated residential core, commercial periphery along the main road (p. 7).',
  problems: [
    // p. 14–15
    'Lack of green cover',
    'Commercial uses on the periphery become inactive at night → perceived as unsafe',
    'Open spaces under-used because of haphazard parking',
    'Narrow, tall residential streets receive little sunlight → isolation, little interaction',
  ],
  ambition: 'Increasing urban happiness in Ahmedabad’s old city neighbourhoods (p. 16)',
  happinessFactors: ['Ecological diversity', 'Physical and mental well-being', 'Community interaction'], // p. 17
};

// p. 19–26 — measured "happy places" (CEPT campus + Ahmedabad).
// sunHours: direct sun hours; isovistPct: isovist as % of the analysis disc;
// shadingMask: shading-mask value from the portfolio (0–1).
export const CASE_STUDIES = [
  { name: 'North Lawns, CEPT', builtType: 'open', quality: 'super green', elements: ['lawns', 'mounds'], sunHours: 10.5, isovistPct: 44, shadingMask: 0.96, page: 19 },
  { name: 'FP Plinth, CEPT', builtType: 'semi-open', quality: 'paved', elements: ['plinth', 'steps'], sunHours: 10.8, isovistPct: 50, shadingMask: 0.52, page: 20 },
  { name: 'Toritos Cafe', builtType: 'built+open', quality: 'super green', elements: ['cafe', 'lawns', 'seating'], sunHours: 8.5, isovistPct: 85, shadingMask: 0.5, page: 21 },
  { name: 'Municipal Market', builtType: 'semi-open', quality: 'paved', elements: ['corridor', 'stalls'], sunHours: 6.9, isovistPct: 34, shadingMask: 0.8, page: 22 },
  { name: 'Chauraha Cafe', builtType: 'open', quality: 'paved', elements: ['lawns', 'mounds', 'steps', 'cafe', 'spillover'], sunHours: 9.6, isovistPct: 28, shadingMask: 0.48, page: 23 },
  { name: 'Art Gallery amphitheatre', builtType: 'open', quality: 'paved', elements: ['steps'], sunHours: 11.2, isovistPct: 6.3, shadingMask: 0.91, page: 24 },
  { name: 'Makeba Cafe', builtType: 'open', quality: 'super green', elements: ['terrace', 'cafe', 'lawns'], sunHours: 6.5, isovistPct: 24, shadingMask: 0.86, page: 25 },
  { name: 'FP Terrace, CEPT', builtType: 'open', quality: 'paved', elements: ['terrace'], sunHours: 6.8, isovistPct: 56, shadingMask: 0.91, page: 26 },
];

// p. 28–29 — programmes ("happy places"), area per unit (m²), elements, units.
export const PROGRAMS = {
  cafe: { label: 'Cafe', area: [65, 100], elements: ['lawn', 'plinth', 'terrace'], units: [3, 4], page: 28 },
  amphitheatre: { label: 'Amphitheatre', area: [380, 485], elements: ['lawn', 'steps'], units: [2, 3], page: 28 },
  plaza: { label: 'Plaza', area: [205, 275], elements: ['mound', 'corridor', 'steps'], units: [2, 3], page: 28 },
  exhibition: { label: 'Exhibition space', area: [205, 275], elements: ['plinth', 'corridor'], units: [1, 2], page: 28 },
  yoga: { label: 'Yoga space', area: [205, 275], elements: ['lawn', 'steps', 'terrace'], units: [3, 4], page: 29 },
  gym: { label: 'Open gym', area: [65, 100], elements: ['mound', 'lawn'], units: [1, 2], page: 29 },
  kids: { label: 'Kids play area', area: [380, 485], elements: ['lawn', 'plinth', 'mound'], units: [2, 3], page: 29 },
  lightPark: { label: 'Light park', area: [65, 100], elements: ['lawn', 'corridor', 'steps'], units: [1, 2], page: 29 },
};

// p. 30–32 — strategy combinations. Area ratio 0.25 / 0.3 / 0.45 is applied in
// listed order. "usageAround" = residential share (yellow) vs commercial (blue).
// stepDivision = [heightRange, widthRange] in m for the extruded grid (p. 31).
export const COMBINATIONS = {
  cultural: {
    label: 'Cafe + Exhibition + Amphitheatre',
    programs: ['cafe', 'exhibition', 'amphitheatre'],
    areaRatio: [0.25, 0.3, 0.45],
    area: [650, 855],
    distFromMainRoad: [120, 160],
    distBetweenUnits: [120, 160],
    residentialShare: 0.5,
    stepDivision: { cafe: [[2.5, 3], [3, 4]], exhibition: null, amphitheatre: [[0.45, 0.6], [0.6, 1.2]] },
    sunHours: [6, 8],
    isovistPct: [10, 35],
    shadingMask: [0.75, 0.9],
    keywords: ['lively', 'sociable', 'legible', 'comfortable'],
  },
  wellbeing: {
    label: 'Light park + Yoga + Kids play',
    programs: ['lightPark', 'yoga', 'kids'],
    areaRatio: [0.25, 0.3, 0.45],
    area: [650, 855],
    distFromMainRoad: [160, 200],
    distBetweenUnits: [80, 120],
    residentialShare: 0.65,
    stepDivision: { lightPark: null, yoga: [[0.9, 1.2], [1.5, 1.8]], kids: null },
    sunHours: [8, 10],
    isovistPct: [35, 60],
    shadingMask: [0.6, 0.75],
    keywords: ['calm', 'restorative', 'happy', 'safe'],
  },
  active: {
    label: 'Open gym + Plaza + Kids play',
    programs: ['gym', 'plaza', 'kids'],
    areaRatio: [0.25, 0.3, 0.45],
    area: [650, 855],
    distFromMainRoad: [80, 120],
    distBetweenUnits: [160, 200],
    residentialShare: 0.33,
    stepDivision: { gym: null, plaza: [[0.15, 0.45], [0.6, 0.9]], kids: null },
    sunHours: [10, 12],
    isovistPct: [60, 85],
    shadingMask: [0.45, 0.6],
    keywords: ['active', 'spacious', 'lively'],
  },
};

// p. 34 — site-selection pseudo-code, expressed as ordered filters.
export const SITE_SELECTION_STEPS = [
  'Select all the open spaces',
  'Keep open spaces that meet the distance requirement from the main road',
  'Keep open spaces that meet the area requirement',
  'Keep open spaces that meet the distance requirement between two units',
];

// p. 35 — intervention pseudo-code.
export const INTERVENTION_STEPS = [
  'Make a rectangle with the area required for the intervention',
  'Divide the two segments into a finer grid of two sizes according to the step-division rules',
  'Create a cut-out within the footprint',
  'Extrude the grid in one direction',
  'Split the remaining part into two parts',
  'Adjust the extrusion in the other direction',
];

// Element vocabulary used by the generator (heights in m).
export const ELEMENTS = {
  lawn: { label: 'Lawn', green: true, height: 0 },
  mound: { label: 'Mound', green: true, height: [0.6, 1.2] },
  plinth: { label: 'Plinth', height: [0.45, 0.6] },
  steps: { label: 'Stepped seating', seats: true },
  terrace: { label: 'Terrace', height: [2.5, 3] },
  corridor: { label: 'Shaded corridor', canopy: true, height: 3.6 },
  kiosk: { label: 'Cafe / kiosk', active: true, height: [2.5, 3] },
};

// Distance from main road / between units are site-selection constraints
// (see generator.js), not per-point metrics.
// Map a combination's POUH bands to trapezoid terms (±15 % shoulders) so they
// can be scored alongside the literature lexicon.
export function combinationTerms(key) {
  const c = COMBINATIONS[key];
  const band = (f, [lo, hi], w) => {
    const pad = (hi - lo) * 0.75 || 1;
    return { f, t: [lo - pad, lo, hi, hi + pad], w, src: ['pouh2022'] };
  };
  return [
    band('sunHours', c.sunHours, 1),
    band('isovistPct', c.isovistPct, 1),
    band('shade', c.shadingMask, 1),
  ];
}

// Pick the combination whose keyword set best matches the user's selection.
export function suggestCombination(prefs) {
  let best = null;
  for (const [key, c] of Object.entries(COMBINATIONS)) {
    let s = 0;
    for (const [kw, v] of Object.entries(prefs)) if (c.keywords.includes(kw)) s += v;
    if (!best || s > best.s) best = { key, s };
  }
  return best.key;
}
