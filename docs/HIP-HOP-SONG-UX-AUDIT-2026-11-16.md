# MadLadPad — strict UX/UI and hip-hop song workflow audit
**16 November 2026 (AWST)** · Status: source-grounded assessment and first implementation slice; **not** physical-device UX sign-off.

## Review method
Inspected `site/index.html`, `site/app.js`, `site/core.js`, `site/voice.js`, `site/audio.js`, `site/styles.css`, existing browser/Song tests, Agent Vault and Issue #200. Compared product semantics with official Ableton Live Arrangement / Clip / MIDI manual, Serato Studio Song View and BandLab region editing, plus a published reference hip-hop arrangement. This is a **code and acceptance-evidence audit**; no new manual device observation or captured app screenshot was available in this session. Do not infer an interface feels usable from static selectors and synthetic browser tests alone.

## Non-negotiable product mental model
- **Source**: original recorded/imported audio/video or note/instrument data. Immutable unless user explicitly replaces it.
- **Pattern (A/B/C...)**: a reusable short rhythmic/melodic source. Beat Maker owns pattern editing and saving, including one-bar step entry. Scene source ID is stable.
- **Song section**: a placement of a linked pattern in an ordered Song, with its own **start and length in bars** (A 4, B 16, C 8...). Tracks owns editing section placement and length.
- **Track**: instrument, audio, vocal or visual lane spanning Song time; owns clips, mute/solo/gain and visible playback state.
- **Clip instance**: references a source with independent song position, duration, trims, optional loop period, repeat mode, transpose/reverse and visual assignment. Does **not** duplicate or destroy the source.
- **Video layer / visual**: real source video where present; otherwise explicit artwork or locally generated visualisation. Generated visuals must never be falsely labelled as original camera video.
- **Export**: produces a continuous final Song, not merely records what a person taps during a live session.

These must remain distinct in both the UI and persistent data, including import/export round trips.

## Five workspace ownership decisions

| Workspace | The one main user question | Owns | Must not duplicate |
|---|---|---|---|
| Playground | What sounds or videos can I play? | Capture/import/preview/trim a pad source, pad performance | Pattern editor, Song timeline, multitrack mixing |
| Beat Maker | What repeating beats/patterns can I create? | Step grid, named patterns A/B/C, saved pattern source, sampled note modes | Song section timeline, recording lanes, full Song export |
| Melody & Rhythm | What notes, words and flow will I use? | Piano roll, rhythm and melody notes, instruments/voice composition, lyrics/rap flow, transcription | Duplicate Song arrangement, recording-track mixer |
| Tracks | How do I turn it all into a full song? | ONE editable Song structure A/B/C, shared bar ruler, clip lanes, recording/overdub, gain/mute/solo and transitions | Standalone beat-making controls, second Song editor |
| Export | What final audio/video do I produce? | Full-song render, supported formats, review and download, optional live-performance capture | Pattern writing, clip mixing, separate duplicate backup controls |

Global transport can be reused across screens if its **mode is always explicit**, stable during recording and contains exactly one primary Play/Stop action. Project backup/restore has one home: Project menu.

## Severity-ranked findings against baseline `c44c8a1`

| Severity | Evidence | User impact | Resolution / current slice |
|---|---|---|---|
| P0 | `#song-arranger` in Beat Maker; `#overdub-timeline` in Tracks | A/B/C arrangement not discoverable where vocals are placed | Move editable Song editor to Tracks; retain linked section model; further unify visual ruler |
| P0 | 16-step scene loops, `songSectionAtStep(...)` uses modulo 16; no independent multi-bar clip repeat model | Cannot make one riff repeat every 2 bars and another every 4 bars over 8/16-bar section | Engine Issue #247: explicit repeat-period vs placement-span semantics |
| P0 | Long audio/video layer playback is one-shot and non-destructive trim; no native split/reverse in Track workflow | Cannot build transitions, reverse flourish or independently manage phrases | Engine Issue #247, TDD and media compatibility guards |
| P0 | `#melody-notes` numeric list and `#note-grid` pad modal limited to 16 sixteenths | No full-song MIDI editor like a piano roll | Engine Issue #247: one reusable 1–64+ bar MIDI clip editor |
| P0 | Export has live recording and Video Director, not confirmed deterministic full-Song AV render | A full song does not automatically create a continuous, reviewed video | Issue #248; clearly label performance capture vs render |
| P1 | Scene select/save/update/load/delete nested under Advanced beats | A/B/C creation is hard to find | Make one persistent `Your beat patterns` section in Beat Maker |
| P1 | Song editor ruler and Tracks overdub ruler are separate DOM components | Hard to line up beats, vocals, MIDI and visuals | P0 follow-up: one horizontal scroll/zoom/time coordinate across section lane and all media |
| P1 | Empty Song gives a short 1-bar minimum track ruler; max 256 bars exists only after Song placement | User reasonably believes Tracks is limited to a few bars | Show explicit unarranged state and easy section adding; never present current viewport as Song length |
| P1 | Secondary `#play-seq` and global `#studio-play` | Competing Play controls | Remove secondary Play, preserve single global transport |
| P1 | Beat Maker `#make-video`; Project backup in menu and Export `#export-pack-action` | Misleading duplicate pathways | Remove redundant CTA and secondary backup entry |
| P1 | Editing spans multiple dense cards and a second numeric-only control bank | Track controls compete with waveform, poor mobile scanning | Compact selected-clip inspector; progressively disclose precise timing and advanced controls |
| P1 | Video Director repeats a 16-step direction scheme | Does not express verse/hook-level picture changes | Song-length visual cut/clip lane and per-part visual fallback (#248) |
| P2 | Screen labels and copy still mix Loop/Sequence/Song/Scene/Track terminology | Confuses one-bar pattern with whole song | Use *pattern*, *section*, *Song*, *clip*, *track* consistently; explain once, not repeatedly |

## What exists, and what does NOT
**Verified from code and prior automated evidence:** 8 named scenes max, 64 Song clip placements, 256 Song bars max, 16-step per-scene repetition, long recorded/imported audio and video layers, non-destructive clip movement and edge trim, basic sampled-note piano roll inside the pad editor, numeric Melody notes and MIDI export, video pad/tile and 16-step Video Director, project-pack preservation. Prior 36-bar A/B/C/A and 240-second synthetic Song acceptance is documented in tests.

**Not proven / not implemented as described by user:** independently looping 2/4/8-bar audio/MIDI clips with separate repeat periods; native Track splitting/reverse; whole-Song drag-to-draw MIDI; unified one-ruler clip editing; automated full-Song video rendering with visuals for every audible part; physical mobile and human listening acceptance.

The presence of a 256-bar data cap is **not** evidence that the existing UI makes it easy to compose 256 bars.

## Hip-hop acceptance song — 90 BPM, 4/4, 72 bars (3:12)

| Start bar | Length | Beat section | Musical role | Record/visual intention |
|---:|---:|---|---|---|
| 1 | 4 | A | Intro | Intro video, spoken/ad-lib clip |
| 5 | 16 | A | Verse 1 | 16-bar rap lead, optional doubles/ad-libs |
| 21 | 8 | B | Sung hook | Chorus vocal/harmony; 8-bar video montage |
| 29 | 16 | A | Verse 2 | Second lead take, different lyrical flow |
| 45 | 8 | B | Hook | Reuse B pattern; optionally new video shot |
| 53 | 8 | C | Bridge/breakdown | Sparse kit and reversible transition |
| 61 | 8 | B | Final hook | Stronger harmonies/doubles |
| 69 | 4 | A | Outro | Decay, performance tile or still image |

**Separate periods, never one global 8-bar loop:** during the 16-bar verse, a one-bar drum clip repeats 16 times; a 2-bar guitar phrase repeats 8 times; a 4-bar bass part repeats 4 times; the 16-bar vocal take plays **once**. MIDI notes can have their own independent lengths. Changing section A's duration must not rewrite a source clip or automatically force other parts to match it. No implicit stretch or destructive rewrite when source seconds do not equal musical-bar duration.

A conventional 4-bar intro / 16-bar verse / 8-bar hook / repeated sections is **a starter template**, not a genre rule. Users should freely rename, change and rearrange sections.

## Recommended implementation sequence
1. **UX consolidation (Issue #246 / this PR):** put the existing Song arranger in Tracks, make A/B/C pattern controls visible in Beat Maker, remove duplicate secondary Play and redundant creation/backup entries, route transport safely. Preserve all saved projects and records.
2. **Ruler + clip ownership:** make one Song time axis with section clips above independent audio/video/MIDI lanes, one zoom, horizontal scroll, playhead, selected-clip inspector. This is not solved by merely placing two separate timelines on one screen.
3. **Independent clip loops and reversals (Issue #247):** source/instance model and tests first; repeat period distinct from clip duration; split/duplicate/reverse with non-destructive references, clear unsupported media guard.
4. **Long MIDI piano roll (Issue #247):** touch drawing, moving, lengthening, velocity, snap and scale, 1–64+ bars, instrument routing; preserve existing pad and melody project data.
5. **Full-song audiovisual output (Issue #248):** every sounding source has an assigned or locally generated visual; render/preview a continuous Song with real and generated pictures, not only live camera recording.
6. **Physical acceptance / release:** 320/390px mobile, tap/drag/pinch/pan without page scrolling, recorder permissions, quota/offline/recovery, screen readers, audio monitoring and actual hip-hop timing/listening. Reconcile exact CI head before sign-off. Keep prod merge/deploy gated.

## Acceptance heuristics
- New user creates pad sample → saves A → creates B → builds 72-bar Song in Tracks → draws 2-bar MIDI bass riff → loops it independently → records 16-bar verse and 8-bar chorus → reverses a transition → associates audio-only material with visual tiles → exports aligned 3:12 audio and video; no hidden second editor.
- At every stage, **one primary ownership location**, one predictable Back/Edit route, no raw-media deletion without explicit confirmation, and undo/revert semantics for destructive actions.
- Labels describe **musical outcome**, not internal object names; e.g. “Save pattern”, “Add section”, “Repeat every 2 bars”, “Record vocal”, “Reverse clip”, “Render Song”.
- Distinguish **proposed, implemented, CI-verified and physically accepted** state in GitHub issues, PRs and Agent Vault.

## Reference sources (principles, not copied UI)
- Ableton Arrangement: https://www.ableton.com/en/manual/arrangement-view/
- Ableton Clip View: https://www.ableton.com/en/manual/clip-view/
- Ableton MIDI editing: https://www.ableton.com/en/live-manual/12/editing-midi/
- Serato Studio Song View: https://support.serato.com/hc/en-us/articles/360001463116-Song-View-Overview
- BandLab region editing and reverse: https://help.bandlab.com/hc/en-us/articles/900003878046-Editing-Audio-Regions
- Example rap Song structure (not canonical): https://www.nksounds.com/rap-song-structure/
