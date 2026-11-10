import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../site/styles.css',import.meta.url),'utf8');

test('the primary studio surface exposes a simple playable progression',()=>{
  assert.match(html,/<a href="#sounds" data-studio-screen="sounds"[^>]*>Playground<\/a>/);
  assert.match(html,/<a href="#beats" data-studio-screen="beats">Beat Maker<\/a>/);
  assert.match(html,/<a href="#export" data-studio-screen="export">Video &amp; Export<\/a>|<a href="#export" data-studio-screen="export">Video & Export<\/a>/);
  assert.match(html,/<section class="intro" id="studio-intro"[^>]*hidden>/);
  assert.match(html,/<button[^>]*id="pad-edit-mode"[^>]*aria-pressed="false"/);
  assert.match(html,/<button[^>]*id="studio-play"/);
  assert.match(html,/<details class="control-disclosure" id="loop-settings">/);
  assert.match(css,/\.pad \.pad-hit\{touch-action:none/);
});

test('editing is modal, trim-first and advanced tools remain reachable',()=>{
  assert.match(html,/<dialog id="sample-editor-dialog"[^>]*aria-labelledby="selected-number"/);
  assert.match(html,/<button[^>]*id="close-sample-editor"/);
  const trimAt=html.indexOf('id="region-title"');
  const advancedAt=html.indexOf('id="sample-advanced"');
  assert.ok(trimAt>0&&advancedAt>trimAt,'the trim editor should precede advanced tools');
  assert.match(html,/<select id="copy-target"/);
  assert.match(html,/<button id="copy-pad"/);
  assert.match(app,/function openSampleEditor\(id(?:, trigger=null)?\)/);
  assert.match(app,/edit\.addEventListener\('click', \(\) => openSampleEditor\(id(?:, edit)?\)\)/);
});

test('beat selection and recording are clear, video framing defaults to following activity',()=>{
  const beatSelect=html.indexOf('id="beat-pad-select"');
  const beatAdvanced=html.indexOf('id="beat-advanced"');
  assert.ok(beatSelect>0&&beatSelect<beatAdvanced,'the beat pad picker belongs in the basic Beat Maker');
  assert.match(html,/<button class="pill-button" id="auto-beat">SURPRISE ME<\/button>/);
  assert.match(html,/<option value="follow-active">Follow active pads<\/option><option value="fixed">/);
  assert.match(app,/\$\('export-lab'\)\.append\(\$\('video-director-details'\)\)/);
  assert.match(html,/<summary>Video framing &amp; formats<\/summary>/);
});
