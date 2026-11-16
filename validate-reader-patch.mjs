import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,posix} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'platform934-reader-'));
const walk=(path)=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(path,e.name)):[join(path,e.name)]);
try {
  const before='gift-links/fixtures/reader-language-before';
  for(const file of walk(before)){
    const target=join(dir,file.slice(before.length+1).replace(/\.txt$/,''));
    mkdirSync(dirname(target),{recursive:true});copyFileSync(file,target);
  }
  const applied=spawnSync('patch',['--batch','-p1','-i',resolve('docs/patches/reader-europe-hosts.patch')],{cwd:dir,encoding:'utf8'});
  assert.equal(applied.status,0,applied.stdout+applied.stderr);
  for(const file of walk('docs/reader-reference')){
    const relative=file.slice('docs/reader-reference/'.length);
    assert.equal(readFileSync(join(dir,relative),'utf8'),readFileSync(file,'utf8'),relative);
  }
  let reader={edition:'EUR',environment:'TEST'}, row, rpc;
  const React={createElement:(type,props,...children)=>typeof type==='function'?type({...props,children}):({type,props:{...props,children}})};
  const cache=new Map();
  function load(file){
    if(cache.has(file))return cache.get(file);
    const mod={exports:{}};cache.set(file,mod.exports);
    const extras=file==='src/routes/a.$token.tsx'?'\nexport { ArticleView };':'';
    const source=ts.transpileModule(readFileSync(join(dir,file),'utf8')+extras,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
    function require(name){
      if(name==='react')return {useEffect:()=>{}};
      if(name==='@tanstack/react-router')return {createFileRoute:()=>()=>({}),useRouterState:()=>''};
      if(name==='@tanstack/react-query')return {useQuery:()=>({})};
      if(name==='@/lib/useReader')return {useReader:()=>reader};
      if(name==='./deployment.ts')return {readerDatabase:()=>({url:'https://db.invalid',anonKey:'fake'})};
      if(['@/lib/piano','@/components/GiftHeader','@/lib/bodyHtml'].includes(name))return {sanitizeBodyHtml:s=>s};
      let target=name.startsWith('@/')?'src/'+name.slice(2):posix.join(posix.dirname(file),name);
      if(!/\.tsx?$/.test(target))target+=existsSync(join(dir,target+'.tsx'))?'.tsx':'.ts';
      return load(target);
    }
    vm.runInNewContext(source,{exports:mod.exports,require,React,URL,URLSearchParams,AbortSignal,console,fetch:async(url,options)=>{
      rpc={url,body:JSON.parse(options.body)};return new Response(JSON.stringify([row]));
    }});
    return mod.exports;
  }
  const api=load('src/lib/giftArticle.ts');
  const table=load('src/lib/articleLanguage.ts');
  const route=load('src/routes/a.$token.tsx');
  const anchors=node=>!node||typeof node!=='object'?[]:[...(node.type==='a'?[node]:[]),...(node.props?.children??[]).flat(Infinity).flatMap(anchors)];
  for(const [language,host,label,path] of [['en','www.lexpress.eu','Subscribe','subscribe'],['fr','fr.lexpress.eu',"S'abonner",'abonnement'],['pl','pl.lexpress.eu','Subskrypcja','subskrypcja']]){
    reader={edition:'EUR',environment:'TEST'};
    row={status:'ok',title:'Fixture',canonical_url:`https://${host}/article`,body:'Fixture',language};
    const result=await api.getGiftArticle('a'.repeat(32),reader);
    assert.equal(result.language,language);
    assert.ok(rpc.url.endsWith('/get_gift_article_for_edition_v2'));assert.equal(rpc.body.p_edition,'EUR');
    const rendered=route.ArticleView({article:row,search:'?s=recipient&at_campaign=fixture&redirect=https://evil.test'});
    assert.equal(rendered.props.lang,language);
    const links=anchors(rendered);
    const button=links.find(l=>l.props.children.includes(label));assert.ok(button,label);
    const target=new URL(button.props.href);assert.equal(target.origin,`https://${host}`);assert.equal(target.pathname,`/${path}/`);
    assert.equal(target.searchParams.get('s'),'recipient');assert.equal(target.searchParams.get('redirect'),null);
    assert.ok(links.some(l=>l.props.href===table.EUROPE_ACTIONS[language].home));
    row={...row,language:language==='en'?'pl':'en'};
    assert.equal((await api.getGiftArticle('a'.repeat(32),reader)).error,'unavailable');
  }
  for(const canonical_url of ['http://pl.lexpress.eu/a','https://pl.lexpress.eu:443/a','https://pl.lexpress.eu:8443/a','https://user@pl.lexpress.eu/a','https://preprod.lexpress.eu/a','https://pl.lexpress.eu.evil.test/a']){
    row={status:'ok',title:'Fixture',canonical_url,language:'pl'};
    assert.equal((await api.getGiftArticle('a'.repeat(32),reader)).error,'unavailable',canonical_url);
  }
  reader={edition:'FR',environment:'TEST'};row={status:'ok',title:'Fixture',canonical_url:'https://www.lexpress.fr/a',language:'fr'};
  assert.equal((await api.getGiftArticle('a'.repeat(32),reader)).language,'fr');
  row={...row,canonical_url:'https://pl.lexpress.eu/a',language:'pl'};
  assert.equal((await api.getGiftArticle('a'.repeat(32),reader)).error,'unavailable');
  console.log('Lecteur : patch appliqué, RPC v2, vrai rendu des boutons EN/FR/PL, accueil, attribution et refus sécurité/langue vérifiés (simulés).');
} finally {rmSync(dir,{recursive:true,force:true});}
