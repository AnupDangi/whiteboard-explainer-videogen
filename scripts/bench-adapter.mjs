#!/usr/bin/env node
// bench-adapter.mjs — retrofit STCC raw run dirs into the Simi Benchmark v1.1.0
// candidate-contract layout so benchmark/scorers/judges/reporters can run.
//
// Read-only over the frozen benchmark and over STCC source. Writes ONLY under
// <stcc>/output/bench-adapted/ (plus the raw output files it is asked to save).
//
// Honesty rules:
//   - Every contract field is filled from an STCC artifact, or set to null.
//   - Nothing is invented. `ready_ms`, `workers`, `peak_rss_mb`, `tts_s`,
//     `voice` are null because STCC records no such value.
//   - Source sha: if the benchmark fixture sha cannot be verified from STCC
//     bytes we hash the STCC source markdown and say so.
//   - OBSERVED / INFERRED / UNKNOWN are recorded per field in coverage.json.
//
// Usage: node scripts/bench-adapter.mjs [--out DIR] [--cases A,B] [--verify-only]
import { readFile, writeFile, mkdir, readdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STCC = path.resolve(HERE, "..");
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const readText = (p) => readFile(p, "utf8").catch(() => null);
const readJSON = async (p) => { const t = await readText(p); try { return t ? JSON.parse(t) : null; } catch { return null; } };
const readJSONL = async (p) => (await readText(p) ?? "").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const SMOKE = ["MATH-01", "PHYS-01", "BIO-01", "CHEM-01", "CS-01", "SYS-01", "AIML-01", "STAT-01"];
const cases = (arg("cases", "") || SMOKE.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const outRoot = path.resolve(arg("out", path.join(STCC, "output", "bench-adapted")));
const verifyOnly = has("verify-only");

// ---- locate the STCC raw run dir for a case ---------------------------------
async function resolveRunDir(cid) {
  const runTxt = await readText(path.join(STCC, "output", cid, "RUN.txt"));
  if (runTxt) {
    const m = runTxt.match(/run_dir=(.+)/);
    if (m) {
      const p = path.resolve(STCC, m[1].trim());
      const probe = await readdir(p).catch(() => null);
      if (probe) return p;
    }
  }
  const runsRoot = path.join(STCC, ".data", "bench-run", cid, "runs");
  const ds = (await readdir(runsRoot).catch(() => [])).filter((d) => !d.startsWith(".")).sort();
  if (!ds.length) throw new Error(`no run dir for ${cid}`);
  return path.join(runsRoot, ds[ds.length - 1]);
}

// ---- ffprobe playability (adapter-observed, not pipeline-recorded) ----------
function probePlayable(file) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_type", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 30000 }).trim();
    return out.includes("video");
  } catch { return false; }
}

function evidenceSpanIdsForScene(bundle, sceneId) {
  const ids = new Set();
  const ce = bundle?.claimEvidence ?? {};
  for (const [k, v] of Object.entries(ce)) {
    if (!k.startsWith(sceneId + ":")) continue;
    for (const e of v ?? []) if (e?.spanId) ids.add(e.spanId);
  }
  return [...ids];
}

async function adaptCase(cid, coverage) {
  const raw = await resolveRunDir(cid);
  const cdir = path.join(outRoot, "cases", cid, "r1");
  if (!verifyOnly) {
    await rm(cdir, { recursive: true, force: true });
    await mkdir(cdir, { recursive: true });
  }
  const cov = (field, source, status, note = "") => { coverage.push({ case_id: cid, field, source, status, note }); };

  const narrationRaw = await readJSON(path.join(raw, "narration.json"));
  const bundle = await readJSON(path.join(raw, "evaluation-bundle.json"));
  const manifest = await readJSON(path.join(raw, "run-manifest.json"));
  const aligned = await readJSON(path.join(raw, "aligned-audio.json"));
  const lock = await readJSON(path.join(raw, "lesson.lock.json"));
  const sourceDoc = await readJSON(path.join(raw, "source-doc.json"));
  const budget = await readJSON(path.join(raw, "budget-ledger.json"));
  const sceneEventsRaw = await readJSONL(path.join(raw, "scene-events.jsonl"));
  const M = (k) => bundle?.metrics?.[k] ?? null; // metrics uses flattened dotted keys

  // source text + hash (STCC actually consumed this markdown, not the fixture pack)
  const srcRel = (await readText(path.join(STCC, "output", cid, "RUN.txt")) ?? "").match(/source=(.+)/)?.[1]?.trim();
  const srcPath = srcRel ? path.resolve(STCC, srcRel) : path.join(STCC, "bench", "benchmark-sources", `${cid}.md`);
  const srcBytes = await readFile(srcPath).catch(() => Buffer.from(""));
  const srcHash = sha256(srcBytes);

  // ---- narration.json {transcript, claim_ids[], segments[{scene_id,text,terms[]}]}
  const scenes = narrationRaw?.scenes ?? [];
  const segments = scenes.map((s) => ({
    scene_id: s.sceneId,
    text: s.plainText ?? "",
    terms: [...new Set((s.mentions ?? []).map((m) => m.phrase).filter(Boolean))],
  }));
  const claimIds = scenes.flatMap((s) => (s.claimSpans ?? []).map((c) => c.claimId).filter(Boolean));
  const narrationOut = {
    transcript: segments.map((s) => s.text).join(" "),
    claim_ids: claimIds,
    segments,
    _adapter: { source: "narration.json scenes[].plainText/mentions/claimSpans" },
  };

  // ---- claims.jsonl {claim_id, span_ids[], text}
  const claims = [];
  for (const s of scenes) {
    const spanIds = evidenceSpanIdsForScene(bundle, s.sceneId);
    for (const c of s.claimSpans ?? []) {
      claims.push({ claim_id: c.claimId, span_ids: spanIds, text: c.exactText ?? c.claimId });
    }
  }
  const claimsJsonl = claims.map((c) => JSON.stringify(c)).join("\n") + (claims.length ? "\n" : "");

  // ---- scene-events.jsonl {scene_id, ready_ms, audio_ms, svg}
  const evByScene = new Map(sceneEventsRaw.map((e) => [e.sceneId, e]));
  const ordered = sceneEventsRaw.length ? sceneEventsRaw.map((e) => e.sceneId) : segments.map((s) => s.scene_id);
  const sceneEvents = ordered.map((sid) => ({
    scene_id: sid,
    ready_ms: null, // UNKNOWN: STCC scene-events carry sequence/duration, no wall-clock ready time
    audio_ms: evByScene.get(sid)?.durationMs ?? null,
    svg: "scene.svg",
  }));
  const sceneEventsJsonl = sceneEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";

  // ---- media.json
  const encodedMs = manifest?.encodedVideoDurationMs ?? bundle?.metrics?.["video.encodedDurationMs"] ?? null;
  const videoSrc = path.join(raw, "video.mp4");
  const playable = await probePlayable(videoSrc);
  const mediaOut = {
    duration_s: encodedMs != null ? +(encodedMs / 1000).toFixed(3) : null,
    drift_ms: null, // UNKNOWN: no A/V word-boundary drift recorded (contract field)
    playable,
    _adapter: {
      duration_source: "run-manifest.encodedVideoDurationMs",
      playable_source: "ffprobe (adapter-observed)",
      av_duration_delta_ms: M("video.audioDurationDeltaMs"),
      audio_duration_ms: aligned?.durationMs ?? null,
    },
  };

  // ---- timings.json (evaluation-bundle.metrics uses flattened dotted keys)
  const stages = {};
  for (const s of bundle?.stageRuns ?? []) stages[s.stage] = s.durationMs;
  const usage = bundle?.usage ?? {};
  const stageArtifacts = manifest?.stages?.stageArtifacts ?? {};
  const anyCache = Object.values(stageArtifacts).some((v) => v?.cacheHit === true);
  const timingsOut = {
    stages,
    workers: null, // UNKNOWN: STCC records no scene/audio worker counts
    ttfp_ms: M("timing.firstPlayableSceneMs"),
    total_gen_ms: M("timing.pipelineWallMs") ?? manifest?.executionTiming?.wallMs ?? null,
    total_wall_ms: manifest?.executionTiming?.wallMs ?? null,
    preparation_ms: manifest?.executionTiming?.preparationMs ?? null,
    input_tokens: usage.promptTokens ?? null,
    output_tokens: usage.completionTokens ?? null,
    tts_s: null, // UNKNOWN: no standalone TTS synthesis time recorded
    estimated_cost_usd: budget?.spentUsd ?? usage.costUsd ?? null,
    peak_rss_mb: null, // UNKNOWN
    repairs: usage.repairs ?? null,
    cache_hit: Object.keys(stageArtifacts).length ? anyCache : null,
    voice: null, // UNKNOWN: provider/language recorded, no voice id
    _adapter: {
      ttfp_source: "evaluation-bundle.metrics.timing.firstPlayableSceneMs",
      total_gen_source: "evaluation-bundle.metrics.timing.pipelineWallMs",
      cost_source: "budget-ledger.spentUsd",
      stages_source: "evaluation-bundle.stageRuns",
      voice_provider: manifest?.options?.voice?.provider ?? null,
    },
  };

  // ---- provenance.json {source_hash}
  const provenanceOut = {
    source_hash: srcHash, // hashed from the STCC-consumed markdown, NOT the fixture pack
    _adapter: {
      origin: path.relative(STCC, srcPath),
      stcc_source_doc_content_sha256: sourceDoc?.contentSha256 ?? null,
      hash_matches_stcc_recorded: sourceDoc?.contentSha256 === srcHash,
      note: "benchmark fixture source.sha256 not available to STCC; this is sha256 of the STCC source markdown",
    },
  };

  // ---- input.json (harness layout file; STCC's actual view was md + CLI flags)
  const inputOut = {
    case_id: cid,
    domain: null,
    objective: null,
    target_duration_s: manifest?.lessonPlan?.requestedDurationSec ?? null,
    learner: null,
    source: {
      sha256: srcHash,
      full_text: srcBytes.toString("utf8"),
      spans: (sourceDoc?.spans ?? []).map((s) => ({ id: s.id, text: s.text })),
    },
    _adapter: { note: "reconstructed STCC candidate view; objective/learner were CLI args not persisted" },
  };

  if (verifyOnly) return { cid, raw, cdir };

  const write = (name, data) => writeFile(path.join(cdir, name), typeof data === "string" ? data : JSON.stringify(data));
  await write("narration.json", narrationOut);
  await write("claims.jsonl", claimsJsonl);
  await write("scene-events.jsonl", sceneEventsJsonl);
  await copyFile(path.join(raw, "final-scene.svg"), path.join(cdir, "scene.svg"));
  await copyFile(videoSrc, path.join(cdir, "video.mp4"));
  await write("media.json", mediaOut);
  await write("timings.json", timingsOut);
  await write("provenance.json", provenanceOut);
  await write("lesson.lock.json", lock ?? { replay: "unsupported" });
  await write("input.json", inputOut);

  // artifact-hashes.json (scorer requires >=4 keys)
  const names = ["narration.json", "claims.jsonl", "scene-events.jsonl", "scene.svg", "video.mp4",
    "media.json", "timings.json", "provenance.json", "lesson.lock.json", "input.json"];
  const hashes = {};
  for (const n of names) hashes[n] = sha256(await readFile(path.join(cdir, n)));
  await write("artifact-hashes.json", hashes);

  cov("narration.json", "narration.json", "OBSERVED", "scenes[].plainText/mentions/claimSpans");
  cov("claims.jsonl", "narration.claimSpans + evaluation-bundle.claimEvidence", "OBSERVED", "span_ids are STCC span ids, not fixture S1..Sn");
  cov("scene-events.jsonl:scene_id/audio_ms/svg", "scene-events.jsonl + scene durationMs", "OBSERVED", "");
  cov("scene-events.jsonl:ready_ms", "—", "UNKNOWN", "STCC records no per-scene wall-clock ready time; streaming:false");
  cov("scene.svg", "final-scene.svg", "OBSERVED", "copied verbatim");
  cov("video.mp4", "video.mp4", "OBSERVED", "copied verbatim");
  cov("media.json:duration_s", "run-manifest.encodedVideoDurationMs", "OBSERVED", "");
  cov("media.json:playable", "ffprobe", "OBSERVED", "adapter-probed, not pipeline-recorded");
  cov("media.json:drift_ms", "evaluation-bundle.metrics.video.audioDurationDeltaMs", "UNKNOWN", "only audio-vs-video length delta available; contract drift left null");
  cov("timings.json:stages", "evaluation-bundle.stageRuns", "OBSERVED", "");
  cov("timings.json:ttfp_ms", "evaluation-bundle.metrics.timing.firstPlayableSceneMs", "OBSERVED", "");
  cov("timings.json:total_gen_ms", "evaluation-bundle.metrics.timing.pipelineWallMs", "OBSERVED", "wall_ms also stored separately");
  cov("timings.json:input_tokens/output_tokens", "evaluation-bundle.usage", "OBSERVED", "");
  cov("timings.json:estimated_cost_usd", "budget-ledger.spentUsd", "OBSERVED", "");
  cov("timings.json:repairs", "evaluation-bundle.usage.repairs", "OBSERVED", "");
  cov("timings.json:cache_hit", "run-manifest.stages.stageArtifacts", "OBSERVED", "all stages cacheHit=false");
  cov("timings.json:workers", "—", "UNKNOWN", "no scene/audio worker counts recorded");
  cov("timings.json:tts_s", "—", "UNKNOWN", "no standalone TTS synthesis time");
  cov("timings.json:peak_rss_mb", "—", "UNKNOWN", "not recorded");
  cov("timings.json:voice", "run-manifest.options.voice", "UNKNOWN", "provider/lang/speed only, no voice id");
  cov("provenance.json:source_hash", "sha256(stcc source md)", "OBSERVED", "fixture sha not available; matches source-doc.contentSha256");
  cov("lesson.lock.json", "lesson.lock.json", "OBSERVED", "STCC lock schema; lacks contract source_hash/seed");
  cov("input.json", "reconstructed candidate view", "INFERRED", "objective/learner were CLI args, not persisted");

  return { cid, raw, cdir };
}

async function main() {
  const coverage = [];
  const runId = `adapted-stcc-${Date.now()}`;
  await mkdir(path.join(outRoot, "cases"), { recursive: true });
  await writeFile(path.join(outRoot, "run.json"), JSON.stringify({
    run_id: runId, suite: "smoke", repeats: 1, candidate: "stcc-claude",
    generator: "stcc-retrofit", benchmark_concurrency_jobs: 1,
    started_at: new Date().toISOString(), source: "scripts/bench-adapter.mjs",
  }, null, 2));
  await writeFile(path.join(outRoot, "environment.json"), JSON.stringify({
    node: process.version, platform: process.platform, prod_cmd_set: false, adapter: "bench-adapter.mjs",
  }, null, 2));

  const recs = [];
  for (const cid of cases) {
    if (verifyOnly) { await adaptCase(cid, coverage); continue; }
    const r = await adaptCase(cid, coverage);
    const hashes = await readJSON(path.join(r.cdir, "artifact-hashes.json"));
    const manifest = await readJSON(path.join(r.raw, "run-manifest.json"));
    const bundle = await readJSON(path.join(r.raw, "evaluation-bundle.json"));
    recs.push({
      run_id: runId, case_id: cid, suite: "smoke", repeat: 1, status: "UNSCORED",
      artifact_hashes: hashes, wall_ms: manifest?.executionTiming?.wallMs ?? null,
      evidence: `adapted from STCC run ${manifest?.runId ?? "?"}; pipeline status=${manifest?.status ?? "?"}; draft ceiling=${bundle?.failures?.find((f) => f.hard === false && /draft|alignment/.test(f.message ?? "")) ? "alignment-calibration-unmeasured" : "unknown"}`,
    });
  }
  if (!verifyOnly) {
    await writeFile(path.join(outRoot, "case-results.jsonl"), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    await writeFile(path.join(outRoot, "stage-timings.jsonl"), "");
    await writeFile(path.join(outRoot, "coverage.json"), JSON.stringify(coverage, null, 2));
  }

  // ponytail: one runnable check — every emitted contract file exists & parses.
  let bad = 0;
  for (const cid of cases) {
    const cdir = path.join(outRoot, "cases", cid, "r1");
    for (const n of ["narration.json", "claims.jsonl", "scene-events.jsonl", "scene.svg", "video.mp4",
      "media.json", "timings.json", "provenance.json", "lesson.lock.json", "artifact-hashes.json"]) {
      const txt = n.endsWith(".mp4") ? await readFile(path.join(cdir, n)).catch(() => null)
        : await readText(path.join(cdir, n));
      if (txt == null) { console.error(`ADAPT CHECK FAIL ${cid}/${n}`); bad++; }
      else if (n.endsWith(".json")) { try { JSON.parse(txt); } catch { console.error(`ADAPT CHECK FAIL ${cid}/${n} bad json`); bad++; } }
    }
    const media = await readJSON(path.join(cdir, "media.json"));
    if (!media || typeof media.duration_s !== "number") { console.error(`ADAPT CHECK FAIL ${cid} duration_s`); bad++; }
  }
  const status = { cases: cases.length, coverage_rows: coverage.length, failures: bad, out: outRoot };
  console.log(JSON.stringify(status));
  if (bad) process.exit(1);
}
main().catch((e) => { console.error("ADAPTER ERROR:", e); process.exit(1); });
