// Timing and measured summary. Warmup + 9 samples, cold start recorded separately.
import { readFileSync, writeFileSync } from "node:fs";
import { solveScene, scaleScene } from "../src/core.mjs";
import { scan } from "../baseline/sampled.mjs";

const data = JSON.parse(readFileSync(new URL("../data/scenes.json", import.meta.url)));

function runAll() {
  const out = [];
  for (const s of data.scenes) out.push(solveScene(s));
  return out;
}
function stats(xs) {
  const sorted = xs.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const p95 = sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  const stddev = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { min: +sorted[0].toFixed(4), median: +median.toFixed(4), p95: +p95.toFixed(4), stddev: +stddev.toFixed(4) };
}

const coldStart = (() => {
  const t0 = performance.now();
  runAll();
  return +(performance.now() - t0).toFixed(4);
})();

for (let i = 0; i < 2; i++) runAll();

const SAMPLES = 11;
const REPEAT = 200;
const solves = [];
for (let s = 0; s < SAMPLES; s++) {
  const t0 = performance.now();
  for (let r = 0; r < REPEAT; r++) runAll();
  solves.push((performance.now() - t0) / REPEAT);
}

const scans = [];
const scanRepeats = 20;
for (let s = 0; s < SAMPLES; s++) {
  const t0 = performance.now();
  for (let r = 0; r < scanRepeats; r++) for (const scene of data.scenes) scan(scene, 60);
  scans.push((performance.now() - t0) / scanRepeats);
}

const solved = runAll();
let exactIntervals = 0, missed60 = 0, baseRuns = 0;
for (let i = 0; i < data.scenes.length; i++) {
  const scene = data.scenes[i];
  exactIntervals += solved[i].overlaps.length;
  const base = scan(scene, 60);
  baseRuns += base.runs;
  for (const iv of solved[i].overlaps) {
    let hit = false;
    for (let k = 0; k <= Math.floor(scene.T * 60); k++) {
      const t = k / 60;
      if (iv.lo < t && t < iv.hi) { hit = true; break; }
    }
    if (!hit) missed60++;
  }
}

const lanes = solved.map((s) => ({
  name: s.name, lanes: s.lanes, clique: s.maxClique, optimal: s.laneOptimal,
  collisions: s.collisions.length, maxSimultaneousVisible: s.maxSimultaneousVisible,
}));

const factors = [1e-6, 1e-3, 1e3, 1e6];
let scaleDrift = 0, scaleMismatch = 0;
for (const scene of data.scenes) {
  const base = solveScene(scene);
  for (const f of factors) {
    const sc = solveScene(scaleScene(scene, f));
    if (sc.lanes !== base.lanes || sc.collisions.length !== base.collisions.length) scaleMismatch++;
    for (let i = 0; i < base.labels.length; i++) {
      const A = base.labels[i].visible, B = sc.labels.find((l) => l.id === base.labels[i].id).visible;
      if (A.length !== B.length) { scaleMismatch++; continue; }
      for (let k = 0; k < A.length; k++) for (let d = 0; d < 2; d++) {
        const drift = Math.abs(B[k][d] - A[k][d]) / Math.max(1, Math.abs(A[k][d]));
        if (drift > scaleDrift) scaleDrift = drift;
      }
    }
  }
}

const solveStats = stats(solves);
const scanStats = stats(scans);
const result = {
  generated_by: "bench/bench.mjs",
  samples: SAMPLES,
  repeat_per_sample: REPEAT,
  scenes: data.scenes.length,
  labels: data.scenes.reduce((n, s) => n + s.labels.length, 0),
  exact_overlap_intervals: exactIntervals,
  collisions: solved.reduce((n, s) => n + s.collisions.length, 0),
  subframe_60hz: {
    fps: 60,
    exact_intervals: exactIntervals,
    detected: exactIntervals - missed60,
    missed: missed60,
    miss_rate: +(missed60 / exactIntervals).toFixed(4),
    baseline_runs: baseRuns,
  },
  lanes,
  all_lane_optimal: lanes.every((l) => l.optimal),
  scale: {
    factors: [1e-6, 1e-3, 1, 1e3, 1e6],
    max_normalized_interval_drift: +scaleDrift.toExponential(6),
    mismatches: scaleMismatch,
  },
  perf_ms: {
    cold_start: coldStart,
    solve_all_scenes: solveStats,
    baseline_scan_all_scenes_60hz: scanStats,
    speedup_vs_60hz_scan: +(scanStats.median / solveStats.median).toFixed(2),
  },
};
writeFileSync(new URL("./result.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));