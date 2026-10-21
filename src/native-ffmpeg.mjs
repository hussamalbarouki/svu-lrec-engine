import {mkdtemp, readFile, writeFile, rm, unlink, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

/** Same tiny filesystem/exec surface used by converter.mjs, backed by native FFmpeg. */
export class NativeFFmpeg {
  constructor(){ this.dir=null;this.proc=null;this.closed=false; }
  async ready(){if(this.closed)throw Error('Engine terminated');if(!this.dir)this.dir=await mkdtemp(join(process.env.WORK_ROOT||tmpdir(),'ffmpeg-'));}
  async writeFile(name, data){await this.ready();await writeFile(join(this.dir, safe(name)),data);}
  async readFile(name){await this.ready();return new Uint8Array(await readFile(join(this.dir,safe(name))));}
  async deleteFile(name){await this.ready();await unlink(join(this.dir,safe(name)));}
  async exec(args){
    await this.ready();
    if(!Array.isArray(args)||args.length>100||args.some(x=>typeof x!=='string'))throw Error('Invalid ffmpeg arguments');
    if(this.closed)throw Error('Engine terminated');
    return await new Promise((resolve,reject)=>{
      let stderr=''; const child=spawn('/usr/bin/ffmpeg', args,{cwd:this.dir,stdio:['ignore','ignore','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C'}});
      this.proc=child;
      const watchdog=setTimeout(()=>child.kill('SIGKILL'),Number(process.env.FFMPEG_EXEC_TIMEOUT_MS||1200000));
      child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-4096)});
      child.on('error',e=>{clearTimeout(watchdog);this.proc=null;reject(e)});
      child.on('close',code=>{clearTimeout(watchdog);this.proc=null;if(code!==0)console.error('FFmpeg:',stderr);resolve(code??1)});
    });
  }
  terminate(){
    this.closed=true;try{this.proc?.kill('SIGKILL')}catch{}
    if(this.dir){const d=this.dir;this.dir=null;rm(d,{recursive:true,force:true}).catch(e=>console.error('Cleanup:',e.message));}
  }
}
function safe(name){if(!/^[a-z0-9_.-]+$/i.test(name)||name==='.'||name==='..')throw Error('Invalid filename');return name;}

export class DiskDirectory {
  constructor(path){this.path=path}
  async getDirectoryHandle(name,{create=false}={}){const dir=join(this.path,safe(name));if(create)await mkdir(dir,{recursive:true});return new DiskDirectory(dir)}
  async getFileHandle(name){const path=join(this.path,safe(name));return {createWritable:async()=>({write:async(data)=>{await writeFile(path,data)},close:async()=>{}}),getFile:async()=>new Blob([await readFile(path)])};}
  async removeEntry(name){await rm(join(this.path,safe(name)),{recursive:true,force:true})}
  async *entries(){for(const {name} of await import('node:fs/promises').then(m=>m.readdir(this.path,{withFileTypes:true})))yield [name]}
}
