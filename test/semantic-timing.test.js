import test from 'node:test';
import assert from 'node:assert/strict';
import {joinWav,timingFromSegments,narratedSpeech} from '../dist/src/semantic/semantic-timing.js';
import {wordsFromDuration} from '../dist/src/shared/voice-engine-client.js';

const wav=(dataLength,frequency=440)=>{
 const header=Buffer.alloc(44),data=Buffer.alloc(dataLength,7);
 header.write('RIFF',0,'ascii');header.writeUInt32LE(36+dataLength,4);header.write('WAVE',8,'ascii');
 header.write('fmt ',12,'ascii');header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);
 header.writeUInt32LE(frequency,24);header.writeUInt32LE(frequency*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
 header.write('data',36,'ascii');header.writeUInt32LE(dataLength,40);
 return Buffer.concat([header,data]);
};

test('joinWav concatenates same-format PCM and rewrites the RIFF sizes',()=>{
 const joined=joinWav([wav(100),wav(50),wav(30)]);
 assert.equal(joined.toString('ascii',0,4),'RIFF');
 assert.equal(joined.readUInt32LE(4),36+180);
 assert.equal(joined.toString('ascii',36,40),'data');
 assert.equal(joined.readUInt32LE(40),180);
 assert.equal(joined.length,44+180);
});

test('joinWav refuses mismatched formats and invalid inputs',()=>{
 assert.throws(()=>joinWav([Buffer.from('not a wav')]),/not a RIFF\/WAVE/);
 assert.throws(()=>joinWav([]),/zero audio/);
 const good=joinWav([wav(20)]);
 assert.throws(()=>joinWav([good,wav(20,8000)]),/formats differ/);
});

test('timingFromSegments gives exact segment starts and semantic-segment provenance',()=>{
 const timing=timingFromSegments([
  {beatId:'b1',text:'one two three',durationMs:600,timingSource:'estimated'},
  {beatId:'b2',text:'four five',durationMs:1000,timingSource:'estimated'}]);
 assert.equal(timing.durationMs,1600);
 assert.equal(timing.timingSource,'semantic-segment');
 assert.equal(timing.words.length,5);
 assert.equal(timing.words[0].word,'one');assert.equal(timing.words[0].startMs,0);
 assert.equal(timing.words[3].word,'four');assert.equal(timing.words[3].startMs,600);
 assert.ok(timing.words.every((word,index)=>index===0||word.startMs>=timing.words[index-1].endMs));
 assert.throws(()=>timingFromSegments([{beatId:'b1',text:'one',durationMs:0,timingSource:'estimated'}]),/Invalid segment duration/);
});

test('provider word timestamps win over proportional estimates when every segment has them',()=>{
 const timing=timingFromSegments([
  {beatId:'b1',text:'alpha beta',durationMs:800,timingSource:'provider',words:[{word:'alpha',startMs:10,endMs:400},{word:'beta',startMs:400,endMs:790}]},
  {beatId:'b2',text:'gamma',durationMs:400,timingSource:'provider',words:[{word:'gamma',startMs:5,endMs:395}]}]);
 assert.equal(timing.timingSource,'provider');
 assert.deepEqual([timing.words[0].startMs,timing.words[2].startMs],[10,805]);
});

test('narratedSpeech synthesizes per beat and joins audio deterministically',async()=>{
 const speech=async text=>({timing:wordsFromDuration(text,500),audio:wav(40),format:'wav',provider:'supertonic',timingSource:'estimated'});
 const result=await narratedSpeech({text:'a b c',beats:[{id:'b1',text:'a b'},{id:'b2',text:'c'}]},speech);
 assert.equal(result.timing.durationMs,1000);
 assert.equal(result.timing.timingSource,'semantic-segment');
 assert.equal(result.format,'wav');
 assert.equal(result.audio.length,44+80);
 assert.equal(result.provider,'supertonic');
});

test('narratedSpeech keeps the single-call path for one-beat narration and fails loudly',async()=>{
 const speech=async text=>({timing:wordsFromDuration(text,900),audio:Buffer.from('RIFFxxxx'),format:'wav',timingSource:'estimated'});
 const single=await narratedSpeech({text:'only',beats:[{id:'b1',text:'only'}]},speech);
 assert.equal(single.timing.durationMs,900);
 await assert.rejects(()=>narratedSpeech({text:'a b',beats:[{id:'b1',text:'a'},{id:'b2',text:'b'}]},async()=>{throw new Error('tts exploded')}),/tts exploded/);
 await assert.rejects(()=>narratedSpeech({text:'a b',beats:[{id:'b1',text:'a'},{id:'b2',text:'b'}]},async text=>({timing:wordsFromDuration(text,500),audio:Buffer.from('RIFFxxxx'),format:text==='a'?'wav':'mp3',timingSource:'estimated'})),/mixed formats/);
});

test('joined WAV copies channels and blockAlign correctly (unit)',()=>{
 const joined=joinWav([wav(100),wav(50)]);
 assert.equal(joined.readUInt16LE(22),1,'channels copied from fmt');
 assert.equal(joined.readUInt32LE(24),440,'sampleRate copied');
 assert.equal(joined.readUInt32LE(28),880,'byteRate copied');
 assert.equal(joined.readUInt16LE(32),2,'blockAlign copied from fmt offset 12');
 assert.equal(joined.readUInt16LE(34),16,'bitsPerSample copied');
});

test('joined WAV passes ffprobe with correct codec, channels and duration',async()=>{
 const {execFileSync}=await import('node:child_process');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 let ffprobe=true;
 try{execFileSync('ffprobe',['-version'],{stdio:'ignore'});}catch{ffprobe=false;}
 if(!ffprobe){console.log('ffprobe not installed; skipping media validation (not a silent pass)');return;}
 const rate=16000,bytesPerSample=2,seconds=data=>data/(rate*bytesPerSample);
 const first=wav(rate*bytesPerSample,rate),second=wav(rate*bytesPerSample/2,rate);
 const joined=joinWav([first,second]);
 const dir=mkdtempSync(join(tmpdir(),'wav-join-')),file=join(dir,'out.wav');
 writeFileSync(file,joined);
 try{
  const probed=JSON.parse(execFileSync('ffprobe',['-v','error','-print_format','json','-show_format','-show_streams',file],{encoding:'utf8'}));
  const stream=probed.streams[0];
  assert.equal(stream.codec_name,'pcm_s16le');
  assert.equal(stream.channels,1);
  assert.equal(Number(stream.sample_rate),rate);
  const actual=Number(probed.format.duration),expected=seconds(first.length-44+second.length-44);
  assert.ok(Math.abs(actual-expected)<0.05,`duration ${actual} vs ${expected}`);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
