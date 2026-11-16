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
  // Contrôle de types strict des sources patchées (transpileModule, plus bas, ne vérifie aucun type).
  // Les modules du projet Lovable absents du dépôt sont déclarés au plus juste.
  const {writeFileSync}=await import('node:fs');
  writeFileSync(join(dir,'stubs.d.ts'),`
declare namespace JSX { type Element = unknown; interface ElementChildrenAttribute { children: {} } interface IntrinsicAttributes { key?: string | number } interface IntrinsicElements { [tag: string]: Record<string, unknown> } }
declare module "react" { export function useEffect(effect: () => void, deps?: unknown[]): void; }
declare module "@tanstack/react-router" { export function createFileRoute(path: string): (options: { component: () => unknown }) => { useParams(): { token: string } }; export function useRouterState<T>(options: { select: (state: { location: { searchStr: string } }) => T }): T; }
declare module "@tanstack/react-query" { export function useQuery<T>(options: { queryKey: unknown[]; queryFn: () => Promise<T>; [option: string]: unknown }): { data: T | undefined; isPending: boolean; isFetching: boolean; refetch: () => void }; }
declare module "@/lib/useReader" { export function useReader(): import("./src/lib/edition.ts").ReaderContext; }
declare module "@/lib/piano" { export function sendPageDisplay(reader: unknown, data: Record<string, unknown>): void; }
declare module "@/components/GiftHeader" { export function GiftHeader(): unknown; }
declare module "@/lib/bodyHtml" { export function sanitizeBodyHtml(html: string): string; }
`);
  writeFileSync(join(dir,'src/lib/deployment.ts'),'import type { ReaderContext } from "./edition.ts";\nexport declare function readerDatabase(context: ReaderContext): { url: string; anonKey: string };\n');
  const typed=walk(join(dir,'src')).filter(f=>/\.tsx?$/.test(f));
  const program=ts.createProgram([...typed,join(dir,'stubs.d.ts')],{strict:true,noUncheckedIndexedAccess:true,noEmit:true,jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ES2020,lib:['lib.es2020.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts'],module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowImportingTsExtensions:true,skipLibCheck:true,types:[],baseUrl:dir,paths:{'@/*':['src/*']}});
  const diagnostics=ts.getPreEmitDiagnostics(program).map(d=>`${d.file?.fileName.slice(dir.length+1)}:${d.file?d.file.getLineAndCharacterOfPosition(d.start).line+1:0} ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`);
  assert.deepEqual(diagnostics,[],'types stricts du lecteur');
  assert.ok(typed.length>=6);
  let reader={edition:'EUR',environment:'TEST'}, row, rpc;
  const React={createElement:(type,props,...children)=>typeof type==='function'?type({...props,children}):({type,props:{...props,children}})};
  const cache=new Map();
  function load(file){
    if(cache.has(file))return cache.get(file);
    const mod={exports:{}};cache.set(file,mod.exports);
    const extras=file==='src/routes/a.$token.tsx'?'\nexport { ArticleView, RefusalView, UnavailableView };':'';
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
  const evidence=JSON.parse(readFileSync('docs/evidence/europe-subscription-labels-20261116.json','utf8'));
  const all=node=>!node||typeof node!=='object'?[]:[node,...(node.props?.children??[]).flat(Infinity).flatMap(all)];
  const labels=JSON.parse(readFileSync('docs/evidence/europe-reader-labels-20261116.json','utf8'));
  const texts=node=>node==null||typeof node==='boolean'?[]:typeof node!=='object'?[String(node)]:(node.props?.children??[]).flat(Infinity).flatMap(texts);
  const shownText=node=>texts(node).join(' ').replace(/\s+/g,' ');
  // Table du lecteur comparée, clé par clé, au relevé : chaque texte a une origine, chaque « relevé » une page.
  const copyKeys=Object.keys(load('src/lib/edition.ts').copy.EUR);
  assert.deepEqual(Object.keys(labels.labels).sort(),['en','fr','pl']);
  for(const [language,entries] of Object.entries(labels.labels)){
    const shown={...table.readerCopy('EUR',language),subscribe:table.articleActions('EUR',language).label,homeLabel:table.articleActions('EUR',language).homeLabel};
    assert.deepEqual(Object.keys(entries).sort(),[...copyKeys,'homeLabel'].sort(),`clés ${language}`);
    for(const [key,entry] of Object.entries(entries)){
      assert.equal(shown[key],entry.text,`${language}.${key}`);
      assert.ok(['relevé','traduit','lecteur'].includes(entry.origin),`${language}.${key} origine`);
      if(entry.origin==='relevé')assert.ok(/^https:\/\/(www|fr|pl)\.lexpress\.eu\//.test(entry.url)&&labels.pages.some(page=>page.url===entry.url&&page.status===entry.status),`${language}.${key} source`);
      else assert.equal(entry.url,undefined,`${language}.${key} : seule une page relevée porte une URL`);
    }
  }
  assert.equal(table.readerCopy('EUR','pl').subscribe,'Subskrypcja');
  // Le message Lovable porte exactement les mêmes textes que la table : pas de retraduction possible.
  const prompt=readFileSync('docs/implementation/lovable-article-language-prompt.md','utf8');
  const translated=['title','description','giftedBy','subscribe','by','published','continueReading','gifted','homeLabel','expired','withdrawn','limited'];
  for(const [language,entries] of Object.entries(labels.labels))for(const key of translated){const entry=entries[key];assert.ok(prompt.includes(`| ${entry.text} |`)||prompt.includes(`| ${entry.text}\n`),`prompt Lovable : ${language}.${key}`);}
  // Les écrans sans langue connue ne sont pas dans le message : rien à traduire, rien à contredire.
  for(const key of ['retry','technical','notFound','pageError'])assert.ok(!prompt.includes(labels.labels.pl[key].text),`prompt sans ${key} polonais`);
  for(const actions of Object.values(table.EUROPE_ACTIONS))assert.ok(prompt.includes(actions.subscription)&&prompt.includes(actions.home));
  assert.ok(!Object.values(labels.labels.en).some(e=>e.origin==='traduit')&&!Object.values(labels.labels.fr).some(e=>e.origin==='traduit'),'seul le polonais est traduit');
  // Le lecteur France ignore la langue : mêmes textes qu'avant, quel que soit l'argument.
  for(const language of [undefined,'en','fr','pl'])assert.equal(table.readerCopy('FR',language),load('src/lib/edition.ts').copy.FR);
  assert.equal(table.readerCopy('EUR'),load('src/lib/edition.ts').copy.EUR,'sans langue connue : anglais historique');
  const anchors=node=>!node||typeof node!=='object'?[]:[...(node.type==='a'?[node]:[]),...(node.props?.children??[]).flat(Infinity).flatMap(anchors)];
  for(const [language,host,label,path] of [['en','www.lexpress.eu','Subscribe','subscribe'],['fr','fr.lexpress.eu',"S'abonner",'abonnement'],['pl','pl.lexpress.eu','Subskrypcja','subskrypcja']]){
    reader={edition:'EUR',environment:'TEST'};
    row={status:'ok',title:'Fixture',canonical_url:`https://${host}/article`,body:'Fixture',language};
    const result=await api.getGiftArticle('a'.repeat(32),reader);
    assert.equal(result.language,language);
    assert.ok(rpc.url.endsWith('/get_gift_article_for_edition_v2'));assert.equal(rpc.body.p_edition,'EUR');
    const rendered=route.ArticleView({article:row,search:'?s=recipient&at_campaign=fixture&redirect=https://evil.test'});
    const links=anchors(rendered);
    const button=links.find(l=>l.props.children.includes(label));assert.ok(button,label);
    const target=new URL(button.props.href);assert.equal(target.origin,`https://${host}`);assert.equal(target.pathname,`/${path}/`);
    assert.equal(target.searchParams.get('s'),'recipient');assert.equal(target.searchParams.get('redirect'),null);
    // Comparé à la preuve relevée par GET, pas à la table testée elle-même.
    const proof=evidence.find(e=>new URL(e.url).hostname===host);
    assert.equal(proof.subscription.label,label);assert.equal(proof.subscription.status,200);
    assert.equal(target.origin+target.pathname,proof.subscription.url);
    const L=labels.labels[language];
    assert.ok(links.some(l=>l.props.href===proof.url&&l.props.children.includes(L.homeLabel.text)),`accueil ${language}`);
    assert.ok(shownText(rendered).includes(L.gifted.text),`phrase d'offre ${language}`);
    // lang ne couvre que le contenu de l'article.
    assert.equal(rendered.props.lang,undefined);
    const tagged=all(rendered).filter(n=>n.props?.lang);
    assert.ok(tagged.length>0&&tagged.every(n=>n.props.lang===language));
    assert.ok(tagged.some(n=>n.type==='h1'));
    // Aperçu : lien source, signature et date dans la langue de l'article.
    const preview=route.ArticleView({article:{...row,status:'preview',body:null,author:'A',published_at:'2026-11-16T10:00:00Z'},search:''});
    const source=anchors(preview).find(l=>l.props.href===row.canonical_url);
    assert.deepEqual(source.props.children,[L.continueReading.text],`aperçu ${language}`);
    const shown=shownText(preview);
    const expected={en:['By A','Published on 16 November 2026'],fr:['Par A','Publié le 16 novembre 2026'],pl:['Autor: A','Opublikowano 16 listopada 2026']}[language];
    for(const text of expected)assert.ok(shown.includes(text),`${text} : ${shown}`);
    assert.ok(!shown.includes('lexpress.fr'),`aucune mention France sur ${language}`);
    if(language==='pl')for(const english of ['By ','Published','Subscribe','shared','Continue'])assert.ok(!shownText(rendered).includes(english)&&!shown.includes(english),`aucun habillage anglais sur un article polonais : ${english}`);
    // Lien expiré ou retiré : écran de refus et bouton dans la langue de l'article.
    for(const status of ['expired','withdrawn']){
      row={status,language};
      const refusal=await api.getGiftArticle('a'.repeat(32),reader);
      assert.deepEqual({...refusal},{error:status,language});
      const view=route.RefusalView({error:refusal.error,language:refusal.language,search:'?s=recipient&redirect=https://evil.test'});
      assert.ok(shownText(view).includes(L[status].text)&&shownText(view).includes(L.limited.text),`refus ${status} ${language}`);
      const refusalButton=anchors(view)[0];assert.deepEqual(refusalButton.props.children,[label]);
      assert.equal(refusalButton.props.href,proof.subscription.url+'?s=recipient');
    }
    row={status:'ok',title:'Fixture',canonical_url:`https://${host}/article`,body:'Fixture',language};
    row={...row,language:language==='en'?'pl':'en'};
    assert.equal((await api.getGiftArticle('a'.repeat(32),reader)).error,'unavailable');
  }
  for(const canonical_url of ['http://pl.lexpress.eu/a','https://pl.lexpress.eu:443/a','https://pl.lexpress.eu:8443/a','https://user@pl.lexpress.eu/a','https://preprod.lexpress.eu/a','https://pl.lexpress.eu.evil.test/a']){
    row={status:'ok',title:'Fixture',canonical_url,language:'pl'};
    assert.equal((await api.getGiftArticle('a'.repeat(32),reader)).error,'unavailable',canonical_url);
  }
  // Langue hors liste, lien inconnu, panne : repli anglais historique du contexte Europe, aucune langue retenue.
  for(const refused of [{status:'expired',language:'xx'},{status:'expired',language:null},{status:'expired',language:['pl']},{status:'expired'},{status:'unknown',language:'pl'}]){
    row=refused;const result=await api.getGiftArticle('a'.repeat(32),reader);
    assert.deepEqual({...result},{error:refused.status},JSON.stringify(refused));
    const view=route.RefusalView({error:result.error,language:result.language,search:''});
    assert.ok(shownText(view).includes(refused.status==='expired'?'This link has expired.':'This link does not exist.'));
    assert.deepEqual(anchors(view)[0].props.children,["Subscribe to L'Express Europe"]);
  }
  assert.ok(shownText(route.UnavailableView({onRetry(){},retrying:false})).includes('This article cannot be displayed right now.'));
  reader={edition:'FR',environment:'TEST'};
  row={status:'expired',language:'pl'};
  assert.deepEqual({...(await api.getGiftArticle('a'.repeat(32),reader))},{error:'expired'},'le lecteur France ignore la langue d’un refus');
  assert.ok(shownText(route.RefusalView({error:'expired',search:''})).includes('Ce lien a expiré.'));
  row={status:'ok',title:'Fixture',canonical_url:'https://www.lexpress.fr/a',language:'fr'};
  assert.equal((await api.getGiftArticle('a'.repeat(32),reader)).language,'fr');
  const france=route.ArticleView({article:{...row,status:'preview',body:null},search:''});
  assert.ok(anchors(france).some(l=>l.props.children.includes('Lire la suite sur lexpress.fr')),'aperçu France inchangé');
  assert.ok(!anchors(france).some(l=>l.props.href==='https://www.lexpress.fr/'),'aucun lien d’accueil ajouté au lecteur France');
  assert.ok(anchors(france).some(l=>l.props.children.includes("S'abonner à L'Express")&&l.props.href.startsWith('https://abonnements-digitaux.lexpress.fr/offres')),'abonnement France inchangé');
  row={...row,canonical_url:'https://pl.lexpress.eu/a',language:'pl'};
  assert.equal((await api.getGiftArticle('a'.repeat(32),reader)).error,'unavailable');
  console.log('Lecteur : patch appliqué, RPC v2, vrai rendu EN/FR/PL (boutons, accueil, signature, date, offre, refus traduits), table comparée au relevé, refus sécurité/langue vérifiés (simulés).');
} finally {rmSync(dir,{recursive:true,force:true});}
