#!/usr/bin/env python3
"""Docling sidecar for explain-canvas-lab ingestion.

Reads one document, runs Docling, and writes a machine-readable bundle the Node
runtime consumes:

    <out>/docling.json   full DoclingDocument (typed items, page + bbox)
    <out>/document.md    markdown view (debug / fallback text)
    <out>/crops/*.png    picture + table crops (content-addressed by sha256)
    <out>/meta.json      counts + per-item provenance sidecar

Contract: prints ONE JSON object to stdout on success:
    {"ok":true,"out":..., "json":..., "markdown":..., "meta":...,
     "pages":N,"tables":N,"pictures":N,"formulas":N,"crops":N,"device":"mps"}
On failure prints {"ok":false,"error":"..."} to stdout and exits non-zero.

This process owns no product logic; it only parses. The Node side maps
meta.json items into SourceDoc text, page locations and figures
(src/experimental/hypothesis/v1_claude/plan/intake/pdfDocling.ts).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
import traceback
from pathlib import Path


def _bbox(prov) -> dict | None:
    if not prov:
        return None
    p = prov[0]
    b = getattr(p, "bbox", None)
    if b is None:
        return {"page": getattr(p, "page_no", None)}
    return {
        "page": getattr(p, "page_no", None),
        "l": float(getattr(b, "l", 0.0)),
        "t": float(getattr(b, "t", 0.0)),
        "r": float(getattr(b, "r", 0.0)),
        "b": float(getattr(b, "b", 0.0)),
        "coord": str(getattr(b, "coord_origin", "")),
    }


def _page(prov) -> int | None:
    if not prov:
        return None
    return getattr(prov[0], "page_no", None)


def _label(item) -> str:
    lab = getattr(item, "label", None)
    return getattr(lab, "value", str(lab)) if lab is not None else type(item).__name__


def _text_of(item) -> str:
    for attr in ("text", "orig"):
        v = getattr(item, attr, None)
        if isinstance(v, str) and v.strip():
            return v
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    # Apple Silicon has MPS; everywhere else the portable default is CPU.
    default_device = "mps" if sys.platform == "darwin" and platform.machine() == "arm64" else "cpu"
    ap.add_argument("--device", default=os.environ.get("DOCLING_DEVICE", default_device))
    ap.add_argument("--threads", type=int, default=int(os.environ.get("DOCLING_NUM_THREADS", "8")))
    ap.add_argument("--ocr", default=os.environ.get("DOCLING_OCR", "on"), choices=["on", "off"])
    ap.add_argument("--formulas", default=os.environ.get("DOCLING_FORMULAS", "on"), choices=["on", "off"])
    ap.add_argument("--images-scale", type=float, default=float(os.environ.get("DOCLING_IMAGES_SCALE", "2")))
    ap.add_argument("--page-batch", type=int, default=int(os.environ.get("DOCLING_PAGE_BATCH", "4")))
    ap.add_argument("--max-pages", type=int, default=int(os.environ.get("DOCLING_MAX_PAGES", "0")))
    args = ap.parse_args()

    src = Path(args.input)
    if not src.is_file():
        print(json.dumps({"ok": False, "error": f"input not found: {src}"}))
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    crops_dir = out / "crops"
    crops_dir.mkdir(parents=True, exist_ok=True)

    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import (
            PdfPipelineOptions,
            AcceleratorOptions,
            AcceleratorDevice,
        )

        device_name = args.device.upper()
        device = getattr(AcceleratorDevice, device_name, AcceleratorDevice.CPU)
        # Docling's formula-enrichment model (CodeFormulaVLM) supports cpu/cuda/xpu
        # only — not MPS. When formulas are requested on Apple Silicon, run the whole
        # pipeline on CPU rather than fail.
        device_fallback = False
        if args.formulas == "on" and device == AcceleratorDevice.MPS:
            device = AcceleratorDevice.CPU
            device_name = "CPU"
            device_fallback = True
        accel = AcceleratorOptions(num_threads=max(1, args.threads), device=device)

        pipeline = PdfPipelineOptions()
        pipeline.accelerator_options = accel
        pipeline.images_scale = args.images_scale
        pipeline.generate_picture_images = True
        pipeline.generate_table_images = True
        pipeline.do_table_structure = True
        pipeline.do_ocr = args.ocr == "on"
        pipeline.do_formula_enrichment = args.formulas == "on"
        pipeline.do_picture_description = False
        pipeline.do_picture_classification = False
        pipeline.do_code_enrichment = False
        try:
            pipeline.ocr_batch_size = max(1, args.page_batch)
            pipeline.layout_batch_size = max(1, args.page_batch)
            pipeline.table_batch_size = max(1, min(4, args.page_batch))
        except Exception:
            pass

        # Prefer RapidOCR (PaddleOCR ONNX models) when present; else Docling default.
        try:
            from docling.datamodel.pipeline_options import RapidOcrOptions

            pipeline.ocr_options = RapidOcrOptions()
        except Exception:
            pass

        converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline)}
        )
        if args.max_pages and args.max_pages > 0:
            result = converter.convert(str(src), page_range=(1, args.max_pages))
        else:
            result = converter.convert(str(src))
        doc = result.document
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}",
                          "trace": traceback.format_exc()[-1200:]}))
        return 1

    # ---- typed items in reading order -------------------------------------
    items: list[dict] = []
    formula_count = 0
    try:
        iterator = doc.iterate_items()
    except Exception:
        iterator = ()
    for entry in iterator:
        item = entry[0] if isinstance(entry, tuple) else entry
        label = _label(item)
        prov = getattr(item, "prov", None)
        base = {
            "type": label,
            "page": _page(prov),
            "bbox": _bbox(prov),
            "selfRef": getattr(item, "self_ref", None),
        }
        if label in ("formula",):
            formula_count += 1
            base["latex"] = _text_of(item)
        elif label in ("picture", "table"):
            base["captions"] = []
            for cap in getattr(item, "captions", []) or []:
                try:
                    cap_text = getattr(cap.resolve(doc), "text", None)
                except Exception:
                    cap_text = None
                if cap_text:
                    base["captions"].append(cap_text)
            if label == "table":
                try:
                    grid = item.data.grid
                    cells = [[(getattr(c, "text", "") or "") for c in row] for row in grid]
                    base["columns"] = cells[0] if cells else []
                    base["rows"] = cells[1:] if len(cells) > 1 else []
                except Exception:
                    pass
        else:
            base["text"] = _text_of(item)
        items.append(base)

    # ---- picture + table crops -------------------------------------------
    crops: list[dict] = []
    for kind, collection in (("picture", doc.pictures), ("table", doc.tables)):
        for idx, item in enumerate(collection):
            try:
                img = item.get_image(doc) if hasattr(item, "get_image") else None
            except Exception:
                img = None
            if img is None:
                continue
            try:
                import io

                buf = io.BytesIO()
                img.convert("RGB").save(buf, format="PNG")
                data = buf.getvalue()
                sha = hashlib.sha256(data).hexdigest()
                name = f"{kind}-{idx:03d}-{sha[:12]}.png"
                (crops_dir / name).write_bytes(data)
                prov = getattr(item, "prov", None)
                crops.append({
                    "kind": kind,
                    "file": f"crops/{name}",
                    "sha256": sha,
                    "selfRef": getattr(item, "self_ref", None),
                    "page": _page(prov),
                    "bbox": _bbox(prov),
                    "width": img.width,
                    "height": img.height,
                })
            except Exception as exc:  # noqa: BLE001
                crops.append({"kind": kind, "selfRef": getattr(item, "self_ref", None), "error": f"{type(exc).__name__}: {exc}"})

    # ---- persistence ------------------------------------------------------
    try:
        (out / "docling.json").write_text(json.dumps(doc.export_to_dict(), ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"export_to_dict failed: {exc}"}))
        return 1
    markdown = ""
    try:
        markdown = doc.export_to_markdown()
        (out / "document.md").write_text(markdown)
    except Exception:
        pass

    try:
        num_pages = len(doc.pages)
    except Exception:
        num_pages = 0

    meta = {
        "parser": "docling",
        "device": device_name.lower(),
        "deviceFallback": device_fallback,
        # Settings and counts use distinct keys (a repeated dict key silently
        # overwrote the OCR/formula settings and the item count).
        "ocrMode": args.ocr,
        "formulaMode": args.formulas,
        "pages": num_pages,
        "tables": len(doc.tables),
        "pictures": len(doc.pictures),
        "formulas": formula_count,
        "crops": len([c for c in crops if "file" in c]),
        "itemCount": len(items),
        "itemKinds": sorted({i["type"] for i in items}),
        "items": items,
        "cropsIndex": crops,
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))

    print(json.dumps({
        "ok": True,
        "out": str(out),
        "json": str(out / "docling.json"),
        "markdown": str(out / "document.md"),
        "meta": str(out / "meta.json"),
        "pages": num_pages,
        "tables": len(doc.tables),
        "pictures": len(doc.pictures),
        "formulas": formula_count,
        "crops": meta["crops"],
        "device": device_name.lower(),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
