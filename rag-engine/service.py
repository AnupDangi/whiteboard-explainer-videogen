#!/usr/bin/env python3
"""RAG-Anything deep-index sidecar.

Deep multimodal layer for explain-canvas-lab. It receives a PRE-PARSED content list
(produced by our Docling sidecar + src/deep-index/content-list.ts) and inserts it with
RAG-Anything's `insert_content_list` — so a document is parsed exactly once.

Commands (one JSON object on stdin, one JSON object on stdout):

    check   -> {"ok":true,"raganything":..., "llm":bool,"embeddings":bool}
    index   -> {"contentList":[...], "filePath":"...", "workingDir":"...", "docId":?}
               -> {"ok":true,"docId":...,"items":N}
    query   -> {"workingDir":"...","question":"...","mode":"naive"}
               -> {"ok":true,"data":{"chunks":[...]}}

Failures print {"ok":false,"error":"..."} and exit non-zero. This process never
fabricates a successful result; missing provider credentials are reported, not hidden.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
import traceback


def _positive_int(name: str, default: int, maximum: int = 300) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(1, min(maximum, value))


class UsageTracker:
    """Captures provider-reported tokens; dollar cost remains unknown without invoice pricing."""
    def __init__(self):
        self.usage_responses = self.call_attempts = self.call_completions = self.failed_calls = 0
        self.failures = []
        self.prompt_tokens = self.completion_tokens = self.total_tokens = 0

    def add_usage(self, values):
        self.usage_responses += 1
        self.prompt_tokens += int(values.get("prompt_tokens", 0) or 0)
        self.completion_tokens += int(values.get("completion_tokens", 0) or 0)
        self.total_tokens += int(values.get("total_tokens", 0) or 0)

    def snapshot(self):
        return {"callAttempts": self.call_attempts, "successfulCallAttempts": self.call_completions,
                "failedCalls": self.failed_calls, "providerReportedUsageResponses": self.usage_responses,
                "promptTokens": self.prompt_tokens,
                "completionTokens": self.completion_tokens, "totalTokens": self.total_tokens,
                "costUsd": None, "costStatus": "unknown; provider response did not expose billed dollars",
                "failures": self.failures[-10:]}

    def begin_call(self): self.call_attempts += 1
    def complete_call(self): self.call_completions += 1
    def fail_call(self, operation: str, error: BaseException):
        self.failed_calls += 1
        self.failures.append({"operation": operation, "errorType": type(error).__name__, "message": str(error)[:250]})


class MultimodalMonitor:
    def __init__(self, expected: int):
        self.expected = expected
        self.completed = 0
        self.failed = 0
        self.failures = []

    def snapshot(self):
        return {"expected": self.expected, "completed": self.completed, "failed": self.failed,
                "complete": self.completed == self.expected and self.failed == 0,
                "failures": self.failures[-10:]}


def _index_status(monitor: MultimodalMonitor, usage: UsageTracker) -> str:
    return "complete" if monitor.snapshot()["complete"] and usage.failed_calls == 0 else "partial"


def _query_status(usage: UsageTracker) -> str:
    return "complete" if usage.failed_calls == 0 else "partial"


def index_store_completion_problems(status_doc, text_chunks, chunk_vectors) -> list[str]:
    """Require LightRAG's actual chunk and vector records before reporting index complete."""
    if not isinstance(status_doc, dict):
        return ["LightRAG document status record is missing"]
    status = status_doc.get("status")
    status = getattr(status, "value", status)
    problems = []
    if status != "processed":
        problems.append(f"document status is {status or 'missing'}, expected processed")
    chunk_ids = status_doc.get("chunks_list")
    if not isinstance(chunk_ids, list):
        chunk_ids = []
    chunk_ids = [chunk_id for chunk_id in chunk_ids if isinstance(chunk_id, str) and chunk_id]
    count = status_doc.get("chunks_count")
    if not chunk_ids:
        problems.append("document status contains no indexed chunk IDs")
    elif isinstance(count, int) and count != len(chunk_ids):
        problems.append(f"document status chunk count {count} does not match chunk ID count {len(chunk_ids)}")

    def returned_ids(records, key_names):
        found = set()
        for record in records if isinstance(records, list) else []:
            if not isinstance(record, dict):
                continue
            for key in key_names:
                value = record.get(key)
                if isinstance(value, str) and value:
                    found.add(value)
                    break
        return found

    expected = set(chunk_ids)
    found_text = returned_ids(text_chunks, ("_id", "id"))
    found_vectors = returned_ids(chunk_vectors, ("id", "_id"))
    missing_text = expected - found_text
    missing_vectors = expected - found_vectors
    if missing_text:
        problems.append(f"{len(missing_text)} indexed chunks are missing from the text chunk store")
    if missing_vectors:
        problems.append(f"{len(missing_vectors)} indexed chunks are missing from the chunk vector store")
    return problems


def _single_attempt(func):
    """Call through LightRAG's tenacity decorator when available to avoid hidden retries."""
    return getattr(func, "__wrapped__", func)


def _telemetry(event: str, **fields):
    print(json.dumps({"telemetry": event, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **fields}), file=sys.stderr, flush=True)


async def _bounded_call(semaphore, timeout_seconds: int, label: str, awaitable_factory, usage: UsageTracker):
    started = time.monotonic()
    async with semaphore:
        usage.begin_call()
        _telemetry("provider_call_started", operation=label, timeoutSeconds=timeout_seconds)
        try:
            result = await asyncio.wait_for(awaitable_factory(), timeout=timeout_seconds)
            usage.complete_call()
            _telemetry("provider_call_completed", operation=label, elapsedMs=int((time.monotonic() - started) * 1000))
            return result
        except Exception as exc:
            usage.fail_call(label, exc)
            _telemetry("provider_call_failed", operation=label, elapsedMs=int((time.monotonic() - started) * 1000), errorType=type(exc).__name__)
            raise


def _llm_funcs(usage: UsageTracker, semaphore):
    from lightrag.llm.openai import openai_complete_if_cache

    base_url = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    # Match the TypeScript router's provider-diverse defaults. Explicit RAG_* and
    # OPENROUTER_* variables remain authoritative.
    model = os.environ.get("RAG_LLM_MODEL", os.environ.get("OPENROUTER_MODEL", "qwen/qwen3.8-flash"))
    vision_model = os.environ.get("RAG_VISION_MODEL", os.environ.get("OPENROUTER_VISION_MODEL", "deepseek/deepseek-v4-flash-vision-exp"))

    request_timeout = _positive_int("RAG_REQUEST_TIMEOUT_SECONDS", 35, 120)

    async def llm_model_func(prompt, system_prompt=None, history_messages=None, model_override=None, **kwargs):
        kwargs.pop("timeout", None)
        kwargs.pop("token_tracker", None)
        async def call():
            # LightRAG wraps this helper in tenacity (3 attempts); call the undecorated
            # implementation and keep a single bounded attempt under our timeout.
            return await _single_attempt(openai_complete_if_cache)(
                model_override or model, prompt, system_prompt=system_prompt,
                history_messages=history_messages or [], api_key=api_key, base_url=base_url,
                timeout=request_timeout, token_tracker=usage,
                openai_client_configs={"max_retries": 0}, **kwargs,
            )
        return await _bounded_call(semaphore, request_timeout + 5, "llm", call, usage)

    async def vision_model_func(prompt, system_prompt=None, history_messages=None, image_data=None, messages=None, **kwargs):
        if messages:
            return await llm_model_func("", system_prompt=None, history_messages=[], messages=messages, model_override=vision_model, **kwargs)
        if image_data:
            user = [{"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_data}"}}]
            msgs = ([{"role": "system", "content": system_prompt}] if system_prompt else []) + [{"role": "user", "content": user}]
            return await llm_model_func("", system_prompt=None, history_messages=[], messages=msgs, model_override=vision_model, **kwargs)
        return await llm_model_func(prompt, system_prompt, history_messages, **kwargs)

    return llm_model_func, vision_model_func


def _embedding_func(usage: UsageTracker, semaphore):
    from lightrag.utils import EmbeddingFunc
    from lightrag.llm.openai import openai_embed

    explicit = bool(os.environ.get("EMBEDDINGS_API_KEY"))
    api_key = os.environ.get("EMBEDDINGS_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    base_url = os.environ.get("EMBEDDINGS_BASE_URL") or (
        os.environ.get("EMBEDDINGS_API_URL", "").rstrip("/").removesuffix("/embeddings")
        or ("https://api.openai.com/v1" if explicit else "https://openrouter.ai/api/v1")
    )
    model = os.environ.get("EMBEDDINGS_MODEL") or ("text-embedding-3-small" if explicit else "openai/text-embedding-3-small")
    if not api_key:
        raise RuntimeError("No embedding provider: set EMBEDDINGS_API_KEY or OPENROUTER_API_KEY")
    request_timeout = _positive_int("RAG_REQUEST_TIMEOUT_SECONDS", 35, 120)
    async def embed(texts, **kwargs):
        kwargs.pop("token_tracker", None)
        async def call():
            # The embedding helper has its own tenacity wrapper too; bypass it so
            # attempt telemetry and the wall-clock bound describe actual requests.
            return await _single_attempt(openai_embed.func)(
                texts, model=model, api_key=api_key, base_url=base_url,
                token_tracker=usage,
                client_configs={"timeout": request_timeout, "max_retries": 0}, **kwargs,
            )
        return await _bounded_call(semaphore, request_timeout + 5, "embedding", call, usage)
    return EmbeddingFunc(
        embedding_dim=int(os.environ.get("EMBEDDINGS_DIM", "1536")),
        max_token_size=8192,
        func=embed,
    )


def _embedding_ready() -> bool:
    """Match `_embedding_func`: OpenRouter credentials also provide embeddings."""
    return bool(os.environ.get("EMBEDDINGS_API_KEY") or os.environ.get("OPENROUTER_API_KEY"))


async def _build(working_dir: str, usage: UsageTracker, semaphore, multimodal_monitor: MultimodalMonitor | None = None):
    """Build RAG-Anything over a pre-initialized LightRAG instance.

    We never parse in this process (Docling already did), so the default MinerU parser
    check must not run. Passing an explicit LightRAG instance bypasses it entirely.
    """
    from lightrag import LightRAG
    from lightrag.kg.shared_storage import initialize_pipeline_status
    from raganything import RAGAnything, RAGAnythingConfig

    llm_model_func, vision_model_func = _llm_funcs(usage, semaphore)
    embedding_func = _embedding_func(usage, semaphore)
    lightrag = LightRAG(
        working_dir=working_dir,
        llm_model_func=llm_model_func,
        embedding_func=embedding_func,
        max_parallel_insert=_positive_int("RAG_ITEM_CONCURRENCY", 4, 12),
        llm_model_max_async=_positive_int("RAG_MODEL_CONCURRENCY", 4, 12),
    )
    await lightrag.initialize_storages()
    await initialize_pipeline_status()
    config = RAGAnythingConfig(
        working_dir=working_dir,
        enable_image_processing=True,
        enable_table_processing=True,
        enable_equation_processing=True,
    )
    rag = RAGAnything(
        config=config,
        lightrag=lightrag,
        vision_model_func=vision_model_func,
    )
    # We never parse in this process (Docling already did), so skip RAG-Anything's
    # document-parser installation check — it only guards the parser we do not use.
    rag._parser_installation_checked = True
    if multimodal_monitor is not None:
        if not rag.modal_processors:
            rag._initialize_processors()
        for content_type, processor in rag.modal_processors.items():
            original = getattr(processor, "generate_chunk_sections", None)
            if not callable(original):
                continue
            async def tracked(*args, _original=original, _content_type=content_type, **kwargs):
                try:
                    result = await _original(*args, **kwargs)
                    if result:
                        multimodal_monitor.completed += 1
                    else:
                        multimodal_monitor.failed += 1
                        multimodal_monitor.failures.append({"type": _content_type, "error": "processor returned no generated sections"})
                    return result
                except Exception as exc:
                    multimodal_monitor.failed += 1
                    multimodal_monitor.failures.append({"type": _content_type, "errorType": type(exc).__name__, "message": str(exc)[:250]})
                    raise
            processor.generate_chunk_sections = tracked
    return rag


async def _index(payload: dict, usage: UsageTracker, semaphore) -> dict:
    content_list = payload.get("contentList") or []
    if not content_list:
        raise RuntimeError("contentList is empty")
    multimodal_items = [item for item in content_list if item.get("type") in {"image", "table", "equation"}]
    monitor = MultimodalMonitor(len(multimodal_items))
    _telemetry("index_started", itemCount=len(content_list), multimodalItems=len(multimodal_items))
    rag = await _build(payload["workingDir"], usage, semaphore, monitor)
    await rag.insert_content_list(
        content_list=content_list,
        file_path=payload.get("filePath", "document.pdf"),
        doc_id=payload.get("docId"),
        display_stats=False,
        force_multimodal_reprocess=bool(payload.get("forceMultimodalReprocess", False)),
    )
    await rag.finalize_storages()
    lightrag = rag.lightrag
    doc_id = payload.get("docId")
    status_doc = await lightrag.doc_status.get_by_id(doc_id) if lightrag is not None and doc_id else None
    chunk_ids = status_doc.get("chunks_list", []) if isinstance(status_doc, dict) else []
    chunk_ids = [chunk_id for chunk_id in chunk_ids if isinstance(chunk_id, str)] if isinstance(chunk_ids, list) else []
    text_chunks = await lightrag.text_chunks.get_by_ids(chunk_ids) if lightrag is not None and chunk_ids else []
    chunk_vectors = await lightrag.chunks_vdb.get_by_ids(chunk_ids) if lightrag is not None and chunk_ids else []
    store_problems = index_store_completion_problems(status_doc, text_chunks, chunk_vectors)
    stores = {"indexedChunks": len(chunk_ids),
              "textChunks": sum(isinstance(row, dict) for row in text_chunks),
              "chunkVectors": sum(isinstance(row, dict) for row in chunk_vectors),
              "verified": not store_problems,
              "problems": store_problems}
    status = _index_status(monitor, usage)
    if store_problems:
        status = "partial"
    complete = status == "complete"
    _telemetry(f"index_{status}", itemCount=len(content_list), multimodal=monitor.snapshot(), stores=stores, usage=usage.snapshot())
    return {"ok": True, "docId": payload.get("docId"), "items": len(content_list), "indexStatus": status,
            "multimodal": monitor.snapshot(), "stores": stores, "actualUsage": usage.snapshot(),
            **({} if complete else {"error": "RAG-Anything insertion did not produce a fully verified index; provider, multimodal, or persisted chunk/vector checks failed."})}


async def _query(payload: dict, usage: UsageTracker, semaphore) -> dict:
    from lightrag import QueryParam

    rag = await _build(payload["workingDir"], usage, semaphore)
    # Return retrieval data instead of an answer-only response. The TypeScript
    # boundary maps verbatim retrieved chunks back to citation-bearing SourceDoc
    # spans and never treats generated figure descriptions as factual evidence.
    light_rag = getattr(rag, "lightrag", None)
    if light_rag is None or not hasattr(light_rag, "aquery_data"):
        raise RuntimeError("RAG-Anything does not expose LightRAG.aquery_data for retrieval-only queries")
    _telemetry("query_started")
    result = await light_rag.aquery_data(
        payload["question"],
        param=QueryParam(
            mode=payload.get("mode", "naive"),
            top_k=int(payload.get("topK", 20)),
            chunk_top_k=int(payload.get("chunkTopK", 12)),
        ),
    )
    query_status = _query_status(usage)
    await rag.finalize_storages()
    _telemetry(f"query_{query_status}", usage=usage.snapshot())
    return {"ok": True, "data": result, "queryStatus": query_status, "actualUsage": usage.snapshot(),
            **({} if query_status == "complete" else {"error": "RAG query returned after one or more provider calls failed; retrieved chunks are not trusted as complete."})}


async def _check(_payload: dict) -> dict:
    import raganything  # noqa: F401
    import lightrag

    return {
        "ok": True,
        "raganything": "ok",
        "lightrag": getattr(lightrag, "__version__", "unknown"),
        "llm": bool(os.environ.get("OPENROUTER_API_KEY")),
        "embeddings": _embedding_ready(),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["check", "index", "query"])
    args = ap.parse_args()
    raw = sys.stdin.read().strip()
    payload = json.loads(raw) if raw else {}
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    usage = UsageTracker()
    semaphore = asyncio.Semaphore(_positive_int("RAG_API_CONCURRENCY", 4, 12))
    try:
        if args.command == "check":
            result = asyncio.run(_check(payload))
        else:
            operation = _index(payload, usage, semaphore) if args.command == "index" else _query(payload, usage, semaphore)
            default_timeout = 210 if args.command == "index" else 90
            timeout = _positive_int("RAG_OPERATION_TIMEOUT_SECONDS", default_timeout, 600)
            result = asyncio.run(asyncio.wait_for(operation, timeout=timeout))
        print(json.dumps(result))
        return 0
    except Exception as exc:  # noqa: BLE001
        _telemetry("operation_failed", command=args.command, errorType=type(exc).__name__, message=str(exc)[:500], usage=usage.snapshot())
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}",
                          "trace": traceback.format_exc()[-1200:], "actualUsage": usage.snapshot(),
                          "costUsd": None, "costStatus": "unknown; upstream did not return billed dollars"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
