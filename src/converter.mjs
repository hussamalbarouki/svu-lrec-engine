import {checkMp4} from './mp4-check.mjs';
import {NativeFFmpeg} from './native-ffmpeg.mjs';
/* SVU LREC Browser Engine 2.3 — no lecture bytes are sent to the app server.
 * Linktivity V1.0.1.0 only. Long videos are encoded in bounded 8s slices.
 * Encoded video is persisted to origin-private disk; WASM is restarted regularly.
 */
const VERSION = 'Linktivity V1.0.1.0';
const MAX_FILE = 2048 * 1048576;
const CDN = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
const sleep = () => new Promise(r => setTimeout(r, 0));
const u24=(b,o)=>b[o]|(b[o+1]<<8)|(b[o+2]<<16);
const u32=(b,o)=> ((b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24)>>>0);
const fail = msg => {throw new Error(msg)};
// Linktivity supports rectangular screen updates directly or wrapped in RFC 1950
// zlib.  Detect by a valid CMF/FLG pair instead of assuming 0x78 forever.
export function screenPacketFormat(payload) {
  if (payload.length < 11) fail('تحديث الشاشة غير مكتمل.');
  const a=payload[10], b=payload[11];
  if (a===0) return 'raw';
  if (payload.length >= 12 && (a & 15)===8 && (a >> 4)<=7 && (((a<<8)|b)%31)===0)
    return 'zlib';
  return 'unknown';
}
// Structurally check every raw rectangle, without relying on a lecture-specific
// package number. An update may legitimately contain more than one rectangle.
function validateRawRectangles(payload,width,height) {
  const n=payload.length;let pos=10,rectangles=0;
  if(!width||!height||n<31) fail('تحديث شاشة خام ناقص أو ورد قبل تهيئة الشاشة.');
  while(pos<n){
    if(pos+21>n) fail('ترويسة مستطيل شاشة خام ناقصة.');
    const flag=payload[pos],x=u32(payload,pos+1),y=u32(payload,pos+5),w=u32(payload,pos+9),h=u32(payload,pos+13),count=u32(payload,pos+17);
    pos+=21;
    if(flag!==0||!w||!h||w>width||h>height||x>width-w||y>height-h||count!==w*h||count>n-pos)
      fail('مستطيل شاشة خام غير صالح أو خارج مساحة الشاشة.');
    pos+=count;rectangles++;
    if(rectangles>100000) fail('عدد مستطيلات الشاشة يتجاوز الحد الآمن.');
  }
  return rectangles;
}
export const ENGINE_VERSION='2.3.0';
export class WindowReader {
  constructor(file) {this.file=file; this.pos=-1; this.window=new Uint8Array(0);}
  async bytes(start,n) {
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(n)||start<0||n<0||start+n>this.file.size) fail('ملف التسجيل ناقص أو تالف.');
    if(n>8388608) return new Uint8Array(await this.file.slice(start,start+n).arrayBuffer());
    if(start<this.pos || start+n>this.pos+this.window.length){this.pos=start;this.window=new Uint8Array(await this.file.slice(start,Math.min(this.file.size,start+8388608)).arrayBuffer());}
    return this.window.subarray(start-this.pos,start-this.pos+n);
  }
}
export async function analyze(file, limitMinutes=120, update=()=>{}) {
  if(!file||file.size<32||file.size>MAX_FILE||!/\.lrec$/i.test(file.name)) fail('اختر ملف LREC سليم ضمن الحد المدعوم.');
  const rdr=new WindowReader(file); let p=0, total=0, duration=0, width=0,height=0,lastVideo=-1,maxStamp=0;
  const video=[]; const audios=new Map(); let versionOK=false;
  while(p<file.size) {
    if(file.size-p<14) fail('حزمة LREC الأخيرة غير مكتملة.');
    const h=await rdr.bytes(p,14);
    if(h[8]!==16 ||h[9]!==4)fail('علامة حزمة غير معروفة؛ الملف ليس Linktivity LREC المدعوم.');
    const len=u24(h,10), stamp=u32(h,0), kind=h[13], n=len-1;
    if(len<1 ||p+13+len>file.size)fail('حجم حزمة LREC غير صحيح.');
    const offset=p+14;
    if(total===0){
      if(kind!==8||n<25)fail('ترويسة LREC غير مدعومة.');
      const header=await rdr.bytes(offset,Math.min(n,512));
      const fields=new TextDecoder('latin1').decode(header.subarray(12)).split('\0');
      versionOK=fields[2]==='Linktivity' && fields.includes('V1.0.1.0');
      if(!versionOK)fail('إصدار LREC غير مدعوم، المطلوب Linktivity V1.0.1.0.');
      if(!/^\d+$/.test(fields[1]||''))fail('مدة التسجيل غير صحيحة.');
      duration=Number(fields[1]);
      if(!Number.isSafeInteger(duration)||duration<1||duration>limitMinutes*60000)fail('مدة المحاضرة تتجاوز حد الخدمة.');
    }
    if(kind===3){
      if(n<=10)fail('حزمة شاشة LREC ناقصة.');
      const head=await rdr.bytes(offset,Math.min(n,40)), op=head[10];
      if(stamp<lastVideo) fail('التوقيت غير تصاعدي في الشاشة.');
      lastVideo=stamp;
      if(op===11){
        if(n<31)fail('ترويسة الشاشة ناقصة.');
        const w=u32(head,11),hh=u32(head,15), depth=u32(head,27);
        if(!w||!hh||w>4096||hh>4096||w*hh>8294400||depth!==8)fail('أبعاد أو عمق ألوان الشاشة غير مدعوم.');
        if(width&&(width!==w||height!==hh))fail('تغيير أبعاد الشاشة أثناء التسجيل غير مدعوم.');
        width=w;height=hh;
      } else if(op===2) {
        if(!width||!height) fail('لوحة ألوان قبل تهيئة الشاشة.');
        if(n!==1035) fail('حجم لوحة ألوان الشاشة غير صحيح.');
      } else {
        const headerBytes=await rdr.bytes(offset,Math.min(n,40));
        const format=screenPacketFormat(headerBytes);
        if(format==='raw') {
          // Fetch the entire raw patch only for validation. The bounded
          // 24-bit container length prevents allocations beyond 16 MiB.
          validateRawRectangles(await rdr.bytes(offset,n),width,height);
        } else if(format==='zlib' && (!width||!height)) {
          fail('تحديث شاشة مضغوط قبل تهيئة الشاشة.');
        } else if(format==='unknown') {
          const code='0x'+op.toString(16).padStart(2,'0').toUpperCase();
          const err=new Error('نمط تحديث شاشة LREC غير مدعوم ('+code+'، الحزمة '+(total+1)+'، الإزاحة '+p+'). يرجى تزويد المطور بعينة من هذا النوع.');
          err.code='UNSUPPORTED_SCREEN_OPCODE';
          err.details={opcode:code,packet:total+1,offset:p,timestamp_ms:stamp,file_size:file.size,engine:ENGINE_VERSION};
          throw err;
        }
      }
      video.push({stamp,offset,n,op});
    }else if(kind===2&&n>=14){
      const a=await rdr.bytes(offset,Math.min(n,1024));
      const nameLength=a[12]|a[13]<<8, inner=10+nameLength, start=nameLength+31;
      if(nameLength>=4&&inner+17<=n&&inner+5<a.length&&a[inner]===16&&a[inner+1]===4){
        const innerLength=u24(a,inner+2);
        const count=innerLength>=48?Math.floor(Math.max(0,Math.min(innerLength-16,n-start))/32)*32:0;
        if(count){
          const name=a.subarray(14,inner);let at=name.indexOf(0);if(at<0)at=name.length;
          const key=Array.from(name.subarray(0,at), x=>x.toString(16).padStart(2,'0')).join('');
          if(!audios.has(key))audios.set(key,[]);
          audios.get(key).push({stamp,offset:offset+start,n:count});
          if(audios.size>100)fail('عدد مسارات الصوت يتجاوز الحد الآمن.');
        }
      }
    }else if(![1,2,3,8].includes(kind))fail('نوع حزمة LREC غير مدعوم.');
    maxStamp=Math.max(maxStamp,stamp); total++;p+=13+len;
    if(total>2000000)fail('عدد حزم مفرط.');
    if(total%2500===0){update('فحص الحزم',5*Math.min(1,p/file.size));await sleep();}
  }
  if(!width||!height||!video.length)fail('لم يتم العثور على شاشة محاضرة صالحة.');
  if(maxStamp>duration+60000)fail('المدة المعلنة لا تطابق طوابع التسجيل.');
  return {file,rdr,duration,width,height,total,video,audios,version:VERSION,
    summary:{duration_ms:duration,width,height,video_events:video.length,audio_tracks:audios.size,chunks:total,version:VERSION}};
}
function pushU16(a,o,x){a[o]=x&255;a[o+1]=x>>8&255;}
function pushU32(a,o,x){a[o]=x&255;a[o+1]=x>>8&255;a[o+2]=x>>16&255;a[o+3]=x>>24&255;}
async function wavForTrack(rdr, packets){
  const compressed=packets.reduce((s,x)=>s+x.n,0);
  if(compressed>64*1048576)fail('حجم مسار الصوت غير آمن.');
  const body=new Uint8Array(90+compressed), v=new DataView(body.buffer);
  const ascii=(at,str)=>{for(let i=0;i<str.length;i++)body[at+i]=str.charCodeAt(i);};
  ascii(0,'RIFF');pushU32(body,4,body.length-8);ascii(8,'WAVE');ascii(12,'fmt ');pushU32(body,16,50);
  pushU16(body,20,0x22);pushU16(body,22,1);pushU32(body,24,8000);pushU32(body,28,1067);
  pushU16(body,32,32);pushU16(body,34,1);pushU16(body,36,32);
  ascii(70,'fact');pushU32(body,74,4);pushU32(body,78,compressed/32*240);
  ascii(82,'data');pushU32(body,86,compressed);
  let at=90;for(const p of packets){const data=await rdr.bytes(p.offset,p.n);body.set(data,at);at+=p.n;}
  return body;
}
async function toBlob(url, mime, sizeLimit=38*1048576){
  const res=await fetch(url,{mode:'cors',cache:'force-cache'});
  if(!res.ok)fail('تعذر تحميل محرك المعالجة ('+res.status+').');
  const len=Number(res.headers.get('content-length')||0);if(len>sizeLimit)fail('المكتبة الخارجية تجاوزت الحجم المسموح.');
  const buf=await res.arrayBuffer();if(buf.byteLength>sizeLimit)fail('حجم محرك المعالجة مفرط.');
  return URL.createObjectURL(new Blob([buf],{type:mime}));
}
let wasmAssets;
async function loadAssets(progress){
  if(wasmAssets)return wasmAssets;
  progress('تحميل نواة FFmpeg للمتصفح (~32MB)؛ لا يتم رفع ملف المحاضرة',6);
  const vendorRoot=new URL('./vendor/',import.meta.url);
  const manifestURL=new URL('manifest.json',vendorRoot);
  const local=await fetch(manifestURL,{cache:'no-store'}).then(r=>r.ok).catch(()=>false);
  const classWorkerURL=new URL('./ffmpeg-worker-compat.js?v=2.3.0',import.meta.url).href;
  if(local){
    wasmAssets={classWorkerURL,
      coreURL:new URL('ffmpeg-core.js',vendorRoot).href,
      wasmURL:new URL('ffmpeg-core.wasm',vendorRoot).href};
  } else {
    const [coreURL,wasmURL]=await Promise.all([
      toBlob(CDN+'/ffmpeg-core.js','text/javascript',2*1048576),
      toBlob(CDN+'/ffmpeg-core.wasm','application/wasm',38*1048576),
    ]);
    wasmAssets={classWorkerURL,coreURL,wasmURL};
  }
  return wasmAssets;
}
async function newEngine(progress){
  return new NativeFFmpeg();
}
function ensureSuccess(status,label){if(status!==0) fail('فشل المحرك أثناء '+label+' (رمز '+status+'). راجع الدعم المتاح للترميز.');}
export async function decodeAudio(record,engine,update,signal){
  const samples=Math.ceil(record.duration*8);const mix=new Int32Array(samples);
  const streams=[...record.audios.values()];let idx=0;
  for(const packets of streams){
    if(signal?.aborted)fail('أُلغي التحويل.');
    const input=await wavForTrack(record.rdr,packets);
    await engine.writeFile('in.wav',input);
    try{
      const status=await engine.exec(['-nostdin','-hide_banner','-loglevel','error','-y','-i','in.wav','-f','s16le','-ac','1','-ar','8000','-c:a','pcm_s16le','out.pcm']);
      ensureSuccess(status,'فك TrueSpeech');
      const pcm=await engine.readFile('out.pcm');
      const expect=packets.reduce((s,p)=>s+p.n/32*240,0);
      if(pcm.byteLength!==expect*2)fail('عدد عينات المسار المفكوك غير مطابق؛ تم إيقاف التحويل لتفادي فقد الصوت.');
      const samples16=new DataView(pcm.buffer,pcm.byteOffset,pcm.byteLength);
      let src=0,next=-1;
      for(const p of packets){
        const count=p.n/32*240,clock=p.stamp*8;
        let at=next>=0&&Math.abs(clock-next)<1200?next:clock;next=at+count;
        const start=Math.max(0,at),end=Math.min(samples,at+count);
        for(let pos=start;pos<end;pos++)mix[pos]+=samples16.getInt16((src+pos-at)*2,true);
        src+=count;
      }
    }finally{
      await engine.deleteFile('in.wav').catch(()=>{});
      await engine.deleteFile('out.pcm').catch(()=>{});
    }
    idx++;update('فك ودمج المسارات الصوتية ('+idx+'/'+streams.length+')',7+18*idx/streams.length);
    await sleep();
  }
  return mix;
}
async function decompressed(data,limit){
  if(typeof DecompressionStream === 'undefined')fail('متصفحك لا يدعم فك الضغط Deflate. استخدم Chrome أو Edge محدثاً.');
  const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  const rd=stream.getReader();const chunks=[];let total=0;
  try {while(true){const {value,done}=await rd.read();if(done)break;total+=value.byteLength;if(total>limit){await rd.cancel();fail('بيانات شاشة متضخمة؛ الحزمة غير آمنة.');}chunks.push(value);}}
  catch(e){throw new Error('تعذر فك ضغط تحديث الشاشة: '+e.message);}
  const a=new Uint8Array(total);let off=0;for(const ch of chunks){a.set(ch,off);off+=ch.length;}return a;
}
export async function makeRenderer(record){
  const {width:w,height:h}=record;
  const rgb=new Uint8Array(w*h*3);const colors=new Uint8Array(256*3);
  const maxRaw=Math.min(134217728,w*h*8+1048576);
  return {rgb,async apply(ev){
    const payload=await record.rdr.bytes(ev.offset,ev.n);const op=payload[10];
    if(op===11){rgb.fill(0);return;}
    if(op===2){if(payload.length!==1035)fail('حجم لوحة الألوان غير صحيح.');
      for(let i=0;i<256;i++){const from=11+i*4,to=i*3;colors[to]=payload[from+2];colors[to+1]=payload[from+1];colors[to+2]=payload[from];}return;
    }
    // Linktivity screen updates use a common rectangle format:
    // 0x78: zlib-compressed list of rectangles, 0x00: uncompressed single/list
    // of rectangles. The 0x00 packet starts with the same 21-byte rectangle
    // header (flag=0, x, y, width, height, byteCount) and indexed pixels.
    // IMPORTANT: Never silently skip unrecognized opcodes.
    const format=screenPacketFormat(payload);
    if(format==='unknown')fail('تحديث شاشة غير مدعوم.');
    if(format==='raw')validateRawRectangles(payload,w,h);
    const raw=format==='zlib'
      ? await decompressed(payload.subarray(10),maxRaw)
      : payload.subarray(10);
    if(raw.byteLength>maxRaw)fail('تحديث شاشة خام يتجاوز الحد الآمن.');
    let p=0;
    while(p<raw.length){
      if(p+21>raw.length)fail('مستطيل شاشة غير مكتمل.');
      const flag=raw[p],x=u32(raw,p+1),y=u32(raw,p+5),rw=u32(raw,p+9),rh=u32(raw,p+13),n=u32(raw,p+17);p+=21;
      if(flag!==0||!rw||!rh||rw*rh!==n||p+n>raw.length||x+rw>w||y+rh>h)fail('مستطيل شاشة تالف أو غير مدعوم.');
      for(let row=0;row<rh;row++){
        let dst=((y+row)*w+x)*3,src=p+row*rw;
        for(let col=0;col<rw;col++){const c=raw[src+col]*3;rgb[dst++]=colors[c];rgb[dst++]=colors[c+1];rgb[dst++]=colors[c+2];}
      }p+=n;
    }
  }};
}
async function opfsDirectory(){
  if(!navigator.storage?.getDirectory)fail('هذا المتصفح لا يدعم التخزين المحلي الآمن للدفعات. استخدم Chrome أو Edge على الكمبيوتر.');
  const root=await navigator.storage.getDirectory();
  // Clean old abandoned temporary data while leaving active tabs untouched.
  try{for await(const [name] of root.entries()){const m=/^lrec-(\d{13})-[0-9a-f-]{36}$/.exec(name);if(m&&Date.now()-Number(m[1])>24*3600*1000)await root.removeEntry(name,{recursive:true});}}catch{}
  const label='lrec-'+Date.now()+'-'+crypto.randomUUID();
  return {root,label,dir:await root.getDirectoryHandle(label,{create:true})};
}
async function savePiece(dir,name,data){
  const handle=await dir.getFileHandle(name,{create:true});const writer=await handle.createWritable();
  try{await writer.write(data);}finally{await writer.close();}
}
async function encodeVideo(record,fps,dir,update,signal){
  const renderer=await makeRenderer(record),nframes=Math.ceil(record.duration*fps/1000);
  let eventIndex=0;
  const segmentFrames=Math.max(1,Math.min(fps*8,Math.floor((64*1048576)/(record.width*record.height*3))));let engine=null,index=0,segment=0;
  const width=record.width,height=record.height,rawSize=width*height*3;
  const pieces=[];
  try{
    while(index<nframes){
      if(signal?.aborted)fail('أُلغي التحويل.');
      if(!engine)engine=await newEngine(update);
      const frames=Math.min(segmentFrames,nframes-index);
      const data=new Uint8Array(rawSize*frames);
      for(let i=0;i<frames;i++){
        const t=(index+i)*1000/fps;
        while(eventIndex<record.video.length&&record.video[eventIndex].stamp<=t){
          await renderer.apply(record.video[eventIndex++]);
        }
        data.set(renderer.rgb,i*rawSize);
        if(i%15===0)await sleep();
      }
      await engine.writeFile('part.rgb',data);
      const args=['-nostdin','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgb24',
        '-video_size',width+'x'+height,'-framerate',String(fps),'-i','part.rgb',
        '-an','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','ultrafast','-crf','22','-pix_fmt','yuv420p','-bf','0','-threads','2',
        '-r',String(fps),'-video_track_timescale',String(fps*1000),'-movflags','+faststart','-f','mp4','slice.mp4'];
      try{
        ensureSuccess(await engine.exec(args),'ترميز جزء الفيديو '+(segment+1));
        const clip=await engine.readFile('slice.mp4');
        if(clip.byteLength<1000)fail('فشل ترميز دفعة فيديو؛ الناتج غير صالح.');
        const fname='segment-'+String(segment).padStart(5,'0')+'.mp4';
        await savePiece(dir,fname,clip);pieces.push(fname);
      }finally{
        await engine.deleteFile('part.rgb').catch(()=>{});await engine.deleteFile('slice.mp4').catch(()=>{});
      }
      index+=frames;segment++;update('ترميز الصورة: '+Math.floor(index/nframes*100)+'% ('+segment+' دفعة)',25+62*index/nframes);
      // Destroy the WebAssembly heap on a schedule: avoids long-run heap growth.
      if(segment%12===0){engine.terminate();engine=null;}
      await sleep();
    }
    // Validate the final packet even when located after last presentation timestamp.
    for(;eventIndex<record.video.length;eventIndex++)await renderer.apply(record.video[eventIndex]);
    return pieces;
  }finally {engine?.terminate();}
}
/* Concatenate in bounded groups rather than placing hundreds of segment files in
 * one FFmpeg WASM heap. Intermediate MP4 files live in OPFS on user disk. */
async function assembleVideo(dir,pieces,update,signal){
  let level=0,current=[...pieces];
  while(current.length>1){
    const next=[];
    for(let i=0;i<current.length;i+=8){
      if(signal?.aborted)fail('أُلغي التحويل.');
      const group=current.slice(i,i+8);
      if(group.length===1){next.push(group[0]);continue;}
      let engine;
      try {
        engine=await newEngine(update);
        const names=[];
        for(let j=0;j<group.length;j++){
          const name='clip-'+j+'.mp4',f=await dir.getFileHandle(group[j]);
          await engine.writeFile(name,new Uint8Array(await (await f.getFile()).arrayBuffer()));
          names.push(name);
        }
        const fileList=new TextEncoder().encode(names.map(name=>"file '"+name+"'").join('\n')+'\n');
        await engine.writeFile('list.txt',fileList);
        ensureSuccess(await engine.exec(['-nostdin','-hide_banner','-loglevel','error','-y',
          '-f','concat','-safe','0','-i','list.txt','-c','copy','-an','join.mp4']), 'تجميع الدفعات');
        const data=await engine.readFile('join.mp4');
        if(data.byteLength<1000)fail('فشل دمج جزء الفيديو.');
        const output='joined-'+level+'-'+String(i/8).padStart(5,'0')+'.mp4';
        await savePiece(dir,output,data);next.push(output);
      }finally{engine?.terminate();}
      // Only delete the inputs AFTER successfully persisting the new merged file.
      for(const name of group)await dir.removeEntry(name);
      update('دمج أجزاء الفيديو محلياً (مرحلة '+(level+1)+')',87+5*Math.min(1,(i+group.length)/current.length));
      await sleep();
    }
    current=next;level++;
  }
  return current[0];
}
async function encodeAudio(mix, record, engine){
  const size=mix.length*2;const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);
  let clipped=0;
  for(let i=0;i<mix.length;i++){const v=mix[i];if(v>32767||v< -32768)clipped++;view.setInt16(i*2,Math.min(32767,Math.max(-32768,v)),true);}
  await engine.writeFile('audio.raw',bytes);
  ensureSuccess(await engine.exec(['-nostdin','-hide_banner','-loglevel','error','-y','-f','s16le','-ar','8000','-ac','1','-i','audio.raw','-c:a','aac','-b:a','64k','-ar','44100','-vn','audio.m4a']),'ترميز الصوت AAC');
  await engine.deleteFile('audio.raw');return clipped;
}
export async function convert(record,{fps=5,update=()=>{},signal}={}){
  if(!Number.isInteger(fps)||fps<1||fps>15)fail('معدل الإطارات غير مدعوم.');
  if(record.duration*fps/1000>100000)fail('عدد إطارات مرتفع للغاية.');
  const start=performance.now();let engine=null,scratch=null,output;
  try{
    update('اختبار مساحة التخزين المحلي',5);
    if(navigator.storage.estimate){const q=await navigator.storage.estimate();const need=Math.max(80000000,record.file.size*8);if(q.quota&&q.usage&&q.quota-q.usage<need)fail('المساحة المتبقية في تخزين المتصفح غير كافية. حرر مساحة أولاً.');}
    scratch=await opfsDirectory();
    engine=await newEngine(update);
    const mix=await decodeAudio(record,engine,update,signal);
    engine.terminate();engine=null;
    update('تجهيز الفيديو على دفعات صغيرة دون احتفاظ بها بالذاكرة',25);
    const pieces=await encodeVideo(record,fps,scratch.dir,update,signal);
    if(!pieces.length)fail('لم تنتج أي دفعة فيديو.');
    if(signal?.aborted)fail('أُلغي التحويل.');
    const finalPiece=await assembleVideo(scratch.dir,pieces,update,signal);
    if(signal?.aborted)fail('أُلغي التحويل.');
    engine=await newEngine(update);
    const combined=await scratch.dir.getFileHandle(finalPiece);
    await engine.writeFile('joined.mp4',new Uint8Array(await (await combined.getFile()).arrayBuffer()));
    await scratch.dir.removeEntry(finalPiece);
    update('ترميز الصوت الأصلي ودمج الصورة',94);
    const clipped=await encodeAudio(mix,record,engine); // keep audio continuity across all slices
    ensureSuccess(await engine.exec(['-nostdin','-hide_banner','-loglevel','error','-y','-i','joined.mp4','-i','audio.m4a',
      '-map','0:v:0','-map','1:a:0','-c','copy','-t',(record.duration/1000).toFixed(3),'-movflags','+faststart','complete.mp4']), 'دمج الصوت والصورة');
    output=await engine.readFile('complete.mp4');
    if(output.byteLength<2000)fail('الفيديو الناتج قصير أو غير صالح.');
    const mp4=checkMp4(output,record.duration);
    update('اكتمال إنشاء MP4 (التحقق النهائي يتطلب تشغيل الملف)',100);
    return {blob:new Blob([output],{type:'video/mp4'}),report:{...record.summary,
      elapsed_seconds:Math.round((performance.now()-start)/1000),size_bytes:output.byteLength, fps,
      audio_clipped_samples:clipped,conversion_engine:'Native FFmpeg / bounded chunks',
      mp4_duration_seconds:mp4.seconds,verification:'Verified ISO BMFF boxes, audio/video tracks, container duration and successful FFmpeg exit; not full frame decode'}};
  }finally{
    engine?.terminate();
    if(scratch){try{await scratch.root.removeEntry(scratch.label,{recursive:true})}catch{}}
  }
}
