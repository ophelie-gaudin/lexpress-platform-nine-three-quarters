import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
for (const file of readdirSync('gift-links/supabase').filter(f=>/^\d.*\.sql$/.test(f)&&!f.startsWith('004')).sort()) await db.exec(readFileSync(`gift-links/supabase/${file}`,'utf8'));
const q = async (sql,args)=>(await db.query(sql,args)).rows;
const live = JSON.parse(readFileSync('docs/evidence/europe-database-contracts-20261116.json','utf8'));
for (const contract of live) {
  const rows = await q("SELECT pg_get_functiondef(p.oid) AS definition,pg_get_function_result(p.oid) AS result FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",[contract.name]);
  assert.ok(rows.some(r=>r.definition.replace(/\s+/g,' ')===contract.definition.replace(/\s+/g,' ')), `${contract.name} identique à la définition PROD observée`);
}
const id = '4DHUZG3CTFFJFLSPBD3XJ2O4TU';
for (const [host,edition] of [['pl.lexpress.eu','EUR'],['fr.lexpress.eu','EUR'],['www.lexpress.eu','EUR'],['www.lexpress.fr','FR']]) {
  // Fixtures distinctes comme les traductions publiques observées.
  const arc = id.slice(0,-1)+host[0].toUpperCase();
  await q('SELECT cache_articles($1::jsonb)',[JSON.stringify([{edition,arc_id:arc,canonical_url:`https://${host}/article-${arc}`,title:'Fixture',body:'Corps de fixture'}])]);
  const link = (await q('SELECT * FROM create_gift_links_for_edition($1,ARRAY[$2])',[edition,arc]))[0];
  for (const column of ['arc_id','token','link','state','expires_at']) assert.ok(Object.hasOwn(link,column),column);
  assert.equal(link.link,`https://articles.lexpress.${edition==='EUR'?'eu':'fr'}/a/${link.token}`);
  assert.equal(link.arc_id,arc);
}
await db.close();
console.log('Europe SQL : migrations rejouées, contrats comparés à PROD, création et origines réelles locales vérifiées.');
