# Transcript and capture UX follow-up

**Status (16 November 2026): shipped.** The capture and sequence changes described here are included in the MadLadPad Pages production deployment `fa74f92d-478e-417d-8d29-2979505b265b`, built from app source `dfe52bbe665aee59e410062944e76a05bf3adc55`. The current `main` tip is `8c58698f746a3fe4a144f4d748198aed89a456da`; its commits after the deployed source are documentation-only, and `site/` has no differences from the deployed source. Cloudflare deployment status and source were checked read-only.

This note records the follow-up to the 16-minute in-person UX discussion. It summarizes a shorter record → play → sequence → share path while preserving local media and the existing project format. Use [`DEVICE-ACCEPTANCE.md`](DEVICE-ACCEPTANCE.md) for the release baseline and device checklist; use [Issue #2](https://github.com/markleonfreese/madladpad/issues/2) for dated evidence and blockers.

## Shipped changes

The follow-up addresses these observations:

| Observation | Shipped behavior | Remaining acceptance |
| --- | --- | --- |
| Recording video should not hide the live pads (15:24) | The shared **Record video** control uses the same recorder on Playground, Sequence and Export. | On Android and iOS, record while tapping pads, switch screens, stop, and review the saved video. |
| Sequence and pads require too much scrolling (13:26) | Sequence opens on its 16-step controls; the labelled **Show performance pads** disclosure reveals the pad grid when needed. | Check portrait layouts, keyboard access, TalkBack and VoiceOver. |
| One clip should supply multiple pads (01:48) | **Copy to pad** creates independent local media slots, each with its own trim. | Copy and trim on a phone, reload, then export and reimport a project pack. |
| Editing should prioritize the chosen sound (07:07) | A populated pad opens on its trim controls; **Replace this clip** reveals recording, file and optional source choices. | Check touch operation and modal focus on Android and iOS. |
| Empty-pad hold should suggest recording (03:40) | Holding an empty pad opens the camera flow; recording requires explicit **Start** and **Keep**. A tap opens source choices, including **Device / Files**. | Test hold, tap, cancellation, denied permission and overwrite protection on a phone. |

These behaviors preserve the existing permission and save transaction: a long press does not start recording or replace media without confirmation.

## Scope boundaries

- Copying is manual and uses independent pad media slots. Automatic multi-region splitting and a shared clip library are not part of this follow-up.
- Pad layouts remain 4, 12 or 16 pads. Automatically growing the layout requires a separate project-layout and migration decision.
- The current MVP also includes separate Speech, Melody and Rap tools. Their local inference and creative-flow acceptance is documented in [`DEVICE-ACCEPTANCE.md`](DEVICE-ACCEPTANCE.md) and [Issue #2](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6900860991).

## Verification and release status

Current `main` passes `npm test` (119/119 unit tests), `npm run test:browser`, `npm run test:song-browser`, `npm run test:webkit` and `npm run test:workers-runtime`. The opt-in `npm run test:speech-model` also passed with 28 synthetic speech words online and offline, a decoded phrase WAV, MIDI events matching the melody editor, and persisted Rap export. The checks use generated media and desktop browsers; they do not establish human speech accuracy or musical quality, physical-device behavior, or screen-reader acceptance. See [the current-main acceptance record](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6900834267) and [the real-model speech record](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6900860991).

Physical Android Chrome and iOS Safari/PWA acceptance remains open for camera permission, touch-hold, playback, recording during pad taps, trim/copy, layout, modal focus, offline reopen and project-pack restore. TalkBack, VoiceOver and human audio/video review also remain open. This host has no `adb` or iOS `simctl`. PR [#84](https://github.com/markleonfreese/madladpad/pull/84) is a review-only draft and is not a release candidate.

The deployed app is static Pages. This documentation update does not change application assets, production configuration or the published deployment. Account-wide spend under A$5/month is not conclusively verified; see [the billing check](https://github.com/markleonfreese/madladpad/issues/2#issuecomment-6900774452). Keep the physical-device, human-review and budget gates open until they have direct evidence.
