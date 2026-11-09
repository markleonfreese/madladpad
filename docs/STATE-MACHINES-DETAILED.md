# MadLadPad state-machine inventory

Audited against the web app source on 9 November 2026. This is a **code-derived inventory**, not a claim that every browser/device transition has passed acceptance testing. `app.js` holds most transient state; `core.js` contains reusable deterministic logic; `voice.js` owns the Voice Lab; `audio.js`, `google.js`, `storage.js` and `sw.js` own platform boundaries.

## Design decision

**Make transient asynchronous activities explicit at their boundaries, without replacing the existing project model or introducing a state-machine framework.** Use the small `AsyncActivity` contract for cancellable `idle → starting → active → idle` flows, and the existing `CaptureSession` for the richer camera flow. Keep persistent musical content in the normalised project, local media in IndexedDB and permissions/streams in runtime-only state.

Every asynchronous boundary should honour these invariants:

1. A single activity cannot be started twice while it is starting or active.
2. A cancel/stop or navigation-away invalidates prior generations; a late permission, decode or worker callback cannot revive the old activity.
3. Device tracks are stopped when no longer needed, including late `getUserMedia` results.
4. Only a successfully completed, current operation mutates project data or produces a user-visible result.
5. UI labels, `disabled` and `aria-pressed` values follow the same state as the operation; errors restore a retryable idle state.
6. Persistent records and exported packs do **not** contain ephemeral phase, access-token or stream objects.

This incremental approach improves **UX** (predictable cancel/retry and no surprise microphone), **DX** (small, testable state contracts instead of unrelated booleans) and **AX** (a catalogue of owners, events, guards and acceptance conditions). It avoids a wholesale rewrite and preserves the existing local-first architecture and project-pack format.

## Inventory

`Explicit` means a named class/contract presently controls the transition. `Implicit` means handlers, flags, DOM state or promise callbacks collectively implement it. Rows describe **logical** machines; a row may contain parallel sub-states.

| # | Flow / owner | States and transition events | Before this audit | Remaining concern |
|---|---|---|---|---|
| 01 | Studio navigation · `app.js` | `sounds / beats / voice / overdub / export` via hash; off-Voice stops tuner | Implicit | Test keyboard focus/history and state retention per screen |
| 02 | Voice sub-tool · `app.js` | `speech / melody / rap` via jump buttons; leaving melody stops tuner | Implicit | Confirm focus and accessibility in mobile layouts |
| 03 | Pad media slot · `app.js`, `audio.js`, `storage.js` | `empty / demo / importing / loaded / playback / replace / removed / error`; media persistence on success | Implicit | Imported files can partially succeed across multiple pads |
| 04 | Pad selection/inspector · `app.js` | `selected pad → trim/edit → preview → commit` and layout-dependent selection | Implicit | Preview and selection can diverge across in-flight decoding |
| 05 | Onset analysis · `app.js`, onset worker | `idle → decoding/analysing → suggestions → chosen / canceled / error` keyed by `onsetRun` | Implicit with generation guard | Test stale media-analysis and preview callbacks |
| 06 | Pad performance · `audio.js`, `app.js` | `ready → triggered/sounding → released`; source path varies among buffer/video/image/demo | Implicit | Polyphony and visual flash are deliberately independent |
| 07 | Transport · `app.js`, `audio.js` | `idle → starting (unlock) → active (tick) → idle`; Play/Stop and BPM restart | **Explicit `AsyncActivity` after audit** | Real audio-device/browser rapid-click acceptance needed |
| 08 | Pattern take · `app.js` | `idle ↔ recording (replace/overdub) → undoable/undone`; taps capture offsets | Implicit | Undo snapshot scoped to latest take; verify restart/clear interactions |
| 09 | Scene selection/launch · `app.js` | `selected/saved → queued for next bar → applied` or canceled at stop | Implicit | Queued scene exists separately from the saved scene list |
| 10 | Track display · `app.js` | `selected-pad steps ↔ all-tracks steps`; `1/4 / 1/8 / 1/16` stride | Implicit | Changes are guarded while pattern recording |
| 11 | Video director · `app.js` | `auto / solo / grid / black` for each of 16 steps; playback highlight | Implicit project state | Editing is persistent; currently-playing highlight is transient |
| 12 | Export recording · `app.js` | `idle → starting → video recording OR audio recording → stopping → retained/downloaded / error` | **Shared explicit `AsyncActivity` after audit** | MediaRecorder errors and browser file downloads need device testing |
| 13 | Export take history · `app.js`, `storage.js` | `none → available → preview/download → replaced`; cached render restore | Implicit | WAV conversion has a separate `checking → decoding → download/error` flow |
| 14 | Camera destination · `app.js` | `empty target / occupied → choose empty target or cancel` | Implicit modal/promise | Never overwrite an occupied pad without explicit intent |
| 15 | Camera session · `app.js`, `core.js` | `idle → ready → recording → review → keep/retake/cancel`; permission and atomic save | **Explicit `CaptureSession` before audit** | Added post-unlock stale-token guard; device acceptance remains |
| 16 | Camera trim preview · `app.js` | `review → adjust region → preview → stopped → keep` | Implicit subordinate flow | `timeupdate` listener cleanup deserves a later targeted test |
| 17 | Project autosave and recovery · `app.js`, `storage.js` | `clean → debounced pending → writing → persisted / recoverable/error`; `saveRevision` gates stale saves | Implicit with revision guard | Distinguish local quota and interrupted write recovery in UI |
| 18 | Project pack export/import · `app.js`, `storage.js` | `idle → serialising/download` or `validating → confirm replace → atomic write → reload/error` | Implicit; atomic DB transaction | Verify failed or invalid pack leaves all current media unchanged |
| 19 | Google Drive import · `google.js` | `unconfigured / OAuth → picker → downloading → imported/canceled/error` | Implicit external callbacks | Canceled picker has no explicit completion message |
| 20 | Google Photos import · `google.js` | `unconfigured / popup → OAuth → session polling → download → delete session / timeout/error` | Implicit async loop | Popup cancellation/timeout and session cleanup need live acceptance |
| 21 | Speech transcription · `voice.js` | `idle → decoding → worker loading/inference → draft transcript / error/canceled` | **Explicit `AsyncActivity` after audit** | Model download may be large; cancel/source/consent must win over late decode/worker result |
| 22 | Speech editing and phrase assembly · `voice.js` | `source words → selected words → phrase → reordered/previewed/exported/assigned` | Implicit project state | Assignment has rollback; users should review inferred words |
| 23 | Microphone tuner · `voice.js` | `idle → requesting permission → listening → stopped/error`; leaving tool stops | **Explicit `AsyncActivity` after audit** | Verify late permission is released on real Android/desktop |
| 24 | Melody and rap editors · `voice.js` | `draft → edited → audition / MIDI export` and rhyme/flow changes | Implicit project state | Audition is async; potential overlapping tones are bounded independently |
| 25 | Vocal overdub · `voice.js`, `storage.js` | `transport required → permission → align to beat → recording → saving → layer ready/error` | Implicit; transport-epoch check | Late permission and save failures deserve explicit per-take generation in a follow-up |
| 26 | Vocal layers/harmony · `voice.js`, `audio.js` | `raw take → layer → muted/solo/pitched/previewed → deleted`; optional derived harmony | Implicit project state with transactional storage | Raw take and metadata must stay consistent after failed writes |
| 27 | Web MIDI · `app.js` | `unsupported / requesting → connected → inputs added/removed / failed` | Implicit browser callbacks | Unplug/reconnect, permissions and visual status need acceptance |
| 28 | Local audio/pitch engine · `audio.js` | `uninitialised → AudioContext/worklet loading → ready/fallback → source loaded/playing/stopped` | Implicit implementation states | Test delayed unlock and processor failure independently |
| 29 | PWA/offline shell · `sw.js`, `app.js` | `unregistered → registered/cache populated → offline shell/updates`; online indicator | Implicit service-worker lifecycle | Offline shell is not proof every model/API action works offline |

## Interaction rules and non-goals

- A studio route, selected pad, loop transport and audio output may coexist. They are **orthogonal**, not one enormous enum. Navigating among studio screens does not automatically stop a user-initiated loop or take.
- A camera capture is separate from an exported performance take. Only performance video/audio takes are mutually exclusive with each other.
- The local speech consent applies to the selected source and is revoked by unchecking it. No inferred transcript should be committed after cancellation, source change or consent withdrawal.
- Importing from Google is optional; the core device/files route must remain functional without Google configuration.
- Do not turn project storage into an event-sourced database or introduce a dependency such as XState until several independent flows genuinely need cross-machine orchestration.
- Do not migrate old project data merely to record runtime phases. Those phases must reset to idle on reload.

## Remaining priorities and acceptance gates

| Priority | Work | Done condition |
|---|---|---|
| P0 · this audit | Guard transport, performance recording, tuner and speech against stale async completions; preserve camera guard | Unit tests pass; no stale operation can become active or commit a result |
| P1 | Test the exact handlers in a real browser and Android: rapid Play/Stop, cancel while permission prompt open, switch Voice tool, revoke transcription consent, switch source, start both recording types | No unintended output or active microphone; UI reset and retry work; no duplicate recordings |
| P1 | Add an explicit lifecycle to vocal overdub start/save and to Google picker cancellation | No late stream after stop, no duplicate take, visible success/cancel/error |
| P2 | Make UI state diagnostics discoverable to automated agents through stable `data-state` attributes on major controls | Agent can assert state without parsing button text; no public or private user data exposed |
| P2 | Exercise failure/recovery paths: quota, interrupted save, invalid pack, export download, offline reload | Existing media survives failures; errors identify retry/backup route |

**Release gate:** source review, `npm test`, browser smoke, Workers runtime smoke and physical device testing. Passing a build or unit suite alone is insufficient to merge or deploy. No production credentials, API permissions, DNS or project-pack schema need to change for this refactor.
