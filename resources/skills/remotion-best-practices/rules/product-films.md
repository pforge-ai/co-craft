---
name: product-films
description: Product launch and demonstration films with grounded claims and deliberate sound-led editing
metadata:
  tags: product, demo, narrative, sound, verification
---

Read this rule for promotional, launch, and competition films. It supplements the technical animation and audio rules; it does not prescribe a visual style or fixed duration.

## Start from the viewer's question

Choose a concrete situation that makes the product valuable. Let an observable action or exchange carry the explanation. A useful visual beat contains one focal idea; avoid converting a full presentation into cards that all settle and remain still.

Build a timeline from actual voice durations, response pauses, and readable text. Keep a single timing source for voice, captions, shot boundaries, and music ducking. Long dialogue needs space to breathe; transitions should not collide with consonants or cover the useful UI action.

## Make evidence legible

Use fresh product capture when showing current behavior. Preserve the source capture and the exact displayed model text. Crop, enlarge, or pan to the decisive interaction rather than shrinking the entire application until nothing is readable.

Keep these distinctions clear in the film or its production notes, according to their relevance:

- Actual runtime behavior versus a proposed integration or concept animation.
- A scripted input with an actual model response versus a spontaneous user study.
- Synthesized matching dialogue versus a continuous live microphone recording.
- External market data versus the product's measured impact or conversion.

Don't invent charts to imply measured frequency. A labeled sequence of use cases is often clearer for a strategy hypothesis. Preserve each statistic's population, date, unit, and source.

## Compose sound and imagery together

Use generated raster imagery when it improves the story, with deliberate subject placement and negative space. Preserve the prompt and provenance alongside project assets. Don't use decorative generated UI as proof of shipped behavior.

Measure voice and music levels; reduce the music during speech and inspect the final mix for clipping. If animating a voice meter, derive it from the real audio envelope. Synthetic source audio can be checked by independent transcription for difficult proper names. Objective signal checks do not establish subjective listening quality.

## Accept the rendered result

Review frames at entrances, transitions, and before exits as well as the settled hero frames. Check meaningful Chinese line breaks, text edges, safe areas, sprite-sheet cropping, screenshot readability, and unintended layering. A thumbnail contact sheet is useful for composition; inspect full-size frames for text.

With `@remotion/media`, pass `objectFit` as the media component prop. A video layered over a still can expose the wrong image at the edges if their sizing differs; verify the rendered frame, not just the JSX.

Decode the final export, confirm duration, dimensions, frame rate, and audio streams, and inspect representative frames from the final encoded file. Deliver a playable local movie, a cover, reproducible source, and concise provenance notes. Avoid calling a production complete solely because TypeScript and the renderer pass.
