import { Viewer, COLORS } from './viewer/scene.js';
import { importFile } from './viewer/importers.js';
import { classifyObjects, siteFromClassified, CLASSES } from './engine/classify.js';
import { KEYWORDS, KEYWORD_KEYS, SOURCES } from './engine/keywords.js';
import { FEATURES, sunPosition, CLIMATE, lawsonClass, utciClass } from './engine/metrics.js';
import { COMBINATIONS, SITE_SELECTION_STEPS, POUH_SITE } from './engine/pouh.js';
import { nearbyBuildings } from './engine/model.js';
import { polygonArea } from './engine/geom.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (v, d = 1) => (v === undefined || v === null || Number.isNaN(v) ? '–' : Number(v).toFixed(d));
const FEATURE = Object.fromEntries(FEATURES.map((f) => [f.key, f]));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const state = {
  site: null,
  openSpaces: [],
  selectedOpen: new Set(),
  drawnZones: [],
  selectedBuildings: new Set(),
  prefs: { happy: 80 },
  results: null,
  variant: 1, // 0 = baseline
  heatKey: '',
  proofKey: 'happy',
  evidence: null,
  classified: null,
  model: null,
};

const viewer = new Viewer($('#viewer'));
// 3D background follows the page theme (light, dark, or the viewer's explicit choice).
function syncSceneTheme() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--scene').trim();
  if (c) viewer.scene.background.set(c);
}
syncSceneTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncSceneTheme);
new MutationObserver(syncSceneTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const setStatus = (t) => { $('#status').textContent = t; };

// ------------------------------------------------------------------ tabs
function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === name));
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ------------------------------------------------------------------ worker
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') {
    state.openSpaces = m.openSpaces;
    state.site.openSpaces = m.openSpaces;
    refreshSelection();
    setStatus(`${state.site.buildings.length} buildings · ${m.openSpaces.length} open spaces`);
  } else if (m.type === 'progress') {
    const p = m.gen / m.generations;
    $('#progress .bar').style.width = `${p * 100}%`;
    $('#progress span').textContent = `Generation ${m.gen}/${m.generations} · best fitness ${fmt(m.best)}`;
  } else if (m.type === 'result') {
    state.results = m;
    state.variant = 1;
    state.proofKey = Object.keys(state.prefs)[0];
    $('#run').disabled = false;
    $('#progress').hidden = true;
    setStatus(`${m.evaluations} designs evaluated in ${(m.ms / 1000).toFixed(1)} s`);
    showTab('results');
    renderResults();
    frameZones();
  } else if (m.type === 'calibrated') {
    state.model = m.model;
    $('#calibInfo').textContent = `Model re-trained with ${m.nSurvey} survey rows (weight ×5 over literature prior).`;
  } else if (m.type === 'error') {
    $('#run').disabled = false;
    $('#progress').hidden = true;
    setStatus(`Error: ${m.message}`);
    console.error(m.stack);
  }
};

// ------------------------------------------------------------------ site
async function loadDefault() {
  setStatus('Loading trial site…');
  const [site, model, rows, evidence, matrix, studySites] = await Promise.all([
    fetch('./data/site-manek-chowk.json').then((r) => r.json()),
    fetch('./models/gbt.json').then((r) => r.json()),
    fetch('./models/training-rows.json').then((r) => r.json()),
    fetch('./data/evidence.json').then((r) => r.json()).catch(() => null),
    fetch('./data/evidence-matrix.json').then((r) => r.json()).catch(() => null),
    fetch('./data/study-sites.json').then((r) => r.json()).catch(() => null),
  ]);
  state.model = model;
  state.trainingRows = rows.rows;
  state.evidence = evidence;
  state.matrix = matrix;
  state.studySites = studySites;
  setSite(site);
}

function setSite(site) {
  state.site = site;
  state.selectedOpen.clear();
  state.drawnZones = [];
  state.selectedBuildings.clear();
  state.results = null;
  viewer.setSite(site);
  const noon = sunPosition(CLIMATE.lat, CLIMATE.day, 15);
  viewer.setSunAngles((noon.alt * 180) / Math.PI, (noon.az * 180) / Math.PI);
  worker.postMessage({ type: 'init', site, model: state.model, trainingRows: state.trainingRows });
  $('#siteInfo').innerHTML = `<b>${esc(site.name)}</b><br><span class="muted small">${site.buildings.length} buildings · ${(site.roads || []).length} streets · ${(site.trees || []).length} trees${site.note ? `<br>${esc(site.note)}` : ''}</span>`;
  renderLegend();
  refreshSelection();
  $('#results').innerHTML = '<p class="hint">Run the generator to see variants and their proof.</p>';
}

$('#loadDefault').addEventListener('click', loadDefault);
$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setStatus(`Reading ${file.name}…`);
  try {
    const res = await importFile(file);
    if (res.site) { setSite(res.site); return; }
    state.classified = classifyObjects(res.objects);
    renderClassification(file.name, res.scale);
  } catch (err) {
    setStatus(`Import failed: ${err.message}`);
  }
  e.target.value = '';
});

const CLASS_COLOR = { ground: COLORS.ground, building: COLORS.building, road: COLORS.road, tree: COLORS.tree, water: COLORS.water, green: COLORS.lawn, furniture: COLORS.seat };
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

function renderClassification(name, scale) {
  const { items } = state.classified;
  $('#classifyBox').hidden = false;
  const counts = {};
  items.forEach((it) => { counts[it.cls] = (counts[it.cls] || 0) + 1; });
  $('#classSummary').innerHTML = CLASSES.filter((c) => counts[c]).map((c) => `<span class="chip"><span class="dot" style="background:${hex(CLASS_COLOR[c])}"></span>${c} ${counts[c]}</span>`).join('');
  $('#classList').innerHTML = items.slice(0, 400).map((it, i) => `
    <div class="item"><span>${esc(it.name)}</span>
      <select data-i="${i}">${CLASSES.map((c) => `<option ${c === it.cls ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <span class="why">${esc(it.reason)} · confidence ${Math.round(it.confidence * 100)} %</span></div>`).join('');
  $$('#classList select').forEach((s) => s.addEventListener('change', () => { items[+s.dataset.i].cls = s.value; }));
  setStatus(`${name}: ${items.length} objects classified${scale !== 1 ? ` (rescaled ×${scale})` : ''}`);
  // Preview immediately with the automatic classes.
  const site = siteFromClassified(state.classified, name);
  setSite(site);
  $('#classifyBox').hidden = false;
}
$('#applyClass').addEventListener('click', () => {
  if (!state.classified) return;
  setSite(siteFromClassified(state.classified, state.site?.name || 'Imported model'));
});

function renderLegend() {
  const items = [
    ['Building', COLORS.building], ['Active frontage', COLORS.buildingActive], ['Open for intervention', COLORS.buildingSelected],
    ['Candidate open space', COLORS.openSpace], ['Lawn / mound', COLORS.lawn], ['Steps / seating', COLORS.steps], ['Kiosk / cafe', COLORS.kiosk], ['Shaded corridor', COLORS.corridor],
  ];
  const open = window.matchMedia('(min-width: 821px)').matches ? 'open' : '';
  $('#legend').innerHTML = `<details ${open}><summary>Legend</summary><div class="chips">${items.map(([n, c]) => `<span class="chip"><span class="dot" style="background:${hex(c)}"></span>${n}</span>`).join('')}</div></details>`;
}

// ------------------------------------------------------------------ selection
const MODE_HINT = {
  orbit: 'Orbit: drag to rotate, scroll/pinch to zoom.',
  pick: 'Pick: tap green open spaces to select them; tap buildings to open them for intervention (the optimiser may raise, lower, activate or clear them).',
  draw: 'Draw: tap points on the ground to outline a zone; double-tap or “Finish zone” to close it.',
};
$$('.seg button').forEach((b) => b.addEventListener('click', () => {
  $$('.seg button').forEach((x) => x.classList.toggle('on', x === b));
  viewer.setMode(b.dataset.mode);
  $('#modeHint').textContent = MODE_HINT[b.dataset.mode];
  $('#finishZone').hidden = b.dataset.mode !== 'draw';
}));
$('#finishZone').addEventListener('click', () => viewer.finishDraft());
viewer.on('pickOpen', (i) => {
  if (viewer.mode !== 'pick') return;
  state.selectedOpen.has(i) ? state.selectedOpen.delete(i) : state.selectedOpen.add(i);
  refreshSelection();
});
viewer.on('pickBuilding', (i) => {
  if (viewer.mode !== 'pick') return;
  state.selectedBuildings.has(i) ? state.selectedBuildings.delete(i) : state.selectedBuildings.add(i);
  refreshSelection();
});
viewer.on('zoneDrawn', (poly) => {
  state.drawnZones.push({ id: `d${state.drawnZones.length}`, polygon: poly, area: polygonArea(poly) });
  refreshSelection();
});
$('#suggestBuildings').addEventListener('click', () => {
  for (const i of nearbyBuildings(state.site, zones(), 8)) state.selectedBuildings.add(i);
  refreshSelection();
});
$('#clearSel').addEventListener('click', () => {
  state.selectedOpen.clear(); state.drawnZones = []; state.selectedBuildings.clear();
  viewer.showDesign(null);
  refreshSelection();
});
$('#siteRules').innerHTML = SITE_SELECTION_STEPS.map((s) => `<li>${esc(s)}</li>`).join('');

function zones() {
  return [...[...state.selectedOpen].map((i) => state.openSpaces[i]), ...state.drawnZones].filter(Boolean).slice(0, 6);
}

// Engine takes up to 24 buildings: keep those closest to the zones.
function nearestFirst(ids, zs) {
  const cents = zs.map((z) => { const n = z.polygon.length; return [z.polygon.reduce((a, p) => a + p[0], 0) / n, z.polygon.reduce((a, p) => a + p[1], 0) / n]; });
  const d = (i) => {
    const [x, y] = state.site.buildings[i].footprint[0];
    return Math.min(...cents.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
  };
  return ids.map((i) => [i, d(i)]).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([i]) => i);
}

function frameZones() {
  const pts = zones().flatMap((z) => z.polygon);
  if (!pts.length) return;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const m = 45;
  viewer.frame({ minX: Math.min(...xs) - m, minY: Math.min(...ys) - m, maxX: Math.max(...xs) + m, maxY: Math.max(...ys) + m });
}

function refreshSelection() {
  if (!state.site) return;
  viewer.showOpenSpaces(state.openSpaces, state.selectedOpen);
  viewer.showZones(state.drawnZones);
  viewer.resetBuildingColors(state.selectedBuildings);
  const z = zones();
  const area = z.reduce((s, q) => s + (q.area || polygonArea(q.polygon)), 0);
  $('#selInfo').innerHTML = `<b>${z.length}</b> zone${z.length === 1 ? '' : 's'} · ${fmt(area, 0)} m² open ground<br>
    <b>${state.selectedBuildings.size}</b> building${state.selectedBuildings.size === 1 ? '' : 's'} open for intervention
    ${z.length > 6 ? '<br><span class="no">Only the first 6 zones are used.</span>' : ''}
    <p class="small muted">POUH combinations need 650–855 m² per intervention; small chowks grow by clearing the buildings you open around them.</p>`;
}

// ------------------------------------------------------------------ keywords
function renderKeywords() {
  $('#keywords').innerHTML = KEYWORD_KEYS.map((k) => {
    const d = KEYWORDS[k], on = state.prefs[k] !== undefined;
    return `<div class="kw ${on ? 'on' : ''}" data-k="${k}">
      <header><b>${esc(d.label)}</b><span class="val">${on ? `target ${state.prefs[k]}` : 'off'}</span></header>
      <div class="ctl"><p class="blurb">${esc(d.blurb)}</p>
        <input type="range" min="0" max="100" step="5" value="${state.prefs[k] ?? 70}" aria-label="${esc(d.label)} intensity" />
        <div class="small muted">${d.terms.map((t) => FEATURE[t.f].label).join(' · ')}</div></div></div>`;
  }).join('');
  $$('.kw').forEach((el) => {
    const k = el.dataset.k;
    el.querySelector('header').addEventListener('click', () => {
      if (state.prefs[k] !== undefined) delete state.prefs[k]; else state.prefs[k] = 70;
      renderKeywords();
    });
    el.querySelector('input').addEventListener('input', (ev) => {
      state.prefs[k] = +ev.target.value;
      el.querySelector('.val').textContent = `target ${state.prefs[k]}`;
    });
  });
}
for (const [k, c] of Object.entries(COMBINATIONS)) $('#combo').insertAdjacentHTML('beforeend', `<option value="${k}">${esc(c.label)}</option>`);

const EFFORT = { fast: { population: 12, generations: 8 }, normal: { population: 20, generations: 14 }, deep: { population: 30, generations: 24 } };
$('#run').addEventListener('click', () => {
  const z = zones();
  if (!z.length) { setStatus('Select at least one open space or draw a zone first (step 2).'); showTab('select'); return; }
  if (!Object.keys(state.prefs).length) { setStatus('Turn on at least one keyword.'); return; }
  $('#run').disabled = true;
  $('#progress').hidden = false;
  $('#progress .bar').style.width = '0';
  $('#progress span').textContent = 'Preparing…';
  setStatus('Generating…');
  worker.postMessage({
    type: 'optimize',
    zones: z.map((q) => ({ polygon: q.polygon, area: q.area })),
    buildings: nearestFirst([...state.selectedBuildings], z).slice(0, 24),
    prefs: { ...state.prefs },
    comboLock: $('#combo').value || null,
    seed: +$('#seed').value || 42,
    ...EFFORT[$('#effort').value],
  });
});

// Survey calibration (optional)
$('[data-pane="feel"]').insertAdjacentHTML('beforeend', `
  <details class="card"><summary>Calibrate with survey data (CSV)</summary>
    <p class="small muted">One row per surveyed spot: all ${FEATURES.length} feature columns (${FEATURES.map((f) => f.key).join(', ')}) plus any keyword columns (0–100 or 1–5/1–7 Likert). Rows are weighted ×5 against the literature prior and the tree models are re-trained on-device.</p>
    <label class="btn">Load CSV<input id="surveyInput" type="file" accept=".csv" hidden /></label>
    <p class="small" id="calibInfo"></p>
  </details>`);
$('#surveyInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $('#calibInfo').textContent = 'Training…';
  worker.postMessage({ type: 'calibrate', csv: await f.text() });
});

// ------------------------------------------------------------------ results
function current() {
  const r = state.results;
  return state.variant === 0 ? r.baseline : r.variants[state.variant - 1];
}

function renderResults() {
  const r = state.results;
  if (!r) return;
  const v = current();
  viewer.showDesign(state.variant === 0 ? null : v.design);
  viewer.resetBuildingColors(state.selectedBuildings, new Set((v.design.buildingEdits || []).filter((e) => e.demolish).map((e) => e.index)),
    Object.fromEntries((v.design.buildingEdits || []).map((e) => [e.index, e])));
  showHeat();

  const keys = Object.keys(state.prefs).filter((k) => r.baseline.scores[k]);
  const tabs = [['Existing', r.baseline], ...r.variants.map((x, i) => [`Variant ${String.fromCharCode(65 + i)}`, x])];
  const comp = v.compliance;
  $('#results').innerHTML = `
    <div class="variants">${tabs.map(([n, x], i) => `<button data-v="${i}" class="${i === state.variant ? 'on' : ''}"><b>${n}</b>${i ? esc(COMBINATIONS[x.design.combo]?.label || '') : 'baseline'}</button>`).join('')}</div>

    <h3>Keyword scores</h3>
    <p class="small muted">Grey = existing, green = this design, black tick = your target. Scores are tree-model predictions (0–100) from the quantitative parameters below.</p>
    ${keys.map((k) => scoreRow(k, r.baseline.scores[k].predicted, v.scores[k].predicted, state.prefs[k])).join('')}
    <details><summary class="small">All keywords</summary>${KEYWORD_KEYS.filter((k) => !keys.includes(k)).map((k) => scoreRow(k, r.baseline.scores[k].predicted, v.scores[k].predicted)).join('')}</details>

    ${comp && state.variant ? `<h3>POUH strategy compliance · ${fmt(comp.score * 100, 0)} %</h3>
      <p class="small muted">${esc(comp.label)} — bands from the portfolio (p. 30–32).</p>
      <table><tr><th>Parameter</th><th class="num">Value</th><th class="num">Band</th><th></th></tr>
      ${comp.rows.map((q) => `<tr><td>${esc(q.label)}</td><td class="num">${fmt(q.value, q.unit === '' ? 2 : 1)} ${q.unit}</td><td class="num">${q.band[0]}–${q.band[1]}</td><td class="${q.ok ? 'ok' : 'no'}">${q.ok ? '✓' : '✗'}</td></tr>`).join('')}</table>` : ''}

    <h3>Quantitative parameters</h3>
    <label class="field">Heat map on site
      <select id="heatSel"><option value="">None (show design)</option>${FEATURES.map((f) => `<option value="${f.key}" ${f.key === state.heatKey ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
    <table><tr><th>Parameter</th><th class="num">Existing</th><th class="num">Design</th><th class="num">Δ</th></tr>
      ${FEATURES.map((f) => {
        const a = r.baseline.agg[f.key], b = v.agg[f.key];
        return `<tr><td>${esc(f.label)} <span class="muted">${esc(f.unit)}</span></td><td class="num">${fmt(a, 2)}</td><td class="num">${fmt(b, 2)}</td><td class="num">${b - a > 0 ? '+' : ''}${fmt(b - a, 2)}</td></tr>`;
      }).join('')}</table>
    <p class="small muted">Comfort: ${lawsonClass(v.agg.wind)} (Lawson) · ${utciClass(v.agg.utci)} (UTCI est., 21 April, T<sub>a</sub> ${CLIMATE.airTemp} °C).</p>

    <h3>Proof</h3>
    <label class="field">Keyword
      <select id="proofSel">${KEYWORD_KEYS.map((k) => `<option value="${k}" ${k === state.proofKey ? 'selected' : ''}>${esc(KEYWORDS[k].label)}</option>`).join('')}</select></label>
    <div id="proof"></div>

    <h3>Export</h3>
    <div class="row"><button class="btn" id="exportJson">Report (.json)</button><button class="btn" id="exportCsv">Point metrics (.csv)</button><button class="btn" id="exportPng">View (.png)</button></div>`;

  $$('.variants button').forEach((b) => b.addEventListener('click', () => { state.variant = +b.dataset.v; renderResults(); }));
  $('#heatSel').addEventListener('change', (e) => { state.heatKey = e.target.value; showHeat(); });
  $('#proofSel').addEventListener('change', (e) => { state.proofKey = e.target.value; renderProof(); });
  $('#exportJson').addEventListener('click', exportJson);
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#exportPng').addEventListener('click', () => download('urbanlm-view.png', viewer.snapshot(), true));
  renderProof();
}

function scoreRow(k, base, des, target) {
  return `<div class="score"><span>${esc(KEYWORDS[k].label.split(' / ')[0])}</span>
    <div class="track"><div class="base" style="width:${base}%"></div><div class="des" style="width:${des}%"></div>${target !== undefined ? `<div class="tgt" style="left:${target}%"></div>` : ''}</div>
    <span class="num">${fmt(des, 0)}</span></div>`;
}

function showHeat() {
  const v = current();
  if (!state.heatKey) { viewer.clear('heat'); $('#heatbar').hidden = true; return; }
  const f = FEATURE[state.heatKey];
  const vals = v.points.map((p) => p.m[state.heatKey]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const range = hi - lo < 1e-6 ? f.range : [lo, hi];
  viewer.showHeat(v.points, state.heatKey, range);
  $('#heatbar').hidden = false;
  $('#heatbar').innerHTML = `${esc(f.label)} <span class="muted">${esc(f.unit)}</span><div class="ramp"></div><div class="ends"><span>${fmt(range[0], 2)}</span><span>${fmt(range[1], 2)}</span></div>`;
}

const FEATURE_QUERY = { isovistArea: 'f_isovist', openness: 'f_isovist', occlusions: 'f_isovist', jaggedness: 'f_isovist', roundness: 'f_isovist', isovistPct: 'f_isovist', svf: 'f_svf', gvi: 'f_gvi', utci: 'f_utci', shade: 'f_sun', sunHours: 'f_sun', wind: 'f_wind', enclosureHW: 'f_hw', activeFrontage: 'f_frontage', seating: 'f_seating', roadDist: 'f_sound' };

function renderProof() {
  const v = current();
  const k = state.proofKey;
  const p = v.proof?.[k];
  const base = state.results.baseline;
  const el = $('#proof');
  if (!p) {
    el.innerHTML = `<p class="small muted">Proof is computed for the keywords you selected. Select “${esc(KEYWORDS[k].label)}” in step 3 and run again.</p>`;
    return;
  }
  const maxC = Math.max(1, ...(p.model?.items || []).map((d) => Math.abs(d.contribution)));
  const ev = state.evidence;
  const refs = (ids) => (ids || []).slice(0, 5).map((id) => {
    const pp = ev?.papers?.[id];
    if (!pp) return '';
    const [t, y, doi, a] = pp;
    return `<li>${esc(a ? `${a.split(' ').slice(-1)[0]} ` : '')}(${y}) ${doi ? `<a href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t)}</li>`;
  }).join('');
  const topFeatures = [...new Set((p.model?.items || []).slice(0, 3).map((d) => FEATURE_QUERY[d.feature]).filter(Boolean))];
  el.innerHTML = `
    <p class="small">Predicted <b>${fmt(v.scores[k].predicted, 0)}</b> (existing ${fmt(base.scores[k].predicted, 0)}); literature-prior score ${fmt(v.scores[k].prior, 0)}. Model fit to prior: R² ${fmt(state.model?.keywords?.[k]?.r2, 3)}.</p>
    <h4>Why — tree-model attribution</h4>
    <p class="small muted">Contribution of each parameter to the score (Saabas path attribution; bars sum to prediction − ${fmt(p.model?.bias, 0)} baseline).</p>
    ${(p.model?.items || []).slice(0, 8).map((d) => `<div class="contrib"><span>${esc(FEATURE[d.feature].label)}</span><div class="axis"><div class="${d.contribution >= 0 ? 'pos' : 'neg'}" style="width:${(Math.abs(d.contribution) / maxC) * 50}%"></div></div><span class="num">${d.contribution >= 0 ? '+' : ''}${fmt(d.contribution, 1)}</span></div>`).join('')}
    <h4>Qualitative → quantitative rules</h4>
    <p class="small muted">Weight = curated weight × corpus factor. “Corpus” = papers (of ${state.matrix?.summary?.relevant ?? '–'} relevant) whose findings point the same way / the opposite way.</p>
    <table><tr><th>Parameter</th><th class="num">Value</th><th class="num">Target</th><th class="num">Fit</th><th class="num">Weight</th><th class="num">Corpus</th><th class="num">Study sites</th><th>Sources</th></tr>
    ${p.prior.map((t) => `<tr><td>${esc(FEATURE[t.feature].label)}${t.corpus?.added ? ' <sup class="tag">corpus</sup>' : ''}</td><td class="num">${fmt(t.value, 2)}</td><td class="num">${rangeText(t.target)}</td><td class="num ${t.membership > 0.7 ? 'ok' : t.membership < 0.3 ? 'no' : ''}">${fmt(t.membership * 100, 0)}%</td><td class="num">${fmt(t.weight * 100, 0)}%</td><td class="num ${t.corpus?.conflict ? 'no' : ''}">${t.corpus ? `${fmt(t.corpus.support, 0)}${t.corpus.against ? ` / ${t.corpus.against}` : ''}${t.corpus.conflict ? ' ⚠' : ''}` : '–'}</td>${siteCell(k, t.feature)}<td class="small">${t.sources.map((s) => `<span title="${esc(SOURCES[s] || s)}">${esc(s)}</span>`).join(', ')}</td></tr>`).join('')}</table>
    ${corpusSection(k)}
    ${ev ? `<h4>Evidence from the corpus (${ev.stats.papers} papers, TF-IDF + LSA)</h4>
      <ol class="refs">${refs(ev.evidence[k])}</ol>
      ${topFeatures.map((q) => `<p class="small muted">On ${esc(q.replace('f_', '').toUpperCase())}:</p><ol class="refs">${refs(ev.evidence[q]).split('</li>').slice(0, 3).join('</li>')}</ol>`).join('')}` : ''}`;
}

// Physical condition measured with this engine at geolocated study sites of
// papers on this keyword (OSM geometry, completeness-graded).
function siteCell(k, f) {
  const t = state.studySites?.check?.[k]?.terms?.find((x) => x.f === f);
  if (!t) return '<td class="num muted">–</td>';
  const m = t.measured;
  return `<td class="num" title="${m.n} study sites · p25–p75 ${fmt(m.p25, 2)}–${fmt(m.p75, 2)} · ${fmt(t.insideCore * 100, 0)}% inside the full-score range">${fmt(m.median, 2)}<div class="small muted">${fmt(m.p25, 1)}–${fmt(m.p75, 1)} · n ${m.n}</div></td>`;
}

// What the mined corpus says about a keyword, including parameters the
// engine cannot compute yet (roadmap for new metrics).
const PARAM_LABEL = (p) => p.replace(/^other:/, '').replace(/_/g, ' ');
function corpusSection(k) {
  const m = state.matrix;
  const rows = m?.keywords?.[k];
  if (!rows?.length) return '';
  const cite = (id) => {
    const pp = m.papers[id];
    if (!pp) return '';
    const [t, y, doi, a] = pp;
    const label = `${a ? a.split(' ').slice(-1)[0] + ' ' : ''}${y ?? ''}`;
    return doi ? `<a href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener" title="${esc(t)}">${esc(label)}</a>` : `<span title="${esc(t)}">${esc(label)}</span>`;
  };
  return `<h4>What the ${m.summary.papers} papers say about “${esc(KEYWORDS[k].label)}”</h4>
    <p class="small muted">LLM-extracted findings from ${m.summary.relevant} relevant abstracts (${m.summary.findings} findings). + / − / ∿ = papers finding a positive, negative or nonlinear effect. Grey rows are not measured by the engine yet.</p>
    <table><tr><th>Parameter</th><th class="num">+</th><th class="num">−</th><th class="num">∿</th><th>Papers</th></tr>
    ${rows.slice(0, 12).map((r) => `<tr class="${r.engine ? '' : 'muted'}"><td>${esc(PARAM_LABEL(r.p))}${r.engine ? '' : ' <span class="small">(not measured yet)</span>'}${r.q?.[0] ? `<div class="small muted">“${esc(r.q[0].q)}”</div>` : ''}</td><td class="num">${r.pos}</td><td class="num">${r.neg}</td><td class="num">${r.nl}</td><td class="small">${r.papers.slice(0, 3).map(cite).join(', ')}</td></tr>`).join('')}</table>`;
}

function rangeText([a, b, c, d]) {
  const n = (x) => (Math.abs(x) >= 1e8 ? '∞' : fmt(x, x < 10 ? 2 : 0));
  if (a <= -1e8) return `≤ ${n(c)}`;
  if (d >= 1e8) return `≥ ${n(b)}`;
  return `${n(b)}–${n(c)}`;
}

function download(name, data, isUrl = false) {
  const a = document.createElement('a');
  a.href = isUrl ? data : URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  a.download = name;
  a.click();
}

function exportJson() {
  const r = state.results;
  const report = {
    generator: 'UrbanLM Lite 0.1 (POUH)',
    site: state.site.name,
    climate: CLIMATE,
    prefs: state.prefs,
    zones: zones().map((z) => z.polygon),
    buildingsOpened: [...state.selectedBuildings],
    baseline: { agg: r.baseline.agg, scores: r.baseline.scores },
    variants: r.variants.map((v) => ({ combo: v.design.combo, fitness: v.fitness, genome: v.genome, agg: v.agg, scores: v.scores, compliance: v.compliance, proof: v.proof, design: v.design })),
    pouhSite: POUH_SITE,
  };
  download('urbanlm-report.json', JSON.stringify(report, null, 2));
}

function exportCsv() {
  const v = current();
  const head = ['x', 'y', ...FEATURES.map((f) => f.key)];
  const rows = v.points.map((p) => [fmt(p.x, 1), fmt(p.y, 1), ...FEATURES.map((f) => fmt(p.m[f.key], 3))].join(','));
  download('urbanlm-points.csv', [head.join(','), ...rows].join('\n'));
}

renderKeywords();
loadDefault().catch((err) => setStatus(`Could not load trial site: ${err.message}`));

// Debug / automation handle (used by the end-to-end test).
window.__urbanlm = { state, viewer, refreshSelection, zones };
