import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAudioFile } from '../src/shared/classifier';

test('uses the specific open-hat folder before the generic hat cue', () => {
  const result = classifyAudioFile('ok kit/open hats/open hat 3.mp3', 'open hat 3.mp3');
  assert.equal(result.category, 'open-hats');
  assert.equal(result.family, 'open-hat');
  assert.equal(result.form, 'unknown');
  assert.ok(result.confidence > 0.75);
});

test('recognizes common drum categories from pack-style names', () => {
  assert.equal(classifyAudioFile('ok kit/808s/808 1.mp3', '808 1.mp3').category, '808s');
  assert.equal(classifyAudioFile('ok kit/808s/808 1.mp3', '808 1.mp3').family, '808');
  assert.equal(classifyAudioFile('ok kit/snares/snare 4.mp3', 'snare 4.mp3').category, 'snares');
  assert.equal(classifyAudioFile('ok kit/claps/clap 2.mp3', 'clap 2.mp3').category, 'claps');
  assert.equal(classifyAudioFile('ok kit/percs/triangle.mp3', 'triangle.mp3').category, 'percs');
});

test('recognizes one-shots, vox, loops, and FX', () => {
  const oneShot = classifyAudioFile('! ONESHOT/BASS - ALMOST808.wav', 'BASS - ALMOST808.wav');
  assert.equal(oneShot.category, 'oneshots');
  assert.equal(oneShot.family, 'bass');
  assert.equal(oneShot.form, 'one-shot');
  assert.equal(classifyAudioFile('Vocals/adlibs/adlib 01.wav', 'adlib 01.wav').category, 'vox');
  const loop = classifyAudioFile('Loops/drum loop 03.wav', 'drum loop 03.wav');
  assert.equal(loop.category, 'loops');
  assert.equal(loop.family, 'drum-kit');
  assert.equal(loop.form, 'loop');
  assert.equal(classifyAudioFile('random fx/impact 04.wav', 'impact 04.wav').category, 'fx');
});

test('recognizes reference-pack aliases without losing family detail', () => {
  const openHat = classifyAudioFile('Pack/O-Hat/O-Hat 02.wav', 'O-Hat 02.wav');
  const fxs = classifyAudioFile('Pack/fxs/fxs 01.wav', 'fxs 01.wav');
  const chant = classifyAudioFile('Pack/Chants/chant 01.wav', 'chant 01.wav');
  const aSnares = classifyAudioFile('Pack/A-Snares/snare 01.wav', 'snare 01.wav');
  const rims = classifyAudioFile('Pack/Rims/rim 01.wav', 'rim 01.wav');

  assert.equal(openHat.category, 'open-hats');
  assert.equal(openHat.family, 'open-hat');
  assert.equal(fxs.category, 'fx');
  assert.equal(fxs.family, 'fx');
  assert.equal(chant.category, 'vox');
  assert.equal(chant.family, 'chant');
  assert.equal(aSnares.category, 'snares');
  assert.equal(aSnares.family, 'snare');
  assert.equal(rims.category, 'percs');
  assert.equal(rims.family, 'rim');
});

test('keeps an unknown file in the review bucket', () => {
  const result = classifyAudioFile('misc/blue-sample.wav', 'blue-sample.wav');
  assert.equal(result.category, 'other');
  assert.ok(result.confidence < 0.2);
});

test('recognizes observed compact hat names without treating embedded words as cues', () => {
  for (const fileName of ['HHat.wav', 'hhats (9) @1trxma.wav', 'closedhat2.wav']) {
    const result = classifyAudioFile(`misc/${fileName}`, fileName);
    assert.equal(result.category, 'hihats', fileName);
    assert.equal(result.family, 'closed-hat', fileName);
    assert.ok(result.confidence >= 0.52, fileName);
  }
  for (const fileName of ['ohats (10) @1trxma.wav', 'openhat5.wav', 'OpenHats_03.wav']) {
    const result = classifyAudioFile(`misc/${fileName}`, fileName);
    assert.equal(result.category, 'open-hats', fileName);
    assert.equal(result.family, 'open-hat', fileName);
    assert.ok(result.confidence >= 0.52, fileName);
  }
  for (const fileName of ['hatchet.wav', 'shhatters.wav', 'ohio.wav', 'opening.wav']) {
    assert.equal(classifyAudioFile(`misc/${fileName}`, fileName).category, 'other', fileName);
  }
});

test('keeps numeric take cues and specific open-hat precedence', () => {
  assert.equal(classifyAudioFile('misc/kick02.wav', 'kick02.wav').category, 'kicks');
  assert.equal(classifyAudioFile('misc/808s/808bass.wav', '808bass.wav').category, '808s');
  const mixed = classifyAudioFile('misc/HHat - ohat lol.wav', 'HHat - ohat lol.wav');
  assert.equal(mixed.category, 'open-hats');
});
