import {test,expect} from 'vitest';import {readFileSync,existsSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {Script} from 'node:vm';
test('pointer package declares its required permission with the same host scope and a complete fixed bundle',()=>{
 const manifest=JSON.parse(readFileSync('extensions/boss-page/manifest.json','utf8'));
 expect(manifest.version).toBe('0.8.0');expect(manifest.permissions.sort()).toEqual(['debugger','nativeMessaging','scripting','storage','webNavigation'].sort());expect(manifest.host_permissions).toEqual(['https://www.zhipin.com/*']);expect(manifest.optional_permissions??[]).not.toContain('debugger');
 const build=spawnSync(process.execPath,['scripts/build-boss-extension.mjs'],{encoding:'utf8'});expect(build.status,build.stderr).toBe(0);
 expect(existsSync('dist/boss-extension/experience-pointer.js')).toBe(true);const code=readFileSync('dist/boss-extension/content.bundle.js','utf8');expect(()=>new Script(code)).not.toThrow();expect(code).toContain('function experiencePointerView');expect(code).toContain('boss-dom-0.8.0');expect(code).not.toContain('hoverSpike');
});
