# WaveSort

WaveSort is a local-first Windows desktop app for turning an unstructured sample library into reviewable category folders.

## Current workflow

1. Choose a source folder and scan it recursively.
2. Review the category guesses, cue-strength labels, metadata, and the cue behind each guess.
3. Adjust one file or apply a category correction to the selected batch; corrections are remembered for that source library. Optionally, in a file's review panel, click **Suggest from sound**, edit the proposed output name, and accept or dismiss it.
4. Choose a destination and review a dry-run plan showing category totals, destination paths, warnings, and files that need attention.
5. Execute the approved plan to copy the selected files into category folders. Moving originals is available as an explicit second option.
6. Undo the last operation when the recorded source/output state is still safe to reverse.

Scanning reports live progress, reuses unchanged files on later scans, reports added/changed/removed counts, and can be cancelled. A cancelled or safety-limited scan remains visible for inspection but cannot be sorted until a complete scan finishes.

During copy, move, resume, retry, and undo, WaveSort shows percentage complete, files and bytes completed, elapsed time, estimated remaining time, and the current file. The operation path uses append-only journal checkpoints so large libraries do not rewrite the entire report for every file.

WaveSort classifies using folder and filename cues. This keeps category decisions explainable and works well with sample-pack conventions such as `808`, `kicks`, `snares`, `hats`, `open hats`, `percs`, `vox`, `loops`, `melodies`, `FX`, `risers`, and `one-shots`. Compact aliases such as `HHat`, `hhats`, `ohats`, and numbered names like `openhat5` are recognized; a rescan refreshes older cached guesses. Classification keeps a sound family separate from its form, so a kick one-shot can sort to `One-Shots/Kicks` and a melody loop to `Loops/Melodies`. The optional sound-name tool is separate from classification: it never changes category or destination folders.

For repetitive packs, **Select similar files** groups names in the same folder after take numbers and producer tags are removed; review the selection before applying the existing bulk category correction. **Library rules** adds root-scoped, literal filename aliases with an impact preview before saving. Saved manual corrections take precedence over rules. **Accuracy** offers a reproducible small queue across predicted categories. Listen to each sound and set its independent verified type in the file details or queue; the panel then reports wrong auto-sorts, correct auto-sorts, and review decisions on verified files only. Labels are tied to the scanned file fingerprint and do not change sorting. See [CLASSIFIER_BENCHMARK.md](C:/Users/chris/OneDrive/Documents/VsCode/WaveSort/CLASSIFIER_BENCHMARK.md) for evaluation limits.

Sound-name V1 is a local, offline heuristic for isolated 0.04–3-second uncompressed PCM (16/24-bit) or float (32-bit) WAV files up to 6 MB. It measures attack, decay, brightness/noisiness, and duration to propose words such as `Tss`, `Tchik`, or `Thump`; the sound-type prefix comes from the reviewed category, not audio recognition. It cannot reliably recognize a sound or prove its source. Loops, stems, textures, unsupported codecs, long/large files, silence, corrupt data, and ambiguous envelopes return no reliable suggestion. Analysis occurs only when requested, and accepting a name affects only the planned destination copy/move. The original extension is kept; the final collision-safe filename appears in the dry-run plan. Rescanning clears unexecuted name choices.

Supported audio files: WAV, MP3, FLAC, AIFF/AIF, M4A, OGG, OPUS, AAC, and WMA. Sidecars such as Ableton `.asd` files, text metadata, and archives are ignored.

## Operation safety

- Planning does not change the source or destination.
- Sources are rechecked immediately before each file is processed.
- Existing destination files are never overwritten; collisions receive a numbered filename.
- Copies are size-verified before a move removes the original.
- Each run writes a local operation journal and reports processed, skipped, changed, missing, and failed files separately.
- Journals include bounded source fingerprints, use append-only per-file checkpoints with atomic snapshots, and can be resumed or retried after cancellation or an application restart.
- Undo only touches outputs recorded by that operation and refuses unsafe reversals.
- Family/form classification drives nested destinations without hiding the legacy category filters.
- Inaccessible directories/files, skipped symbolic links, and scan-limit stops appear in a scan report.
- Audio preview is range-streamed; bounded WAV/FLAC/AIFF metadata is shown without loading the entire file into memory.
- The report action opens the durable JSON journal for the last operation.
- The interface uses a near-black base with a locally saved accent color in Settings.

The classifier remains explainable filename/folder heuristics rather than waveform understanding. Cue strength is not a calibrated probability, and browser-level playback coverage varies by codec. See the remaining limitations and verification gates in [AUDIT_NEXT_STEPS.md](C:/Users/chris/OneDrive/Documents/VsCode/WaveSort/AUDIT_NEXT_STEPS.md).

## Development

```text
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check
pnpm dev
```

The portable Windows build is produced with `pnpm package:portable` and written to `release/WaveSort-0.1.0-x64.exe`. It is unsigned and uses Electron's default icon in this milestone.

The app does not upload audio, use an account, or send telemetry.
