// Baseline: fixed-step (60 Hz) sampling of the same box predicate.
// It knows nothing about the exact interval solver; it only answers
// "does this pair overlap at frame k / 60?".
import { overlapAt } from "../src/core.mjs";

/** Per-pair runs of consecutive sampled overlap frames. */
export function scan(scene, fps = 60) {
  const dt = 1 / fps;
  const n = Math.floor(scene.T * fps);
  const hits = new Map();
  for (let k = 0; k <= n; k++) {
    const t = k * dt;
    const labels = scene.labels;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        if (!overlapAt(labels[i], labels[j], t)) continue;
        const key = `${labels[i].id}|${labels[j].id}`;
        if (!hits.has(key)) hits.set(key, []);
        hits.get(key).push(t);
      }
    }
  }
  let runs = 0;
  for (const times of hits.values()) {
    for (let k = 0; k < times.length; k++) {
      if (k === 0 || times[k] - times[k - 1] > dt * 1.5) runs++;
    }
  }
  return { pairs: hits.size, runs, samples: n + 1, gridStep: dt };
}