// Deterministic design generator implementing the POUH pseudo-code
// (portfolio p. 34–35) over user-selected intervention zones and buildings.
//
// A design is fully determined by a genome (array of numbers in [0, 1]) plus
// the site; the optimiser only ever manipulates genomes.

import { COMBINATIONS, PROGRAMS } from './pouh.js';
import { polygonArea, polygonCentroid, minAreaRect, pointInPolygon } from './geom.js';
import { CLS, cloneGrid, forEachCellInPolygon, stampTree, stampCanopy, cellOf } from './raster.js';
import { mulberry32 } from './rng.js';

export const COMBO_KEYS = Object.keys(COMBINATIONS);
const ZONE_GENES = 10;
const BUILDING_GENES = 3;
const MAX_ZONES = 6;
const MAX_BUILDINGS = 24;

export function genomeLength(zones, buildings) {
  return 1 + Math.min(zones.length, MAX_ZONES) * ZONE_GENES + Math.min(buildings.length, MAX_BUILDINGS) * BUILDING_GENES;
}

const lerp = (a, b, t) => a + (b - a) * t;
const pick = (range, t) => (Array.isArray(range) ? lerp(range[0], range[1], t) : range);

// Oriented box → polygon (plan).
export function boxPolygon(b) {
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const hw = b.w / 2, hd = b.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [b.cx + u * c - v * s, b.cy + u * s + v * c]);
}

function localToWorld(frame, u, v) {
  const c = Math.cos(frame.angle), s = Math.sin(frame.angle);
  return [frame.cx + u * c - v * s, frame.cy + u * s + v * c];
}

// Distance from a point to the nearest main-road segment.
export function distToMainRoad(site, x, y) {
  let best = Infinity;
  for (const r of site.roads || []) {
    if (!r.main || !r.line) continue;
    for (let i = 0; i < r.line.length - 1; i++) {
      const [x1, y1] = r.line[i], [x2, y2] = r.line[i + 1];
      const dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
    }
  }
  return best;
}

// Lay out one programme strip following p. 35: grid by step division,
// cut-out, extrusion along u for the first part, along v for the remainder.
function layoutProgram(prog, strip, genes, combo, out, rand) {
  const def = PROGRAMS[prog];
  const step = combo.stepDivision[prog];
  const { frame, u0, u1, v0, v1 } = strip;
  const add = (kind, uA, uB, vA, vB, h, extra = {}) => {
    const [cx, cy] = localToWorld(frame, (uA + uB) / 2, (vA + vB) / 2);
    out.boxes.push({ kind, program: prog, cx, cy, w: Math.abs(uB - uA), d: Math.abs(vB - vA), angle: frame.angle, h, ...extra });
  };
  const W = u1 - u0, D = v1 - v0;
  if (W < 1 || D < 1) return;

  // Cut-out: an open paved void kept free inside the footprint.
  const cut = genes.cutout * 0.35;
  const cutU = u0 + W * (0.5 - cut / 2), cutU1 = u0 + W * (0.5 + cut / 2);

  const els = def.elements;
  const green = els.includes('lawn') || els.includes('mound');
  const greenShare = green ? lerp(0.3, 0.8, genes.green) : 0;

  // Shaded corridor along the long edge (v0 side).
  if (els.includes('corridor')) {
    const cw = lerp(2.5, 4, genes.canopy);
    add('corridor', u0, u1, v0, v0 + cw, 3.6, { canopy: true });
  }

  if (step) {
    // Stepped grid (steps / terraces / cafe blocks), extruded along u then v.
    const sh = pick(step[0], genes.stepH), sw = pick(step[1], genes.stepW);
    const nU = Math.max(1, Math.floor((W * (1 - cut)) / sw));
    const tiers = prog === 'cafe' ? 1 : Math.max(2, Math.min(5, Math.round(lerp(2, 5, genes.extrude))));
    const splitV = v0 + D * lerp(0.45, 0.7, genes.split);
    let placed = 0;
    for (let i = 0; i < nU; i++) {
      const a = u0 + i * sw, b = a + sw * 0.96;
      if (b > cutU && a < cutU1) continue; // cut-out
      if (prog === 'cafe') {
        // Cafe: kiosk blocks (active frontage) with terrace on alternate modules.
        if (placed >= 4) break;
        add('kiosk', a, b, splitV - sw, splitV, sh, { active: true });
        placed++;
        continue;
      }
      const tier = (i % tiers) + 1; // extrusion along u
      add('steps', a, b, v0 + (els.includes('corridor') ? 4 : 0), splitV, sh * tier, { seats: 2 });
    }
    // Remaining part: extrusion in the other direction (along v).
    if (prog !== 'cafe') {
      const nV = Math.max(1, Math.floor((v1 - splitV) / sw));
      for (let j = 0; j < Math.min(nV, 4); j++) {
        const tier = Math.min(tiers, j + 1);
        add('steps', u0, u0 + W * 0.35, splitV + j * sw, splitV + (j + 1) * sw * 0.96, sh * tier, { seats: 2 });
      }
    }
  } else if (els.includes('plinth')) {
    add('plinth', u0 + W * 0.1, u0 + W * 0.45, v0 + D * 0.55, v1 - D * 0.05, lerp(0.45, 0.6, genes.stepH), { seats: 1 });
  }

  if (green) {
    // Lawn / mound area on the opposite side of the cut-out.
    const gw = W * greenShare;
    const ga = cutU1, gb = Math.min(u1, cutU1 + gw);
    if (gb - ga > 1) {
      add('lawn', ga, gb, v0 + D * 0.15, v1, 0.05, { green: true });
      if (els.includes('mound')) add('mound', ga + (gb - ga) * 0.2, ga + (gb - ga) * 0.6, v0 + D * 0.4, v0 + D * 0.8, lerp(0.6, 1.2, genes.stepH), { green: true });
      // Trees on the lawn: deterministic jittered grid, density gene.
      const spacing = lerp(12, 6, genes.trees);
      for (let u = ga + spacing / 2; u < gb; u += spacing) {
        for (let v = v0 + D * 0.15 + spacing / 2; v < v1; v += spacing) {
          const [x, y] = localToWorld(frame, u + (rand() - 0.5) * 1.5, v + (rand() - 0.5) * 1.5);
          out.trees.push({ x, y, r: 3.5, h: 8, program: prog });
        }
      }
    }
  }
  // Seating along the cut-out edges (edge effect, Gehl).
  const nSeats = Math.round(lerp(2, 10, genes.seats));
  for (let k = 0; k < nSeats; k++) {
    const [x, y] = localToWorld(frame, cutU + (k % 2) * (cutU1 - cutU), v0 + (D * (k + 0.5)) / nSeats);
    out.seats.push({ x, y, program: prog });
  }
}

// Decode a genome into a concrete design (list of primitives + building edits).
export function decode(genome, ctx) {
  const { site, zones, buildings, comboLock } = ctx;
  const rand = mulberry32(ctx.seed ?? 1234);
  const out = { boxes: [], trees: [], seats: [], buildingEdits: [], zones: [], combo: null };
  const comboKey = comboLock || COMBO_KEYS[Math.min(COMBO_KEYS.length - 1, Math.floor(genome[0] * COMBO_KEYS.length))];
  const combo = COMBINATIONS[comboKey];
  out.combo = comboKey;

  const cleared = new Set();
  let gi = 1;
  zones.slice(0, MAX_ZONES).forEach((zone, zi) => {
    const g = genome.slice(gi, gi + ZONE_GENES);
    gi += ZONE_GENES;
    const genes = { use: g[0], area: g[1], angle: g[2], green: g[3], canopy: g[4], trees: g[5], stepH: g[6], stepW: g[7], cutout: g[8], seats: g[9], extrude: g[6], split: g[7] };
    const zArea = polygonArea(zone.polygon);
    const [cx, cy] = polygonCentroid(zone.polygon);
    const rect = minAreaRect(zone.polygon);
    const info = { index: zi, area: zArea, used: genes.use >= 0.25, distMainRoad: distToMainRoad(site, cx, cy) };
    out.zones.push(info);
    if (!info.used) return;

    // Step 1: rectangle with the required area (bounded by the zone).
    // Available land = the open zone + footprints of buildings the user opened
    // within 15 m of it (they may be cleared, POUH p. 39).
    let avail = zArea;
    const reach = [];
    for (const bi of buildings) {
      const [bx, by] = polygonCentroid(site.buildings[bi].footprint);
      if (Math.min(...zone.polygon.map(([px, py]) => Math.hypot(px - bx, py - by))) < 15 || pointInPolygon(bx, by, zone.polygon)) {
        avail += polygonArea(site.buildings[bi].footprint);
        reach.push([bx, by]);
      }
    }
    const want = lerp(combo.area[0], combo.area[1], genes.area);
    const A = Math.min(want, avail * 0.9);
    const aspect = Math.max(1, Math.min(2.5, rect.length / Math.max(rect.width, 1)));
    const L = Math.sqrt(A * aspect);
    const Wd = A / L;
    // Aligned with the zone's long axis; near-square zones may turn 90°.
    const turn = genes.angle >= 0.5 && aspect < 1.4;
    let fx = cx, fy = cy;
    if (reach.length && A > zArea) {
      const rx = reach.reduce((q, p) => q + p[0], 0) / reach.length, ry = reach.reduce((q, p) => q + p[1], 0) / reach.length;
      const t = Math.min(0.6, 1 - zArea / A);
      fx = cx + (rx - cx) * t; fy = cy + (ry - cy) * t;
    }
    const frame = { cx: fx, cy: fy, angle: rect.angle + (turn ? Math.PI / 2 : 0) };
    info.interventionArea = L * Wd;
    // Buildings the user opened for intervention that fall inside the
    // intervention rectangle are cleared (POUH Experiment-1 placement, p. 39).
    const rectPoly = boxPolygon({ cx: frame.cx, cy: frame.cy, w: L, d: Wd, angle: frame.angle });
    info.rect = rectPoly;
    for (const bi of buildings) {
      const b = site.buildings[bi];
      const [bx, by] = polygonCentroid(b.footprint);
      if (pointInPolygon(bx, by, rectPoly)) cleared.add(bi);
    }

    // Step 2: split along the long side by the combination area ratio.
    let u = -L / 2;
    combo.programs.forEach((prog, pi) => {
      const len = L * combo.areaRatio[pi];
      layoutProgram(prog, { frame, u0: u, u1: u + len, v0: -Wd / 2, v1: Wd / 2 }, genes, combo, out, rand);
      u += len;
    });
    // Clip primitives to the zone polygon (centre test).
    const inside = (x, y) => pointInPolygon(x, y, zone.polygon) || (A > zArea && pointInPolygon(x, y, rectPoly));
    out.boxes = out.boxes.filter((b) => b.zone !== undefined || inside(b.cx, b.cy));
    out.trees = out.trees.filter((t) => t.zone !== undefined || inside(t.x, t.y));
    out.seats = out.seats.filter((q) => q.zone !== undefined || inside(q.x, q.y));
    for (const arr of [out.boxes, out.trees, out.seats]) for (const o of arr) if (o.zone === undefined) o.zone = zi;
  });

  // Spacing between units (p. 34 step 4) — report compliance.
  const used = out.zones.filter((z) => z.used);
  const cents = used.map((z) => polygonCentroid(zones[z.index].polygon));
  for (let i = 0; i < used.length; i++) {
    let nn = Infinity;
    for (let j = 0; j < used.length; j++) if (i !== j) nn = Math.min(nn, Math.hypot(cents[i][0] - cents[j][0], cents[i][1] - cents[j][1]));
    used[i].distNearestUnit = nn;
  }

  buildings.slice(0, MAX_BUILDINGS).forEach((bi) => {
    const g = genome.slice(gi, gi + BUILDING_GENES);
    gi += BUILDING_GENES;
    const b = site.buildings[bi];
    const floors = Math.max(1, Math.round(b.height / 3.2));
    const delta = Math.round(lerp(-2, 2, g[0]));
    out.buildingEdits.push({
      index: bi,
      demolish: cleared.has(bi) || g[2] > 0.85,
      reason: cleared.has(bi) ? 'intervention' : g[2] > 0.85 ? 'gene' : undefined,
      height: Math.max(1, floors + delta) * 3.2,
      active: g[1] > 0.5 || !!b.active,
    });
  });
  return out;
}

// Stamp a decoded design onto a copy of the base raster.
export function applyDesign(baseGrid, site, design) {
  const g = cloneGrid(baseGrid);
  for (const e of design.buildingEdits) {
    const b = site.buildings[e.index];
    const poly = b.footprint;
    forEachCellInPolygon(g, poly, (k) => {
      if (g.bid[k] !== e.index) return;
      if (e.demolish) {
        g.h[k] = 0; g.cls[k] = CLS.GROUND; g.bid[k] = -1; g.active[k] = 0;
      } else {
        g.h[k] = e.height; g.active[k] = e.active ? 1 : 0;
      }
    });
  }
  for (const b of design.boxes) {
    const poly = boxPolygon(b);
    if (b.canopy) { stampCanopy(g, poly, b.h, 0.1); continue; }
    forEachCellInPolygon(g, poly, (k) => {
      if (g.cls[k] === CLS.BUILDING && g.bid[k] >= 0) return;
      if (b.green) { if (g.cls[k] !== CLS.TREE) g.cls[k] = CLS.GREEN; }
      if (b.h > 0.1) {
        g.h[k] = Math.max(g.h[k], b.h);
        if (b.h > 1.6) { g.cls[k] = CLS.BUILDING; g.active[k] = b.active ? 1 : 0; }
      }
      if (b.seats) g.seat[k] = Math.min(255, g.seat[k] + b.seats);
    });
  }
  for (const t of design.trees) stampTree(g, t);
  for (const s of design.seats) {
    const k = cellOf(g, s.x, s.y);
    if (k >= 0) g.seat[k] = Math.min(255, g.seat[k] + 1);
  }
  return g;
}

// Rough intervention cost used as an Occam penalty (prefer fewer changes).
export function designCost(design) {
  let c = design.boxes.length * 0.2 + design.trees.length * 0.05;
  // Clearing inside a POUH intervention footprint is part of the programme
  // (cheap); stand-alone demolition elsewhere is expensive.
  for (const e of design.buildingEdits) c += e.demolish ? (e.reason === 'intervention' ? 0.4 : 2.5) : 0;
  return c;
}
