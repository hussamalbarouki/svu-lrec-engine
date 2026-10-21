import {deflateSync} from 'node:zlib';
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
const table=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let i=0;i<8;i++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);table[n]=c>>>0;}
function crc(buffer){let c=0xffffffff;for(const b of buffer)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(name,data){const type=Buffer.from(name,'ascii'),size=Buffer.allocUnsafe(4),hash=Buffer.allocUnsafe(4);size.writeUInt32BE(data.length);hash.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([size,type,data,hash]);}
export function pngRGB(width,height,rgb){
  if(width<1||height<1||rgb.length!==width*height*3)throw Error('Invalid raw frame');
  const stride=width*3,raw=Buffer.allocUnsafe((stride+1)*height);
  for(let row=0;row<height;row++){const base=row*(stride+1);raw[base]=0;raw.set(rgb.subarray(row*stride,(row+1)*stride),base+1);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:1})),chunk('IEND',Buffer.alloc(0))]);
}
