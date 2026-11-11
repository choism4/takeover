import {spawn} from 'node:child_process';
export function run(file,args,{input,cwd,timeout=120000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',done=false;
    const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1000).unref();},timeout);
    child.stdout.on('data',d=>{stdout+=d;if(stdout.length>8e6)child.kill();});
    child.stderr.on('data',d=>{stderr=(stderr+d).slice(-20000);});
    child.on('error',e=>{clearTimeout(timer);done=true;reject(e);});
    child.on('close',code=>{clearTimeout(timer);if(done)return;code===0?resolve(stdout):reject(new Error(`${file} failed (${code}): ${stderr||stdout}`.slice(0,2000)));});
    child.stdin.on('error',()=>{});child.stdin.end(input??'');
  });
}
