#!/usr/bin/env node
/**
 * verify-barge-in.mjs — code-level check that barge-in is correctly wired.
 *
 * Live barge-in needs real mic+speaker, so the user can't test it by voice.
 * These static assertions verify the exact code conditions that make barge-in
 * work: the mic is NEVER ducked while the model speaks, and an `interrupted`
 * event stops playback. Run:  node scripts/verify-barge-in.mjs  (exit 0 = pass)
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;

function read(rel) {
  try {
    return readFileSync(ROOT + rel, 'utf8');
  } catch (e) {
    console.error(`✗ cannot read ${rel}: ${e.message}`);
    process.exit(1);
  }
}

const media = read('frontend/src/lib/media-handler.ts');
const voice = read('frontend/src/services/voice.ts');

const checks = [
  {
    name: 'shouldSendAudio() returns true (mic never ducked)',
    pass: /return true;\s*\}/.test(media) && !/!this\.modelSpeaking/.test(media),
  },
  {
    name: 'no mic-ducking flag remains (modelSpeaking)',
    pass: !/this\.modelSpeaking/.test(media),
  },
  {
    name: 'shouldSendAudio gates BOTH mic capture paths',
    pass: (media.match(/if \(!this\.shouldSendAudio\(\)\) return;/g) || []).length === 2,
  },
  {
    name: 'stopAudioPlayback() exists to halt output on interruption',
    pass: /stopAudioPlayback\(\)/.test(media),
  },
  {
    name: 'voice.ts maps "interrupted" event -> stopAudioPlayback',
    pass: /['\"]interrupted['\"]/.test(voice) && /mediaHandler\.stopAudioPlayback/.test(voice),
  },
];

let failed = 0;
for (const c of checks) {
  console.log((c.pass ? '✅ PASS' : '❌ FAIL') + '  ' + c.name);
  if (!c.pass) failed++;
}

console.log('\n' + (failed === 0 ? '🎉 All barge-in wiring checks passed.' : `${failed} check(s) FAILED`));
process.exit(failed === 0 ? 0 : 1);