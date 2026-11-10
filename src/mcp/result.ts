/** Parse only the program's versioned result, never a snapshot or a tool success flag. */
export function decodeToolResult(raw:unknown):Record<string,unknown> {
 if(!raw || typeof raw!=='object' || (raw as {isError?:boolean}).isError)throw new Error('MCP 工具返回错误');
 const r=raw as {structuredContent?:unknown;content?:Array<{type:string;text?:string}>};
 const candidates:unknown[]=[];
 if(r.structuredContent && typeof r.structuredContent==='object' && 'schemaVersion' in r.structuredContent)candidates.push(r.structuredContent);
 for(const c of r.content??[]){
  if(c.type!=='text'||!c.text)continue;
  const t=c.text.trim();const match=t.match(/^### Result\r?\n([\s\S]*?)(?=\r?\n### |$)/);
  try{const p=JSON.parse(match?match[1].trim():t);if(p&&typeof p==='object'&&p.schemaVersion===1)candidates.push(p);}catch{/* not a result */}
 }
 if(candidates.length!==1)throw new Error('MCP 结果缺失或有歧义');
 return candidates[0] as Record<string,unknown>;
}
