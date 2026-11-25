import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../site/styles.css',import.meta.url),'utf8');

test('the primary studio surface exposes a simple playable progression',()=>{
  assert.match(html,/<a href="#sounds" data-studio-screen="sounds"[^>]*><span>01<\/span>\s*Playground<\/a>/);
  assert.match(html,/<a href="#beats" data-studio-screen="beats"[^>]*><span>02<\/span>\s*Beat Maker<\/a>/);
  assert.match(html,/<a href="#voice" data-studio-screen="voice"[^>]*><span>03<\/span>\s*Melody & Rhythm<\/a>/);
  assert.match(html,/<a href="#overdub" data-studio-screen="overdub"[^>]*><span>04<\/span>\s*Tracks<\/a>/);
  assert.match(html,/<a href="#export" data-studio-screen="export"[^>]*><span>05<\/span>\s*Export<\/a>/);
  assert.doesNotMatch(html,/<summary>Lab<\/summary>/,'Music stages should not be hidden behind a Lab submenu');
  assert.match(app,/\$\('sequencer'\)\.hidden = screen!=='beats'/,'Beat Maker must not be duplicated in Tracks');
  assert.match(html,/<section class="intro" id="studio-intro"[^>]*hidden>/);
  assert.doesNotMatch(html,/PLAYGROUND · 12 PADS|id="grid-section-label"/,'the Playground should not repeat its navigation label or pad count');
  assert.match(html,/<div class="playground-actions"><button type="button" id="pad-edit-mode"/,'Edit pads should be the primary Playground toolbar action');
  assert.doesNotMatch(html,/<div class="playground-actions"><button id="demo-button"/,'global demo fallback should not clutter the Playground');
  assert.match(html,/<div class="transport-settings">[\s\S]*?<button id="demo-button"[^>]*aria-pressed="false"/,'global demo fallback should remain reversible under Settings');
  assert.match(css,/\.transport-settings #demo-button/,'the settings demo action should have dedicated touch styling');
  assert.match(html,/<button[^>]*id="pad-edit-mode"[^>]*aria-pressed="false"/);
  assert.match(html,/<button[^>]*id="studio-play"/);
  assert.match(html,/<button[^>]*id="studio-record"[^>]*aria-pressed="false"/);
  assert.match(app,/\$\('studio-record'\)\.addEventListener\('click',toggleSetRecording\)/);
  assert.match(html,/<details class="control-disclosure" id="loop-settings">/);
  assert.match(css,/\.pad \.pad-hit\{touch-action:none/);
  assert.match(css,/\.transport-panel\{[^}]*position:fixed/);
  assert.match(css,/\.transport-controls\{[^}]*display:grid/);
  assert.match(app,/\$\('loop-settings'\)\.open = false/);
});

test('editing is modal, trim-first and advanced tools remain reachable',()=>{
  assert.match(html,/<dialog id="sample-editor-dialog"[^>]*aria-labelledby="selected-number"/);
  assert.match(html,/<button[^>]*id="close-sample-editor"/);
  const trimAt=html.indexOf('id="region-title"');
  const advancedAt=html.indexOf('id="sample-advanced"');
  assert.ok(trimAt>0&&advancedAt>trimAt,'the trim editor should precede advanced tools');
  assert.match(html,/<select id="copy-target"/);
  assert.match(html,/<button id="copy-pad"/);
  assert.ok(html.indexOf('class="copy-sample"')<advancedAt,'reusing a recording should not require opening advanced tools');
  assert.match(html,/<details class="editor-sources" id="editor-sources"/);
  assert.match(app,/function openSampleEditor\(id(?:, trigger=null)?\)/);
  assert.match(app,/edit\.addEventListener\('click', \(\) => openSampleEditor\(id(?:, edit)?\)\)/);
});

test('beat selection and recording are clear, video framing defaults to following activity',()=>{
  const beatSelect=html.indexOf('id="beat-pad-select"');
  const beatAdvanced=html.indexOf('id="beat-advanced"');
  assert.ok(beatSelect>0&&beatSelect<beatAdvanced,'the beat pad picker belongs in the basic Beat Maker');
  assert.match(html,/<button class="pill-button" id="auto-beat">SURPRISE ME<\/button>/);
  assert.match(html,/<button class="pill-button" id="sequence-pad-toggle"[^>]*aria-expanded="false"/);
  assert.match(html,/<option value="follow-active">Follow active pads<\/option><option value="fixed">/);
  assert.match(app,/\$\('export-lab'\)\.append\(\$\('video-director-details'\)\)/);
  assert.match(html,/<summary>Video framing &amp; formats<\/summary>/);
});

test('live Song video discloses and represents active local audio tracks',()=>{
  assert.match(html,/audio tracks appear as local waveforms/);
  assert.match(html,/not a deterministic full-Song render/);
  assert.match(html,/beat-following Melody and harmony appear as note lanes/);
  assert.match(html,/aria-label="Live performance composition with pad, audio waveform, Melody note lanes and video tiles"/);
  assert.match(app,/songAudioFramesAtStep\?\.\(songStep\)/,'live capture should ask the Song timeline for active audio clips');
  assert.match(app,/songMelodyVisualTracksAtStep\?\.\(songStep\)/,'live capture should ask the Song timeline for beat-following Melody notes');
  assert.match(app,/AUDIO · \$\{cell\.track\.name\}/,'audio waveform tiles should identify the source track');
  assert.match(app,/cell\.track\.peaks/,'waveform tiles should use the locally decoded source waveform');
  assert.match(app,/MELODY · \$\{cell\.track\.name\}/,'generated note lanes should identify Melody and harmony');
  assert.match(app,/note\.velocity\/127/,'note lanes should visualize note velocity');
  assert.match(app,/note\.step\/totalSteps/,'note lanes should use absolute arrangement time');
  assert.match(readFileSync(new URL('../site/sw.js',import.meta.url),'utf8'),/madladpad-shell-v42/,'the offline shell version should refresh Word Remix transport sync');
});

test('offline Song WAV export is accessible and describes its local support boundary',()=>{
  assert.match(html,/<button class=\"pill-button\" id=\"render-song-audio\"[^>]*aria-describedby=\"render-song-audio-note\"[^>]*>RENDER SONG MIX · OFFLINE WAV<\/button>/);
  assert.match(html,/<p id=\"render-song-audio-note\"[^>]*>Mixes saved Song steps with local pad and vocal audio, opted-in video-track audio, repeated Word Remix cues and beat-following Melody into a deterministic stereo WAV/);
  assert.match(html,/Independent Pitch and the built-in demo instruments are rendered locally/);
  assert.match(html,/<p id=\"render-song-audio-status\" class=\"voice-status\" role=\"status\" aria-live=\"polite\"/);
  assert.match(app,/rememberAudioTake:\(blob,duration\)=>\{rememberTake\('audio',blob,duration\);download\(blob,lastTakes\.audio\.name\);\}/,'a finished WAV should use the existing preview and take recovery path');
  assert.match(readFileSync(new URL('../site/sw.js',import.meta.url),'utf8'),/\/song-render\.js/,'offline rendering should be precached with the PWA shell');

});

test('full Song video export is local, cancellable, bounded and available for offline retry',()=>{
  assert.match(html,/<button class="pill-button" id="render-song-video"[^>]*aria-describedby="render-song-video-note"[^>]*>RENDER SONG VIDEO · MP4 \/ WEBM<\/button>/);
  assert.match(html,/<p id="render-song-video-note"[^>]*>Builds a complete local 24 fps video/);
  assert.match(html,/source-linked Word Remix cues/);
  assert.match(html,/preserves independent Pitch and built-in demo instruments/);
  assert.match(html,/<p id="render-song-video-status" class="voice-status song-video-render-status" role="status" aria-live="polite"/);
  assert.match(readFileSync(new URL('../site/voice.js',import.meta.url),'utf8'),/videoButton\.textContent=songVideoAbortController\?'× CANCEL VIDEO RENDER'/,'long video rendering should expose a cancel control');
  assert.match(readFileSync(new URL('../site/app.js',import.meta.url),'utf8'),/rememberVideoTake:\(blob,duration\)=>\{rememberTake\('video',blob,duration\);download\(blob,lastTakes\.video\.name\);\}/,'a completed video should use the existing preview, local recovery and download path');
  assert.match(readFileSync(new URL('../site/sw.js',import.meta.url),'utf8'),/\/song-video-render\.js/,'the deterministic video composer should be part of the offline shell');
  assert.match(readFileSync(new URL('../scripts/build-media-codec-kit.mjs',import.meta.url),'utf8'),/media-codec-kit\.bundle\.js/,'the tree-shaken local encoder should be generated by the build');
});

test('one Song arrangement owner, visible named patterns and no redundant action buttons',()=>{
  const beat=html.indexOf('id="sequencer"');
  const tracks=html.indexOf('id="overdub-lab"');
  const exportStage=html.indexOf('id="export-lab"');
  const patternLibrary=html.indexOf('id="pattern-library-title"');
  const song=html.indexOf('id="song-arranger"');
  assert.ok(beat<patternLibrary&&patternLibrary<tracks,'saved A/B/C patterns must be visible in Beat Maker');
  assert.ok(tracks<song&&song<exportStage,'the single editable Song arrangement must sit in Tracks');
  const advancedEnd=html.indexOf('</details>',html.indexOf('id="beat-advanced"'));
  assert.ok(patternLibrary>advancedEnd,'saved patterns should not require opening Advanced beats');
  for(const id of ['play-seq','make-video','export-pack-action','song-view','pattern-view']){
    assert.doesNotMatch(html,new RegExp('id="'+id+'"'),'duplicate or redundant '+id+' action');
  }
  for(const id of ['song-arranger','scene-select','studio-play','export-button']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'exactly one primary '+id+' control');
  }
  assert.match(app,/if\(screen==='overdub'&&sequenceView!=='song'\)setSequenceView\('song'\)/);
  assert.match(app,/if\(screen==='beats'&&sequenceView!=='patterns'\)setSequenceView\('patterns'\)/);
  assert.match(app,/renderSong\(\);voiceLab\?\.refreshTimeline\?\.\(\);queueSave\(\)/,'song changes should update the waveform ruler');
});

test('Word Remix reuses one original speaker video monitor in the existing studio transport',()=>{
  assert.match(html,/<aside id="word-remix-live"[^>]*hidden>/);
  assert.match(html,/<video id="word-remix-live-video" playsinline preload="metadata"/);
  assert.match(html,/id="word-remix-follow-transport"/);
  assert.equal((html.match(/id="word-remix-live-video"/g)||[]).length,1);
  assert.match(css,/\.word-remix-live\{position:fixed/);
});
