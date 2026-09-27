import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { polygonArea, convexHull, minAreaRect, pointInPolygon } from '../src/engine/geom.js';
import { buildGrid, CLS } from '../src/engine/raster.js';
import { pointMetrics, sunPosition, lawsonClass, utciClass } from '../src/engine/metrics.js';
import { trapezoid, priorScore, KEYWORD_KEYS } from '../src/engine/keywords.js';
import { trainGBT, predictGBT, contributionsGBT } from '../src/engine/gbt.js';
import { classifyObjects, siteFromClassified } from '../src/engine/classify.js';
import { prepare, evaluateGenome, findOpenSpaces } from '../src/engine/pipeline.js';
import { optimize } from '../src/engine/optimizer.js';
import { nearbyBuildings, parseSurveyCSV } from '../src/engine/model.js';
import { CASE_STUDIES, COMBINATIONS, PROGRAMS } from '../src/engine/pouh.js';

const square = (cx, cy, s) => [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]];

test('geometry basics', () => {
  assert.equal(polygonArea(square(0, 0, 5)), 100);
  assert.equal(convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]).length, 4);
  const r = minAreaRect([[0, 0], [10, 0], [10, 2], [0, 2]]);
  assert.ok(Math.abs(r.length - 10) < 1e-6 && Math.abs(r.width - 2) < 1e-6);
  assert.ok(pointInPolygon(0, 0, square(0, 0, 1)));
  assert.ok(!pointInPolygon(3, 0, square(0, 0, 1)));
});

test('isovist in an empty field approaches the disc area; courtyard is enclosed', () => {
  const empty = { bounds: { minX: -150, minY: -150, maxX: 150, maxY: 150 }, buildings: [] };
  const g = buildGrid(empty, 2);
  const m = pointMetrics(g, 0, 0, { rays: 64, maxR: 50 });
  assert.ok(Math.abs(m.isovistArea - Math.PI * 2500) / (Math.PI * 2500) < 0.03, `area ${m.isovistArea}`);
  assert.equal(m.openness, 1);
  assert.ok(m.svf > 0.99);
  assert.equal(m.isovistPct, 100);

  // 20 × 20 m courtyard with 12 m walls on all sides.
  const walls = [
    { footprint: [[-14, 10], [14, 10], [14, 14], [-14, 14]], height: 12 },
    { footprint: [[-14, -14], [14, -14], [14, -10], [-14, -10]], height: 12 },
    { footprint: [[-14, -10], [-10, -10], [-10, 10], [-14, 10]], height: 12 },
    { footprint: [[10, -10], [14, -10], [14, 10], [10, 10]], height: 12 },
  ];
  const cg = buildGrid({ bounds: empty.bounds, buildings: walls }, 1);
  const c = pointMetrics(cg, 0, 0, { rays: 64 });
  assert.ok(c.isovistArea > 300 && c.isovistArea < 450, `courtyard isovist ${c.isovistArea}`);
  assert.equal(c.openness, 0);
  assert.ok(c.enclosureHW > 0.4, `H/W ${c.enclosureHW}`);
  assert.ok(c.svf < m.svf && c.svf > 0.2, `svf ${c.svf}`);
  assert.ok(c.sunHours < m.sunHours);
  assert.ok(c.wind < m.wind);
});

test('solar noon altitude at Ahmedabad on 21 April is ~78.6° (decl. +11.6°)', () => {
  const s = sunPosition(23.03, 111, 12);
  assert.ok(Math.abs((s.alt * 180) / Math.PI - 78.6) < 0.5);
});

test('comfort classes follow Lawson and UTCI bands', () => {
  assert.equal(lawsonClass(1.5), 'sitting');
  assert.equal(lawsonClass(3), 'standing');
  assert.equal(utciClass(30), 'moderate heat stress');
  assert.equal(utciClass(40), 'very strong heat stress');
});

test('trapezoid membership and prior scores stay in 0–100', () => {
  assert.equal(trapezoid(5, [0, 2, 8, 10]), 1);
  assert.equal(trapezoid(1, [0, 2, 8, 10]), 0.5);
  assert.equal(trapezoid(11, [0, 2, 8, 10]), 0);
  const m = { isovistArea: 500, openness: 0.2, roundness: 0.5, jaggedness: 40, occlusions: 5, enclosureHW: 1, svf: 0.5, gvi: 0.2, shade: 0.6, sunHours: 8, isovistPct: 40, utci: 33, wind: 1.5, bcr: 0.5, meanHeight: 10, edgeDist: 4, activeFrontage: 0.4, seating: 6, waterView: 0, skylineVar: 8, roadDist: 15 };
  for (const k of KEYWORD_KEYS) {
    const s = priorScore(k, m);
    assert.ok(s >= 0 && s <= 100, `${k} ${s}`);
  }
});

test('POUH knowledge base matches the portfolio', () => {
  assert.equal(CASE_STUDIES.length, 8);
  assert.deepEqual(CASE_STUDIES.map((c) => c.sunHours), [10.5, 10.8, 8.5, 6.9, 9.6, 11.2, 6.5, 6.8]);
  assert.equal(Object.keys(PROGRAMS).length, 8);
  for (const c of Object.values(COMBINATIONS)) {
    assert.deepEqual(c.areaRatio, [0.25, 0.3, 0.45]);
    assert.deepEqual(c.area, [650, 855]);
  }
});

test('GBT fits a nonlinear function deterministically and attributions add up', () => {
  const X = [], y = [];
  for (let i = 0; i < 600; i++) {
    const a = (i % 30) / 30, b = Math.floor(i / 30) / 20;
    X.push([a, b, 0.5]);
    y.push(100 * (a > 0.5 ? 1 : 0) * b + 10 * a);
  }
  const m1 = trainGBT(X, y, { nTrees: 60 });
  const m2 = trainGBT(X, y, { nTrees: 60 });
  assert.ok(m1.r2 > 0.97, `r2 ${m1.r2}`);
  assert.equal(JSON.stringify(m1.trees), JSON.stringify(m2.trees));
  const x = [0.8, 0.7, 0.5];
  const { bias, contributions } = contributionsGBT(m1, x);
  const sum = bias + contributions.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - predictGBT(m1, x)) < 1e-6);
  assert.ok(Math.abs(contributions[2]) < 1e-9, 'constant feature gets no credit');
});

// --- synthetic 3D scene for the classifier --------------------------------
function boxTris(x0, z0, x1, z1, y0, y1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return Float32Array.from(f.flatMap((t) => t.flatMap((i) => v[i])));
}
function sphereTris(cx, cy, cz, r, seg = 10) {
  const out = [];
  const p = (i, j) => {
    const th = (i / seg) * Math.PI, ph = (j / seg) * 2 * Math.PI;
    return [cx + r * Math.sin(th) * Math.cos(ph), cy + r * Math.cos(th), cz + r * Math.sin(th) * Math.sin(ph)];
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) out.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1), ...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1));
  return Float32Array.from(out);
}

test('classifier separates ground, buildings, road, tree and honours names', () => {
  const objects = [
    { name: 'Mesh001', positions: boxTris(-60, -60, 60, 60, -0.2, 0) }, // ground slab
    { name: 'Mesh002', positions: boxTris(-30, -30, -10, -10, 0, 12) }, // building
    { name: 'Mesh003', positions: boxTris(-50, 5, 50, 12, 0, 0.1) }, // road strip
    { name: 'Mesh004', positions: sphereTris(20, 6, 20, 3) }, // tree crown
    { name: 'Pond', positions: boxTris(30, -40, 40, -30, 0, 0.2) },
  ];
  const { items } = classifyObjects(objects, { split: false });
  const cls = Object.fromEntries(items.map((i) => [i.name, i.cls]));
  assert.equal(cls.Mesh001, 'ground');
  assert.equal(cls.Mesh002, 'building');
  assert.equal(cls.Mesh003, 'road');
  assert.equal(cls.Mesh004, 'tree');
  assert.equal(cls.Pond, 'water');
  for (const it of items) assert.ok(it.reason.length > 5);
  const site = siteFromClassified(classifyObjects(objects, { split: false }));
  assert.equal(site.buildings.length, 1);
  assert.ok(Math.abs(site.buildings[0].height - 12) < 0.3);
  const g = buildGrid(site, 2);
  const zones = findOpenSpaces(g, { minArea: 50, maxArea: 20000 });
  assert.ok(zones.length >= 1);
});

test('classifier splits a merged mesh into components', () => {
  const merged = new Float32Array([...boxTris(0, 0, 10, 10, 0, 9), ...boxTris(20, 0, 30, 10, 0, 15)]);
  const { items } = classifyObjects([{ name: 'Merged', positions: merged }], { split: true });
  assert.equal(items.filter((i) => i.cls === 'building').length, 2);
});

test('pipeline + optimiser are deterministic on the default site', () => {
  const site = JSON.parse(readFileSync(new URL('../public/data/site-manek-chowk.json', import.meta.url)));
  const model = JSON.parse(readFileSync(new URL('../public/models/gbt.json', import.meta.url)));
  const zones = site.openSpaces.slice(0, 1);
  const buildings = nearbyBuildings(site, zones, 10).slice(0, 6);
  const ctx = prepare(site, { zones, buildings });
  const g = Array.from({ length: ctx.nGenes }, (_, i) => ((i * 37) % 100) / 100);
  const a = evaluateGenome(ctx, g, model), b = evaluateGenome(ctx, g, model);
  assert.deepEqual(a.agg, b.agg);
  assert.ok(a.design.boxes.length > 0);
  const prefs = { happy: 80, comfortable: 70 };
  const r1 = optimize(ctx, model, prefs, { population: 8, generations: 3, seed: 5 });
  const r2 = optimize(ctx, model, prefs, { population: 8, generations: 3, seed: 5 });
  assert.equal(r1.best.fitness, r2.best.fitness);
  assert.ok(r1.best.fitness >= r1.history[0].best - 1e-9);
});

test('survey CSV parsing rescales Likert ratings', () => {
  const head = 'isovistArea,openness,roundness,jaggedness,occlusions,enclosureHW,svf,gvi,shade,sunHours,isovistPct,utci,wind,bcr,meanHeight,edgeDist,activeFrontage,seating,waterView,skylineVar,roadDist,happy';
  const row = '500,0.2,0.5,40,5,1,0.5,0.2,0.6,8,40,33,1.5,0.5,10,4,0.4,6,0,8,15,5';
  const rows = parseSurveyCSV(`${head}\n${row}\n${row.replace(/,5$/, ',1')}`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ratings.happy, 100);
  assert.equal(rows[1].ratings.happy, 0);
});
