import {open,stat,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {analyze,convert} from './converter.mjs';
import {DiskDirectory} from './native-ffmpeg.mjs';
const exec=promisify(execFile);

class LocalFile {
  constructor(path,size){this.path=path;this.name='input.lrec';this.size=size;}
  slice(start,end){const path=this.path;return {async arrayBuffer(){const n=end-start;const file=await open(path,'r');try{const buf=Buffer.allocUnsafe(n);const {bytesRead}=await file.read(buf,0,n,start);if(bytesRead!==n)throw Error('Source truncated');return buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);}finally{await file.close()}}}}
}
/** Converts one upload. Runs alone per process; OPFS adapter isolated to job directory. */
export async function runConversion(path,directory,onUpdate,options={}){
  await mkdir(join(directory,'opfs'),{recursive:true});
  const oldDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const base=globalThis.navigator;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{...base,storage:{getDirectory:async()=>new DiskDirectory(join(directory,'opfs'))}}});
  process.env.WORK_ROOT=directory;
  try{
    const st=await stat(path),record=await analyze(new LocalFile(path,st.size),Number(process.env.MAX_MINUTES||180),onUpdate);
    if(options.maxSeconds){const maxms=Math.min(record.duration,Math.round(options.maxSeconds*1000));
      record.duration=maxms;record.video=record.video.filter(v=>v.stamp<=maxms);
      record.audios=new Map([...record.audios].map(([k,a])=>[k,a.filter(v=>v.stamp<=maxms)]).filter(([,a])=>a.length));
      record.summary.duration_ms=maxms;
    }
    const result=await convert(record,{fps:Number(process.env.FPS||5),update:onUpdate});
    const dest=join(directory,'result.mp4');
    const {writeFile}=await import('node:fs/promises');
    await writeFile(dest,Buffer.from(await result.blob.arrayBuffer()));
    const {stdout}=await exec('/usr/bin/ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,codec_type','-of','json',dest],{timeout:30000});
    const probe=JSON.parse(stdout);const codecs=probe.streams?.map(s=>s.codec_name)||[];
    if(!codecs.includes('h264')||!codecs.includes('aac')||Math.abs(Number(probe.format?.duration)-record.duration/1000)>1.2)throw Error('MP4 verification failed');
    return {output:dest,report:{...result.report,engine:'Native FFmpeg Docker',duration_ms:record.duration,codecs}};
  }finally{
    if(oldDescriptor)Object.defineProperty(globalThis,'navigator',oldDescriptor);
    else delete globalThis.navigator;
    delete process.env.WORK_ROOT;
  }
}
