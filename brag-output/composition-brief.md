# Hyperframes Composition Brief: WaveSort

## Objective

Create a 21-second landscape launch film for WaveSort that demonstrates its real choose → review → approve copy workflow. The rendering composition belongs in `brag-output/composition/`; final MP4 and poster belong in `brag-output/`.

## Source material

- Project root: `C:/Users/chris/OneDrive/Documents/VsCode/WaveSort`
- Inspected: `index.html`, `src/renderer/App.tsx`, `src/renderer/styles.css`, `README.md`, `package.json`
- Product: WaveSort, a local-first Windows sample-folder organizer.
- Key UI: near-black review table, right file-detail pane, explicit copy-plan modal, operation progress.
- Verbatim app copy to include: “Sort your sounds.”, “Choose a folder”, “Your sounds”, “Copy plan”, “Copy verified plan”, “Local only”.
- Demo filenames/counts are fictional; they must not look like a real user library screenshot.

## Creative direction

Polished, quiet, precise tool film. Hook with the friction of scattered samples, then show the actual action and controlled result. Do not imply waveform recognition: current classification is based on filename/folder cues and can be corrected. Do not imply any automatic destructive move. No generic productivity claims, abstract filler, or unrelated oscilloscope visuals.

## Visual identity

- Background `#080a0b`; text `#ecf0ef`; accent `#d9ad6b`.
- Inter/system/Segoe UI sans; preserve WaveSort’s restrained interface hierarchy.
- Video adaptation may enlarge interface type and frame only the important UI regions for legibility, but not invent features.

## Storyboard

Use `brag-plan.md` as the creative contract:

1. Unsorted — 2.5s — “Your samples. Everywhere.” + illustrative filenames.
2. Choose and scan — 4.5s — empty state, click “Choose a folder”, review table populates.
3. Review — 7s — categories, selected file, one correction.
4. Review, then copy — 4.5s — explicit “Copy plan” and “Copy verified plan”, progress to completion.
5. WaveSort — 2.5s — “Sorted. Originals untouched.”, wordmark and “Local only”.

## Audio

- No narration.
- Low music bed: `happy-beats-business-moves-vol-10-by-ende-dot-app.mp3` from the brag skill bundle, copied locally into `assets/music/`.
- Bundled cue preset estimates 109.96 BPM; optional beat points near 2.46, 5.19, 6.28, 7.35, 8.73, 9.83, 10.93, 12.02, 13.11 and strong cues at 15.82/18.55 seconds. Shift only when readability survives.
- Sparse low-risk SFX for visible click, row reveal, copy completion. Choose exact assets/timing during composition.
- Optional audio-reactive gold focus warmth if extraction works. Never add a waveform/equalizer.
- Fade bed out on final card. The track page lists CC BY 4.0; share caption includes attribution.

## Implementation and delivery

Follow official Hyperframes core, animation, creative, keyframes, and CLI contracts. Keep animation seek-safe and assets local. Run `hyperframes check` with zero errors; inspect key frames for legibility. Render `brag.mp4`, pick a settled poster into `brag.jpg`, bake it as frame zero, and write one share caption in `share-copy.txt`.
