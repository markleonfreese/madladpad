import assert from 'node:assert/strict';
import test from 'node:test';
import { melodyClipMapBars, renderMelodyClipMap } from '../site/melody-roll.js';
import { melodyClipEvents } from '../site/core.js';

const clip={id:'bass',name:'Bass phrase',startStep:0,patternBars:2,repeatEnabled:true,repeatEveryBars:8,repeatPhaseBars:0,placementEndBar:null,notes:[{midi:60,step:0,duration:4}]};
const starts=map=>map.flatMap((state,i)=>state==='start'?[i+1]:[]);

test('a two-bar phrase every eight bars shows independent repeat gaps and does not mutate notes',()=>{
  const before=JSON.stringify(clip),map=melodyClipMapBars(clip,24);
  assert.equal(map.length,24);
  assert.deepEqual(starts(map),[1,9,17]);
  assert.deepEqual(map.slice(0,8),['start','phrase','gap','gap','gap','gap','gap','gap']);
  assert.deepEqual(melodyClipEvents(clip,24).map(note=>note.step/16+1),starts(map));
  assert.equal(JSON.stringify(clip),before);
});
test('phase and exclusive end bar agree with playback scheduling',()=>{
  const c={...clip,startStep:16,repeatPhaseBars:2,placementEndBar:13};
  const map=melodyClipMapBars(c,24);
  assert.deepEqual(starts(map),[4,12]);
  assert.equal(map[2],'outside');assert.equal(map[4],'phrase');assert.equal(map[12],'outside');
  assert.deepEqual(melodyClipEvents(c,24).map(note=>note.step/16+1),[4,12]);
});
test('one-shot ignores repeat phase and ends after its phrase',()=>{
  assert.deepEqual(melodyClipMapBars({...clip,startStep:32,repeatEnabled:false,repeatPhaseBars:4},6),['outside','outside','start','phrase','outside','outside']);
});
test('overlapping cycles show each start without inventing silent gaps',()=>{
  assert.deepEqual(melodyClipMapBars({...clip,patternBars:3,repeatEveryBars:2},6),['start','phrase','start','phrase','start','phrase']);
});
test('sub-bar starts, partial end, and clips entirely outside the song are represented',()=>{
  const c={...clip,startStep:8,patternBars:1,repeatEnabled:false};
  assert.deepEqual(melodyClipMapBars(c,3),['start','phrase','outside']);
  assert.deepEqual(melodyClipMapBars({...c,startStep:64},3),['outside','outside','outside']);
  assert.deepEqual(melodyClipMapBars({...c,placementEndBar:1},3),['outside','outside','outside']);
});

function element(tag,doc){
  return {tag,ownerDocument:doc,dataset:{},attributes:{},children:[],listeners:{},textContent:'',
    setAttribute(key,value){this.attributes[key]=String(value);},
    append(...items){this.children.push(...items);},
    replaceChildren(){this.children=[];},
    addEventListener(name,fn){this.listeners[name]=fn;},
    click(){if(!this.disabled)this.listeners.click?.();},
    focus(){doc.focused=this;},
    querySelector(selector){
      const match=selector.match(/^\[aria-label="(.*)"\]$/);
      return walk(this).find(node=>match&&node.attributes['aria-label']===match[1])||null;
    }
  };
}
function walk(node){return [node,...node.children.flatMap(walk)];}
test('map selection and paging use the existing lane callback without editing the clip',()=>{
  const doc={createElement(tag){return element(tag,doc);}},host=element('div',doc);
  const melody={notes:[],clips:[clip],activeClipId:'bass'},chosen=[],before=JSON.stringify(melody);
  renderMelodyClipMap(host,melody,24,id=>chosen.push(id));
  assert.equal(host.querySelector('[aria-label="Edit MIDI clip Bass phrase"]').attributes['aria-pressed'],'true');
  assert.equal(walk(host).filter(n=>n.dataset.state==='start').length,2);
  host.querySelector('[aria-label="Next MIDI map bars"]').click();
  assert.equal(host.dataset.firstBar,'17');
  assert.equal(walk(host).filter(n=>n.dataset.state==='start').length,1);
  assert.equal(host.querySelector('[aria-label="Next MIDI map bars"]').disabled,true);
  host.querySelector('[aria-label="Edit standalone melody"]').click();
  host.querySelector('[aria-label="Edit MIDI clip Bass phrase"]').click();
  assert.deepEqual(chosen,['','bass']);
  assert.equal(JSON.stringify(melody),before);
});
