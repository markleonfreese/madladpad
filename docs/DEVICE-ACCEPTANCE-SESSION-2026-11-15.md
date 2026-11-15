# MadLadPad — physical-device acceptance session

**Prepared:** 15 November 2026 (AWST)  
**Execution status:** **BLOCKED — no physical Android or iOS device is connected to the assistant.** These checks have **not** been performed in this session; never convert preparation, simulated Chromium/WebKit or screenshots into a device PASS.  
**Published target:** https://madladpad.pages.dev  
**Authoritative source:** Pages production deployment `ffb580d0-9759-4665-a535-faab36f56907`, commit `7f2069df3344c155653cc615b6b526cf3cb8a6f7`. Do not use review-only PR #84, the legacy Worker, or a local preview as a substitute for the production URL.  
**Record results:** [Issue #2](https://github.com/markleonfreese/madladpad/issues/2), link [Issue #200](https://github.com/markleonfreese/madladpad/issues/200), [Issue #208](https://github.com/markleonfreese/madladpad/issues/208), [Issue #134](https://github.com/markleonfreese/madladpad/issues/134) for retrigger defects.

## Session header (complete separately per device)

| Field | Actual observation |
| --- | --- |
| Device model / form factor | Not supplied |
| OS version / browser version | Not supplied |
| Browser tab or installed home-screen PWA | Not tested |
| Tested URL / source release | `https://madladpad.pages.dev` / `7f2069d` expected; device not observed |
| Test date and time (AWST) | Not started |
| Available free device storage | Unknown |
| Headphones / speaker; audio and video output | Unknown |
| Network (Wi-Fi / mobile / offline) | Unknown |
| Accessibility (TalkBack / VoiceOver) | Not tested |
| Tester / redacted evidence link | Not provided |

**Safety before testing:** Existing personal clips and IndexedDB media must be backed up through **Project menu → Back up project** first. Work only in a disposable test project. Use original, rights-safe short sounds and nonsensitive spoken words; never upload private recordings, project packs or screenshots containing personal data to a public issue. Avoid clearing site storage, app data or browser cache until the test project is exported and recoverable. No live network API key or paid external service is needed.

## Device-run checklist

| ID | Exact device actions | Expected outcome | Actual status |
| --- | --- | --- | --- |
| D1 | Open **the published URL** in Android Chrome and separately in iOS Safari, with browser/OS versions noted; rotate portrait/landscape | Playground, Sequence, Video & Export and More tools are reachable; no horizontal document overflow; controls fit touch targets; no console-independent visible errors | **BLOCKED — physical devices unavailable** |
| D2 | On Playground choose two different demo or local sample pads. Play A (a multi-second sound) then B; rapidly retrigger A twice with separate taps | B does **not** cut A short; each new A gesture starts one sample attack, no double-fire, stuck audio or stray synthesized click | **BLOCKED — hardware listening** |
| D3 | In **Sequence → PATTERNS**, create short patterns and use **Advanced beats → Scene name → SAVE NEW** to save A, B and C. Switch to **SONG**; **SECTION / NUMBER OF BARS / ADD SECTION** create A(8) → B(16) → C(4) → A(8) | Four linked clips, **36 bars**; reused A is the same saved pattern. Play Song and verify A/B/C/A transitions, bar boundaries and final stop | **BLOCKED — device** |
| D4 | On Song ruler select a 4+ bar section, drag its move handle and right-edge resize handle; then use the numeric LENGTH (BARS) and the existing Move earlier/later buttons | Correct reorder/whole-bar resize; no accidental edit while scrolling; new timing persists after a reload; touches do not trigger adjacent clips | **BLOCKED — device** |
| D5 | Play Song; open **More tools → Overdub**, allow microphone and press **RECORD AUDIO TRACK**. Speak/sing a short **non-sensitive** take crossing a bar/section boundary, then **STOP AND SAVE TAKE** | Audible take; waveform positioned at the recorded bar, start and end visible, non-destructive trims and start position editable, original take preserved after reload. No ongoing mic after Stop | **BLOCKED — real microphone** |
| D6 | On disposable Song, press **RECORD VIDEO TRACK**, grant camera/mic, record and save a short clip; review output in Video & Export | Video appears as a timed Song track and can be reviewed; audio is initially muted unless explicitly enabled; stop/cancel releases camera/mic. Sound/video alignment is acceptable to a human listener | **BLOCKED — real camera** |
| D7 | Back up the test project as `.madladpad`, verify file exists; then import/restore **only the disposable backup** after reopening | A/B/C/A, sources, waveform, trim, video, audio opt-in and clip positions survive with no duplicates or silent data loss | **BLOCKED — device** |
| D8 | After successfully loading all app resources while online, install/add the PWA to the home screen and reopen once. Disconnect networking and reopen the installed app. Check saved local audio and Song. Restore networking afterwards | Existing project, shell and locally cached assets function as expected offline; no silent erase or unexpected upload. Note separately if speech model was never cached | **BLOCKED — installed PWA** |
| D9 | With a *new, disposable test take only*, interrupt app mid-recording (OS app switch or process kill), reopen and inspect any recovery prompt. Repeat with permission denial in a separate fresh browser session if safe | Recoverable committed take or explicit safe failure; no corruption of previous raw source, no stuck recording permission, transparent messaging. Do **not** force low storage, delete media or kill a real recording | **BLOCKED — OS interruption / quota** |
| D10 | Enable TalkBack on Android or VoiceOver on iOS and navigate Song, handles, timeline, microphone record/stop and saved takes without looking | Controls have meaningful accessible names, focus order makes sense and the workflow is operable without relying only on drag | **BLOCKED — physical screen reader** |
| D11 | Listen to generated audio export and watch video export through actual device speakers/headphones; compare section changes and the overdub against the timeline | No unexpected cutoff, obvious doubling, missing instrument, major drift or silence; device and file format are recorded | **BLOCKED — human listening/video** |

**Stop immediately** on unexpected loss of existing user data, runaway recording, persistent camera/mic activity after Stop, repeated corrupt project-pack restore, device overheating, or a potentially billable prompt. Preserve a sanitised reproduction description; do not reset the browser or destroy the project before capturing recoverable evidence.

## Evidence and disposition

For each device: record **PASS / FAIL / BLOCKED / NOT TESTED** for D1–D11, with OS/browser, network state, timestamp, exact action, observed versus expected result, any redacted screenshot (no private media), export type/duration and an Issue #2 comment. Failures should be linked to a focused defect; do not silently close existing Issues #2, #200 or #208. A Chromium/WebKit desktop pass remains **synthetic-only**.

**Current conclusion (15 November 2026):** no real phone, microphone, camera, native installed-PWA or screen-reader session has been executed through this assistant. Production release can be retained based on separate verified static/deployment/browser evidence, but device acceptance remains **BLOCKED**, not passed. A user or an authorised physical device tester must perform D1–D11 and report actual observations.
