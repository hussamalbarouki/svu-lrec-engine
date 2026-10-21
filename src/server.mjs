import http from 'node:http';
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir,rm,stat,statfs,unlink} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join} from 'node:path';
import {runConversion} from './runner.mjs';

const PORT=Number(process.env.PORT||3000);
const SECRET=process.env.ENGINE_SHARED_SECRET||'';
const ORIGIN=process.env.APP_ORIGIN||'https://svu.hussamm.tech';
const WORK_ROOT=process.env.WORK_ROOT||'/work';
const MAX_UPLOAD=Math.min(2048,Math.max(1,Number(process.env.MAX_UPLOAD_MB||256)))*1048576;
const TTL=Number(process.env.RESULT_TTL_MINUTES||30)*60000;
const QUEUE_LIMIT=Number(process.env.QUEUE_LIMIT||2);
if(SECRET.length<32)throw Error('ENGINE_SHARED_SECRET must have at least 32 random characters');
if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(ORIGIN))throw Error('APP_ORIGIN must be HTTPS origin');
const jobs=new Map();const queue=[];let active=null;

function signedToken(req){
  const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))throw Error('Missing token');
  const [encoded,signature,extra]=h.slice(7).trim().split('.');
  if(!encoded||!signature||extra||encoded.length>2048)throw Error('Invalid token');
  const expected=createHmac('sha256',SECRET).update(encoded).digest();
  const actual=Buffer.from(signature,'base64url');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error('Invalid token signature');
  const claims=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
  if(claims.aud!=='svu-lrec-cloud'||claims.scope!=='convert'||!
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.job_id)||
    !Number.isSafeInteger(claims.exp)||claims.exp<Math.floor(Date.now()/1000)||claims.exp>Math.floor(Date.now()/1000)+3600||
    !Number.isSafeInteger(claims.max_bytes)||claims.max_bytes<32||claims.max_bytes>MAX_UPLOAD){throw Error('Token expired or invalid claims');}
  return claims;
}
function reply(res,code,obj){if(res.headersSent)return;res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));}
function err(res,code,message){reply(res,code,{error:message});}
function status(job){return {job_id:job.id,status:job.status,progress:job.progress,stage:job.stage,created_at:job.created,finished_at:job.finished||null,report:job.status==='complete'?job.report:undefined,error:job.status==='failed'?job.error:undefined};}
function pump(){
  if(active||queue.length===0)return;
  const job=queue.shift();active=job;job.status='processing';job.stage='بدء المعالجة';
  runConversion(join(job.dir,'upload.lrec'),job.dir,(stage,progress)=>{job.stage=stage;job.progress=Math.max(0,Math.min(100,Number(progress)||0))})
    .then(({report})=>{job.status='complete';job.progress=100;job.stage='جاهز للتنزيل';job.report=report;job.finished=Date.now();})
    .catch(e=>{console.error('Job',job.id,'failed:',e);job.status='failed';job.error=String(e.message||e).slice(0,300);job.finished=Date.now();})
    .finally(async()=>{try{await unlink(join(job.dir,'upload.lrec'))}catch{};active=null;pump();});
}
async function cleanup(){
  for(const [id,job] of jobs){if(job.status==='processing'||job.status==='queued'||job.status==='uploading')continue;
    if(job.finished&&Date.now()-job.finished>TTL){jobs.delete(id);await rm(job.dir,{recursive:true,force:true}).catch(()=>{})}}
}
setInterval(()=>cleanup().catch(console.error),60000).unref();
await mkdir(WORK_ROOT,{recursive:true});
const server=http.createServer(async(req,res)=>{
  try{
    const origin=req.headers.origin;
    if(origin && origin!==ORIGIN)return err(res,403,'Origin not allowed');
    if(origin===ORIGIN){res.setHeader('access-control-allow-origin',ORIGIN);res.setHeader('vary','Origin');res.setHeader('access-control-allow-methods','GET,POST,DELETE,OPTIONS');res.setHeader('access-control-allow-headers','Authorization,Content-Type');res.setHeader('access-control-max-age','300');}
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/healthz'&&req.method==='GET')return reply(res,200,{status:'ok',engine:'svu-lrec-native',version:'0.1.0',active:active?1:0,queued:queue.length});
    const hit=/^\/api\/jobs\/([0-9a-f-]{36})(?:\/(upload|output))?$/.exec(pathname);
    if(!hit)return err(res,404,'Not found');
    const id=hit[1],action=hit[2]||'',claims=signedToken(req);
    if(id!==claims.job_id)return err(res,403,'Token not valid for this job');
    if(action==='upload'&&req.method==='POST'){
      if(jobs.has(id))return err(res,409,'Job already exists');
      if(queue.length>=QUEUE_LIMIT||active&&queue.length>=QUEUE_LIMIT)return err(res,503,'Engine busy, retry later');
      if(req.headers['content-type']!=='application/octet-stream')return err(res,415,'Expected application/octet-stream');
      const stated=Number(req.headers['content-length']);
      const permitted=Math.min(MAX_UPLOAD,claims.max_bytes);
      if(Number.isFinite(stated)&&stated>permitted)return err(res,413,'Upload too large');
      const fs=await statfs(WORK_ROOT);if(Number(fs.bavail)*Number(fs.bsize)<permitted+256*1048576)return err(res,507,'Not enough free disk space');
      const dir=join(WORK_ROOT,id);await mkdir(dir,{recursive:false});
      const job={id,dir,created:Date.now(),status:'uploading',progress:0,stage:'رفع الملف'};jobs.set(id,job);
      let total=0;
      try{
        await pipeline(req,new Transform({transform(chunk,_,done){total+=chunk.length;if(total>permitted)return done(Error('Upload exceeds allowed bytes'));done(null,chunk)}}),createWriteStream(join(dir,'upload.lrec'),{flags:'wx',mode:0o600}));
        if(total<32)throw Error('Source file too small');
      }catch(e){jobs.delete(id);await rm(dir,{recursive:true,force:true});return err(res,total>permitted?413:400,'Upload incomplete or over limit');}
      job.status='queued';job.stage='بانتظار المعالجة';queue.push(job);pump();return reply(res,202,status(job));
    }
    const job=jobs.get(id);if(!job)return err(res,404,'Job unavailable or expired');
    if(action===''&&req.method==='GET')return reply(res,200,status(job));
    if(action===''&&req.method==='DELETE'){
      if(job.status==='processing')return err(res,409,'Cannot cancel an active conversion yet');
      jobs.delete(id);const at=queue.indexOf(job);if(at!==-1)queue.splice(at,1);
      await rm(job.dir,{recursive:true,force:true});return reply(res,200,{status:'removed'});
    }
    if(action==='output'&&req.method==='GET'){
      if(job.status!=='complete')return err(res,409,'Output not ready');
      const {createReadStream}=await import('node:fs');const file=join(job.dir,'result.mp4');const meta=await stat(file);
      res.writeHead(200,{'content-type':'video/mp4','content-length':meta.size,'content-disposition':'attachment; filename="lecture.mp4"','cache-control':'no-store','x-content-type-options':'nosniff'});
      createReadStream(file).on('error',()=>res.destroy()).pipe(res);return;
    }
    return err(res,405,'Method not allowed');
  }catch(e){console.error('Request rejected:',String(e.message||e));if(!res.headersSent)err(res,401,'Unauthorized or invalid request');else res.destroy();}
});
server.requestTimeout=30*60*1000;server.headersTimeout=20000;
server.listen(PORT,'0.0.0.0',()=>console.log(`SVU LREC native engine v0.1.0 on :${PORT}`));
