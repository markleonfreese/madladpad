# Playground-first UX review and implementation (10 November 2026)

Status: merged in PR #119; PR #142 moves the global fallback demo toggle into Settings, leaving Edit pads as the single Playground toolbar action, and dismisses the Project menu when navigating or tapping outside. PR #145 adds optional per-pad one-step gating while preserving full-sound defaults. PR #148 adds optional held-step looping. PR #151 removes overflow clipping from Experimental navigation and verifies the Voice Lab/Overdub popup at phone and desktop widths. The current static Pages release is deployment `bd8f37c8-50ee-44d0-b73f-b82b7f3c07be` from main `17b7290`. This does not update the separate legacy Workers URL. Remaining physical-device, screen-reader and listening checks are listed in [DEVICE-ACCEPTANCE.md](DEVICE-ACCEPTANCE.md).

## Sequencer playback follow-up (12 November 2026)

- **Play full sound** remains the default for existing and new pads. **One sound per step** and **Loop across held steps** are optional per-pad settings saved in projects and scenes. One-step starts the trim per active cell and gates at the next canonical 16th boundary; loop starts a contiguous run once, repeats short decoded audio and releases at a gap. Pattern Undo restores steps and offsets only, so it does not revert this sound setting.
- A held run may span step 15→0; all-on patterns continue across bars until stopped or changed. Queued scene launch releases the old run at the bar boundary. Unsupported media uses a full one-shot with a limitation notice. Manual pad taps remain one-shot.

## Design decision

The application is an instrument first and an editor second. Default entry is the playable 12-pad Playground. Project management, advanced beat controls, camera settings, sample suggestions, pitch/MIDI tools, Voice Lab and Overdub remain available without occupying the first screen.

| Intent | First action | Deeper action / guard |
| --- | --- | --- |
| Play a sample | Tap a loaded pad; starts immediately | Hold to sustain until release; a short tap completes the one-shot |
| Add a clip | Tap an empty pad: Record or Files | Hold empty pad for 550 ms, release to open camera preview; recording still requires explicit Start and Keep |
| Edit a pad | Tap **Edit pads**, then a pad; or use desktop Edit / track Edit | A modal editor opens in view; Done or Escape closes it |
| Find the right moment | Clip preview, start/end timeline, Apply | Advanced suggestions, volume/speed/pitch, MIDI, duplicate |
| Reuse one clip | Advanced → Copy to empty pad | Copied media has independent trim, volume, pitch and speed, retaining destination ID and beat/solo/mute state |
| Build a beat | Beat Maker → choose pad → tap steps; Surprise Me | Advanced beat controls: grid, recording, all tracks and scene management |
| Make a video | Video & Export → Record Video or Audio | Optional follow-active/fixed/directed composition, aspect/format and video director |
| Work with other tools | Lab → Voice Lab / Overdub | Optional advanced workflows stay functional |

## UX risks addressed

- The old inspector was well below the grid on phones; Edit changed selection without showing the editing controls. Edit now opens a visible dialog with accessible close and Escape handling.
- Pad interaction no longer relies on mobile text-selection gestures. A gesture on an empty pad cannot start recording or overwrite anything without explicit camera review/Keep.
- Source imports, sample trim, video export and specialised settings no longer compete visually with the grid. Project backup/restore and name are in a single Project menu.
- The transport remains within reach at the bottom of narrow viewports, while layout, BPM and quantisation stay in a disclosure. The old 4/12/16-pad layouts and project model are unchanged.
- The Beat Maker's pad choice and Surprise Me are visible; later actions (make video, advanced pattern controls) no longer block step entry.
- Unsupported Google picker actions remain disabled and are omitted from the active menus until configured.

## Safeguards and limits

- This change does not alter the saved project schema, bulk media import, offline cache, output file codecs, audio quantisation, voice models or the camera save transaction.
- The duplicate action stores a second media slot using the existing IndexedDB representation. A future shared media-library index could deduplicate storage, but that requires an explicit migration and rollback plan.
- Follow-active video composition is the newly preferred default for **new** capture sessions; fixed grid and directed shots remain selectable. Recording is not automatically started.
- GitHub Verify `42837683740` passed unit tests, Chromium/browser and accessibility checks, WebKit mobile-adjacent smoke, and Workers runtime checks on current main. These synthetic checks do not verify physical Android/iOS, real camera permissions, touch gestures, screen readers, or human listening.
- The browser regressions for the Playground-first editing flow are in the current suite. Continue using the physical-device checklist for those remaining acceptance gates; do not describe them as pre-merge work.

## Minimum release acceptance

1. On Android 320/390-wide and iPhone Safari, pad hit targets and Edit mode are usable; the Playground grid is visible without a long initial scroll, and the bottom transport does not cover controls.
2. Tap/hold/release on loaded pads, and tap/hold on empty pads, behave as described; permissions are requested only on intentional capture, cancellation never saves media, and pad text is not selected.
3. Edit opens the expected sample immediately; close, Escape, import, trim, Apply, copy to another empty pad, then edit independently all work without changing the original pad or beat pattern.
4. Beat Maker still plays and saves patterns/scenes; Voice Lab and Overdub remain discoverable behind Lab; three video framing modes and audio/video exports still work.
5. Offline reopen and project pack restore retain selected trims, copied pads, patterns and recordings. Axe, keyboard focus and real-device smoke are clean.
