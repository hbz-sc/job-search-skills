export const listing = `<!doctype html><html><body>
<a class="user-name" data-user-id="account-1">求职者</a>
<input placeholder="搜索职位、公司"><button>搜索</button>
<div class="city-label">深圳</div><div class="filter-select-box">经验不限</div>
<div class="job-card-wrapper"><a class="job-name" href="/job_detail/one.html?tracking=1">AI工程师</a><div class="company-name">同名公司</div><span class="salary">10-15K</span><span class="job-area">深圳·南山</span></div>
<div class="job-card-wrapper"><a class="job-name" href="/job_detail/two.html">AI工程师</a><div class="company-name">同名公司</div></div>
<div class="job-card-wrapper"><span class="job-name">缺少稳定链接</span></div>
<button onclick="window.opens=(window.opens||0)+1">立即沟通</button>
</body></html>`;
export function chatPage(mode:'direct'|'fill'|'unknown'|'failed'|'bubble'='direct'){
 const choice=mode==='fill'?"document.querySelector('textarea').value='你好，想了解这个岗位。';":mode==='unknown'?'':'send();';
 return `<!doctype html><html><body><a class="user-name" data-user-id="account-1">求职者</a>
 <section class="chat-conversation" data-conversation-id="chat1" data-job-id="one" data-boss-id="boss1">
 <div class="chat-position"><a href="/job_detail/one.html">AI工程师</a></div><div class="chat-company">同名公司</div>
 <div class="chat-record"></div><button title="常用语" onclick="document.querySelector('.phrase-panel').hidden=false">常用语</button>
 <div class="phrase-panel" hidden><div class="phrase-item" onclick="choose()">你好，想了解这个岗位。</div><div class="phrase-item">其他内容</div></div>
 <textarea class="chat-input"></textarea><button class="btn-send" onclick="send()">发送</button></section>
 <script>window.sends=0;
 function send(){window.sends++;let box=document.createElement('div');box.className='message-item item-myself';let text=document.createElement('div');text.className='text';text.textContent='你好，想了解这个岗位。';box.append(text);let status=document.createElement('span');status.className='message-status';status.textContent=${JSON.stringify(mode==='failed'?'发送失败':mode==='bubble'?'':'送达')};box.append(status);document.querySelector('.chat-record').append(box);document.querySelector('textarea').value='';}
 function choose(){${choice}document.querySelector('.phrase-panel').hidden=true;}
 </script></body></html>`;
}
