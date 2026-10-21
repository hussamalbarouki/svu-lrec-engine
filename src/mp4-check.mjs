/* Minimal independent ISO BMFF structural check. This does not decode frames. */
const ascii=(data,at)=>String.fromCharCode(...data.subarray(at,at+4));
const be32=(v,at)=>v.getUint32(at,false);
function boxes(data,from,to){
 const out=[];const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 for(let p=from;p<to;){
   if(to-p<8)throw new Error('MP4 contains truncated box header.');
   let n=be32(view,p),header=8;
   if(n===1){if(to-p<16)throw new Error('Truncated extended size.');const x=view.getBigUint64(p+8,false);if(x>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Unsupported MP4 box size.');n=Number(x);header=16;}
   else if(n===0)n=to-p;
   if(n<header||p+n>to)throw new Error('Invalid MP4 box size.');
   out.push({type:ascii(data,p+4),start:p,end:p+n,data:p+header});p+=n;
 }
 return out;
}
function nested(data,box,type){return boxes(data,box.data,box.end).find(x=>x.type===type)}
export function checkMp4(bytes,expectedMs){
 if(!(bytes instanceof Uint8Array)||bytes.length<1000)throw new Error('Empty MP4 output.');
 const top=boxes(bytes,0,bytes.length);const ftyp=top.find(x=>x.type==='ftyp');const moov=top.find(x=>x.type==='moov');const mdat=top.find(x=>x.type==='mdat');
 if(!ftyp||!moov||!mdat||mdat.end-mdat.data<256)throw new Error('Missing essential MP4 boxes.');
 const mvhd=nested(bytes,moov,'mvhd');if(!mvhd)throw new Error('Missing duration header in MP4.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const v=bytes[mvhd.data];
 if(v!==0&&v!==1)throw new Error('Unsupported movie time field.');
 const rate=be32(view,mvhd.data+(v?20:12));
 const duration=v?Number(view.getBigUint64(mvhd.data+24,false)):be32(view,mvhd.data+16);
 if(!rate||!Number.isFinite(duration))throw new Error('Invalid MP4 timescale.');
 const seconds=duration/rate;
 if(Math.abs(seconds-expectedMs/1000)>1.1)throw new Error('Output video duration mismatch: '+seconds+' s.');
 const tracks=new Set();
 for(const b of boxes(bytes,moov.data,moov.end)){
  if(b.type!=='trak')continue;
  const mdia=nested(bytes,b,'mdia');if(!mdia)continue;
  const hdlr=nested(bytes,mdia,'hdlr');if(hdlr&&hdlr.data+12<=hdlr.end)tracks.add(ascii(bytes,hdlr.data+8));
 }
 if(!tracks.has('vide')||!tracks.has('soun'))throw new Error('Output MP4 does not contain both audio and video.');
 return {seconds,bytes:bytes.length,tracks:[...tracks]};
}
