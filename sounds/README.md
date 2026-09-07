# Combat Sound Bank

Original procedural Foley generated for this project, not third-party recordings.
46 events / 72 stereo PCM WAV files, 44.1 kHz / 16 bit, approximately 5.76 MiB.

## Regenerate

```sh
node scripts/generate-sounds.cjs
node tests/combat-audio.test.cjs
```

The generator writes every WAV and `manifest.js`. Edit recipes in the generator,
not the generated manifest. Change its `VERSION` and the script query strings in
`index.html` when publishing a replacement bank to invalidate browser caches.

## Sound Families

| Family | Events |
|---|---|
| Hidden weapons | dartThrow, dartImpact, nailThrow, machineBox, needleRain |
| Sword | swordSwing, swordImpact, swordBeam, crossCut, thrust, counterStance, counterHit |
| Fist | boxerDash, punchSwing, punch, palmPush, dragonPull, meridianLock |
| Channel / ultimate | channelStart, channelTick, channelFinish, dragonCharge, dragonBurst |
| Support | silkArmor, breathing, drawCard |
| Damage accents | hitLight, hitHeavy, critAccent, launcher, playerHurt, shieldBlock |
| Enemy | enemyShot, enemyTelegraph, teleport, enemyCleave, fieldOmen, tileBurst, waveSweep, dartVolley, counterBurst |
| Interface | aimOn, aimOff, pause, victory, defeat |

Repeated impacts have three distinct generated variants. Charge cues retain fixed
playback speed. Short early reflections are baked in; samples bypass the legacy
long reverb. The runtime limits overlapping voices and merges same-frame tile bursts.

## Playback

HTTP(S) pages prefetch the bank with four concurrent downloads. The first touch or
key press unlocks Web Audio and decodes the bank. Missing files or `file://` pages
retain the legacy synthesis fallback. The sound button preserves the mute preference.
Pause, restart, defeat and victory stop remaining sample voices.

All project decisions, verification history and deployment status live in
[PROJECT.md](../PROJECT.md), not here.
