import { spawn } from 'node:child_process';

export async function copyText(text:string):Promise<void>{
  if(Buffer.byteLength(text)>2*1024*1024)throw new Error('Clipboard export is limited to 2 MiB; use /export for larger conversations.');
  const [command,args]:[string,string[]]=process.platform==='win32'?['powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())']]:process.platform==='darwin'?['pbcopy',[]]:process.env.WAYLAND_DISPLAY?['wl-copy',[]]:['xclip',['-selection','clipboard']];
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['pipe','ignore','ignore'],windowsHide:true,shell:false});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Clipboard command timed out.'));},5000);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Clipboard unavailable on this terminal. Use /export instead.'));});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Clipboard command failed.'));});
    child.stdin.on('error',()=>{});child.stdin.end(text,'utf8');
  });
}
