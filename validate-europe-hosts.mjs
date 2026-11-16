import assert from 'node:assert/strict';
import { arcIdDepuisUrl } from './gift-links/functions/_shared/arc-id.mjs';
import { chargerArticle } from './gift-links/functions/_shared/arc.mjs';
const id = '4DHUZG3CTFFJFLSPBD3XJ2O4TU';
const example = `https://pl.lexpress.eu/wywiad/kim-sa-najlepsi-szpiedzy-w-europie-kulisy-naszego-rankingu-08-04-2026-${id}/`;
for (const host of ['pl.lexpress.eu', 'fr.lexpress.eu', 'www.lexpress.eu', 'lexpress.eu']) {
  assert.equal(arcIdDepuisUrl(`https://${host}/article-${id}/`).edition, 'EUR', host);
}
assert.equal(arcIdDepuisUrl(example).arcId, id);
for (const host of ['en.lexpress.eu', 'de.lexpress.eu', 'preprod.lexpress.eu', 'evil.lexpress.eu', 'pl.lexpress.eu.evil.test']) {
  assert.ok(arcIdDepuisUrl(`https://${host}/article-${id}`).erreur, host);
}
for (const prefix of ['http://pl.lexpress.eu', 'https://pl.lexpress.eu:8443', 'https://pl.lexpress.eu:443', 'https://user@pl.lexpress.eu']) {
  assert.ok(arcIdDepuisUrl(`${prefix}/article-${id}`).erreur, prefix);
}
for (const [host, site] of [['pl.lexpress.eu','lexpress-europe-pl'], ['fr.lexpress.eu','lexpress-europe-fr'], ['www.lexpress.eu','lexpress-europe'], ['www.lexpress.fr','lexpress']]) {
  const canonicalUrl = `https://${host}/article-${id}`;
  const article = arcIdDepuisUrl(canonicalUrl);
  const calls = [];
  const content = await chargerArticle(article, { arcBase: 'https://arc.invalid', arcToken: 'fake', fetch: async url => {
    calls.push(url);
    return new Response(JSON.stringify({_id:id, websites:{[site]:{website_url:`/article-${id}`}}, headlines:{basic:'Titre'}, content_elements:[{type:'text',content:'Corps réel de fixture'}]}));
  }});
  assert.equal(new URL(calls[0]).searchParams.get('website'), site);
  assert.equal(content.source, 'arc');
  assert.equal(content.canonical_url, canonicalUrl);
  assert.equal(content.body, 'Corps réel de fixture');
}
for (const target of ['https://internal.invalid/', 'http://pl.lexpress.eu/', 'https://pl.lexpress.eu:443/', 'https://www.lexpress.eu/']) {
  let calls = 0;
  const result = await chargerArticle(arcIdDepuisUrl(example), {fetch:async () => {
    calls++; return new Response(null,{status:302,headers:{location:target}});
  }});
  assert.ok(result.erreur, target);
  assert.equal(calls, 1, 'refus avant requête vers la redirection');
}
console.log('Europe : hôtes, exemple PL, site Arc, corps, canonique et SSRF vérifiés.');

// Exécution du bundle réel avec Arc/base simulés : aucun appel réseau.
const { readFileSync } = await import('node:fs');
const { stripTypeScriptTypes } = await import('node:module');
const vm = await import('node:vm');
let handler;
const rpcCalls = [];
const source = readFileSync('gift-links/functions/create-gift-links/index.bundle.ts', 'utf8').replace(/^import .*jsr:.*;$/m, '');
const context = vm.createContext({
  URL, Response, Request, TextEncoder, crypto, console, Date, Set, Map,
  Deno: { env: {get: key => ({ARC_BASE:'https://arc.invalid', ARC_TOKEN:'fake'})[key]}, serve: value => { handler = value; } },
  createClient: () => ({rpc: async (name,args) => {
    rpcCalls.push({name,args});
    if (name === 'verify_api_client') return {data:[{ok:true,client_id:'fake-client',name:'fixture'}]};
    if (name === 'create_gift_links_for_edition') return {data:args.p_arc_ids.map(arc_id => ({arc_id, token:(arc_id === id ? 'a' : 'b').repeat(32),link:`https://articles.lexpress.${args.p_edition === 'EUR' ? 'eu' : 'fr'}/a/${(arc_id === id ? 'a' : 'b').repeat(32)}`, state:'created'}))};
    return {data:[]};
  }}),
  fetch: async value => {
    const url = new URL(value), site = url.searchParams.get('website');
    return new Response(JSON.stringify({_id:url.searchParams.get('_id'),websites:{[site]:{website_url:`/article-${url.searchParams.get('_id')}`}},headlines:{basic:'Fixture'},content_elements:[{type:'text',content:'Corps de fixture'}]}));
  },
});
vm.runInContext(stripTypeScriptTypes(source), context);
for (const host of ['pl.lexpress.eu','fr.lexpress.eu','www.lexpress.eu','www.lexpress.fr']) {
  rpcCalls.length = 0;
  const response = await handler(new Request('https://local.invalid', {method:'POST',headers:{'x-gift-service-token':'fake'},body:JSON.stringify({urls:[`https://${host}/article-${id}`]})}));
  assert.equal(response.status, 200);
  const result = await response.json(), edition = host.endsWith('.eu') ? 'EUR' : 'FR';
  assert.equal(result.links[0].edition, edition);
  const language = host.startsWith('pl.') ? 'pl' : host.startsWith('fr.') || edition === 'FR' ? 'fr' : 'en';
  assert.equal(result.links[0].language, language);
  assert.equal(rpcCalls.find(c=>c.name==='cache_articles').args.p_articles[0].language, language);
  assert.equal(result.links[0].content, 'full');
  assert.equal(result.links[0].link, `https://articles.lexpress.${edition === 'EUR' ? 'eu' : 'fr'}/a/${'a'.repeat(32)}`);
  assert.equal(rpcCalls.find(c=>c.name==='cache_articles').args.p_articles[0].edition, edition);
  assert.equal(rpcCalls.find(c=>c.name==='create_gift_links_for_edition').args.p_edition, edition);
}
console.log('Bundle : cache, création par édition, domaine de lecture et corps intégral vérifiés (simulés).');

// Même identifiant Arc publié sur plusieurs sites Europe : refus avant mise en cache.
const ambiguous = await chargerArticle(arcIdDepuisUrl(example), {arcBase:'https://arc.invalid',arcToken:'fake',fetch:async()=>new Response(JSON.stringify({_id:id,websites:{'lexpress-europe':{},'lexpress-europe-pl':{}},headlines:{basic:'Ambigu'},content_elements:[{type:'text',content:'Corps ambigu'}]}))});
assert.match(ambiguous.erreur,/plusieurs sites Europe/);
// L'alias sans www est normalisé vers son origine publique sans suivre le :443 du site.
let fallbackUrl;
await chargerArticle(arcIdDepuisUrl(`https://lexpress.eu/article-${id}`), {fetch:async url=>{fallbackUrl=url;return new Response('<meta property="og:title" content="Fixture">');}});
assert.equal(new URL(fallbackUrl).hostname,'www.lexpress.eu');
// Un og:url du bon site mais non normalisé (espace en tête) est stocké sous forme normalisée.
const spaced = await chargerArticle(arcIdDepuisUrl(example), {fetch:async()=>new Response(`<meta property="og:title" content="Fixture"><meta property="og:url" content=" https://PL.lexpress.eu/normalise-${id}">`)});
assert.equal(spaced.canonical_url,`https://pl.lexpress.eu/normalise-${id}`);
let redirects = 0;
const relative = await chargerArticle(arcIdDepuisUrl(example), {fetch:async()=>++redirects===1?new Response(null,{status:302,headers:{location:'/relative'}}):new Response('<meta property="og:title" content="Fixture">')});
assert.equal(relative.source,'page-publique');
assert.equal(redirects,2);
let endless = 0;
const loop = await chargerArticle(arcIdDepuisUrl(example), {fetch:async()=>{endless++;return new Response(null,{status:302,headers:{location:'/loop'}});}});
assert.ok(loop.erreur);
assert.equal(endless,5);
console.log('Europe : ambiguïté multisite refusée, alias public et limites des redirections vérifiés.');

// Deux traductions réelles d'un même sujet restent deux articles Arc indépendants.
rpcCalls.length = 0;
const frenchId = '5IZJUWHEXBCELAV4FGFPXU3LTQ';
const mixed = await handler(new Request('https://local.invalid', {method:'POST',headers:{'x-gift-service-token':'fake'},body:JSON.stringify({urls:[example,`https://fr.lexpress.eu/a-${frenchId}`,example]})}));
const mixedResult = await mixed.json();
assert.equal(mixed.status,200);
assert.equal(new Set(mixedResult.links.map(l=>l.arc_id)).size,2);
assert.equal(new Set(mixedResult.links.map(l=>l.token)).size,2);
const identifiers=rpcCalls.find(c=>c.name==='create_gift_links_for_edition').args.p_arc_ids;
assert.deepEqual([...identifiers].sort(),[id,frenchId].sort());
const cached=rpcCalls.find(c=>c.name==='cache_articles').args.p_articles;
assert.equal(cached.find(a=>a.arc_id===id).language,'pl');
assert.equal(cached.find(a=>a.arc_id===frenchId).language,'fr');
// Un même identifiant Arc demandé sous deux langues : refusé pour les deux, jamais un jeton à deux langues.
rpcCalls.length = 0;
const conflict = await handler(new Request('https://local.invalid', {method:'POST',headers:{'x-gift-service-token':'fake'},body:JSON.stringify({urls:[example,`https://www.lexpress.eu/a-${id}`,`https://fr.lexpress.eu/a-${frenchId}`]})}));
const conflictResult = await conflict.json();
assert.equal(conflict.status,200);
assert.deepEqual(conflictResult.links.map(l=>[l.arc_id,l.language]),[[frenchId,'fr']]);
assert.equal(conflictResult.rejected.length,2);
assert.ok(conflictResult.rejected.every(r=>/deux langues/.test(r.erreur)),JSON.stringify(conflictResult.rejected));
assert.ok(rpcCalls.filter(c=>c.name==='cache_articles').every(c=>c.args.p_articles.every(x=>x.arc_id!==id)),'rien mis en cache pour l’identifiant ambigu');
console.log('Fonction : lot FR/PL avec identifiants fournis, langues et liens distincts, répétition PL dédupliquée par Arc ID, identifiant sous deux langues refusé.');
