import {mkdtemp,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runConversion} from '../src/runner.mjs';
const sample=process.argv[2]||process.env.TEST_LREC;
if(!sample)throw Error('Usage: node tests/smoke.mjs /path/to/lecture.lrec [seconds]');
const dir=await mkdtemp(join(tmpdir(),'svu-lrec-smoke-'));
try{
 const r=await runConversion(sample,dir,(msg,p)=>{if(p%10<2)console.log(Math.floor(p)+'%',msg)}, {maxSeconds:Number(process.argv[3]||12)});
 console.log('SUCCESS',JSON.stringify({bytes:(await stat(r.output)).size,report:r.report},null,2));
}finally{await rm(dir,{recursive:true,force:true})}
