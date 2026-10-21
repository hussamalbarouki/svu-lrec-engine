import {open,stat,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {analyze,convert} from './converter.mjs';
import {DiskDirectory} from './native-ffmpeg.mjs';
const exec=promisify(execFile);
import {makeRenderer,decodeAudio} from './converter.mjs';
import {pngRGB} from './png.mjs';
import {createHash} from 'node:crypto';
import {statfs,writeFile,open as fsOpen} from 'node:fs/promises';
import {spawn} from 'node:child_process';


class LocalFile {
  constructor(path,size){this.path=path;this.name='input.lrec';this.size=size;}
  slice(start,end){const path=this.path;return {async arrayBuffer(){const n=end-start;const file=await open(path,'r');try{const buf=Buffer.allocUnsafe(n);const {bytesRead}=await file.read(buf,0,n,start);if(bytesRead!==n)throw Error('Source truncated');return buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);}finally{await file.close()}}}}
}

/** Adaptive VPS path: screen updates are VFR PNG snapshots, not thousands of
 * redundant constant-FPS images. Browser converter remains unchanged. */
async function fastNative(record,directory,onUpdate){
  const decoder=new NativeFFmpeg();let mix;
  try {onUpdate('فك الصوت',8);mix=await decodeAudio(record,decoder,onUpdate);}
  finally{decoder.terminate();}
  const audio=join(directory,'audio.raw'),file=await fsOpen(audio,'wx',0o600);
  try {const block=Buffer.allocUnsafe(524288);
    for(let offset=0;offset<mix.length;offset+=262144){
      const count=Math.min(262144,mix.length-offset);
      for(let i=0;i<count;i++)block.writeInt16LE(Math.max(-32768,Math.min(32767,mix[offset+i])),i*2);
      await file.write(block.subarray(0,count*2));
    }
  }finally{await file.close();}
  mix=null;
  const dir=join(directory,'frames');await mkdir(dir,{recursive:true});
  let idx=0,lastHash=null,totalBytes=0;const entries=[];
  const maxBytes=2*1024**3; // hard cap for temporary PNG snapshots
  const renderer=await makeRenderer(record);
  async function snapshot(t){
    const hash=createHash('sha1').update(renderer.rgb).digest('hex');
    if(hash===lastHash)return;lastHash=hash;
    const path=join(dir,'frame-'+String(entries.length).padStart(6,'0')+'.png');
    const png=pngRGB(record.width,record.height,renderer.rgb);
    totalBytes+=png.length;if(totalBytes>maxBytes)throw Error('VFR temporary files exceed disk cap');
    await writeFile(path,png,{flag:'wx',mode:0o600});entries.push({path,t});
  }
  try {
    while(idx<record.video.length&&record.video[idx].stamp===0)await renderer.apply(record.video[idx++]);
    await snapshot(0);
    while(idx<record.video.length){
      const t=record.video[idx].stamp;
      while(idx<record.video.length&&record.video[idx].stamp===t)await renderer.apply(record.video[idx++]);
      if(t>=record.duration)continue;
      await snapshot(t);
      if(idx%70===0)onUpdate('تجهيز الشاشة',30+35*idx/record.video.length);
    }
    const lines=['ffconcat version 1.0'];
    for(let i=0;i<entries.length;i++){
      lines.push("file '"+entries[i].path+"'");
      lines.push('duration '+(Math.max(1,(entries[i+1]?.t||record.duration)-entries[i].t)/1000).toFixed(6));
    }
    lines.push("file '"+entries[entries.length-1].path+"'");
    const playlist=join(directory,'frames.ffconcat');
    await writeFile(playlist,lines.join('\n')+'\n',{mode:0o600});
    const output=join(directory,'result.mp4');
    const args=['-nostdin','-hide_banner','-loglevel','error','-y',
      '-safe','0','-f','concat','-i',playlist,
      '-f','s16le','-ar','8000','-ac','1','-i',audio,
      '-map','0:v:0','-map','1:a:0',
      '-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-fps_mode','vfr',
      '-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-threads','2',
      '-c:a','aac','-b:a','64k','-ar','44100','-t',(record.duration/1000).toFixed(3),
      '-movflags','+faststart','-f','mp4',output];
    onUpdate('ترميز المحاضرة',73);
    await new Promise((resolve,reject)=>{
      const child=spawn('/usr/bin/ffmpeg',['-progress','pipe:2','-stats_period','1',...args],
        {cwd:directory,stdio:['ignore','ignore','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C'}});
      let stderr='',partial='',settled=false;
      const clock=setTimeout(()=>child.kill('SIGKILL'),Number(process.env.FFMPEG_EXEC_TIMEOUT_MS||7200000));
      const finish=(error)=>{if(settled)return;settled=true;clearTimeout(clock);error?reject(error):resolve();};
      child.stderr.on('data',b=>{
        stderr=(stderr+b.toString()).slice(-8192);partial+=b.toString();
        const lines=partial.split(/\r?\n/);partial=lines.pop()||'';
        for(const line of lines){const match=/^out_time_ms=(\d+)$/.exec(line.trim());
          if(match){const secs=Number(match[1])/1000000;
            if(Number.isFinite(secs))onUpdate('ترميز الفيديو · '+Math.min(99,Math.round(secs*100/(record.duration/1000)))+'%',Math.min(96,73+23*secs/(record.duration/1000)));
          }
        }
      });
      child.on('error',finish);child.on('close',code=>finish(code===0?null:Error('FFmpeg VFR: '+code+': '+stderr)));
    });
    onUpdate('فحص الفيديو',97);
    return {video_mode:'screen-events',size_bytes:(await stat(output)).size};
  }finally{
    await rm(dir,{recursive:true,force:true}).catch(()=>{});
    await rm(join(directory,'frames.ffconcat'),{force:true}).catch(()=>{});
    await rm(audio,{force:true}).catch(()=>{});
  }
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
    const dest=join(directory,'result.mp4');
    let report;
    if(record.video.length<6000 && process.env.VIDEO_MODE!=='cfr'){
      try{report=await fastNative(record,directory,onUpdate);}
      catch(error){console.warn('Fast VFR unavailable, falling back to original encoder:',error.message);
        const result=await convert(record,{fps:Number(process.env.FPS||5),update:onUpdate});
        await writeFile(dest,Buffer.from(await result.blob.arrayBuffer()));
        report={...result.report,video_mode:'fallback-cfr'};}
    }else{
      const result=await convert(record,{fps:Number(process.env.FPS||5),update:onUpdate});
      await writeFile(dest,Buffer.from(await result.blob.arrayBuffer()));
      report={...result.report,video_mode:'fallback-cfr'};
    }
    const {stdout}=await exec('/usr/bin/ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,codec_type','-of','json',dest],{timeout:30000});
    const probe=JSON.parse(stdout);const codecs=probe.streams?.map(s=>s.codec_name)||[];
    if(!codecs.includes('h264')||!codecs.includes('aac')||Math.abs(Number(probe.format?.duration)-record.duration/1000)>1.2)throw Error('MP4 verification failed');
    return {output:dest,report:{...report,engine:'Native FFmpeg adaptive',duration_ms:record.duration,codecs}};
  }finally{
    if(oldDescriptor)Object.defineProperty(globalThis,'navigator',oldDescriptor);
    else delete globalThis.navigator;
    delete process.env.WORK_ROOT;
  }
}
