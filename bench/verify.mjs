// Independent checks for the continuous-time label certificate.
// The oracle below deliberately does NOT call the core geometry functions:
// it re-derives visibility and overlap with plain comparisons at sample times.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { solveScene, scaleScene } from "../src/core.mjs";
import { scan } from "../baseline/sampled.mjs";

const data = JSON.parse(readFileSync(new URL("../data/scenes.json", import.meta.url)));
const N = 30000;

function oc(o, t) { return [o.p[0] + o.v[0] * t, o.p[1] + o.v[1] * t]; }
function oracleOverlap(a, b, t) {
  const ca = oc(a, t), cb = oc(b, t);
  return Math.abs(ca[0] - cb[0]) < (a.s[0] + b.s[0]) / 2 &&
         Math.abs(ca[1] - cb[1]) < (a.s[1] + b.s[1]) / 2;
}
function oracleInside(lab, vp, t) {
  const c = oc(lab, t);
  return c[0] >= vp.xmin + lab.s[0] / 2 && c[0] <= vp.xmax - lab.s[0] / 2 &&
         c[1] >= vp.ymin + lab.s[1] / 2 && c[1] <= vp.ymax - lab.s[1] / 2;
}
function oracleVisible(scene, lab, t) {
  return oracleInside(lab, scene.viewport, t) && !scene.occluders.some((o) => oracleOverlap(lab, o, t));
}
function inSet(set, t) {
  return set.some(([lo, hi]) => lo <= t && t <= hi);
}
function key(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

let grand = { scenes: 0, overlaps: 0, collisions: 0, oracleOverlapSamples: 0, oracleVisibleHits: 0, missed60: 0, lanesOk: 0, cliqueOk: 0 };
const scaleFactors = [1e-6, 1e-3, 1, 1e3, 1e6];
let scaleDrift = 0;

for (const scene of data.scenes) {
  const solved = solveScene(scene);
  grand.scenes++;
  grand.overlaps += solved.overlaps.length;
  grand.collisions += solved.collisions.length;

  // 1. Every reported collision interval is real at its midpoint.
  for (const c of solved.collisions) {
    const t = (c.lo + c.hi) / 2;
    assert.ok(c.lo < c.hi, `${scene.name}: empty collision interval`);
    const la = scene.labels.find((l) => l.id === c.a);
    const lb = scene.labels.find((l) => l.id === c.b);
    assert.ok(oracleOverlap(la, lb, t), `${scene.name}: collision midpoint not overlapping ${c.a}/${c.b}@${t}`);
    assert.ok(oracleVisible(scene, la, t) && oracleVisible(scene, lb, t),
      `${scene.name}: collision midpoint not visible ${c.a}/${c.b}@${t}`);
  }

  // 2. Every visible interval midpoint is really visible (no occlusion/viewport false positive).
  for (const rec of solved.labels) {
    const lab = scene.labels.find((l) => l.id === rec.id);
    for (const [lo, hi] of rec.visible) {
      const t = (lo + hi) / 2;
      assert.ok(oracleVisible(scene, lab, t), `${scene.name}: visible midpoint failed oracle ${rec.id}@${t}`);
    }
  }

  // 3. Dense independent oracle sweep: no collision instant may be missed.
  const colByPair = new Map();
  for (const c of solved.collisions) {
    const k = key(c.a, c.b);
    if (!colByPair.has(k)) colByPair.set(k, []);
    colByPair.get(k).push([c.lo, c.hi]);
  }
  let missed = 0;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * scene.T / N;
    const Vis = scene.labels.map((l) => oracleVisible(scene, l, t));
    for (let a = 0; a < scene.labels.length; a++) {
      if (!Vis[a]) continue;
      for (let b = a + 1; b < scene.labels.length; b++) {
        if (!Vis[b]) continue;
        if (!oracleOverlap(scene.labels[a], scene.labels[b], t)) continue;
        grand.oracleOverlapSamples++;
        const set = colByPair.get(key(scene.labels[a].id, scene.labels[b].id));
        if (!set || !inSet(set, t)) missed++;
      }
    }
  }
  assert.equal(missed, 0, `${scene.name}: oracle found ${missed} collision instants the interval solver missed`);
  grand.lanesOk += solved.laneOptimal ? 1 : 0;
  grand.cliqueOk += solved.lanes === solved.maxClique ? 1 : 0;

  // 4. 60 Hz baseline: count exact intervals with no frame inside them.
  const base = scan(scene, 60);
  let missed60 = 0;
  for (const iv of solved.overlaps) {
    let hit = false;
    for (let k = 0; k <= Math.floor(scene.T * 60); k++) {
      const t = k / 60;
      if (iv.lo < t && t < iv.hi) { hit = true; break; }
    }
    if (!hit) missed60++;
  }
  grand.missed60 += missed60;

  // 5. Lane assignment: proper colouring and meets the exact clique lower bound.
  for (const c of solved.collisions) {
    const la = solved.labels.find((l) => l.id === c.a);
    const lb = solved.labels.find((l) => l.id === c.b);
    assert.notEqual(la.lane, lb.lane, `${scene.name}: same-lane collision ${c.a}/${c.b}`);
  }
  assert.equal(solved.lanes, solved.maxClique, `${scene.name}: DSATUR ${solved.lanes} != clique ${solved.maxClique}`);
  for (let i = 0; i < solved.clique.length; i++) {
    for (let j = i + 1; j < solved.clique.length; j++) {
      const ca = scene.labels[solved.clique[i]].id, cb = scene.labels[solved.clique[j]].id;
      assert.ok(colByPair.has(key(ca, cb)), `${scene.name}: clique pair ${ca}/${cb} has no collision`);
    }
  }

  console.log(`PASS ${scene.name}: labels=${scene.labels.length} overlaps=${solved.overlaps.length} collisions=${solved.collisions.length} lanes=${solved.lanes} clique=${solved.maxClique} 60HzRuns=${base.runs} 60HzMissed=${missed60} oracleCollisionSamples=${grand.oracleOverlapSamples}`);

  // 6. Scale invariance: same combinatorial certificate, endpoints scale exactly.
  const baseSig = solved.labels.map((l) => ({ id: l.id, lane: l.lane, n: l.visible.length, iv: l.visible }))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const s of scaleFactors) {
    if (s === 1) continue;
    const scaled = solveScene(scaleScene(scene, s));
    assert.equal(scaled.lanes, solved.lanes, `${scene.name}: lane count drifted at scale ${s}`);
    assert.equal(scaled.collisions.length, solved.collisions.length, `${scene.name}: collision count drifted at scale ${s}`);
    const sig = scaled.labels.map((l) => ({ id: l.id, lane: l.lane, n: l.visible.length, iv: l.visible }))
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.equal(sig.length, baseSig.length);
    for (let i = 0; i < sig.length; i++) {
      assert.equal(sig[i].id, baseSig[i].id);
      assert.equal(sig[i].lane, baseSig[i].lane);
      assert.equal(sig[i].n, baseSig[i].n);
      for (let k = 0; k < sig[i].n; k++) {
        for (let d = 0; d < 2; d++) {
          const want = baseSig[i].iv[k][d];
          const got = sig[i].iv[k][d];
          const drift = Math.abs(got - want) / Math.max(1, Math.abs(want));
          if (drift > scaleDrift) scaleDrift = drift;
        }
      }
    }
  }
}

assert.equal(grand.scenes, 6, "expected 6 scenes");
assert.ok(grand.overlaps > 100, "expected >100 exact overlap intervals");
assert.ok(grand.missed60 >= 20, `expected >=20 sub-frame intervals missed by 60 Hz, got ${grand.missed60}`);
assert.equal(grand.lanesOk, 6, "every scene must reach the clique lower bound");
assert.ok(scaleDrift < 1e-9, `scale drift ${scaleDrift} >= 1e-9`);
console.log(`PASS scale: factors=${scaleFactors.join(",")} maxNormalizedDrift=${scaleDrift.toExponential(3)} lanesStable=6/6`);
console.log(`PASS oracle: 6 scenes x ${N} samples, collisionInstants=${grand.oracleOverlapSamples}, missed=0`);
console.log(`PASS subframe: exactOverlaps=${grand.overlaps}, 60HzMissed=${grand.missed60}, 60HzDetected=${grand.overlaps - grand.missed60}`);
console.log(`PASS lanes: optimal=6/6, totalCollisions=${grand.collisions}`);
console.log("RESULT PASS failures=0");