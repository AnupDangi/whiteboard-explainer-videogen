#!/usr/bin/env python3
"""Compare stable-ts with torchaudio's English CTC forced aligner on one generated run.

This is a diagnostic, not a calibration command: one generated lesson cannot
select a live aligner or change the S5 pass gate. It accepts generated-lesson
artifacts only and uses audio-energy boundaries independent of either aligner.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import statistics
import wave
from pathlib import Path
from typing import Any


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path, chunk_bytes: int = 1024 * 1024) -> str:
    """Hash large audio/model files without retaining a second in-memory copy."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(chunk_bytes), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ctc_target(text: str, labels: list[str]) -> tuple[list[str], list[int], list[int | None]]:
    """Return original words, CTC character IDs, and the owning word per ID.

    The English model can align its supported alphabet only. Punctuation is
    omitted from the acoustic target but remains in the original caption word;
    numbers, accented letters, and other unsupported alphanumerics fail closed.

    Only alphabetic characters are ever emitted as target IDs. Without this,
    a literal punctuation character that happens to share a label string with
    the CTC blank token (`"-"`, e.g. a hyphen in "self-balancing") would be
    picked up as a real acoustic target and land in the targets tensor as the
    blank id itself — which torchaudio.functional.forced_align always rejects
    outright, since it (correctly) never wants blank in its input targets and
    already handles genuinely repeated adjacent letters (e.g. "wheel") on its
    own via the documented `L_log_probs >= L_label + N_repeat` allowance.
    """
    dictionary = {label.lower(): index for index, label in enumerate(labels)}
    words = re.findall(r"\S+", text)
    if not words:
        raise ValueError("transcript contains no words")
    targets: list[int] = []
    owners: list[int | None] = []
    for word_index, word in enumerate(words):
        unsupported = [char for char in word if char.isalnum() and char.lower() not in dictionary]
        if unsupported:
            raise ValueError(f"unsupported CTC transcript characters in {word!r}: {''.join(unsupported)!r}")
        chars = [char.lower() for char in word if char.isalpha() and char.lower() in dictionary]
        if not chars:
            raise ValueError(f"word has no alignable CTC characters: {word!r}")
        if targets:
            targets.append(dictionary["|"])
            owners.append(None)
        targets.extend(dictionary[char] for char in chars)
        owners.extend([word_index] * len(chars))
    return words, targets, owners


def ctc_token_spans(path: list[int], targets: list[int], blank: int = 0) -> list[tuple[int, int]]:
    """Collapse a CTC path and return each target token's half-open frame span."""
    spans: list[list[int]] = []
    collapsed: list[int] = []
    previous: int | None = None
    for frame, token in enumerate(path):
        if token == blank:
            previous = None
        elif token != previous:
            spans.append([frame, frame + 1])
            collapsed.append(token)
            previous = token
        else:
            spans[-1][1] = frame + 1
    if len(spans) != len(targets):
        raise ValueError(f"CTC path aligns {len(spans)} tokens but transcript requires {len(targets)}")
    if collapsed != targets:
        raise ValueError("CTC path token sequence does not match the normalized transcript")
    return [(start, end) for start, end in spans]


def require_generated_run(manifest: dict[str, Any]) -> None:
    if manifest.get("runClass") != "generated-lesson":
        raise ValueError("alignment comparison accepts generated-lesson runs only")


def require_provider_generated_audio_run(manifest: dict[str, Any], evaluation: dict[str, Any]) -> None:
    """Reject generated labels without completed source, model, script, and TTS stages."""
    require_generated_run(manifest)
    if evaluation.get("runClass") != "generated-lesson" or evaluation.get("runId") != manifest.get("runId"):
        raise ValueError("evaluation bundle does not match this generated-lesson run")
    if not manifest.get("stages", {}).get("sourceDoc"):
        raise ValueError("generated-lesson manifest has no source-document artifact hash")
    stages = {entry.get("stage"): entry for entry in evaluation.get("stageRuns", [])}
    requirements = {
        "S1-source-intake": "local",
        "S2-concepts": "provider",
        "S3-teaching-plan": "provider",
        "S4-narration-script": "provider",
        "S5-tts-alignment": "local",
    }
    for stage, expected_kind in requirements.items():
        entry = stages.get(stage)
        if entry is None or entry.get("kind") != expected_kind:
            raise ValueError(f"required source-generated audio stage missing or wrong kind: {stage}")
        if stage != "S5-tts-alignment" and entry.get("status") != "completed":
            raise ValueError(f"source-generated prerequisite did not complete: {stage}")
        if stage != "S5-tts-alignment" and (entry.get("failures") or entry.get("fallbackCount", 0)):
            raise ValueError(f"source-generated prerequisite contains failure/fallback: {stage}")


def require_same_word_sequence(expected_text: str, aligned_words: list[dict[str, Any]]) -> None:
    expected = [word.casefold() for word in re.findall(r"\S+", expected_text)]
    actual = [str(word.get("w", word.get("word", ""))).casefold() for word in aligned_words]
    if actual != expected:
        raise ValueError("aligner word sequence does not match the exact S4 narration")


def normalized_transcript_tokens(text: str) -> list[str]:
    """Normalize recognized text for lexical consistency, not timing truth."""
    return [token.casefold() for token in re.findall(r"[\w]+(?:['-][\w]+)*", text, flags=re.UNICODE)]


def transcript_consistency(expected_text: str, recognized_text: str) -> dict[str, Any]:
    """Report ASR token omissions/additions; this never validates or repairs timestamps."""
    expected = normalized_transcript_tokens(expected_text)
    recognized = normalized_transcript_tokens(recognized_text)
    matcher = difflib.SequenceMatcher(a=expected, b=recognized, autojunk=False)
    missing: list[str] = []
    extra: list[str] = []
    for tag, a_start, a_end, b_start, b_end in matcher.get_opcodes():
        if tag in ("delete", "replace"):
            missing.extend(expected[a_start:a_end])
        if tag in ("insert", "replace"):
            extra.extend(recognized[b_start:b_end])
    return {
        "expectedTokenCount": len(expected),
        "recognizedTokenCount": len(recognized),
        "exactTokenSequence": expected == recognized,
        "missingTokens": missing,
        "extraTokens": extra,
    }


def transcribe_scene_locally(audio_path: Path, model: Any) -> str:
    """Transcribe with a local cached model; callers must set local_files_only."""
    segments, _ = model.transcribe(str(audio_path), language="en", vad_filter=False)
    return " ".join(segment.text.strip() for segment in segments).strip()


def word_frame_spans(owners: list[int | None], token_spans: list[tuple[int, int]], word_count: int) -> list[tuple[int, int]]:
    """Aggregate measured character frames into each original word interval."""
    frames: list[list[int]] = [[] for _ in range(word_count)]
    for owner, (start, end) in zip(owners, token_spans, strict=True):
        if owner is not None:
            frames[owner].extend((start, end))
    if any(not word_frames for word_frames in frames):
        raise ValueError("CTC alignment left one or more transcript words without character frames")
    return [(min(word_frames), max(word_frames)) for word_frames in frames]


def rms_vad_boundaries(samples: list[float], sample_rate: int, window_ms: float = 5.0) -> tuple[float, float]:
    """Independent scene onset/offset proxy: 5 ms RMS, 5% onset / 2.5% offset."""
    import numpy as np

    window = max(1, round(sample_rate * window_ms / 1000))
    usable = len(samples) // window * window
    if usable == 0:
        raise ValueError("audio is shorter than one VAD window")
    rms = np.sqrt(np.mean(np.asarray(samples[:usable]).reshape(-1, window) ** 2, axis=1))
    peak = float(rms.max())
    if not peak:
        raise ValueError("audio is silent")
    active = np.flatnonzero(rms >= peak * 0.025)
    onset = np.flatnonzero(rms >= peak * 0.05)
    if not len(active) or not len(onset):
        raise ValueError("energy VAD found no speech")
    return (float(onset[0] * window / sample_rate * 1000),
            float((active[-1] + 1) * window / sample_rate * 1000))


def _read_pcm16(path: Path):
    import numpy as np

    with wave.open(str(path), "rb") as audio:
        channels, width, sample_rate = audio.getnchannels(), audio.getsampwidth(), audio.getframerate()
        frames = audio.getnframes()
        raw = audio.readframes(frames)
    if width != 2:
        raise ValueError(f"expected signed 16-bit PCM WAV at {path}, got {width * 8}-bit samples")
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, sample_rate


def align_ctc(audio_path: Path, text: str, model: Any, labels: list[str], sample_rate: int):
    import numpy as np
    import torch
    import torchaudio

    samples, original_rate = _read_pcm16(audio_path)
    waveform = torch.from_numpy(samples.copy()).unsqueeze(0)
    if original_rate != sample_rate:
        waveform = torchaudio.functional.resample(waveform, original_rate, sample_rate)
    words, targets, owners = ctc_target(text, labels)
    with torch.inference_mode():
        emissions, _ = model(waveform)
        path, token_scores = torchaudio.functional.forced_align(
            emissions.log_softmax(dim=-1),
            torch.tensor([targets], dtype=torch.int32),
            input_lengths=torch.tensor([emissions.shape[1]], dtype=torch.int32),
            target_lengths=torch.tensor([len(targets)], dtype=torch.int32),
            blank=0,
        )
    path_ids = path[0].tolist()
    token_spans = ctc_token_spans(path_ids, targets)
    word_spans = word_frame_spans(owners, token_spans, len(words))
    # Match WhisperX's audio-length / emission-length frame scale; no minimum
    # duration is imposed and no timestamp is stretched to satisfy the gate.
    frame_ms = waveform.shape[1] / emissions.shape[1] / sample_rate * 1000
    result = [
        {"word": word, "startMs": start * frame_ms, "endMs": end * frame_ms}
        for word, (start, end) in zip(words, word_spans, strict=True)
    ]
    if any(item["endMs"] <= item["startMs"] for item in result):
        raise ValueError("CTC produced a non-positive word interval")
    return result, samples, original_rate, float(token_scores.mean().item())


def _boundary_errors(words: list[dict[str, Any]], vad: tuple[float, float], offset_ms: float = 0) -> list[float]:
    if not words:
        raise ValueError("aligner returned no words")
    return [abs(words[0]["startMs"] - offset_ms - vad[0]),
            abs(words[-1]["endMs"] - offset_ms - vad[1])]


def compare_generated_run(run_dir: Path, model_dir: Path | None = None, asr_consistency: bool = False) -> dict[str, Any]:
    manifest = json.loads((run_dir / "run-manifest.json").read_text())
    evaluation = json.loads((run_dir / "evaluation-bundle.json").read_text())
    require_provider_generated_audio_run(manifest, evaluation)
    narration = json.loads((run_dir / "narration.json").read_text())
    stable = json.loads((run_dir / "aligned-audio.json").read_text())
    voice = manifest.get("options", {}).get("voice", {})
    if voice.get("language", "en").lower().split("-")[0] != "en":
        raise ValueError("WAV2VEC2_ASR_BASE_960H diagnostic currently supports English only")

    import torchaudio

    bundle = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
    root = model_dir or (Path(__file__).resolve().parents[5] / ".data" / "alignment-models")
    model_path = root / bundle._path
    model = bundle.get_model(dl_kwargs={"model_dir": str(root)}).eval()
    transcription_model = None
    asr_status: dict[str, Any] | None = None
    if asr_consistency:
        try:
            from faster_whisper import WhisperModel

            transcription_model = WhisperModel("base", device="cpu", compute_type="float32", local_files_only=True)
            asr_status = {
                "status": "diagnostic-only",
                "model": "faster-whisper base, local cache only",
                "limitation": "lexical recognition is not word-boundary ground truth; this model family also underlies stable-ts",
            }
        except Exception as error:  # noqa: BLE001 - optional local diagnostic is explicitly unmeasured on failure
            asr_status = {
                "status": "unmeasured",
                "reason": "local-transcriber-unavailable",
                "errorClass": type(error).__name__,
            }
    labels = bundle.get_labels()
    scenes = []
    asr_scenes = []
    all_boundary_errors: dict[str, list[float]] = {"stable-ts": [], "torchaudio-wav2vec2-ctc": []}
    for narration_scene in narration["scenes"]:
        scene_id = narration_scene["sceneId"]
        audio_path = run_dir / "scene-audio" / f"{scene_id}.wav"
        aligned, samples, audio_rate, mean_token_log_score = align_ctc(
            audio_path, narration_scene["plainText"], model, labels, bundle.sample_rate
        )
        if transcription_model is not None:
            recognized_text = transcribe_scene_locally(audio_path, transcription_model)
            asr_scenes.append({
                "sceneId": scene_id,
                "audioSha256": sha256_file(audio_path),
                **transcript_consistency(narration_scene["plainText"], recognized_text),
                "stableTsZeroWords": [
                    str(word.get("w", word.get("word", "")))
                    for word in stable["sceneWords"][scene_id]
                    if word.get("endMs", 0) <= word.get("startMs", 0)
                ],
            })
        vad = rms_vad_boundaries(samples.tolist(), audio_rate)
        offset = float(stable["sceneBoundsMs"][scene_id]["startMs"])
        stable_words = stable["sceneWords"][scene_id]
        require_same_word_sequence(narration_scene["plainText"], stable_words)
        stable_errors = _boundary_errors(stable_words, vad, offset)
        ctc_errors = _boundary_errors(aligned, vad)
        all_boundary_errors["stable-ts"].extend(stable_errors)
        all_boundary_errors["torchaudio-wav2vec2-ctc"].extend(ctc_errors)
        scenes.append({
            "sceneId": scene_id,
            "audioSha256": sha256_file(audio_path),
            "scriptSha256": sha256(narration_scene["plainText"].encode("utf-8")),
            "wordCount": len(aligned),
            "stableTsZeroIntervals": sum(word["endMs"] <= word["startMs"] for word in stable_words),
            "ctcZeroIntervals": sum(word["endMs"] <= word["startMs"] for word in aligned),
            "vadOnsetMs": vad[0],
            "vadOffsetMs": vad[1],
            "stableTsBoundaryErrorsMs": stable_errors,
            "ctcBoundaryErrorsMs": ctc_errors,
            "ctcMeanTokenLogScore": mean_token_log_score,
            "ctcWords": aligned,
        })

    summary = {}
    for aligner, errors in all_boundary_errors.items():
        summary[aligner] = {
            "boundarySamples": len(errors),
            "medianAbsoluteBoundaryErrorMs": statistics.median(errors),
            "maximumAbsoluteBoundaryErrorMs": max(errors),
            "zeroDurationWords": sum(scene["stableTsZeroIntervals" if aligner == "stable-ts" else "ctcZeroIntervals"] for scene in scenes),
        }
    return {
        "schemaVersion": "alignment-comparison/v2",
        "evidenceClass": "source-generated-stage-diagnostic",
        "calibrationStatus": "unmeasured",
        "promotionDecision": "none; one source-generated lesson is insufficient to change live S5",
        "sourceRunId": manifest["runId"],
        "sourceArtifactHash": manifest.get("stages", {}).get("sourceDoc"),
        "voice": voice,
        "stableTs": {"package": "stable-ts", "version": "2.19.1", "model": "base"},
        "ctc": {"model": "torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H", "sampleRate": bundle.sample_rate,
                "weightsFile": bundle._path, "weightsSha256": sha256_file(model_path) if model_path.is_file() else None},
        "independentBoundaryMethod": "5ms RMS; 5% of per-scene peak for onset; 2.5% for offset",
        "limitations": ["one source-generated lesson / three scene clips", "utterance-boundary VAD is not interior-word ground truth", "English CTC alphabet only; unsupported alphanumeric characters fail closed", "not a live S5 calibration and not visual-quality evidence"],
        "summary": summary,
        "scenes": scenes,
        **({"asrConsistency": {**asr_status, "scenes": asr_scenes}} if asr_status is not None else {}),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True, type=Path, help="source-generated lesson directory with run-manifest.json")
    parser.add_argument("--model-dir", type=Path, help="torchaudio model cache directory; defaults to <repo>/.data/alignment-models")
    parser.add_argument("--asr-consistency", action="store_true", help="also compare local cached ASR tokens with S4 narration; diagnostic only, no timestamp validation")
    parser.add_argument("--output", type=Path, help="report path; defaults to alignment-comparison-ctc-v2.json within the run")
    args = parser.parse_args()
    report = compare_generated_run(args.run_dir, args.model_dir, args.asr_consistency)
    output = args.output or args.run_dir / "alignment-comparison-ctc-v2.json"
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(output), "summary": report["summary"], "calibrationStatus": report["calibrationStatus"]}))


if __name__ == "__main__":
    main()
