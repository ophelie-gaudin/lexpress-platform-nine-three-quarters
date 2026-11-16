import {readFileSync,readdirSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const q=async(sql,args)=>(await db.query(sql,args)).rows;
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE operator BYPASSRLS;');
for(const f of readdirSync('gift-links/supabase').filter(f=>/^\d.*\.sql$/.test(f)&&!f.startsWith('004')&&f<'017').sort())await db.exec(readFileSync(`gift-links/supabase/${f}`,'utf8'));
await q("SELECT cache_articles($1::jsonb)",[JSON.stringify([{edition:'EUR',arc_id:'OLD',canonical_url:'https://www.lexpress.eu/old',title:'Old',body:'English'},{edition:'FR',arc_id:'OLD',canonical_url:'https://www.lexpress.fr/old',title:'Ancien',body:'Français'}])]);
const old=(await q("SELECT * FROM create_gift_links_for_edition('EUR',ARRAY['OLD'])"))[0];
const migration='gift-links/supabase/017-article-language.sql';
if(existsSync(migration))await db.exec(readFileSync(migration,'utf8'));
const defaults=await q('SELECT edition,language FROM articles ORDER BY edition');
assert.deepEqual(defaults,[{edition:'EUR',language:'en'},{edition:'FR',language:'fr'}]);
const unchanged=(await q('SELECT * FROM gift_links WHERE token=$1',[old.token]))[0];
assert.equal(new Date(unchanged.expires_at).toISOString(),new Date(old.expires_at).toISOString());
const pl='4DHUZG3CTFFJFLSPBD3XJ2O4TU',fr='5IZJUWHEXBCELAV4FGFPXU3LTQ';
await q('SELECT cache_articles($1::jsonb)',[JSON.stringify([{edition:'EUR',language:'pl',arc_id:pl,canonical_url:`https://pl.lexpress.eu/a-${pl}`,title:'PL',body:'Corps PL'},{edition:'EUR',language:'fr',arc_id:fr,canonical_url:`https://fr.lexpress.eu/a-${fr}`,title:'FR',body:'Corps FR'}])]);
const links=await q("SELECT * FROM create_gift_links_for_edition('EUR',ARRAY[$1,$2,$1])",[pl,fr]);
assert.equal(links.length,2);
assert.notEqual(links[0].token,links[1].token);
assert.notEqual(links[0].link,links[1].link);
for(const link of links){
 const read=(await q("SELECT * FROM get_gift_article_for_edition_v2('EUR',$1)",[link.token]))[0];
 assert.equal(read.language,link.arc_id===pl?'pl':'fr');
 assert.equal(read.body,link.arc_id===pl?'Corps PL':'Corps FR');
 const opens=(await q('SELECT opens FROM gift_links WHERE token=$1',[link.token]))[0].opens;
 assert.equal(opens,1,'la RPC v2 journalise une seule lecture');
 await db.exec('SET ROLE anon');
 const publicRead=(await q("SELECT * FROM get_gift_article_for_edition_v2('EUR',$1)",[link.token]))[0];
 assert.equal(publicRead.language,read.language);
 await assert.rejects(q('SELECT * FROM articles'));
 await db.exec('RESET ROLE');
 assert.match(link.link,/^https:\/\/articles\.lexpress\.eu\/a\//);
 const cross=(await q("SELECT * FROM get_gift_article_for_edition_v2('FR',$1)",[link.token]))[0];
 assert.equal(cross.status,'unknown');assert.equal(cross.language,null);
}
await q('SELECT cache_articles($1::jsonb)',[JSON.stringify([{edition:'EUR',arc_id:pl,title:'Actualisé',body:null}])]);
assert.equal((await q('SELECT language FROM articles WHERE edition=$1 AND arc_id=$2',['EUR',pl]))[0].language,'pl');
await q("INSERT INTO articles(edition,arc_id,canonical_url,title) VALUES ('EUR','DEFAULT_EUR','https://www.lexpress.eu/default','default'),('FR','DEFAULT_FR','https://www.lexpress.fr/default','default')");
assert.deepEqual(await q("SELECT language FROM articles WHERE arc_id LIKE 'DEFAULT_%' ORDER BY edition"),[{language:'en'},{language:'fr'}]);
await assert.rejects(q("UPDATE articles SET language='xx' WHERE arc_id=$1",[pl]));
await assert.rejects(q("UPDATE articles SET language='pl' WHERE edition='FR'"));
// Revue adverse du 16/11 : la langue d'origine ne change pas et reste cohérente avec l'adresse canonique.
const row=async id=>(await q('SELECT language,canonical_url FROM articles WHERE edition=$1 AND arc_id=$2',['EUR',id]))[0];
const cache=rows=>q('SELECT cache_articles($1::jsonb)',[JSON.stringify(rows)]);
await assert.rejects(cache([{edition:'EUR',language:'en',arc_id:pl,canonical_url:'https://www.lexpress.eu/a-'+pl,title:'EN'}]),/langue/,'une ligne pl ne bascule pas en en');
await assert.rejects(cache([{edition:'EUR',arc_id:pl,canonical_url:'https://www.lexpress.eu/a-'+pl,title:'ancien appelant'}]),/langue/,'un ancien appelant ne déplace pas la canonique vers un autre hôte');
assert.deepEqual(await row(pl),{language:'pl',canonical_url:`https://pl.lexpress.eu/a-${pl}`});
await assert.rejects(cache([{edition:'EUR',language:'pl',arc_id:'INCOHERENT',canonical_url:'https://www.lexpress.eu/incoherent',title:'x'}]),/articles_language_check/,'langue et hôte canonique incohérents');
assert.equal(await row('INCOHERENT'),undefined);
await cache([{edition:'EUR',arc_id:'LEGACY_PL',canonical_url:'https://pl.lexpress.eu/legacy',title:'sans langue'},{edition:'EUR',arc_id:'LEGACY_EN',canonical_url:'https://lexpress.eu/legacy',title:'sans langue'}]);
assert.equal((await row('LEGACY_PL')).language,'pl');assert.equal((await row('LEGACY_EN')).language,'en');
await assert.rejects(q('UPDATE articles SET language=NULL WHERE arc_id=$1',[pl]),/null value|not-null/i,'une langue effacée est refusée, pas remplacée en silence');
await assert.rejects(q("UPDATE articles SET canonical_url='https://www.lexpress.eu/x' WHERE arc_id=$1",[pl]),/articles_language_check/,'canonique et langue restent liées');
// Chemin réel : la fonction écrit sous service_role, la purge aussi ; un autre rôle doté des droits
// de table (correction manuelle) ne doit pas être bloqué par la contrainte.
// Supabase accorde par défaut les droits de table à service_role ; les migrations locales non.
await db.exec('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT SELECT,INSERT,UPDATE ON public.articles TO operator; SET ROLE service_role');
await cache([{edition:'EUR',language:'pl',arc_id:'ROLE_PL',canonical_url:'https://pl.lexpress.eu/role',title:'rôle',body:'Corps'},{edition:'EUR',arc_id:'ROLE_V24',canonical_url:'https://www.lexpress.eu/role',title:'v24 sans langue',body:'Body'}]);
await q('SELECT purge_withdrawn_bodies(7)');
await db.exec('SET ROLE operator');
await q("UPDATE articles SET title='corrigé' WHERE arc_id='ROLE_PL'");
await db.exec('RESET ROLE');
assert.equal((await row('ROLE_PL')).language,'pl');assert.equal((await row('ROLE_V24')).language,'en');
// Une ancienne valeur fausse (première version de 017 : tout EUR = en) est réparée au rejeu.
await db.exec("ALTER TABLE articles DROP CONSTRAINT articles_language_check; UPDATE articles SET language='en' WHERE arc_id='ROLE_PL'");
await db.exec(readFileSync(migration,'utf8'));
assert.equal((await row('ROLE_PL')).language,'pl');
// Retour arrière puis ré-application : les langues PL/FR sont retrouvées par l'hôte canonique.
await db.exec(readFileSync('gift-links/supabase/rollback/017-article-language.sql','utf8'));
await db.exec(readFileSync(migration,'utf8'));
assert.equal((await row(pl)).language,'pl');assert.equal((await row(fr)).language,'fr');assert.equal((await row('OLD')).language,'en');
for(const link of links){
 const again=(await q("SELECT * FROM get_gift_article_for_edition_v2('EUR',$1)",[link.token]))[0];
 assert.equal(again.language,link.arc_id===pl?'pl':'fr','lien diffusé toujours lisible après retour arrière puis ré-application');
}
await db.exec(readFileSync(migration,'utf8')); // rejouable, conserve les langues explicites
assert.equal((await q('SELECT language FROM articles WHERE arc_id=$1',[pl]))[0].language,'pl');
await db.exec(readFileSync('gift-links/supabase/rollback/017-article-language.sql','utf8'));
assert.equal((await q("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='articles' AND column_name='language'"))[0].n,0);
assert.equal((await q("SELECT count(*)::int AS n FROM gift_links WHERE token=$1",[old.token]))[0].n,1);
await db.close();
console.log('Langues SQL : défauts EUR/FR, langue immuable et liée à la canonique, migration rejouable après retour arrière, identifiants PL/FR et liens distincts, lecture v2, refus croisés et rollback vérifiés.');
