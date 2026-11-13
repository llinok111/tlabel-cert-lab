// Continuous-time screen-space label visibility certificate.
// Pure ES module: no three.js, no DOM, no I/O, no environment access.
//
// Model: every label and occluder moves linearly in the screen plane.
// A label box is w x h centred at p + v*t. Two boxes overlap when their
// open interiors intersect on both axes. Each axis inequality is linear in t,
// so the exact set of overlapping instants is a single open interval, with no
// sampling and no tolerance constants.

/** Centre of an object with {p:[x,y], v:[vx,vy]} at time t. */
export function centerAt(obj, t) {
  return [obj.p[0] + obj.v[0] * t, obj.p[1] + obj.v[1] * t];
}

// One linear inequality |d0 + dv*t| < halfWidth. Returns an open interval.
function oneAxis(d0, dv, halfWidth) {
  if (dv === 0) return Math.abs(d0) < halfWidth ? [-Infinity, Infinity] : null;
  let lo = (-halfWidth - d0) / dv;
  let hi = (halfWidth - d0) / dv;
  if (lo > hi) [lo, hi] = [hi, lo];
  return [lo, hi];
}

/** Exact open time interval where two moving boxes overlap, clipped to [t0,t1]. */
export function overlapInterval(a, b, t0 = 0, t1 = Infinity) {
  const x = oneAxis(b.p[0] - a.p[0], b.v[0] - a.v[0], (a.s[0] + b.s[0]) / 2);
  if (!x) return null;
  const y = oneAxis(b.p[1] - a.p[1], b.v[1] - a.v[1], (a.s[1] + b.s[1]) / 2);
  if (!y) return null;
  const lo = Math.max(x[0], y[0], t0);
  const hi = Math.min(x[1], y[1], t1);
  return lo < hi ? [lo, hi] : null;
}

/** Boolean form of overlapInterval, used by the renderer and by tests. */
export function overlapAt(a, b, t) {
  const ax = Math.abs(b.p[0] + b.v[0] * t - (a.p[0] + a.v[0] * t));
  const ay = Math.abs(b.p[1] + b.v[1] * t - (a.p[1] + a.v[1] * t));
  return ax < (a.s[0] + b.s[0]) / 2 && ay < (a.s[1] + b.s[1]) / 2;
}

// One coordinate inside [lo,hi] for all t: centre = p + v*t.
function linearBand(p, v, lo, hi) {
  if (lo > hi) return null;
  if (v === 0) return p >= lo && p <= hi ? [-Infinity, Infinity] : null;
  let a = (lo - p) / v;
  let b = (hi - p) / v;
  if (a > b) [a, b] = [b, a];
  return [a, b];
}

export function unionIntervals(list, t0 = -Infinity, t1 = Infinity) {
  const clamped = [];
  for (const iv of list) {
    if (!iv) continue;
    const lo = Math.max(iv[0], t0);
    const hi = Math.min(iv[1], t1);
    if (lo < hi) clamped.push([lo, hi]);
  }
  clamped.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const iv of clamped) {
    if (!out.length || iv[0] > out[out.length - 1][1]) out.push([iv[0], iv[1]]);
    else if (iv[1] > out[out.length - 1][1]) out[out.length - 1][1] = iv[1];
  }
  return out;
}

export function intersectSets(a, b) {
  const out = [];
  for (const [alo, ahi] of a) {
    for (const [blo, bhi] of b) {
      const lo = Math.max(alo, blo);
      const hi = Math.min(ahi, bhi);
      if (lo < hi) out.push([lo, hi]);
    }
  }
  return unionIntervals(out);
}

export function subtractIntervals(a, b) {
  const out = [];
  for (const [alo, ahi] of a) {
    let pieces = [[alo, ahi]];
    for (const [blo, bhi] of b) {
      const next = [];
      for (const [lo, hi] of pieces) {
        if (bhi <= lo || blo >= hi) { next.push([lo, hi]); continue; }
        if (blo > lo) next.push([lo, Math.min(hi, blo)]);
        if (bhi < hi) next.push([Math.max(lo, bhi), hi]);
      }
      pieces = next;
    }
    out.push(...pieces);
  }
  return unionIntervals(out);
}

function viewportBand(label, vp) {
  const x = linearBand(label.p[0], label.v[0], vp.xmin + label.s[0] / 2, vp.xmax - label.s[0] / 2);
  const y = linearBand(label.p[1], label.v[1], vp.ymin + label.s[1] / 2, vp.ymax - label.s[1] / 2);
  if (!x || !y) return [];
  return intersectSets([x], [y]);
}

/** All intervals where the label lies fully inside the viewport, minus occluders. */
export function visibleIntervals(label, scene) {
  let out = intersectSets(viewportBand(label, scene.viewport), [[0, scene.T]]);
  for (const occ of scene.occluders) {
    const iv = overlapInterval(label, occ, 0, scene.T);
    if (iv) out = subtractIntervals(out, [iv]);
  }
  return unionIntervals(out, 0, scene.T);
}

/** Exact maximum clique (Bron-Kerbosch with pivot); graphs here have <= 20 nodes. */
function maxClique(adj) {
  const n = adj.length;
  let best = [];
  const expand = (R, P, X) => {
    if (!P.length && !X.length) {
      if (R.length > best.length) best = R.slice();
      return;
    }
    const union = P.concat(X);
    let pivot = union[0], bestCount = -1;
    for (const u of union) {
      let count = 0;
      for (const v of P) if (adj[u].has(v)) count++;
      if (count > bestCount) { bestCount = count; pivot = u; }
    }
    const candidates = P.filter((v) => !adj[pivot].has(v));
    for (const v of candidates) {
      const nextP = P.filter((w) => adj[v].has(w));
      const nextX = X.filter((w) => adj[v].has(w));
      expand(R.concat(v), nextP, nextX);
      P = P.filter((w) => w !== v);
      X = X.concat(v);
    }
  };
  expand([], Array.from({ length: n }, (_, i) => i), []);
  return best;
}

/** Deterministic DSATUR colouring; optimal whenever it meets the clique bound. */
function dsatur(adj) {
  const n = adj.length;
  const colors = new Array(n).fill(-1);
  for (let step = 0; step < n; step++) {
    let pick = -1, bestSat = -1, bestDeg = -1;
    for (let v = 0; v < n; v++) {
      if (colors[v] !== -1) continue;
      const sat = new Set();
      for (const u of adj[v]) if (colors[u] !== -1) sat.add(colors[u]);
      const deg = adj[v].size;
      if (sat.size > bestSat || (sat.size === bestSat && (deg > bestDeg || (deg === bestDeg && v < pick)))) {
        pick = v; bestSat = sat.size; bestDeg = deg;
      }
    }
    const used = new Set();
    for (const u of adj[pick]) if (colors[u] !== -1) used.add(colors[u]);
    let c = 0;
    while (used.has(c)) c++;
    colors[pick] = c;
  }
  return colors;
}

/**
 * Solve one scene exactly over its whole clip.
 * visible  : intervals where the label is inside the viewport and not covered.
 * collisions: intervals where two visible labels' boxes overlap.
 * lanes    : colouring of the collision graph; same-lane labels never collide.
 */
export function solveScene(scene) {
  const T = scene.T;
  const labels = scene.labels;
  const visible = labels.map((l) => visibleIntervals(l, scene));
  const overlaps = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const iv = overlapInterval(labels[i], labels[j], 0, T);
      if (iv) overlaps.push({ a: labels[i].id, b: labels[j].id, lo: iv[0], hi: iv[1] });
    }
  }

  // A lane conflict needs both labels visible AND their boxes overlapping
  // at the same instant. Pair overlap is one interval; visible sets are unions.
  const adj = labels.map(() => new Set());
  const collisions = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const iv = overlapInterval(labels[i], labels[j], 0, T);
      if (!iv) continue;
      const both = intersectSets(intersectSets([iv], visible[i]), visible[j]);
      if (!both.length) continue;
      adj[i].add(j); adj[j].add(i);
      for (const [lo, hi] of both) {
        collisions.push({ a: labels[i].id, b: labels[j].id, lo, hi });
      }
    }
  }

  const clique = maxClique(adj);
  const laneOf = dsatur(adj);
  const lanes = laneOf.length ? Math.max(...laneOf) + 1 : 0;

  const pieces = [];
  for (let i = 0; i < labels.length; i++) {
    for (const [lo, hi] of visible[i]) {
      pieces.push({ label: labels[i].id, lane: laneOf[i], lo, hi });
    }
  }
  const flat = [];
  for (const ivs of visible) for (const [lo, hi] of ivs) flat.push([lo, 1], [hi, -1]);
  flat.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let depth = 0, maxSimultaneousVisible = 0;
  for (const [, d] of flat) { depth += d; if (depth > maxSimultaneousVisible) maxSimultaneousVisible = depth; }

  return {
    name: scene.name,
    T,
    labels: labels.map((l, i) => ({ id: l.id, priority: l.priority, visible: visible[i], lane: laneOf[i] })),
    overlaps,
    collisions,
    pieces,
    lanes,
    maxClique: clique.length,
    clique,
    maxSimultaneousVisible,
    laneOptimal: lanes === clique.length,
  };
}

/** Status of every label at one instant, derived from the exact certificate. */
export function statusAt(solved, scene, t) {
  const vp = scene.viewport;
  const out = [];
  for (const lab of scene.labels) {
    const x = lab.p[0] + lab.v[0] * t;
    const y = lab.p[1] + lab.v[1] * t;
    const inside = x >= vp.xmin + lab.s[0] / 2 && x <= vp.xmax - lab.s[0] / 2 &&
      y >= vp.ymin + lab.s[1] / 2 && y <= vp.ymax - lab.s[1] / 2;
    const covered = scene.occluders.some((o) => overlapAt(lab, o, t));
    const rec = solved.labels.find((l) => l.id === lab.id);
    const vis = rec.visible.some(([lo, hi]) => lo < t && t < hi);
    const status = !inside || !vis ? "out" : covered ? "occluded" : "visible";
    out.push({ id: lab.id, status, lane: vis ? rec.lane : -1, x, y });
  }
  return out;
}

/** Uniformly scale every spatial quantity. Time stays unchanged. */
export function scaleScene(scene, s) {
  const scaleObj = (o) => ({
    ...o,
    p: [o.p[0] * s, o.p[1] * s],
    v: [o.v[0] * s, o.v[1] * s],
    s: [o.s[0] * s, o.s[1] * s],
  });
  return {
    ...scene,
    viewport: {
      xmin: scene.viewport.xmin * s, xmax: scene.viewport.xmax * s,
      ymin: scene.viewport.ymin * s, ymax: scene.viewport.ymax * s,
    },
    labels: scene.labels.map(scaleObj),
    occluders: scene.occluders.map(scaleObj),
  };
}