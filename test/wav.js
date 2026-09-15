/** Minimal valid 16-bit mono PCM WAV builder for tests. */
export function makeWav(dataLength=40,sampleRate=16000){
 const data=Buffer.alloc(dataLength,7),header=Buffer.alloc(44);
 header.write('RIFF',0,'ascii');header.writeUInt32LE(36+dataLength,4);header.write('WAVE',8,'ascii');
 header.write('fmt ',12,'ascii');header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);
 header.writeUInt32LE(sampleRate,24);header.writeUInt32LE(sampleRate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
 header.write('data',36,'ascii');header.writeUInt32LE(dataLength,40);
 return Buffer.concat([header,data]);
}
