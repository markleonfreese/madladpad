import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../site/styles.css',import.meta.url),'utf8');

test('the primary studio surface exposes a simple playable progression',()=>{
  assert.match(html,/<a href="#sounds" data-studio-screen="sounds"[^>]*><span>01<\/span>\s*Playground<\/a>/);
  assert.match(html,/<a href="#beats" data-studio-screen="beats"[^>]*><span>02<\/span>\s*Sequence<\/a>/);
  assert.match(html,/<a href="#export" data-studio-screen="export"[^>]*><span>03<\/span>\s*Video &amp; Export<\/a>|<a href="#export" data-studio-screen="export"[^>]*><span>03<\/span>\s*Video & Export<\/a>/);
  assert.match(html,/<summary>Experimental<\/summary>/);
  assert.match(html,/<section class="intro" id="studio-intro"[^>]*hidden>/);
  assert.doesNotMatch(html,/PLAYGROUND · 12 PADS|id="grid-section-label"/,'the Playground should not repeat its navigation label or pad count');
  assert.match(html,/<div class="playground-actions"><button id="demo-button"[^>]*>Demo sounds<\/button><button type="button" id="pad-edit-mode"/,'pad actions should remain available without the redundant heading');
  assert.doesNotMatch(html,/<div class="pad-bottom">[\s\S]*?<button id="demo-button"/,'demo sounds should be in the first-screen Playground controls');
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
