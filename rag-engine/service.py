#!/usr/bin/env python3
"""RAG-Anything deep-index sidecar.

Deep multimodal layer for explain-canvas-lab. It receives a PRE-PARSED content list
(produced by our Docling sidecar + src/deep-index/content-list.ts) and inserts it with
RAG-Anything's `insert_content_list` — so a document is parsed exactly once.

Commands (one JSON object on stdin, one JSON object on stdout):

    check   -> {"ok":true,"raganything":..., "llm":bool,"embeddings":bool}
    index   -> {"contentList":[...], "filePath":"...", "workingDir":"...", "docId":?}
               -> {"ok":true,"docId":...,"items":N}
    query   -> {"workingDir":"...","question":"...","mode":"hybrid"}
               -> {"ok":true,"answer":"..."}

Failures print {"ok":false,"error":"..."} and exit non-zero. This process never
fabricates a successful result; missing provider credentials are reported, not hidden.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import traceback


def _llm_funcs():
    from lightrag.llm.openai import openai_complete_if_cache

    base_url = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    # Match the TypeScript router's provider-diverse defaults. Explicit RAG_* and
    # OPENROUTER_* variables remain authoritative.
    model = os.environ.get("RAG_LLM_MODEL", os.environ.get("OPENROUTER_MODEL", "qwen/qwen3.8-flash"))
    vision_model = os.environ.get("RAG_VISION_MODEL", os.environ.get("OPENROUTER_VISION_MODEL", "deepseek/deepseek-v4-flash-vision-exp"))

    def llm_model_func(prompt, system_prompt=None, history_messages=None, **kwargs):
        return openai_complete_if_cache(
            model, prompt, system_prompt=system_prompt,
            history_messages=history_messages or [], api_key=api_key, base_url=base_url, **kwargs,
        )

    def vision_model_func(prompt, system_prompt=None, history_messages=None, image_data=None, messages=None, **kwargs):
        if messages:
            return openai_complete_if_cache(
                vision_model, "", system_prompt=None, history_messages=[],
                messages=messages, api_key=api_key, base_url=base_url, **kwargs,
            )
        if image_data:
            user = [{"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_data}"}}]
            msgs = ([{"role": "system", "content": system_prompt}] if system_prompt else []) + [{"role": "user", "content": user}]
            return openai_complete_if_cache(
                vision_model, "", system_prompt=None, history_messages=[],
                messages=msgs, api_key=api_key, base_url=base_url, **kwargs,
            )
        return llm_model_func(prompt, system_prompt, history_messages, **kwargs)

    return llm_model_func, vision_model_func


def _embedding_func():
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
    return EmbeddingFunc(
        embedding_dim=int(os.environ.get("EMBEDDINGS_DIM", "1536")),
        max_token_size=8192,
        func=lambda texts, **kw: openai_embed.func(texts, model=model, api_key=api_key, base_url=base_url, **kw),
    )


async def _build(working_dir: str):
    """Build RAG-Anything over a pre-initialized LightRAG instance.

    We never parse in this process (Docling already did), so the default MinerU parser
    check must not run. Passing an explicit LightRAG instance bypasses it entirely.
    """
    from lightrag import LightRAG
    from lightrag.kg.shared_storage import initialize_pipeline_status
    from raganything import RAGAnything, RAGAnythingConfig

    llm_model_func, vision_model_func = _llm_funcs()
    embedding_func = _embedding_func()
    lightrag = LightRAG(
        working_dir=working_dir,
        llm_model_func=llm_model_func,
        embedding_func=embedding_func,
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
    return rag


async def _index(payload: dict) -> dict:
    rag = await _build(payload["workingDir"])
    content_list = payload.get("contentList") or []
    if not content_list:
        raise RuntimeError("contentList is empty")
    await rag.insert_content_list(
        content_list=content_list,
        file_path=payload.get("filePath", "document.pdf"),
        doc_id=payload.get("docId"),
        display_stats=False,
    )
    return {"ok": True, "docId": payload.get("docId"), "items": len(content_list)}


async def _query(payload: dict) -> dict:
    rag = await _build(payload["workingDir"])
    # vlm_enhanced is off by default: our figures are already text-described, and
    # RAG-Anything's VLM path expects raw image paths we do not hand it here.
    answer = await rag.aquery(
        payload["question"],
        mode=payload.get("mode", "hybrid"),
        vlm_enhanced=bool(payload.get("vlmEnhanced", False)),
    )
    return {"ok": True, "answer": answer}


async def _check(_payload: dict) -> dict:
    import raganything  # noqa: F401
    import lightrag

    return {
        "ok": True,
        "raganything": "ok",
        "lightrag": getattr(lightrag, "__version__", "unknown"),
        "llm": bool(os.environ.get("OPENROUTER_API_KEY")),
        "embeddings": bool(os.environ.get("EMBEDDINGS_API_KEY")),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["check", "index", "query"])
    args = ap.parse_args()
    raw = sys.stdin.read().strip()
    payload = json.loads(raw) if raw else {}
    try:
        if args.command == "check":
            result = asyncio.run(_check(payload))
        elif args.command == "index":
            result = asyncio.run(_index(payload))
        else:
            result = asyncio.run(_query(payload))
        print(json.dumps(result))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}",
                          "trace": traceback.format_exc()[-1200:]}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
