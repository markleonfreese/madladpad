# Lyric Intelligence V0 — MadLadPad / WGOT

**Status:** Local-first feature eligible to merge after exact-head checks pass. A merge alone does not authorize a production Pages publish.

## User workflow
In **Melody & Rhythm → Rap & flow**, write in the existing 16 editable bars and optionally open **Lyric Insights**. The disclosure updates on each bar edit. It groups possible line-ending rhymes, identifies repeated ending words, and reports estimated syllable ranges and unused bars. It never edits the lyrics or saved flow map.

## Reusable module contract
The module at site/lyric-intelligence.js exports analyseLyrics(input, estimateSyllables).

- input: newline-separated string or array of strings; bounded to 256 lines and 500 characters per line. Empty lines retain bar numbers.
- estimateSyllables(text): host-supplied deterministic function; MadLadPad passes its existing estimateSyllables from site/core.js.
- Result: lines (each with bar, text, filled, syllables, ending, family, repeatedEnding), filledBars, emptyBars, syllableRange, possibleRhymeFamilies, repeatedEndings, observations.
- No DOM, network, storage, inference model, new runtime dependency or text mutation inside the module. UI renders lyric data with textContent.

## Known limits
This engine uses a small set of common English word groups and spelling suffixes. It is **not** a phonetic dictionary or reliable semantic/multisyllabic rhyme detector. Approximate matches may be false, and authentic rhymes may be missed. Syllable counts vary by accent/performance; spoken and sung rhythms need listening checks. Observations are literal counts, not emotional or lyrical interpretations.

The Rap & flow editor still supports 16 bars. The engine itself supports multiline text for future integrations; there is no new standalone paste editor or automatic distribution of a pasted verse across bars. For WGOT, this module is an optional foundation for the music catalogue/transcription work.

## Next isolated slice
Connect selected transcripts or word timestamps to a reviewable lyric draft and preserve source-pad/start/end provenance. Never expose private Mark/Mason/Alana audio in public content without permissions. Do not introduce automatic publication, LLM interpretation, or project migration in V0.

## Verification gates
- Focused tests: node --test tests/lyric-intelligence.test.mjs.
- Repo gate: npm test; npm run test:browser; npm run test:song-browser; npm run test:webkit; npm run test:workers-runtime (exact-head CI evidence required if local repo unavailable).
- Separate manual gates: real lyrics, phone/touch display, keyboard and screen reader, actual spoken rhyme quality.
