# Shared hypothesis harness

This directory contains only architecture-neutral contracts, frozen fixtures,
artifact hashing, low-level SVG helpers, and deterministic evaluation gates.
It is copied byte-for-byte into both isolated worktrees. Track implementations
must not edit these files independently; shared changes are copied to both trees
and the manifest is regenerated.

Scored runs are 30 seconds, 1920×1080, 30 fps, one repair maximum, and at most
$0.10 per clip. Fixture mode may use deterministic word timings; live mode must
use a calibrated forced aligner and cannot silently change configured models.
