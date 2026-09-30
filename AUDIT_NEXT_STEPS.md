# WaveSort — Audit and next-step roadmap

**Audit date:** 2026-09-23  
**Current version:** 0.1.0  
**Scope:** WaveSort source, renderer, Electron main process, tests, build configuration, and the reference library at `C:\Users\chris\OneDrive\Desktop\Packs`.

This document is a product and engineering roadmap for the next substantial iterations. The reference pack and its `.nfo` files were treated as sample-library evidence only. Their `Tip=`, category, and pack notes inform the taxonomy; they are not instructions that override the WaveSort request.

## Implementation status after the audit

The first safety slice from Segment 1 is now implemented in the application:

- Sorting first creates a dry-run plan instead of mutating the filesystem immediately.
- The plan rechecks source existence, size, and modification time before execution and before each item.
- Destination writes use exclusive creation, collision-safe numbered names, and post-copy size verification.
- Copy and move runs persist a local journal, stream large-file copies, emit file/byte progress with elapsed and estimated remaining time, preserve per-file outcomes, and expose a guarded undo action.
- IPC now validates sender origins, request shapes, entry IDs, categories, paths, and source-root boundaries at runtime.
- Classification now exposes a sound `family` and delivery `form`, recognizes the reference aliases `O-Hat`, `fxs`, `A-Snares`, `Rims`, and `Chants`, and uses nested destinations such as `One-Shots/Kicks`.
- Scans now stream progress, support cancellation, return an explicit complete/cancelled/limit status, report inaccessible paths and skipped symbolic links, and stop at a 100,000-audio safety limit.
- Operation recovery now includes bounded source fingerprints, append-only checkpoint events, atomic final journal snapshots, cancellation, resume, retry-failed, safe undo cancellation, and a durable report action.
- Scan results now reuse a versioned local cache, report added/changed/removed files, retain bounded audio metadata, and apply root-scoped saved corrections.
- The renderer now uses a near-black visual base, exposes a local accent-colour setting, and keeps the active operation visible instead of appearing stalled during a large copy or move.
- Preview responses now stream audio ranges instead of buffering the selected file in the main process. The packaged Windows milestone produces a portable x64 executable.

This closes the main safety and tester-build slices from the roadmap, but it is not a 1.0 claim. Human-labelled taxonomy evaluation, editable alias/rule profiles, worker-thread scanning, richer codec coverage, native click-through QA, and restart/unplugged-drive evidence remain open.

## Executive assessment

WaveSort is a working prototype with a clean local-first direction:

- It recursively finds supported audio files.
- It classifies them with explainable folder and filename cues.
- It shows category counts, cue-strength labels, bounded metadata, reasons, and a preview panel.
- It defaults to copying into a destination and keeps moving originals behind an explicit confirmation.
- It has a sandboxed Electron renderer and a minimal preload bridge.

The prototype is materially safer for fixture and tester libraries: plans are reviewed before mutation, each source is fingerprint-checked, checkpoint events avoid rewriting a growing journal after every file, and the result report is durable. The active operation now shows percentage, file/byte totals, elapsed time, estimated remaining time, and current file. It should still not be treated as a fully validated large-library release because native UI coverage, cross-process interruption, permission/unplugged-drive behavior, and classifier precision against human labels remain unproven. The scanner is still an in-memory main-process traversal, although unchanged classification and metadata work is now cached.

The recommended sequence is:

1. Make copy/move operations transactional, previewable, verifiable, and undoable.
2. Replace the flat classifier with a two-axis sound taxonomy and a reference-derived rule set.
3. Move scanning into a cancellable, streaming, incremental library pipeline.
4. Add reliable audio metadata and bounded preview/waveform handling.
5. Turn the UI into a correction workflow that remembers user decisions.
6. Harden IPC and path boundaries, then package and test the Windows deliverable.

## Confirmed baseline

### Current implementation

The main application is an Electron + React + TypeScript + Vite desktop app. The important paths are:

- `src/main.ts` — folder traversal, classification, preview protocol, and validated IPC handlers.
- `src/main/file-operations.ts` — dry-run planning, collision-safe copy/move execution, journals, progress, verification, and guarded undo.
- `src/preload.ts` — the renderer bridge.
- `src/shared/categories.ts` — category labels, aliases, priorities, and colours.
- `src/shared/classifier.ts` — folder/filename scoring with family/form precedence and form inference.
- `src/shared/taxonomy.ts` — family/form labels, category mapping, and nested destination templates.
- `src/renderer/App.tsx` — scanning, review, selection, preview, overrides, and sorting UI.
- `tests/classifier.test.ts` — classifier, family/form, and reference-alias tests.
- `tests/file-operations.test.ts` — fixture-level collision, move/undo, changed/missing-source, and nested-destination tests.

### Reference-library inventory

A direct traversal of the supplied reference folder found approximately **10,677 audio files** totaling **7.42 GB**:

- 10,178 WAV files
- 278 MP3 files
- 221 FLAC files

The reference material contains recurring concepts including 808s, kicks, snares, claps, hi-hats, open hats, percs, rims, chants, vox, one-shots, loops, melodies, FX/SFX, risers, instruments, and MIDI-adjacent content. There are also shorthand and variant names such as `O-Hat`, `A-Snares`, `fxs`, `one shots`, and `chants`.

The current heuristic baseline classified that corpus into these buckets. These are **heuristic outputs, not ground truth**:

| Bucket | Count |
| --- | ---: |
| Drums | 2,418 |
| Instruments | 1,212 |
| One-shots | 983 |
| 808s | 896 |
| Snares | 806 |
| Hi-hats | 764 |
| FX | 617 |
| Percs | 598 |
| Claps | 472 |
| Vox | 400 |
| Kicks | 336 |
| Loops | 232 |
| Open Hats | 209 |
| Cymbals | 162 |
| Melodies | 65 |
| Bass | 56 |
| Toms | 33 |
| Risers | 13 |
| Review bucket | 405 |

There were roughly **515 review candidates** when low-confidence results were included. The classifier currently misses or weakly handles at least `O-Hat` as an open-hat alias and `fxs` as an FX alias. Those are small examples of a larger taxonomy problem, not isolated spelling bugs.

### Verification performed during this audit

The following checks passed:

- `pnpm test` — 13 tests passed, including 5 file-operation and 3 scanner integration tests.
- `pnpm build` — Vite renderer build and Electron TypeScript build passed.
- `pnpm exec tsc -p tsconfig.json --noEmit` — renderer/shared type check passed.
- Electron startup reached the built application without the earlier development-URL failure; the temporary process was then stopped.
- `pnpm test` — 20 tests passed, including operation recovery, progress/final journal cleanup, safe undo cancellation, scanner cache/corrections, metadata parsing, and profile persistence.
- `pnpm exec tsc -p tsconfig.json --noEmit` — passed.
- `pnpm exec tsc -p tsconfig.electron.json --noEmit` — passed.
- `pnpm build` — Vite renderer and Electron bundle passed.
- `pnpm package:portable` — produced the current `release/WaveSort-0.1.0-x64.exe`; it began with the PE signature `MZ`, stayed responsive for five seconds as a packaged process, was confirmed `NotSigned`, and has SHA-256 `D54041A56C5F7E9457C883DC9F6C5E592C5A1342287431A4A4BBC1B1293C4DBE`.

The following are not yet proven:

- Full native-window click-through of the scan, preview, copy, and move workflow.
- Audio playback across every advertised codec.
- Full native-window click-through of the latest packaged scan, preview, copy, move, undo, progress, and settings workflow.
- Classification precision/recall against human-labelled examples.
- Recovery from an actual process crash, permission error, unplugged drive, or partial move across a process restart; cancellation and same-process resume/retry are covered by fixtures.

## Audit findings

| ID | Priority | Finding | Evidence | Consequence |
| --- | --- | --- | --- | --- |
| F-01 | P0 | The operation layer now has a dry-run plan, bounded source fingerprints, streaming verified copies, append-only checkpoints, atomic final journals, cancellation, resume, retry-failed, durable reports, guarded undo, and size/content verification. | `src/main/file-operations.ts`, `src/main/fingerprint.ts` | The large-library execution path no longer rewrites the entire growing journal per file; actual crash and unplugged-drive behavior still needs packaged end-to-end evidence. |
| F-02 | P0 | Cross-volume move still uses verified copy then unlink; failures are journaled as `copied-not-removed`, but the operation is not resumable after a process crash. | `src/main/file-operations.ts` | A failed unlink or interruption can still leave a duplicate that needs explicit review. |
| F-03 | P1 | The destination is not strongly validated against the source, prior output, or path identity. | `src/main.ts:158-162` | Users can select confusing or unsafe destinations, especially when sorting back into an existing library. |
| F-04 | P1 | Scanning now has progress events, cancellation, a partial-result state, a 100,000-audio safety limit, a versioned local cache, and added/changed/removed reporting, but it remains a main-process in-memory traversal. | `src/main/scanner.ts`, `src/main.ts`, `src/renderer/App.tsx` | Large libraries are safer and unchanged rescans are cheaper, but very large scans can still compete with the UI process. |
| F-05 | P1 | Inaccessible directories/files and symbolic-link skips now produce bounded scan issues; policy skips and junction/reparse-point handling are not yet fully surfaced or canonicalized. | `src/main/scanner.ts` | The user can act on the important partial-scan cases, but path-policy coverage is not complete. |
| F-06 | P1 | Preview now uses a range-aware streaming protocol and avoids full-file buffering; codec playback capability is still browser-dependent. | `src/main.ts`, `src/main/audio-metadata.ts` | Large previews no longer require one full main-process allocation, but codec-by-codec playback QA remains open. |
| F-07 | P1 | A family/form result and nested destination template now preserve one-shot/loop sound identity, but the legacy flat category UI and category-only override model remain. | `src/shared/classifier.ts`, `src/shared/taxonomy.ts`, `src/main/file-operations.ts` | Common packaging labels no longer erase family identity in the output path, but the correction workflow does not yet edit both axes independently. |
| F-08 | P1 | The UI now calls the value cue strength, but the underlying score is still a formula rather than an evaluated probability. | `src/shared/classifier.ts`, `src/renderer/App.tsx` | Users are less likely to read the score as a calibrated probability; a labelled benchmark is still needed. |
| F-09 | P1 | Reference aliases now cover the observed `O-Hat`, `fxs`, `A-Snares`, `Rims`, and `Chants` examples, but aliases are not user-editable or profile-versioned. | `src/shared/categories.ts`, `src/shared/classifier.ts` | More of the supplied pack vocabulary works automatically, while vendor-specific abbreviations still require source changes. |
| F-10 | P1 | User overrides and the validated accent-colour setting now persist in a versioned, local profile; profile export/import and the remaining category/template settings are still missing. | `src/main/profile-store.ts`, `src/main/scanner.ts`, `src/renderer/App.tsx` | Corrections and appearance survive rescans and restarts for the same library, but users cannot yet back up or move the profile. |
| F-11 | P1 | Sender/payload validation now combines with canonical realpath checks for scans, previews, source reads, operation sources/targets, and a narrow source-folder/report action surface. | `src/main.ts`, `src/main/file-operations.ts`, `src/preload.ts` | Junction/symlink escapes are materially constrained; malicious filesystem replacement and full IPC end-to-end coverage still need dedicated tests. |
| F-12 | P1 | Tests now cover collision-safe copy, move/undo, changed/missing sources, cancellation/resume, scanner cache/corrections, metadata parsing, and profile persistence; Electron IPC, native UI, codec playback, and failure injection remain uncovered. | `tests/*.test.ts` | Core regressions are less likely, but end-to-end behavior is still under-tested. |
| F-13 | P2 | A portable x64 Windows build is now configured and produced locally; signing, icon branding, installer choice, and public release remain intentionally separate decisions. | `package.json`, `release/WaveSort-0.1.0-x64.exe` | Testers can use the local portable artifact, but it is unsigned and not published. |
| F-14 | P2 | `typecheck`, `check`, build, test, and portable packaging scripts now exist; lint/format/CI integration is still missing. | `package.json` | The local verification path is repeatable, but there is no remote automated gate. |
| F-15 | P2 | Scans now start with no files selected and expose explicit select-visible/select-all-results controls; bulk category correction is available. | `src/renderer/App.tsx` | Accidental whole-library submission is less likely; virtualized review and richer filters remain open. |

## Next steps: large implementation segments

## Segment 1 — Make sorting safe, previewable, and recoverable

**Priority:** P0  
**Outcome:** WaveSort can prepare and execute a large sort without creating an unexplainable filesystem state.

This is the first segment because every later classifier improvement increases the number of files users may trust WaveSort to process. The operation layer must be reliable before the app becomes more confident.

### Implemented slice in this pass

WaveSort now has a working operation model. It builds a non-mutating plan, revalidates source size/time and a bounded fingerprint, allocates collision-safe destinations, records an initial atomic journal and append-only per-item checkpoints, streams copies with byte progress, verifies copied bytes/content, emits percentage/elapsed/estimated-remaining progress, supports cancellation/resume/retry-failed, exposes a durable report, and offers guarded undo. The implementation is covered by fixture-level tests for collisions, move/undo, changed/missing sources, progress/final journal cleanup, and cancellation/resume.

The remaining work in this segment is deliberate: add failure-injection and packaged end-to-end tests, validate actual process-restart recovery, and exercise permissions, unplugged drives, and cross-volume interruption.

### Scope

Build a real operation model instead of sending a list of IDs directly to an imperative loop:

- Generate a complete dry-run plan containing source path, destination category, destination path, collision decision, source size, source modification time, and a stable file identity.
- Show the plan before execution, including counts by category, files requiring review, conflicts, missing files, and estimated total bytes.
- Revalidate each source immediately before copying or moving. At minimum compare existence, size, modification time, and a fast identity hash; do not silently process a file that changed after scanning.
- Implement collision handling with exclusive creation/retry semantics rather than an `access()` check followed by a separate copy/rename.
- Write an operation journal before execution and append a checkpoint after every item. Finalize an atomic snapshot for the durable report. The journal must support resume, retry-failed, and exportable evidence without rewriting the full growing document for every item.
- Add an undo path for copy operations by deleting only the exact outputs created by that operation. For moves, record source and destination pairs and only offer undo when the source/destination state still matches the journal.
- Make partial completion a first-class result. “Processed,” “skipped,” “changed since scan,” “conflict,” and “error” should not be flattened into one toast.
- Add a cancel button that stops scheduling new work and lets the current file finish safely; expose percentage, bytes, elapsed time, and estimated remaining time while it runs.

### Acceptance gates

- A dry run never changes the source or destination.
- A simulated failure after item N leaves a journal that accurately identifies all completed and incomplete items.
- Copying 100 fixture files with duplicate names never overwrites an existing file.
- Moving across two volumes either completes each item safely or leaves enough journal state to resume/undo without guessing.
- Re-running a completed plan is idempotent: it skips or explains existing outputs instead of producing uncontrolled duplicates.
- A test can assert the exact source and destination inventory before and after every operation.

### Suggested internal shape

Introduce a dedicated operation service such as `src/main/operations/` with separate `plan`, `execute`, `journal`, `undo`, and `verify` modules. Keep filesystem mutation out of the renderer and keep the renderer responsible only for choosing, reviewing, and displaying the plan.

## Segment 2 — Replace the flat classifier with a two-axis, reference-derived taxonomy

**Priority:** P0/P1  
**Outcome:** A file retains both its sound identity and its packaging/form information.

The current category list mixes several dimensions. `Kicks`, `808s`, `Vox`, and `Loops` are sound or content families, while `One-shots` is a delivery/form factor. A two-axis model avoids losing information and better matches the supplied packs.

### Implemented slice in this pass

WaveSort now returns both `family` and `form` alongside the existing category result. One-shot and loop cues are scored separately from family cues, so examples such as `One-Shot/BASS`, `One-Shot/KICK`, `One-Shot/VOX`, and `Loops/Melodies` retain the useful sound identity. The plan preview and filesystem operation layer turn those axes into nested destination folders. The classifier also recognizes the supplied `O-Hat`, `fxs`, `A-Snares`, `Rims`, and `Chants` conventions, with regression coverage.

The remaining work in this segment is to create a labelled gold set, calibrate confidence, expose family/form overrides in the review UI, and move aliases/rules into an editable, versioned profile.

### Scope

Create a classification result with at least:

- `family`: kick, snare, clap, closed-hat, open-hat, 808, bass, perc, rim, tom, cymbal, vox, chant, FX, riser, melody, instrument, drum-kit, unknown.
- `form`: one-shot, loop, stem, texture, preset-adjacent, unknown.
- Optional attributes: clean/distorted, tonal/noisy, acoustic/electronic, dry/processed, vendor/pack, and source folder.
- A destination template such as `One-Shots/808s`, `One-Shots/Kicks`, `Loops/Melodies`, `Vox/Chants`, or a user-defined template.

Use the reference library to build a versioned alias profile rather than encoding every rule directly in one array:

- Normalize known shorthand: `O-Hat`, `OH`, `openhat`, `hi hats`, `HH`, `A-Snares`, `fxs`, `SFX`, `chants`, `one shots`, and common plural/singular variants.
- Treat `.nfo` and folder labels as evidence for the profile, not as executable content.
- Preserve source pack/vendor context as metadata instead of letting a vendor folder name override the actual sound category.
- Add explicit precedence rules. For example, `open hat` should beat `hat`, but `one-shot` should not erase `open hat` or `kick`; it should set the form axis.
- Add a user rule editor with ordered rules, aliases, exclusions, and a “test this filename” preview.
- Add a per-scan profile so the user can select “trap sample packs,” “general drum library,” or a personal profile.

### Evaluation before claiming confidence

Create a small labelled gold set from the reference folder. Human-label a stratified sample across categories, pack vendors, clean names, noisy names, shorthand names, and generic names. Measure:

- Family precision and recall.
- Form precision and recall.
- Review-bucket rate.
- Confusion pairs such as closed-hat/open-hat, 808/bass, FX/percs, loops/melodies, and vox/chants.
- How often the highest-confidence result is wrong.

Only then rename confidence levels. Until this exists, call the value “cue strength” or “rule confidence,” not a probability.

### Acceptance gates

- `One-Shot/BASS`, `One-Shot/KICK`, and `One-Shot/VOX` preserve both dimensions in the result and destination.
- `O-Hat`, `fxs`, `one shots`, `chants`, `A-Snares`, and `Rims` map correctly in a golden test fixture.
- A user can change a rule without editing source code.
- The output plan shows exactly how family and form become folders.
- The benchmark report records performance separately from subjective examples.

## Segment 3 — Build a scalable, cancellable library scanner

**Priority:** P1  
**Outcome:** Scanning 10,000–100,000 files feels responsive, reports partial failures clearly, and does not need to rescan everything every time.

The supplied reference library is already large enough to expose the current limitations. The current scan builds every entry in the main process and returns the whole array in one IPC response. That is acceptable for a prototype but not for a persistent sample manager.

### Implemented slice in this pass

The scanner is now a dedicated service with throttled progress events, cancellation through an abort signal, explicit `complete`/`cancelled`/`limit` result status, bounded issue reporting, policy-directory skipping, symbolic-link/junction escape checks, a 100,000-audio safety limit, a versioned local index, bounded fingerprints, metadata reuse, corrections, and added/changed/removed reporting. The renderer shows the live scan state and blocks sorting when a scan is incomplete. Scanner fixtures cover normal traversal, unsupported-file counts, cancellation, the limit result, cache reuse, changes, removals, and saved corrections.

The remaining work in this segment is a worker-thread or dedicated process, richer policy controls, and a streaming/paginated result model for libraries beyond the current in-memory limit.

### Scope

- Move traversal and metadata work into a worker thread or dedicated main-process worker.
- Stream progress events: directories visited, audio files found, files classified, unreadable entries, and current path.
- Add cancellation with an abort signal and a clean partial-scan result.
- Establish explicit scan policy: hidden files, hidden folders, system folders, symlinks/reparse points, junctions, archives, sidecars, and output folders.
- Resolve and compare real paths so a symlink/reparse point cannot escape the selected root.
- Distinguish skipped-by-policy from inaccessible, invalid, unsupported, and changed files.
- Add scan limits and memory guards with a clear “large library mode.” Avoid sending thousands of full absolute paths and metadata objects to the renderer at once.
- Store a local index keyed by canonical path plus size, modified time, and content fingerprint. Reuse unchanged classification/metadata results.
- Add a rescan mode that detects added, removed, changed, and moved files.
- Keep deterministic ordering and deterministic IDs across rescans.

### Acceptance gates

- The UI stays responsive while scanning the supplied reference folder.
- Cancelled scans report exactly where they stopped and never leave a false “complete” status.
- Permission failures appear in a warning panel with paths and actionable text.
- A second scan of an unchanged library reuses cached work and reports the reuse count.
- A changed file is invalidated; an unchanged file is not reclassified unnecessarily.
- Hidden and symlink behavior is covered by fixture tests on Windows.

## Segment 4 — Add trustworthy audio metadata and bounded preview analysis

**Priority:** P1  
**Outcome:** WaveSort can preview and enrich files without loading entire files into memory or implying unsupported codec behavior.

The preview protocol now streams the selected file and supports HTTP byte ranges. The metadata path reads at most a bounded header and currently extracts useful WAV, FLAC, and AIFF/AIF information. This closes the direct full-file allocation risk, while richer codecs and waveform/content analysis remain follow-up work.

### Implemented slice in this pass

The custom audio protocol canonicalizes the requested file inside the scan root, returns range responses for seeking, rejects invalid ranges, and sets explicit content length/type headers. The scanner stores bounded metadata and a bounded fingerprint in the local cache. The inspector displays codec, sample rate, channels, bit depth, duration where available, and an honest “support varies” note for formats outside the known browser playback set.

### Scope

- Implement range-aware streaming for the custom audio protocol, or use a trusted local decoder/service that supports seeking.
- Add a decoder capability matrix and surface unsupported playback rather than silently showing a dead player.
- Extract duration, channels, sample rate, bit depth, codec, bitrate, and file size. Keep metadata extraction separate from classification.
- Generate a bounded waveform overview from downsampled audio, not from the full-resolution file in the renderer.
- Add optional BPM/key detection only after the basic metadata path is reliable. Treat detected BPM/key as suggestions with provenance and confidence.
- Add a “content analysis” mode as a later opt-in stage: spectral features, transient density, pitch/noise ratio, and possibly a local model. Do not make this the first fix for taxonomy errors.
- Add preview caching with invalidation by file fingerprint.

### Acceptance gates

- Previewing a large WAV does not allocate the entire file in the Electron main process.
- Seeking works for formats that advertise seeking support, and unsupported formats explain why.
- Metadata results are deterministic for the same file and are invalidated when the file changes.
- Waveform generation has a fixed memory/time bound per file.
- No content-analysis label is shown as authoritative without an evaluated test set.

## Segment 5 — Turn the interface into a correction and batch-review workspace

**Priority:** P1  
**Outcome:** Users can review thousands of suggestions efficiently, correct them in batches, and keep their work.

The existing UI is visually coherent and now has an explicit review-first selection state, bulk reassignment, persistent corrections, scan-change reporting, operation recovery controls, and a durable report action. The next step is workflow depth rather than more decoration.

### Implemented slice in this pass

New scans start with no selection. Reviewers can select visible results or all results, assign a category to the selected batch, save corrections for the source root, resume or retry an operation, undo when safe, and open the operation journal. The UI calls the heuristic score cue strength rather than a probability.

### Scope

- Replace the immediate “everything selected” default with an explicit review state and a clear “select all results” action.
- Add filters for low cue strength, missing metadata, duplicate candidates, changed files, and category/form combinations.
- Add bulk reassignment for selected rows and a batch rule action such as “all files in this folder → category/form.”
- Make the plan visible before copy or move, with category totals, destination preview, conflicts, and warnings.
- Keep a persistent unsaved-changes state for overrides and rules.
- Add undo, retry failed, rescan changed files, and open output folder actions.
- Add keyboard navigation and accessible focus states for high-volume review.
- Virtualize or window the list when the result set is larger than the current page model.
- Show full operation results in a durable report instead of a temporary toast.
- Add optional star/keep/reject tags without mixing them into the classifier category.

### Acceptance gates

- A reviewer can find all low-confidence results without searching manually.
- A selection can be reassigned in bulk and the plan updates immediately.
- Leaving and reopening the app does not lose saved corrections.
- The user can understand exactly what will happen before any filesystem mutation.
- A completed operation can be opened as a report and its outputs can be undone when safe.

## Segment 6 — Harden IPC, validation, persistence, and configuration boundaries

**Priority:** P1  
**Outcome:** The app has a narrow, validated local API and durable user configuration without adding accounts, cloud services, or telemetry.

### Implemented slice in this pass

The main process validates sender origin and request shape, canonicalizes source paths through realpath checks, rejects source/target journal escapes, refuses source symlinks during operations, verifies non-symlink outputs, narrows the shell action to the scanned source folder, exposes only the report action for durable journals, and persists root-scoped corrections plus a validated accent-colour setting in an atomic versioned profile file. Profile writes are queued so concurrent row corrections cannot overwrite one another.

### Scope

- Validate every IPC payload at runtime with a schema: source path, destination path, entry IDs, operation, category/form overrides, and limits.
- Validate the sender for every handler and reject unexpected origins/windows.
- Move the shell action from an arbitrary `openPath` into narrowly scoped operations such as reveal source folder, reveal output folder, and open report.
- Canonicalize paths with realpath checks before reading, previewing, copying, or moving.
- Keep renderer responses minimal. Avoid exposing more absolute filesystem information than the UI needs.
- Add the remaining app settings for category profile, destination template, copy/move default, ignored folders, hidden-file policy, and review threshold. The first appearance setting, accent colour, is now implemented.
- Persist settings and corrections in a versioned local file or SQLite-backed store with migrations; the current atomic JSON profile already covers corrections and accent colour.
- Add an import/export format for profiles and correction rules so the user can back them up without an account.
- Record application version and classifier-profile version in every operation report.

### Acceptance gates

- Malformed IPC payloads fail with structured errors and no filesystem change.
- A path that escapes the selected root is rejected after canonicalization, including through a junction or symlink.
- App restart preserves settings and saved rules.
- Exported profiles can be imported into a clean workspace and produce the same classifications for the same fixture set.
- The app remains local-only with no telemetry or remote service dependency.

## Segment 7 — Add end-to-end QA and produce a tester-ready Windows build

**Priority:** P1/P2  
**Outcome:** WaveSort can be handed to a tester as a repeatable Windows application with evidence for the risky paths.

### Implemented slice in this pass

The project now has a repeatable `typecheck`, `check`, and `package:portable` workflow. Electron Builder produces a portable x64 artifact in `release/`; the current verified artifact is unsigned, uses Electron's default icon, and was launched as an independent packaged process.

### Scope

Build a real fixture and packaging pipeline:

- Create a fixture library with duplicate names, nested packs, hidden files, sidecars, unsupported files, broken links, permission failures, changed files, zero-byte files, and files with misleading names.
- Add integration tests for scan results, rule precedence, collision handling, copy, move, cross-volume behavior, cancellation, resume, undo, and report generation.
- Add Electron smoke tests covering launch, preload isolation, directory selection, scan, preview, plan, copy, and move.
- Add renderer tests for selection state, filters, overrides, plan totals, error reports, and persistence.
- Add a typecheck/lint/format command and run all of them in CI.
- Add a Windows packaging target, preferably portable first, then an installer only when update/signing decisions are explicit.
- Record package version, artifact hash, supported Windows architecture, and known unsigned-installer warnings.
- Test the packaged app against a copy of the fixture library, never against the user’s real reference library by default.

### Acceptance gates

- A clean machine can launch the packaged artifact without Node, pnpm, or source files.
- The packaged app passes the same scan and operation fixture suite as development.
- A failed operation produces a recoverable report and does not get called a success.
- The release notes state exactly what is verified and what is still experimental.
- No installer or release is published until the artifact and anonymous download path are verified.

## Recommended implementation order

### Milestone A — Trustworthy organizer core

Deliver Segments 1 and the safety-critical part of Segment 6 first. Keep the current filename classifier, but require a dry-run plan, source revalidation, collision-safe writes, operation journals, and integration tests before allowing large moves.

### Milestone B — Correct taxonomy and correction loop

Deliver Segment 2 and the user-facing parts of Segment 5. Introduce family/form output, reference-derived aliases, a golden-labelled test set, bulk corrections, and saved profiles. This is the milestone that should materially improve sorting quality.

### Milestone C — Large-library and audio-quality layer

Segments 3 and 4 now include progress/cancel/cache, metadata, and bounded streaming preview. The remaining large-library worker, waveform generation, and content-based audio analysis should be evaluated only after native and codec QA.

### Milestone D — Tester-ready product

The portable Windows build is now local and verified. Finish the remaining native/fixture QA before deciding whether to add an installer, signing, public distribution, licensing, or automatic updates.

## Explicitly deferred until the core is trustworthy

- Cloud classification, accounts, telemetry, analytics, or remote uploads.
- DAW-specific project mutation or automatic plugin/database changes.
- A black-box AI label that cannot explain or reproduce its result.
- Automatic destructive cleanup of duplicates or source folders.
- Public release or licensing decisions without explicit approval.

## Definition of a strong WaveSort 1.0

WaveSort 1.0 should be able to scan a large local library, show a reproducible family/form classification with a clear reason, let the user correct it in batches, produce a complete dry-run plan, execute copy or move operations with a journal, verify every output, recover from interruption, undo safe operations, and reopen the same library without losing the user’s profile. It should be packaged for Windows and supported by integration evidence, not only a green classifier unit test.
