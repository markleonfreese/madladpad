import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, normaliseProject } from '../site/core.js';
import { SamplerAudio } from '../site/audio.js';

test('legacy projects default speed to 1 and preserve pitch metadata', () => {
  const project = normaliseProject({pads:[{pitch:7}]});
  assert.equal(project.pads[0].speed, 1);
  assert.equal(project.pads[0].pitch, 7);
  assert.equal(normaliseProject({pads:[{speed:4}]}).pads[0].speed, 2);
  assert.equal(normaliseProject({pads:[{speed:0.1}]}).pads[0].speed, 0.5);
  assert.equal(makeProject().pads[0].speed, 1);
});

test('speed alone sets media playbackRate while pitch metadata is ignored', async () => {
  const element = { duration: 10, currentTime:0, playbackRate:1, preservesPitch:false, pause(){}, play(){return Promise.resolve();} };
  const sampler = Object.create(SamplerAudio.prototype);
  sampler.context = {currentTime:0};
  sampler.sources = new Map([[0,{file:{},element,gain:{gain:{value:1}}}]]);
  sampler.demoEnabled = false;
  assert.equal(sampler.trigger(0,{kind:'video',start:0,end:0.05,speed:1.5,pitch:7,volume:1},()=>{},0),true);
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(element.playbackRate,1.5);
  assert.equal(element.preservesPitch,true);
});
