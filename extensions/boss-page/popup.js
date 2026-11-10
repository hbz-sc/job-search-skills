const state=document.querySelector('#state');
async function command(kind){
 try{const r=await chrome.runtime.sendMessage({kind});if(r?.status)state.textContent=r.status;if(r?.events)document.querySelector('#events').textContent=JSON.stringify(r.events.slice(-30),null,2);}
 catch(e){state.textContent='扩展通信失败：'+e.message;}
}
for(const id of ['connect','disconnect','diagnostics'])document.getElementById(id).addEventListener('click',()=>command(id));
void command('status');setInterval(()=>command('status'),1500);
