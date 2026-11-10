// Fixed experience-filter input only. Not a generic CDP or coordinate API.
export class ExperiencePointer{
 constructor(api,{pollMs=100,commandMs=2500}={}){this.api=api;this.pollMs=pollMs;this.commandMs=commandMs;this.operation=null;}
 cancel(reason='RUN_STOPPED'){if(this.operation)this.operation.cancelled=reason;}
 async select({binding,deadline,check,observe,assertCurrent=()=>{},prepare=async()=>{},onPhase=()=>{}}){
  if(this.operation)throw Error('EXPERIENCE_POINTER_BUSY');
  if(!this.api.debugger)throw Error('DEBUGGER_PERMISSION_REQUIRED');
  const o={target:{tabId:binding.tabId},attached:false,held:false,presses:0,finished:false,attachPending:false,cancelled:null};this.operation=o;
  const trace=phase=>{try{onPhase(phase);}catch{}};
  const sync=()=>{if(o.cancelled)throw Error(o.cancelled);if(o.finished)throw Error('RUN_STOPPED');if(Date.now()>=deadline)throw Error('DEADLINE_EXPIRED');assertCurrent();};
  const guard=async()=>{sync();await limit(check(),'DEBUGGER_CHECK_TIMEOUT');sync();};
  const limit=async(p,code,cleaning=false)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),cleaning?this.commandMs:Math.max(1,Math.min(this.commandMs,deadline-Date.now())));})]);}finally{clearTimeout(timer);}};
  const detached=source=>{if(source.tabId===o.target.tabId){o.attached=false;o.cancelled='DEBUGGER_DETACHED';}};
  const cleanup=async()=>{
   if(o.cleaning)return o.cleaning;
   o.cleaning=(async()=>{
    let failed=false;
    if(o.attached&&o.held)try{await limit(this.api.debugger.sendCommand(o.target,'Input.dispatchMouseEvent',{type:'mouseReleased',x:-1,y:-1,button:'left',buttons:0,clickCount:0}),'DEBUGGER_CLEANUP_TIMEOUT',true);o.held=false;}catch{failed=true;}
    if(o.attached)try{await limit(Promise.resolve(this.api.debugger.detach(o.target)).then(()=>{o.attached=false;trace('detached');if(!o.attachPending&&this.operation===o)this.operation=null;}),'DEBUGGER_CLEANUP_TIMEOUT',true);}catch{failed=true;}
    this.api.debugger.onDetach?.removeListener(detached);
    if(!o.attachPending&&!o.attached&&this.operation===o)this.operation=null;
    if(failed)throw Error('DEBUGGER_CLEANUP_FAILED');
   })();return o.cleaning;
  };
  const read=async(step,label)=>{await guard();const value=await limit(observe(step,label),'EXPERIENCE_OBSERVE_TIMEOUT');await guard();return value;};
  const validPoint=p=>{if(!p||![p.x,p.y,p.viewportWidth,p.viewportHeight].every(Number.isFinite)||p.viewportWidth<=0||p.viewportHeight<=0||p.x<0||p.y<0||p.x>=p.viewportWidth||p.y>=p.viewportHeight)throw Error('EXPERIENCE_INVALID_POINT');return {x:p.x,y:p.y};};
  const send=async(type,p,label,before)=>{
   await guard();
   const phase=type==='mouseMoved'?(label?'move_option':'move_control'):type==='mousePressed'?'press_option':'release_option';
   if(type!=='mouseMoved'){
    // This must be the LAST asynchronous observation before dispatch. Calling
    // read() here would insert another async guard after the fresh hit test.
    const fresh=await limit(observe('option',label),'EXPERIENCE_OBSERVE_TIMEOUT');sync();
    validPoint(fresh.point);
    if(fresh.label!==label||!same(p,fresh.point))throw Error('EXPERIENCE_TARGET_MOVED');
    if(signature(fresh)!==signature(before))throw Error('EXPERIENCE_SELECTION_CHANGED');
    p=fresh.point;
   }
   const pos=validPoint(p);sync();if(type==='mousePressed'){o.held=true;o.presses++;}
   trace(phase+'_sent');
   try{await limit(this.api.debugger.sendCommand(o.target,'Input.dispatchMouseEvent',{type,...pos,...(type==='mouseMoved'?{buttons:0}:{button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})}),'DEBUGGER_INPUT_TIMEOUT');trace(phase+'_ack');}
   catch(e){trace(phase+'_failed');throw Error(o.cancelled|| (e.message==='DEBUGGER_INPUT_TIMEOUT'?e.message:'DEBUGGER_INPUT_FAILED'));}
   if(type==='mouseReleased')o.held=false;await guard();
  };
  const sleep=()=>new Promise(r=>setTimeout(r,this.pollMs));
  const same=(a,b)=>Math.abs(a.x-b.x)<=1&&Math.abs(a.y-b.y)<=1;
  const signature=v=>JSON.stringify(v.selection);
  let primaryError;
  try{
   await guard();if(this.api.permissions&&!await limit(this.api.permissions.contains({permissions:['debugger']}),'DEBUGGER_CHECK_TIMEOUT'))throw Error('DEBUGGER_PERMISSION_REQUIRED');await guard();
   trace('foreground_started');await limit(prepare(sync),'DEBUGGER_CHECK_TIMEOUT');await guard();trace('foreground_ready');
   this.api.debugger.onDetach?.addListener(detached);o.attachPending=true;
   trace('attach_started');
   const attaching=Promise.resolve().then(()=>this.api.debugger.attach(o.target,'1.3')).then(async()=>{
    o.attachPending=false;o.attached=true;trace('attached');
    if(o.finished){o.cleaning=null;await cleanup();}
   },()=>{o.attachPending=false;if(o.finished){this.api.debugger.onDetach?.removeListener(detached);if(this.operation===o)this.operation=null;}throw Error('DEBUGGER_ATTACH_FAILED');});
   await limit(attaching,'DEBUGGER_ATTACH_TIMEOUT');await guard();
   let opens=0,reopens=0,forceReopen=false;
   for(let transition=0;transition<12;transition++){
    let current=await read('selection');if(!current.selection?.known)throw Error('EXPERIENCE_SELECTION_UNVERIFIED');
    const expected=current.expectedLabel;if(!['1-3年','3-5年'].includes(expected))throw Error('INVALID_SCOPE');
    const targets=current.expectedLabels??[expected];if(!targets.length||targets.some(t=>!['1-3年','3-5年'].includes(t))||!targets.includes(expected))throw Error('INVALID_SCOPE');
    if(current.selection.labels.length===targets.length&&targets.every(t=>current.selection.labels.includes(t)))return {experience:expected};
    // Selecting the target first works for a single-select replacement and a
    // multi-select addition; clear extras only after the target is selected.
    const label=targets.find(t=>!current.selection.labels.includes(t))??current.selection.labels.find(l=>!targets.includes(l));
    if(forceReopen){current={...current,menuVisible:false};forceReopen=false;}
    while(!current.menuVisible&&opens<2){
     opens++;let control;try{control=await read('control');}catch(e){if(e.message!=='EXPERIENCE_TARGET_OFFSCREEN')throw e;await read('scroll');control=await read('control');}
     await send('mouseMoved',control.point);
     for(let i=0;i<10;i++){await sleep();current=await read('selection');if(current.menuVisible)break;}
    }
    if(!current.menuVisible)throw Error('EXPERIENCE_MENU_NOT_OPEN');
    const pressesBefore=o.presses;
    try{
    let target;
    for(let move=0;move<2;move++){
     target=await read('option',label);await send('mouseMoved',target.point,label);
     const fresh=await read('option',label);
     if(same(target.point,fresh.point)){target=fresh;break;}target=null;
    }
    if(!target)throw Error('EXPERIENCE_TARGET_MOVED');
    if(!target.selection.known)throw Error('EXPERIENCE_SELECTION_UNVERIFIED');
    if(targets.includes(label)&&target.selection.labels.includes(label)||!targets.includes(label)&&!target.selection.labels.includes(label))continue;
    const before=signature(target);
    await send('mousePressed',target.point,label,target);
    const pressed=await read('option',label);if(!same(target.point,pressed.point))throw Error('EXPERIENCE_TARGET_MOVED');
    await send('mouseReleased',pressed.point,label,pressed);
    let changed=false;for(let i=0;i<10;i++){await sleep();const after=await read('selection');if(signature(after)!==before){changed=true;break;}}
    if(!changed)throw Error('EXPERIENCE_SELECTION_UNCHANGED');
    opens=0; // A confirmed toggle may legitimately close a multi-select menu.
    }catch(e){
     if(e.message==='EXPERIENCE_MENU_NOT_OPEN'&&o.presses===pressesBefore&&!o.held&&opens<2&&reopens<1){reopens++;forceReopen=true;continue;}
     throw e;
    }
   }
   throw Error('EXPERIENCE_SELECTION_UNVERIFIED');
  }catch(e){primaryError=e;throw e;}
  finally{
   o.finished=true;
   try{await cleanup();}catch(e){if(!primaryError)throw e;}
  }
 }
}
