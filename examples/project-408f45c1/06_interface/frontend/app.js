const level=document.querySelector("#level");const value=document.querySelector("#value");const log=document.querySelector("#log");const status=document.querySelector("#status");
level.addEventListener("input",()=>value.textContent=level.value);
async function command(name,payload={}){const response=await fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"command",request_id:crypto.randomUUID(),name,payload})});const result=await response.json();log.textContent=JSON.stringify(result,null,2);status.textContent=result.status==="accepted"?"命令已校验":"请求失败";}
document.querySelectorAll("[data-command]").forEach(button=>button.addEventListener("click",()=>command(button.dataset.command)));
document.querySelector("#apply").addEventListener("click",()=>command("set_output",{level:Number(level.value)}));
