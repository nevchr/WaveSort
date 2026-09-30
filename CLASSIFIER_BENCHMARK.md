# WaveSort classification benchmark

## What exists now

The app's **Accuracy** panel builds a reproducible, small queue across the categories currently present in a scan (up to four files per category, spread across folders where possible). A person can preview each file and save an independent **Verified type**. These root-scoped labels do not change the sort category or destination. Labels are bound to the scanned file fingerprint; a changed file needs a fresh verification. A label can be corrected or cleared.

The panel evaluates the *raw filename/folder classifier plus saved library alias rules*, not saved manual category corrections. It reports:

- **Correct auto-sorts:** predicted category matches a verified label and the file was not sent to review.
- **Wrong auto-sorts:** predicted category differs from a verified label and the file was not sent to review.
- **Review decisions:** the prediction was `Review` or its cue strength was below the review threshold.
- **Auto-sort precision:** correct / (correct + wrong), only among verified files the classifier would auto-sort.
- **Review rate:** review decisions / all verified files in the current scan.

These are diagnostic rates on the verified set, not calibrated probabilities or estimates of whole-library accuracy. The queue is stratified by *predicted* category, so it is deliberately not a random prevalence sample. Labels from changed or absent files are excluded. Fewer than 20 verified labels is explicitly called a starting signal in the UI.

## Current evidence and limits

A read-only filename pass over the existing `WaveSort Sorted/Review` output in the supplied Packs example found 268 WAV filenames. The compact-hat alias update would assign 17 `hhats` filenames to Hi-hats and 25 `ohats`/`openhat` filenames to Open Hats; 226 remained in Review. That is **42 recognizable names**, not 42 verified correct audio classifications. Existing sorted output is not ground truth and was not changed by this pass.

No human-listened labelled set has been completed yet, so an honest category accuracy figure is **not available**. The app now has the local workflow to collect one without uploading files or silently using old output folders as labels.

## Suggested evaluation pass

1. Scan the original library, open **Accuracy**, and inspect the sound of each queued file before selecting its verified type. Include unfamiliar filenames, shorthand, clean names, and several pack folders.
2. Reach at least 60 verified files before treating category-level patterns as actionable. Where a category is absent from the queue, label representative files manually from that category in the main review list.
3. Record the correct/wrong/review counts and inspect the listed wrong auto-sorts. Fix a recurring naming convention with **Library rules** only after previewing its matches and protected corrections.
4. Reopen Accuracy after the refreshed scan and compare the same verified labels. Keep some labels unexamined while tuning rules to check whether improvements generalize.

The next credibility gate is native packaged-app click-through and human listening on representative audio. Unit tests verify metric math, alias matching, persistence, cache behavior, and sort-operation safety, but do not substitute for those checks.
