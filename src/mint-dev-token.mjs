// Operator-only local test utility. Do not deploy or expose as an HTTP endpoint.
import {createHmac,randomUUID} from 'node:crypto';
if(!process.env.ENGINE_SHARED_SECRET||process.env.ENGINE_SHARED_SECRET.length<32)throw Error('ENGINE_SHARED_SECRET required');
const id=randomUUID();const payload={aud:'svu-lrec-cloud',scope:'convert',job_id:id,exp:Math.floor(Date.now()/1000)+3600,max_bytes:Math.min(268435456,Number(process.env.MAX_UPLOAD_MB||256)*1048576)};
const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
const signed=createHmac('sha256',process.env.ENGINE_SHARED_SECRET).update(encoded).digest('base64url');
console.log(JSON.stringify({job_id:id,token:encoded+'.'+signed}));
