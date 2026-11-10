import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
export async function mcpSite(){
 const server=createServer((req,res)=>{
  const u=new URL(req.url!,'http://local');res.setHeader('Content-Type','text/html;charset=utf-8');
  if(u.pathname==='/wapi/zpgeek/search/joblist.json'){
   res.setHeader('Content-Type','application/json');const q=u.searchParams.get('query');
   const title=u.searchParams.get('stale')?'旧迟到结果':q==='same'?'同 ID 新岗位正文':'AI工程师';
   setTimeout(()=>res.end(JSON.stringify({zpData:{jobList:q==='empty'?[]:[{encryptJobId:u.searchParams.get('stale')?'other':q==='old'?'old':'one',jobName:title,brandName:'公司'}]}})),Number(u.searchParams.get('lag')??50));return;
  }
  const isChat=u.pathname.includes('/chat');
  res.end(`<!doctype html><html><body>
   <a class="user-name" data-user-id="account-1">用户</a><a href="/web/geek/chat">消息</a>
   <div class="city-label">深圳</div><div class="filter-select-box">经验不限</div>
   ${isChat?`<section class="chat-conversation" data-conversation-id="chat1" data-job-id="one" data-boss-id="hr1"><div class="chat-position"><a href="/job_detail/one.html">AI工程师</a></div><div class="chat-company">公司</div><div class="chat-record"></div><button title="常用语">常用语</button><div class="phrase-panel" hidden><div class="phrase-item">你好，想了解这个岗位。</div><div class="phrase-item">第二条</div></div><textarea class="chat-input"></textarea><button class="btn-send">发送</button></section>`:
   `<input placeholder="搜索职位、公司"><button id="search">搜索</button><div class="job-detail-box" data-job-id="one"><h1>AI工程师</h1><span class="company-name">公司</span><button id="contact">立即沟通</button></div><div id="results"><div class="job-card-wrapper"><a href="/job_detail/old.html">旧岗位</a><span class="company-name">公司</span></div></div><div class="empty" hidden>暂无相关职位</div>`}
   <script>
   window.contacts=0;window.sends=0;window.mode='direct';
   const search=document.querySelector('#search');
   if(search)search.onclick=async()=>{const q=document.querySelector('input').value;const r=await fetch('/wapi/zpgeek/search/joblist.json?query='+encodeURIComponent(q));const data=await r.json();setTimeout(()=>{document.querySelector('#results').innerHTML=data.zpData.jobList.map(j=>'<div class="job-card-wrapper"><a href="/job_detail/'+j.encryptJobId+'.html">'+j.jobName+'</a><span class="company-name">公司</span></div>').join('');document.querySelector('.empty').hidden=data.zpData.jobList.length!==0;history.replaceState(null,'','/web/geek/jobs?query='+encodeURIComponent(q));},150);};
   const contact=document.querySelector('#contact');if(contact)contact.onclick=()=>{window.contacts++;location.href='/web/geek/chat';};
   const phrase=document.querySelector('[title="常用语"]');if(phrase)phrase.onclick=()=>{const panel=document.querySelector('.phrase-panel');setTimeout(()=>panel.hidden=!panel.hidden,window.panelDelay||0);};
   function send(text){window.sends++;const row=document.createElement('div');row.className='message-item item-myself';const content=document.createElement('div');content.className='text';content.textContent=text;row.append(content);const status=document.createElement('span');status.className='message-status';status.textContent=window.mode==='bubble'?'':window.mode==='failed'?'发送失败':'送达';row.append(status);document.querySelector('.chat-record').append(row);document.querySelector('textarea').value='';}
   for(const item of document.querySelectorAll('.phrase-item'))item.onclick=()=>{const text=item.textContent;document.querySelector('.phrase-panel').hidden=true;document.querySelector('textarea').value=text;if(window.mode==='direct'||window.mode==='failed'||window.mode==='bubble')send(text);if(window.mode==='delayed-direct')setTimeout(()=>send(text),200);};
   const submit=document.querySelector('.btn-send');if(submit)submit.onclick=()=>send(document.querySelector('textarea').value);
   </script></body></html>`);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return {url:'http://127.0.0.1:'+(server.address() as AddressInfo).port,close:()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))};
}
