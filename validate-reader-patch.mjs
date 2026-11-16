import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'platform934-reader-'));
try {
  mkdirSync(join(dir,'src/lib'),{recursive:true});
  copyFileSync('gift-links/fixtures/reader-giftArticle-before.ts.txt',join(dir,'src/lib/giftArticle.ts'));
  const applied=spawnSync('patch',['--batch','-p1','-i',resolve('docs/patches/reader-europe-hosts.patch')],{cwd:dir,encoding:'utf8'});
  assert.equal(applied.status,0,applied.stdout+applied.stderr);
  const source=stripTypeScriptTypes(readFileSync(join(dir,'src/lib/giftArticle.ts'),'utf8')).replace(/^import .*$/gm,'').replace(/^export /gm,'');
  for (const [edition,host,accepted] of [['EUR','lexpress.eu',true],['EUR','www.lexpress.eu',true],['EUR','pl.lexpress.eu',true],['EUR','fr.lexpress.eu',true],['EUR','preprod.lexpress.eu',false],['EUR','pl.lexpress.eu.evil.test',false],['EUR','www.lexpress.fr',false],['FR','pl.lexpress.eu',false],['FR','www.lexpress.fr',true]]) {
    const context=vm.createContext({URL,URLSearchParams,AbortSignal,readerDatabase:()=>({url:'https://db.invalid',anonKey:'fake'}),fetch:async()=>new Response(JSON.stringify([{status:'ok',title:'Fixture',canonical_url:`https://${host}/article`,body:'Fixture'}]))});
    vm.runInContext(source,context);
    const result=await context.getGiftArticle('a'.repeat(32),{edition,environment:'TEST'});
    assert.equal(!result.error,accepted,`${edition}/${host}`);
  }
  console.log('Lecteur : patch applicable au source retrouvé, EN/PL/FR acceptés, hôtes arbitraires et édition croisée refusés (simulés).');
} finally {rmSync(dir,{recursive:true,force:true});}
