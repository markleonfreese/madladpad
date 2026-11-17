// Synthetic local-source encode/decode test. It does not use user media or a production service.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root=resolve('site');
const renderDurationSeconds=Number(process.env.MADLADPAD_VIDEO_DURATION_SECONDS)||2;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local video acceptance</title>');return;}
  const path=resolve(root,`.${pathname}`);
  if(!path.startsWith(`${root}/`)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}
  catch{res.writeHead(404).end();}
});

let browser;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();
  const errors=[];
  context.on('request',request=>{if(!request.url().startsWith(`http://127.0.0.1:${server.address().port}/`))errors.push(`off-origin request: ${request.url()}`);});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='log'&&message.text().startsWith('LONG_VIDEO_PROGRESS'))console.log(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/?duration=${renderDurationSeconds}`);
  const result=await page.evaluate(async()=>{
    const Media=await import('/media-codec-kit.bundle.js');
    const {renderSongVideo,songVideoDimensions}=await import('/song-video-render.js');
    const dimensions=songVideoDimensions('16:9');
    const sampleRate=44100,durationSeconds=Number(new URLSearchParams(location.search).get('duration'))||2;
    const sourceAudio=new AudioBuffer({numberOfChannels:2,length:sampleRate*2,sampleRate});
    for(let channel=0;channel<2;channel++){
      const data=sourceAudio.getChannelData(channel);
      for(let frame=0;frame<data.length;frame++)data[frame]=.08*Math.sin(2*Math.PI*220*frame/sampleRate);
    }
    const sourcePlan={durationSeconds:2,bpm:90};
    const source=await renderSongVideo(sourcePlan,{audioBuffer:sourceAudio,visualsAtTime:seconds=>[
      {kind:'midi',trackId:'lead',name:'Lead',midi:60+Math.floor(seconds*4),velocity:96,sourceSeconds:seconds}
    ]},{Media,format:'auto',aspect:'16:9'});
    const sourceTwo=await renderSongVideo(sourcePlan,{audioBuffer:sourceAudio,visualsAtTime:seconds=>[
      {kind:'midi',trackId:'harmony',name:'Harmony',midi:72+Math.floor(seconds*2),velocity:80,sourceSeconds:seconds}
    ]},{Media,format:'webm',aspect:'16:9'});

    const artworkCanvas=document.createElement('canvas');artworkCanvas.width=96;artworkCanvas.height=96;
    const art=artworkCanvas.getContext('2d');art.fillStyle='#ed5d3d';art.fillRect(0,0,96,96);art.fillStyle='#fff2d7';art.fillRect(20,20,56,56);
    const artwork=await new Promise(resolve=>artworkCanvas.toBlob(resolve,'image/png'));
    let lastProgress=0,plan,audioBuffer,visualsAtTime,visualFiles,timelineChecks=[];
    if(durationSeconds>10){
      const {makeProject,normaliseProject,normaliseSong}=await import('/core.js');
      const {buildSongRenderPlan,songRenderVisualsAtTime,renderSongAudioWav}=await import('/song-render.js');
      const makePattern=(id,name)=>{
        const pads=Array.from({length:16},()=>({steps:Array(16).fill(false),stepOffsets:Array(16).fill(0)}));
        pads[0].steps[0]=true;pads[1].steps.fill(true);return{id,name,pads};
      };
      const base=makeProject();
      const project=normaliseProject({...base,bpm:90,
        pads:base.pads.map((pad,index)=>index===0?{...pad,kind:'audio',fileName:'local-tone.wav',start:0,end:2,volume:.35,speed:1,pitch:0}
          :index===1?{...pad,kind:'image',fileName:'artwork.png',start:0,end:1}:pad),
        scenes:[makePattern('a','Intro'),makePattern('b','Verse'),makePattern('c','Hook')],
        song:normaliseSong({clips:[{id:'intro',sceneId:'a',bars:8},{id:'verse',sceneId:'b',bars:16},{id:'hook',sceneId:'c',bars:24},{id:'outro',sceneId:'a',bars:24}]}),
        voice:{...base.voice,layers:[],videoLayers:[
          {id:'video-one',name:'Verse camera',startStep:0,trimStartSec:.2,trimEndSec:1.8,durationSec:2,repeatEnabled:true,repeatEveryBars:1,audibleLengthBars:.5,placementEndBar:72},
          {id:'video-two',name:'Hook camera',startStep:128,trimStartSec:.1,trimEndSec:1.9,durationSec:2,repeatEnabled:true,repeatEveryBars:1,audibleLengthBars:.5,placementEndBar:72}
        ],melody:{...base.voice.melody,followBeat:true,notes:Array.from({length:72},(_,bar)=>({midi:60+bar%12,step:bar*16,duration:16,velocity:100,layer:'lead'}))}}
      });
      plan=buildSongRenderPlan(project,{padDurations:{0:2}});
      if(plan.bars!==72||plan.durationSeconds!==192)throw new Error(`Expected the full 72-bar / 192-second plan, received ${plan.bars} bars / ${plan.durationSeconds} s.`);
      const mixed=await renderSongAudioWav(plan,{pads:new Map([[0,sourceAudio]])},{makeWav:false});
      audioBuffer=mixed.buffer;
      visualsAtTime=seconds=>songRenderVisualsAtTime(project,plan,seconds);
      visualFiles=new Map([['video-one',source.blob],['video-two',sourceTwo.blob],['pad-1',artwork]]);
      timelineChecks=[.5,22,65,128.5,189.5].map(seconds=>{
        const section=plan.sections.find(item=>seconds>=item.startStep*60/90/4&&seconds<item.endStep*60/90/4);
        return {seconds,section:section?.sceneId,kinds:visualsAtTime(seconds).map(item=>item.kind)};
      });
    }else{
      audioBuffer=sourceAudio;plan={durationSeconds,bpm:90};
      visualsAtTime=seconds=>[
        {kind:'video',trackId:'video-one',name:'Verse camera',sourceSeconds:seconds%2},
        {kind:'video',trackId:'video-two',name:'Hook camera',sourceSeconds:(seconds+.4)%2},
        {kind:'still',trackId:'pad-1',name:'Local artwork',sourceSeconds:0},
        {kind:'midi',trackId:'melody',name:'Lead melody',midi:60+Math.floor(seconds*3),velocity:112,sourceSeconds:seconds}
      ];
      visualFiles=new Map([['video-one',source.blob],['video-two',sourceTwo.blob],['pad-1',artwork]]);
    }
    let timelineCoverage=true;
    for(const check of timelineChecks){
      const kinds=check.kinds;
      const videoCount=kinds.filter(kind=>kind==='video').length;
      if(!['video','still','midi','waveform'].every(kind=>kinds.includes(kind))||videoCount<1||videoCount>2||(check.seconds>.5&&videoCount!==2))timelineCoverage=false;
    }
    const composed=await renderSongVideo(plan,{audioBuffer,visualFiles,waveformBuffers:new Map([['pad-0',sourceAudio]]),visualsAtTime},
    {Media,format:'auto',aspect:'16:9',onProgress:event=>{
        lastProgress=event.frames;
        if(durationSeconds>10&&event.frames%240===0)console.log(`LONG_VIDEO_PROGRESS ${event.frames}/${event.totalFrames}`);
      }});
    const input=new Media.Input({source:new Media.BlobSource(composed.blob),formats:[Media.MP4,Media.QTFF,Media.WEBM]});
    const videoTrack=await input.getPrimaryVideoTrack();
    const audioTrack=await input.getPrimaryAudioTrack();
    const sink=new Media.VideoSampleSink(videoTrack);
    const decoded=await sink.getSample(Math.max(0,durationSeconds-0.8));
    const metadata={format:composed.format,codec:composed.codec,size:composed.blob.size,duration:await videoTrack.computeDuration(),
      audioDuration:await audioTrack.computeDuration(),width:decoded.displayWidth,height:decoded.displayHeight,progress:lastProgress};
    decoded.close();input.dispose();
    return {metadata,dimensions,sourceFormat:source.format,secondSourceFormat:sourceTwo.format,timelineChecks,timelineCoverage};
  });
  assert.deepEqual(result.dimensions,{width:640,height:360});
  assert.ok(['mp4','webm'].includes(result.metadata.format));
  assert.equal(result.secondSourceFormat,'webm','the local renderer should support the browser-native WebM fallback as well as MP4');
  const durationSeconds=renderDurationSeconds;
  assert.ok(Math.abs(result.metadata.duration-durationSeconds)<=.06,`video duration should match Song time: ${result.metadata.duration}`);
  assert.ok(Math.abs(result.metadata.audioDuration-durationSeconds)<=.06,`muxed audio should match Song time: ${result.metadata.audioDuration}`);
  assert.equal(result.metadata.width,640);assert.equal(result.metadata.height,360);
  assert.ok(result.metadata.size>5000&&result.metadata.size<48*1024*1024);
  assert.equal(result.metadata.progress,Math.ceil(durationSeconds*24));
  if(durationSeconds>10){
    assert.equal(result.timelineCoverage,true,`the 72-bar arrangement should keep its four-source visual at A/B/C/A transitions: ${JSON.stringify(result.timelineChecks)}`);
    assert.deepEqual(result.timelineChecks.map(check=>check.section),['a','b','c','a','a']);
  }
  assert.deepEqual(errors,[]);
  console.log(`Synthetic offline video encode/decode passed: ${JSON.stringify(result.metadata)}; two local video tiles, local artwork, MIDI visualization and generated audio.`);
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
