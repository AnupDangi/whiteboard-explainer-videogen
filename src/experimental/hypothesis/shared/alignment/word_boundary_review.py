#!/usr/bin/env python3
"""Prepare and score blinded human word-boundary reviews of generated audio.

Candidate alignments live only in the organizer key. Participant pages receive
the exact narration and source-generated scene audio, never candidate times or
aligner labels. This tool reports measurements; it never mutates S5 outputs.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import secrets
import statistics
import sys
import wave
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compare_aligners import (  # noqa: E402
    require_provider_generated_audio_run,
    require_same_word_sequence,
    sha256_file,
)


SCHEMA = "word-boundary-review/v1"
VOTE_SCHEMA = "word-boundary-vote/v1"
REPORT_SCHEMA = "word-boundary-report/v1"
MEDIAN_AGREEMENT_LIMIT_MS = 80.0
P90_AGREEMENT_LIMIT_MS = 200.0


def _json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object: {path}")
    return value


def _percentile90(values: list[float]) -> float:
    if not values:
        raise ValueError("cannot compute a percentile from no observations")
    ordered = sorted(values)
    return ordered[max(0, math.ceil(0.90 * len(ordered)) - 1)]


def _safe_child(parent: Path, candidate: Path) -> Path:
    root = parent.resolve()
    result = candidate.resolve()
    try:
        result.relative_to(root)
    except ValueError as error:
        raise ValueError(f"run artifact resolves outside selected run directory: {candidate}") from error
    return result


def _wav_info(path: Path) -> tuple[int, int, int, list[int]]:
    """Validate PCM16 WAV and return rate, channels, frames, and 400-bin peaks."""
    with wave.open(str(path), "rb") as stream:
        channels, width, rate, frames = (
            stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getnframes()
        )
        if width != 2 or channels < 1 or rate < 1 or frames < 1:
            raise ValueError(f"expected nonempty PCM16 WAV audio: {path}")
        data = stream.readframes(frames)
    sample_count = len(data) // 2
    peaks = [0] * 400
    # Read signed little-endian PCM without external numerical libraries.
    for frame in range(frames):
        start = frame * channels * 2
        peak = max(abs(int.from_bytes(data[start + channel * 2:start + channel * 2 + 2], "little", signed=True))
                   for channel in range(channels))
        bucket = min(399, frame * 400 // frames)
        if peak > peaks[bucket]:
            peaks[bucket] = peak
    if sample_count < frames * channels:
        raise ValueError(f"truncated PCM16 WAV: {path}")
    return rate, channels, frames, peaks


def _load_candidate_ctc(run_dir: Path, manifest: dict[str, Any], scene_id: str,
                        narration_text: str, audio_hash: str) -> list[dict[str, Any]] | None:
    path = run_dir / "alignment-comparison-ctc-v2.json"
    if not path.exists():
        return None
    report = _json(path)
    if report.get("schemaVersion") != "alignment-comparison/v2":
        raise ValueError(f"unsupported CTC comparison report: {path}")
    if report.get("sourceRunId") != manifest.get("runId"):
        raise ValueError("CTC comparison report belongs to a different source run")
    row = next((scene for scene in report.get("scenes", []) if scene.get("sceneId") == scene_id), None)
    if row is None or row.get("audioSha256") != audio_hash:
        raise ValueError(f"CTC report does not identify the exact scene audio: {scene_id}")
    words = row.get("ctcWords")
    if not isinstance(words, list):
        raise ValueError(f"CTC report has no candidate words for scene {scene_id}")
    require_same_word_sequence(narration_text, [{"w": item.get("word")} for item in words])
    return [{"startMs": float(item["startMs"]), "endMs": float(item["endMs"])} for item in words]


def collect_run(run_dir: Path) -> dict[str, Any]:
    run_dir = run_dir.resolve()
    manifest = _json(run_dir / "run-manifest.json")
    evaluation = _json(run_dir / "evaluation-bundle.json")
    require_provider_generated_audio_run(manifest, evaluation)
    source_hash = manifest.get("stages", {}).get("sourceDoc")
    if not isinstance(source_hash, str) or not source_hash:
        raise ValueError(f"run has no SourceDoc identity: {run_dir}")
    narration = _json(run_dir / "narration.json")
    aligned = _json(run_dir / "aligned-audio.json")
    scenes: list[dict[str, Any]] = []
    narration_scenes = narration.get("scenes")
    if not isinstance(narration_scenes, list) or not narration_scenes:
        raise ValueError("narration.json contains no scenes")
    for scene in narration_scenes:
        scene_id = scene.get("sceneId")
        text = scene.get("plainText")
        if not isinstance(scene_id, str) or not isinstance(text, str) or not text.strip():
            raise ValueError("narration scene is missing its ID or exact plainText")
        words = aligned.get("sceneWords", {}).get(scene_id)
        if not isinstance(words, list):
            raise ValueError(f"aligned audio is missing scene {scene_id}")
        require_same_word_sequence(text, words)
        boundary = aligned.get("sceneBoundsMs", {}).get(scene_id)
        if not isinstance(boundary, dict) or not isinstance(boundary.get("startMs"), (int, float)):
            raise ValueError(f"aligned audio has no scene offset for {scene_id}")
        offset = float(boundary["startMs"])
        audio_path = _safe_child(run_dir, run_dir / "scene-audio" / f"{scene_id}.wav")
        if not audio_path.is_file():
            raise ValueError(f"scene audio is missing: {scene_id}")
        rate, channels, frames, peaks = _wav_info(audio_path)
        duration_ms = frames * 1000.0 / rate
        audio_hash = sha256_file(audio_path)
        stable_words = []
        for word in words:
            start, end = float(word["startMs"]) - offset, float(word["endMs"]) - offset
            stable_words.append({"startMs": start, "endMs": end})
        ctc_words = _load_candidate_ctc(run_dir, manifest, scene_id, text, audio_hash)
        if ctc_words is not None and len(ctc_words) != len(stable_words):
            raise ValueError(f"stable-ts and CTC word counts differ for {scene_id}")
        scenes.append({
            "sceneId": scene_id,
            "text": text,
            "words": [str(item.get("w", item.get("word", ""))) for item in words],
            "audioPath": str(audio_path),
            "audioSha256": audio_hash,
            "sampleRate": rate,
            "channels": channels,
            "durationMs": duration_ms,
            "wavePeaks": peaks,
            "stableTsWords": stable_words,
            "ctcWords": ctc_words,
        })
    return {
        "runId": manifest["runId"],
        "sourceDocSha256": source_hash,
        "sourceInputHash": manifest.get("stages", {}).get("input"),
        "narrationHash": manifest.get("stages", {}).get("narration"),
        "scenes": scenes,
    }


def _participant_page(package_id: str, participant_id: str, scenes: list[dict[str, Any]]) -> str:
    public_scenes = []
    for index, scene in enumerate(scenes, start=1):
        words = []
        for word_index, word in enumerate(scene["words"]):
            words.append({"word": word, "wordIndex": word_index})
        public_scenes.append({
            "itemId": scene["itemId"],
            "clipLabel": f"Clip {index}",
            "words": words,
            "durationMs": scene["durationMs"],
            "audio": scene["audioDataUri"],
            "wavePeaks": scene["wavePeaks"],
        })
    payload = json.dumps({"packageId": package_id, "participantId": participant_id, "scenes": public_scenes},
                         ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Word timing review</title>
<style>
:root{{color-scheme:light;font:16px system-ui,sans-serif;background:#f5f4f0;color:#20211f}}body{{max-width:1100px;margin:24px auto;padding:0 18px}}
h1{{font-size:1.45rem}}.card{{background:white;border:1px solid #d7d6d0;border-radius:12px;padding:16px;margin:16px 0}}
audio{{width:100%}}canvas{{width:100%;height:110px;border:1px solid #ddd;border-radius:8px;cursor:crosshair}}
.row{{display:grid;grid-template-columns:minmax(120px,1fr) 88px 100px 88px 100px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #eee}}
.row button,button{{padding:7px 10px}}.word{{font-weight:600}}.mark{{font-variant-numeric:tabular-nums;color:#666}}.active{{background:#f2f0e8}}
.toolbar{{display:flex;gap:8px;flex-wrap:wrap;align-items:center}}.progress{{margin-left:auto}}.status{{min-height:1.5em;color:#45483f}}
@media(max-width:650px){{.row{{grid-template-columns:minmax(90px,1fr) 64px 74px 64px 74px;gap:4px;font-size:13px}}}}
</style>
<body><h1>Word timing review</h1><p>For each clip, mark the first audible speech sound as the start and the last audible sound (including a final consonant) as the end; exclude silence. Use the word buttons while audio plays; brackets also mark the selected word (<kbd>[</kbd> start, <kbd>]</kbd> end). You can edit times in milliseconds. Do not guess from sentence meaning when the audio is unclear; mark the clip uncertain and add a note.</p>
<div class="toolbar"><button id="prev">Previous clip</button><button id="next">Next clip</button><span id="clipLabel"></span><span class="progress" id="progress"></span></div>
<section class="card"><audio id="audio" controls preload="metadata"></audio><canvas id="wave" width="1000" height="110" aria-label="Waveform; click to seek"></canvas><p id="selection">Select a word row, then mark its start and end at the playhead.</p><label><input id="uncertain" type="checkbox"> This clip is too unclear to annotate reliably</label> <input id="note" placeholder="Optional note" style="width:min(420px,90%)"></section>
<div id="words"></div><div class="toolbar"><button id="download">Download annotations</button><span class="status" id="status"></span></div>
<script>
const pack={payload};let clipIndex=0,selectedWord=0,loadedItem=null;const annotations=new Map();
const audio=document.querySelector('#audio'),canvas=document.querySelector('#wave'),ctx=canvas.getContext('2d');
function clip(){{return pack.scenes[clipIndex]}}function itemState(){{let state=annotations.get(clip().itemId);if(!state){{state={{words:clip().words.map(()=>({{startMs:null,endMs:null}})),uncertain:false,note:''}};annotations.set(clip().itemId,state)}}return state}}
function render(){{const c=clip(),state=itemState();document.querySelector('#clipLabel').textContent=c.clipLabel+' ('+(clipIndex+1)+'/'+pack.scenes.length+')';if(loadedItem!==c.itemId){{loadedItem=c.itemId;audio.src=c.audio;audio.load()}}document.querySelector('#uncertain').checked=state.uncertain;document.querySelector('#note').value=state.note;
document.querySelector('#progress').textContent=pack.scenes.reduce((n,s)=>n+(annotations.get(s.itemId)?.words.filter(w=>w.startMs!==null&&w.endMs!==null).length||0),0)+' / '+pack.scenes.reduce((n,s)=>n+s.words.length,0)+' words marked';
const list=document.querySelector('#words');list.innerHTML='';c.words.forEach((w,i)=>{{const a=state.words[i],row=document.createElement('div');row.className='row'+(selectedWord===i?' active':'');row.onclick=()=>{{selectedWord=i;render()}};const label=document.createElement('span');label.className='word';label.textContent=(i+1)+'. '+w.word;row.append(label);
for(const field of ['startMs','endMs']){{const button=document.createElement('button');button.textContent=field==='startMs'?'Set start':'Set end';button.title='Set '+field+' to audio playhead';button.onclick=e=>{{e.stopPropagation();selectedWord=i;a[field]=Math.round(audio.currentTime*1000);render()}};row.append(button);const display=document.createElement('input');display.type='number';display.min='0';display.max=String(c.durationMs);display.step='1';display.placeholder='ms';display.value=a[field]===null?'':String(a[field]);display.title='Edit '+field+' in milliseconds';display.onclick=e=>e.stopPropagation();display.onchange=e=>{{const value=e.target.value; a[field]=value===''?null:Number(value);render()}};row.append(display)}}list.append(row)}});drawWave()}}
function drawWave(){{const c=clip(),state=itemState(),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#fafaf8';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#75816d';ctx.lineWidth=1;ctx.beginPath();c.wavePeaks.forEach((v,i)=>{{const x=i*w/c.wavePeaks.length,y=v/32768*(h*.46);ctx.moveTo(x,h/2-y);ctx.lineTo(x,h/2+y)}});ctx.stroke();ctx.strokeStyle='#b14c39';ctx.beginPath();const x=audio.currentTime/(c.durationMs/1000)*w;ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();ctx.fillStyle='#555';ctx.font='12px system-ui';for(const word of state.words){{for(const t of [word.startMs,word.endMs])if(t!==null){{const bx=t/c.durationMs*w;ctx.fillRect(bx,0,1,h)}}}}}}
canvas.onclick=e=>{{const rect=canvas.getBoundingClientRect();audio.currentTime=Math.max(0,Math.min(clip().durationMs/1000,(e.clientX-rect.left)/rect.width*clip().durationMs/1000))}};
audio.ontimeupdate=drawWave;document.querySelector('#prev').onclick=()=>{{clipIndex=(clipIndex+pack.scenes.length-1)%pack.scenes.length;selectedWord=0;render()}};document.querySelector('#next').onclick=()=>{{clipIndex=(clipIndex+1)%pack.scenes.length;selectedWord=0;render()}};
document.querySelector('#uncertain').onchange=e=>itemState().uncertain=e.target.checked;document.querySelector('#note').oninput=e=>itemState().note=e.target.value;
document.onkeydown=e=>{{if(e.target.matches('input'))return;if(e.key==='['||e.key===']'){{e.preventDefault();itemState().words[selectedWord][e.key==='['?'startMs':'endMs']=Math.round(audio.currentTime*1000);render()}}else if(e.key==='ArrowDown'){{selectedWord=Math.min(clip().words.length-1,selectedWord+1);render()}}else if(e.key==='ArrowUp'){{selectedWord=Math.max(0,selectedWord-1);render()}}}};
document.querySelector('#download').onclick=()=>{{const items=pack.scenes.map(s=>({{itemId:s.itemId,words:annotations.get(s.itemId)?.words||[],uncertain:annotations.get(s.itemId)?.uncertain||false,note:annotations.get(s.itemId)?.note||''}}));const result={{schemaVersion:'{VOTE_SCHEMA}',packageId:pack.packageId,participantId:pack.participantId,annotations:items}};const blob=new Blob([JSON.stringify(result,null,2)+'\\n'],{{type:'application/json'}});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=pack.participantId+'-votes.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);document.querySelector('#status').textContent='Saved a local JSON download.'}};
render();</script></body></html>"""


def build_pack(run_dirs: list[Path], out_dir: Path, key_out: Path) -> dict[str, Any]:
    if not run_dirs:
        raise ValueError("at least one --run-dir is required")
    if out_dir.exists() or key_out.exists():
        raise FileExistsError("pack output and organizer key paths must not already exist")
    try:
        key_out.resolve().relative_to(out_dir.resolve())
    except ValueError:
        pass
    else:
        raise ValueError("organizer key must be stored outside the participant pack directory")
    runs = [collect_run(path) for path in run_dirs]
    hashes = [run["sourceDocSha256"] for run in runs]
    if len(set(hashes)) != len(hashes):
        raise ValueError("pack contains repeated SourceDoc hashes; retries are not independent documents")
    package_id = secrets.token_hex(16)
    key_items: list[dict[str, Any]] = []
    public_scenes: list[dict[str, Any]] = []
    for run in runs:
        for scene in run["scenes"]:
            item_id = secrets.token_hex(16)
            audio_bytes = Path(scene["audioPath"]).read_bytes()
            if hashlib.sha256(audio_bytes).hexdigest() != scene["audioSha256"]:
                raise ValueError("scene audio changed while the review pack was being built")
            data_uri = "data:audio/wav;base64," + base64.b64encode(audio_bytes).decode("ascii")
            words = scene["words"]
            if len(words) != len(scene["stableTsWords"]):
                raise ValueError("narration/alignment word count differs")
            stable = scene["stableTsWords"]
            ctc = scene["ctcWords"]
            key_items.append({
                "itemId": item_id,
                "sourceDocSha256": run["sourceDocSha256"],
                "sourceRunId": run["runId"],
                "sceneId": scene["sceneId"],
                "audioSha256": scene["audioSha256"],
                "scriptSha256": hashlib.sha256(scene["text"].encode("utf-8")).hexdigest(),
                "durationMs": scene["durationMs"],
                "words": words,
                "stableTsWords": stable,
                "ctcWords": ctc,
                "ctcAvailable": ctc is not None,
                "runInputHash": run["sourceInputHash"],
                "narrationHash": run["narrationHash"],
            })
            public_scenes.append({**scene, "itemId": item_id, "audioDataUri": data_uri})
    if sum(len(item["words"]) for item in key_items) < 1:
        raise ValueError("review pack contains no word items")
    key = {
        "schemaVersion": SCHEMA,
        "packageId": package_id,
        "createdAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "sourceCount": len(set(hashes)),
        "sourceDocSha256": sorted(set(hashes)),
        "itemCount": len(key_items),
        "wordCount": sum(len(item["words"]) for item in key_items),
        "agreementCriteria": {"medianBoundaryDifferenceMsMax": MEDIAN_AGREEMENT_LIMIT_MS,
                              "p90BoundaryDifferenceMsMax": P90_AGREEMENT_LIMIT_MS},
        "items": key_items,
    }
    key_bytes = (json.dumps(key, ensure_ascii=False, indent=2) + "\n").encode()
    key["keySha256"] = hashlib.sha256(key_bytes).hexdigest()
    # Keep reviewer deliverables in two independent directories. Random scene
    # order helps reduce sequence/order bias; opaque item IDs preserve joins.
    out_dir.mkdir(parents=True)
    for participant in ("judge-1", "judge-2"):
        folder = out_dir / participant
        folder.mkdir()
        ordered = list(public_scenes)
        secrets.SystemRandom().shuffle(ordered)
        (folder / "review.html").write_text(_participant_page(package_id, participant, ordered), encoding="utf-8")
    key_out.parent.mkdir(parents=True, exist_ok=True)
    key_out.write_text(json.dumps(key, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return key


def _validate_vote(key: dict[str, Any], vote_path: Path) -> dict[str, Any]:
    vote = _json(vote_path)
    if vote.get("schemaVersion") != VOTE_SCHEMA or vote.get("packageId") != key.get("packageId"):
        raise ValueError(f"vote file does not belong to organizer package: {vote_path}")
    participant_id = vote.get("participantId")
    if not isinstance(participant_id, str) or not participant_id.strip():
        raise ValueError("reviewer ID must be a nonempty string")
    items = vote.get("annotations")
    if not isinstance(items, list):
        raise ValueError("vote file is missing annotations")
    expected = {item["itemId"]: item for item in key["items"]}
    received: dict[str, dict[str, Any]] = {}
    for annotation in items:
        item_id = annotation.get("itemId")
        if item_id not in expected or item_id in received:
            raise ValueError("vote file contains unknown or duplicate item IDs")
        expected_item = expected[item_id]
        words = annotation.get("words")
        if not isinstance(words, list) or len(words) != len(expected_item["words"]):
            raise ValueError(f"wrong annotation word count for item {item_id}")
        checked_words = []
        previous_start = -1.0
        for index, word in enumerate(words):
            try:
                start, end = float(word["startMs"]), float(word["endMs"])
            except (TypeError, KeyError, ValueError) as error:
                raise ValueError(f"word {index} in item {item_id} has an incomplete boundary") from error
            if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start or end > expected_item["durationMs"]:
                raise ValueError(f"word {index} in item {item_id} has an invalid interval")
            if start < previous_start:
                raise ValueError(f"word starts are out of order in item {item_id}")
            previous_start = start
            checked_words.append({"startMs": start, "endMs": end})
        received[item_id] = {"words": checked_words, "uncertain": bool(annotation.get("uncertain")),
                             "note": str(annotation.get("note", ""))[:2000]}
    if set(received) != set(expected):
        raise ValueError("vote file does not cover every review item")
    return {"participantId": participant_id, "annotations": received, "voteSha256": sha256_file(vote_path)}


def _candidate_metrics(key_items: list[dict[str, Any]], votes: list[dict[str, Any]], candidate_name: str) -> dict[str, Any] | None:
    errors: list[float] = []
    zero_words = 0
    covered_words = 0
    for item in key_items:
        candidate = item["stableTsWords"] if candidate_name == "stable-ts" else item["ctcWords"]
        if candidate is None:
            continue
        human = [votes[j]["annotations"][item["itemId"]]["words"] for j in range(2)]
        if len(candidate) != len(item["words"]):
            raise ValueError(f"candidate word count differs for {item['itemId']}")
        for index, predicted in enumerate(candidate):
            zero_words += int(float(predicted["endMs"]) <= float(predicted["startMs"]))
            for boundary in ("startMs", "endMs"):
                target = statistics.mean(float(review[index][boundary]) for review in human)
                errors.append(abs(float(predicted[boundary]) - target))
            covered_words += 1
    if not errors:
        return None
    return {
        "wordCount": covered_words,
        "boundaryCount": len(errors),
        "medianAbsoluteErrorMs": statistics.median(errors),
        "p90AbsoluteErrorMs": _percentile90(errors),
        "maximumAbsoluteErrorMs": max(errors),
        "zeroDurationWords": zero_words,
    }


def score_pack(key_path: Path, vote_paths: list[Path]) -> dict[str, Any]:
    if len(vote_paths) != 2:
        raise ValueError("exactly two independent --votes files are required")
    key = _json(key_path)
    if key.get("schemaVersion") != SCHEMA:
        raise ValueError("unsupported organizer key schema")
    recorded_hash = key.pop("keySha256", None)
    canonical = (json.dumps(key, ensure_ascii=False, indent=2) + "\n").encode()
    key["keySha256"] = recorded_hash
    if not isinstance(recorded_hash, str) or hashlib.sha256(canonical).hexdigest() != recorded_hash:
        raise ValueError("organizer key hash is missing or invalid")
    votes = [_validate_vote(key, path) for path in vote_paths]
    if votes[0]["participantId"] == votes[1]["participantId"]:
        raise ValueError("the two vote files must come from distinct reviewers")
    items = key["items"]
    per_item_differences: list[float] = []
    uncertain_items: list[str] = []
    for item in items:
        item_id = item["itemId"]
        left = votes[0]["annotations"][item_id]
        right = votes[1]["annotations"][item_id]
        if left["uncertain"] or right["uncertain"]:
            uncertain_items.append(item_id)
        for lword, rword in zip(left["words"], right["words"], strict=True):
            per_item_differences.extend((abs(lword["startMs"] - rword["startMs"]),
                                         abs(lword["endMs"] - rword["endMs"])))
    median_diff = statistics.median(per_item_differences)
    p90_diff = _percentile90(per_item_differences)
    agreement_pass = median_diff <= MEDIAN_AGREEMENT_LIMIT_MS and p90_diff <= P90_AGREEMENT_LIMIT_MS
    independent_sources = len(set(key.get("sourceDocSha256", [])))
    word_count = sum(len(item["words"]) for item in items)
    enough_data = independent_sources >= 3 and word_count >= 100
    candidates = {"stable-ts": _candidate_metrics(items, votes, "stable-ts")}
    if any(item.get("ctcAvailable") for item in items):
        candidates["torchaudio-wav2vec2-ctc"] = _candidate_metrics(items, votes, "ctc")
    status = "measured-candidate-comparison" if enough_data and agreement_pass and not uncertain_items else "pilot-only-unmeasured"
    reasons = []
    if independent_sources < 3:
        reasons.append("requires at least three distinct source documents")
    if word_count < 100:
        reasons.append("requires at least 100 word items")
    if not agreement_pass:
        reasons.append("reviewer agreement is outside the pre-registered limits")
    if uncertain_items:
        reasons.append(f"{len(uncertain_items)} scene annotations marked uncertain")
    return {
        "schemaVersion": REPORT_SCHEMA,
        "status": status,
        "packageId": key["packageId"],
        "organizerKeySha256": recorded_hash,
        "reviewerIds": [vote["participantId"] for vote in votes],
        "voteFileSha256": [vote["voteSha256"] for vote in votes],
        "sourceCount": independent_sources,
        "sourceDocSha256": sorted(set(key.get("sourceDocSha256", []))),
        "reviewItemCount": len(items),
        "wordCount": word_count,
        "uncertainItemCount": len(uncertain_items),
        "reviewerAgreement": {
            "medianBoundaryDifferenceMs": median_diff,
            "p90BoundaryDifferenceMs": p90_diff,
            "criteria": key["agreementCriteria"],
            "passes": agreement_pass,
        },
        "items": [{
            "itemId": item["itemId"],
            "sourceDocSha256": item["sourceDocSha256"],
            "sourceRunId": item["sourceRunId"],
            "sceneId": item["sceneId"],
            "audioSha256": item["audioSha256"],
            "scriptSha256": item["scriptSha256"],
        } for item in items],
        "individualAnnotations": [{
            "participantId": vote["participantId"],
            "annotations": [{
                "itemId": item["itemId"],
                "uncertain": vote["annotations"][item["itemId"]]["uncertain"],
                "words": vote["annotations"][item["itemId"]]["words"],
            } for item in items],
        } for vote in votes],
        "candidateErrorsAgainstMeanHumanBoundary": candidates,
        "reasons": reasons,
        "limitations": [
            "human boundary annotation is itself uncertain, especially under coarticulation",
            "two reviewers and the current source set do not justify automatic live-aligner promotion",
            "candidate intervals are compared with the mean of two human boundary marks",
            "this report evaluates audio timing only and says nothing about visual or teaching quality",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    pack = sub.add_parser("pack", help="build two blinded audio annotation pages")
    pack.add_argument("--run-dir", action="append", type=Path, required=True,
                      help="source-generated lesson run; repeat for independent source docs")
    pack.add_argument("--out", type=Path, required=True, help="new participant pack directory")
    pack.add_argument("--key-out", type=Path, required=True,
                      help="separate organizer key path; do not give this file to reviewers")
    score = sub.add_parser("score", help="score two complete independent annotation files")
    score.add_argument("--key", type=Path, required=True)
    score.add_argument("--votes", action="append", type=Path, required=True)
    score.add_argument("--out", type=Path, help="report output; stdout if omitted")
    args = parser.parse_args()
    try:
        if args.command == "pack":
            key = build_pack(args.run_dir, args.out, args.key_out)
            print(json.dumps({"packageId": key["packageId"], "sourceCount": key["sourceCount"],
                              "itemCount": key["itemCount"], "wordCount": key["wordCount"],
                              "participantPages": [str(args.out / "judge-1" / "review.html"),
                                                   str(args.out / "judge-2" / "review.html")],
                              "organizerKey": str(args.key_out)}, indent=2))
        else:
            report = score_pack(args.key, args.votes)
            rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
            if args.out:
                if args.out.exists():
                    raise FileExistsError(f"report path already exists: {args.out}")
                args.out.parent.mkdir(parents=True, exist_ok=True)
                args.out.write_text(rendered, encoding="utf-8")
                print(f"wrote {args.out}")
            else:
                print(rendered, end="")
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
