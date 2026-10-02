# Lamina reference pack — observations (SIMI-REF)

Built by `scripts/lamina-reference.mjs` from `../lamina-labs-video/*.mp4`. There are 33 scenes; each
`*-sceneNN.png` tiles 6 frames, from the start of the scene to just before the cut. `index.json` records
the scene boundaries.

Scene cuts are found by a sharp drop in dark-pixel ("ink") mass, because the board is cleared between
scenes. ffmpeg's `scene` score detects almost none of these cuts, since the frames are mostly white.
The four scenes found in the Attention video match its four on-screen titles.

These are observations from the frames only. They describe what the videos look like, not how Lamina
builds them.

## Timing
- Scene length: median about 18 s, range 10.5–28.5 s across all 33 scenes. A 75 s video has 4 scenes.
- A board builds up over the whole scene. Elements appear one at a time, in step with the narration.
  The finished board is only visible in the last few seconds.

## Drawing
- Icons draw the outline first, then fill. Frames caught mid-reveal show empty outlined keys and a sun
  whose yellow fill is only half wiped in (`lamina-video-...-scene03`, `simi-scene02`).
- An arrow is drawn from its source before the target appears, so the arrow leads the eye to what comes
  next (`simi-scene02`: LEAF → , then CHLOROPLAST).
- Each element appears where it ends up. Nothing moves after it is drawn, so positions are fixed for the
  whole scene.

## Composition
- The title is large, uppercase and hand-lettered, centred at the top, about 5–6% of the frame height.
- Every concept is a flat pastel-filled icon with a black outline. It has an uppercase label underneath,
  or a side label for quantities and attributes ("CHLOROPHYLL", "0.5 SAT").
- Icons are about 120–200 px tall at 1080p. Arrows are short, with open arrowheads.
- Layout reads left to right, then top to bottom, and grows toward free space. It is not strictly
  centred. At the end of a scene the content covers about 50–70% of the frame.
- Some scenes are icon + arrow + text rows (list_icon); others are fan-out/convergence flows. In the
  longer videos a scene often combines two of these patterns.
- Text is used sparingly: a short handwritten caption at most ("Do a blindspot pass before we start.").

## Not seen in the reference
- No typeset formulas, plots or number lines. The math primitives in this track have no Lamina
  counterpart.
