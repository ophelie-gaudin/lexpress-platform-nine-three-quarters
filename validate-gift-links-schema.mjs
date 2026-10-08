// Liens offerts, lot 1 : ce test porte sur ce que la page publique NE PEUT PAS faire.
//
// Le token est la seule protection d'un article premium. S'il suffit de lire `articles` pour obtenir le
// corps, le token ne protège plus rien — il suffirait d'énumérer la table.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let n = 0; const check = (c, l) => { assert.ok(c, l); n++; };

const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
await db.exec(readFileSync('gift-links/supabase/001-schema.sql', 'utf8'));
await db.exec(readFileSync('gift-links/supabase/002-author.sql', 'utf8'));
await db.exec(readFileSync('gift-links/supabase/003-un-lien-par-article.sql', 'utf8'));
await db.exec(readFileSync('gift-links/supabase/005-identifiant-envoi.sql', 'utf8'));
await db.exec(readFileSync('gift-links/supabase/006-clients-api.sql', 'utf8'));
await db.exec(readFileSync('gift-links/supabase/007-attribution-liens.sql', 'utf8'));
await db.exec(readFileSync('gift-links/supabase/008-noms-anglais.sql', 'utf8'));
await db.exec(readFileSync('gift-links/supabase/009-attribution-par-envoi.sql', 'utf8'));

const q = async (sql, params) => (await db.query(sql, params)).rows;

await q(`INSERT INTO articles (arc_id, canonical_url, title, standfirst, image_url, body, section, published_at)
         VALUES ('LQBW5JK75BDOBJHRA76NRFPJFY', 'https://www.lexpress.fr/secret-defense/a-LQBW5JK75BDOBJHRA76NRFPJFY',
                 'La DGSE investit dans l''IA', 'Les maîtres-espions se confessent', 'https://img/1.jpg',
                 'Corps réservé aux abonnés.', 'secret-defense', now() - interval '2 days'),
                ('SANSCORPS0000000000000000A', 'https://www.lexpress.fr/france/b-SANSCORPS0000000000000000A',
                 'Un titre sans corps', 'Le chapeau', 'https://img/2.jpg', NULL, 'france', now() - interval '1 day')`);

// ── CRÉATION.
const liens = await q(`SELECT * FROM create_gift_links(ARRAY['LQBW5JK75BDOBJHRA76NRFPJFY','SANSCORPS0000000000000000A'])`);
check(liens.length === 2, 'un lien par article demandé');
check(liens.every((l) => /^[0-9a-f]{32}$/.test(l.token)), 'le token est opaque : 32 caractères hexadécimaux, 128 bits');
check(new Set(liens.map((l) => l.token)).size === 2, 'deux articles, deux tokens distincts');
{
  // Le token est stable PAR ARTICLE (003) : c'est voulu. Ce qui doit rester imprévisible, c'est le lien
  // entre un article et son token — sinon la page serait aspirable par énumération.
  const encore = await q(`SELECT token, state FROM create_gift_links(ARRAY['LQBW5JK75BDOBJHRA76NRFPJFY'])`);
  check(encore[0].token === liens.find((l) => l.arc_id === 'LQBW5JK75BDOBJHRA76NRFPJFY').token,
    'redemander le même article rend le même token');
  check(liens[0].token !== liens[1].token, 'mais deux articles ont deux tokens distincts');
  for (const l of liens)
    check(!l.token.includes(l.arc_id.toLowerCase().slice(0, 8)),
      'C’EST LA PROPRIÉTÉ QUI COMPTE : le token ne dérive pas de l’identifiant de l’article — sinon il suffirait de le calculer');
}
{
  const j = Math.round((new Date(liens[0].expires_at) - Date.now()) / 86400000);
  check(j === 15, `expiration par défaut à quinze jours — obtenu ${j}`);
}

// ── CE QUI DOIT ÉCHOUER BRUYAMMENT.
for (const [cas, sql] of [
  ['article absent du cache', `SELECT * FROM create_gift_links(ARRAY['INCONNU00000000000000000A'])`],
  ['aucun article demandé', `SELECT * FROM create_gift_links(ARRAY[]::text[])`],
  ['expiration déjà passée', `SELECT * FROM create_gift_links(ARRAY['LQBW5JK75BDOBJHRA76NRFPJFY'], now() - interval '1 hour')`],
]) {
  let leve = false;
  try { await q(sql); } catch { leve = true; }
  check(leve, `C’EST LA PROPRIÉTÉ QUI COMPTE : ${cas} lève une erreur — sinon l’appelant croit avoir trois liens et n’en envoie que deux`);
}

// ── LECTURE : LES CINQ ÉTATS.
const tokenPlein = liens.find((l) => l.arc_id === 'LQBW5JK75BDOBJHRA76NRFPJFY').token;
const tokenVide = liens.find((l) => l.arc_id === 'SANSCORPS0000000000000000A').token;
const lire = async (t) => (await q('SELECT * FROM get_gift_article($1)', [t]))[0];

{
  const r = await lire(tokenPlein);
  check(r.status === 'ok' && r.body === 'Corps réservé aux abonnés.', 'un lien valide rend l’article complet');
  const p = await lire(tokenVide);
  check(p.status === 'preview' && p.body === null && p.title === 'Un titre sans corps' && p.image_url === 'https://img/2.jpg',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : sans corps, l’aperçu est un ÉTAT à part entière — titre, chapeau, image — et non une erreur');

  check((await lire('00000000000000000000000000000000')).status === 'unknown', 'un token inconnu : « unknown »');
  check((await lire('pas-un-token')).status === 'unknown', 'un token mal formé ne fait pas tomber la requête');
  check((await lire(null)).status === 'unknown', 'un token nul non plus');
}
{
  await q('UPDATE gift_links SET expires_at = now() - interval $$1 minute$$ WHERE token = $1', [tokenPlein]);
  const r = await lire(tokenPlein);
  check(r.status === 'expired' && r.body === null && r.title === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : passée la date, plus RIEN ne sort — ni corps, ni titre');

  await q('UPDATE gift_links SET expires_at = now() + interval $$1 day$$, withdrawn_at = now() WHERE token = $1', [tokenPlein]);
  const w = await lire(tokenPlein);
  check(w.status === 'withdrawn' && w.body === null,
    'un retrait manuel coupe l’accès même si la date est encore valable — article corrigé, dépublié ou retiré sur demande');
  check(w.status !== 'expired', '« expiré » et « retiré » restent deux statuts distincts : ils ne racontent pas la même histoire au lecteur');
}

// ── LA MESURE NE COMPTE QUE LES VRAIES LECTURES.
{
  const avant = Number((await q('SELECT opens FROM gift_links WHERE token = $1', [tokenVide]))[0].opens);
  await lire(tokenVide); await lire(tokenVide);
  const apres = Number((await q('SELECT opens, last_opened_at FROM gift_links WHERE token = $1', [tokenVide]))[0].opens);
  check(apres === avant + 2, 'chaque ouverture incrémente le compteur');
  check(Number((await q('SELECT count(*) AS n FROM gift_link_opens WHERE token = $1', [tokenVide]))[0].n) === apres,
    'et laisse une ligne dans le journal d’ouvertures');

  const ouverturesRefus = Number((await q('SELECT count(*) AS n FROM gift_link_opens WHERE token = $1', [tokenPlein]))[0].n);
  check(ouverturesRefus === 1,
    `C’EST LA PROPRIÉTÉ QUI COMPTE : un lien expiré ou retiré n’est pas une lecture — seule l’ouverture valide a été comptée (obtenu ${ouverturesRefus})`);
}

// ── LES DROITS : UNE SEULE PORTE OUVERTE À `anon`.
{
  const droit = async (role, objet, priv) =>
    (await q('SELECT has_table_privilege($1, $2, $3) AS ok', [role, objet, priv]))[0].ok;
  for (const t of ['articles', 'gift_links', 'gift_link_opens'])
    check(!(await droit('anon', t, 'SELECT')),
      `C’EST LA PROPRIÉTÉ QUI COMPTE : anon ne peut PAS lire ${t} — sinon le token ne protège plus rien, il suffirait d’énumérer la table`);

  const exec = async (role, sig) => (await q('SELECT has_function_privilege($1, $2, $3) AS ok', [role, sig, 'EXECUTE']))[0].ok;
  check(await exec('anon', 'get_gift_article(text,text,text,text,text,text)'), 'anon peut appeler get_gift_article : c’est la page publique — signature de la migration 005, dont le DROP avait emporté les droits');
  // Signature de la migration 007 : un paramètre de plus, le service qui demande.
  check(!(await exec('anon', 'create_gift_links(text[],timestamptz,uuid)')),
    'mais PAS create_gift_links : une page publique ne fabrique pas de liens');
  check(!(await exec('authenticated', 'create_gift_links(text[],timestamptz,uuid)')),
    'ni authenticated : seul le service, par service_role');

  const def = (await q("SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'get_gift_article'"))[0];
  check(def.prosecdef === true, 'get_gift_article est SECURITY DEFINER : c’est ce qui lui permet de lire des tables fermées');
  check(String(def.proconfig).includes('search_path'),
    'et son search_path est figé — sans cela, un objet homonyme créé par l’appelant détournerait la fonction');

  for (const t of ['articles', 'gift_links', 'gift_link_opens'])
    check((await q('SELECT relrowsecurity AS on FROM pg_class WHERE relname = $1', [t]))[0].on === true,
      `RLS activée sur ${t}`);
}

// ── LA SIGNATURE ET L'ATTRIBUTION (002).
{
  // Un article NEUF : le token étant stable par article (003), réutiliser le précédent rendrait son
  // lien déjà coupé.
  await q(`INSERT INTO articles (arc_id, canonical_url, title, body, author)
           VALUES ('SIGNE00000000000000000001', 'https://x', 'Signé', 'Un corps.', 'Laureline Dupont')`);
  const tokenPlein2 = (await q(`SELECT token FROM create_gift_links(ARRAY['SIGNE00000000000000000001'])`))[0].token;
  const r = await lire(tokenPlein2);
  check(r.author === 'Laureline Dupont', 'la signature remonte jusqu’à la page');
  check(!('campaign' in r),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : la lecture ne rend AUCUNE campagne — le lien est commun à tous ses destinataires, lui en coller une attribuait toutes les lectures à la dernière déclarée');

  const sansAuteur = await lire(tokenVide);
  check(sansAuteur.author === null, 'une signature inconnue vaut null : la page affiche la date seule, elle n’invente pas de nom');

  await q('UPDATE gift_links SET withdrawn_at = now() WHERE token = $1', [tokenPlein2]);
  const coupe = await lire(tokenPlein2);
  check(coupe.status === 'withdrawn' && coupe.title === null,
    'un lien coupé ne rend toujours rien de l’article');
  check(!('campaign' in coupe),
    'un refus non plus ne rend de campagne : la page tient le segment de SON visiteur dans sa query string, elle n’a rien à relire ici');
}

// ── UN LIEN PAR ARTICLE, PROLONGÉ PLUTÔT QUE RECRÉÉ (003).
//
// Ce que ça protège : un lien déjà diffusé reste valable. Le recréer rendrait mort celui que la personne
// a reçu hier, pendant qu'un autre circule.
{
  const creer = async (arcs, jours) => (await db.query(
    'SELECT * FROM create_gift_links($1::text[], $2)',
    [arcs, jours === null ? null : new Date(Date.now() + jours * 86400000).toISOString()])).rows;

  await q(`INSERT INTO articles (arc_id, canonical_url, title) VALUES ('STABLE00000000000000000001', 'https://x', 'Stable')`);

  const a1 = await creer(['STABLE00000000000000000001'], 15);
  check(a1[0].state === 'created', 'premier appel : lien créé');

  const a2 = await creer(['STABLE00000000000000000001'], 15);
  check(a2[0].token === a1[0].token,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : redemander le même article rend le MÊME lien — sinon celui qu’on a diffusé hier meurt pendant qu’un autre circule');
  check(a2[0].state === 'extended' && new Date(a2[0].expires_at) >= new Date(a1[0].expires_at),
    'redemander « 15 jours » repousse bien la fin à quinze jours À PARTIR DE MAINTENANT : c’est une prolongation, pas un non-événement');

  const a3 = await creer(['STABLE00000000000000000001'], 30);
  check(a3[0].token === a1[0].token && a3[0].state === 'extended', 'une demande plus lointaine prolonge le même lien');
  check(new Date(a3[0].expires_at) > new Date(a1[0].expires_at), 'la date est bien repoussée');
  check((await q("SELECT extended_at FROM gift_links WHERE token = $1", [a1[0].token]))[0].extended_at !== null,
    'et la prolongation est datée');

  // « unchanged » ne se produit que là : on demande MOINS de temps qu'il n'en reste.
  const a4 = await creer(['STABLE00000000000000000001'], 10);
  check(a4[0].state === 'unchanged' && new Date(a4[0].expires_at).getTime() === new Date(a3[0].expires_at).getTime(),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : on ne RACCOURCIT jamais — quelqu’un a peut-être reçu le lien avec la promesse plus longue');

  // Un lien expiré se rouvre : c'est le cas décrit par Ophélie (expiré le 2 janvier, redemandé en mars).
  await q('UPDATE gift_links SET expires_at = now() - interval $$60 days$$ WHERE token = $1', [a1[0].token]);
  const a5 = await creer(['STABLE00000000000000000001'], 10);
  check(a5[0].token === a1[0].token && a5[0].state === 'extended', 'un lien expiré depuis longtemps se rouvre, avec le même token');
  check((await lire(a1[0].token)).status !== 'expired', 'et redevient lisible');

  // Un lien RETIRÉ ne se rouvre pas.
  await q('UPDATE gift_links SET withdrawn_at = now() WHERE token = $1', [a1[0].token]);
  const a6 = await creer(['STABLE00000000000000000001'], 30);
  check(a6[0].state === 'withdrawn' && a6[0].token === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un appel d’API ne défait PAS un retrait éditorial — article corrigé, dépublié ou retiré sur demande');
  check((await lire(a1[0].token)).status === 'withdrawn', 'et le lien reste coupé');

  // L'unicité est garantie par la base, pas seulement par la fonction.
  let doublonRefuse = false;
  try {
    await q("INSERT INTO gift_links (token, arc_id, expires_at) VALUES ('ffffffffffffffffffffffffffffffff', 'STABLE00000000000000000001', now() + interval '1 day')");
  } catch { doublonRefuse = true; }
  check(doublonRefuse, 'deux liens pour un même article sont refusés par la contrainte, pas seulement par la fonction');
}

// ── 005 : l'identifiant d'ENVOI rend une lecture attribuable.
//
// Le token est partagé par article (003) : lui seul ne dit jamais QUI a lu. Ces cas-là éprouvent que
// l'ouverture porte désormais l'envoi, et surtout qu'une query string bricolée ne casse rien.
{
  // Un article NEUF : le token est stable par article (003), donc réutiliser un token déjà éprouvé plus
  // haut le trouverait coupé ou expiré.
  await q(`INSERT INTO articles (arc_id, canonical_url, title, body, author)
           VALUES ('ENVOI00000000000000000001', 'https://x/envoi', 'Attribué', 'Un corps.', 'Corentin Pennarguear')`);
  const lien = (await q(`SELECT token FROM create_gift_links(ARRAY['ENVOI00000000000000000001'])`))[0].token;
  const envoi = 'a'.repeat(32);

  // L'appel historique, qui ne nomme que quatre arguments, doit continuer de fonctionner : c'est ce qui
  // permet d'appliquer la migration AVANT la mise à jour de la page.
  const ancien = await q(`SELECT status FROM get_gift_article($1, 'Whatsapp', 'prospects', NULL)`, [lien]);
  check(ancien[0].status === 'ok', "005 : l'appel à quatre arguments marche encore (déploiement sans fenêtre de casse)");

  await q(`SELECT 1 FROM get_gift_article($1, 'Whatsapp', 'prospects', NULL, $2, 'prospects_chauds')`, [lien, envoi]);
  const vu = await q(`SELECT send_id, campaign_group, utm_source FROM gift_link_opens WHERE send_id = $1`, [envoi]);
  check(vu.length === 1, "005 : l'ouverture est attribuée à l'envoi");
  check(vu[0].campaign_group === 'prospects_chauds', '005 : le segment est conservé');
  check(vu[0].utm_source === 'Whatsapp', '005 : at_medium est conservé dans utm_source');

  // UNE URL BRICOLÉE NE DOIT PAS FAIRE TOMBER LA PAGE. Pas de contrainte CHECK : on range NULL.
  const sale = await q(`SELECT status FROM get_gift_article($1, NULL, NULL, NULL, 'pas-un-identifiant', 'Segment Inconnu !')`, [lien]);
  check(sale[0].status === 'ok', "005 : une query string bricolée sert quand même l'article");
  const range = await q(`SELECT send_id, campaign_group FROM gift_link_opens ORDER BY id DESC LIMIT 1`);
  check(range[0].send_id === null && range[0].campaign_group === null, '005 : une valeur douteuse est rangée à NULL, jamais rejetée');

  // Un lien expiré ne compte toujours pas, identifiant d'envoi ou non.
  const avant = (await q(`SELECT count(*)::int AS n FROM gift_link_opens`))[0].n;
  await q(`UPDATE gift_links SET expires_at = now() - interval '1 day' WHERE token = $1`, [lien]);
  const expire = await q(`SELECT status FROM get_gift_article($1, NULL, NULL, NULL, $2, NULL)`, [lien, 'b'.repeat(32)]);
  check(expire[0].status === 'expired', '005 : un lien expiré reste expiré');
  const apres = (await q(`SELECT count(*)::int AS n FROM gift_link_opens`))[0].n;
  check(apres === avant, "005 : un lien expiré n'est toujours pas compté comme une lecture");
  await q(`UPDATE gift_links SET expires_at = now() + interval '30 days' WHERE token = $1`, [lien]);
}


// ── 006 : un jeton par service appelant.
//
// CE QUE CES CAS DÉFENDENT. Le jeton en clair ne doit jamais arriver en base — la fonction Edge n'envoie
// que son empreinte. Et révoquer un service ne doit couper que lui.
{
  const sha = (t) => createHash('sha256').update(t).digest('hex');
  const verifier = async (empreinte) => (await q('SELECT * FROM verify_api_client($1)', [empreinte]))[0];

  const idA = (await q('SELECT create_api_client($1,$2,$3) AS id', ['service-a', sha('jeton-a'), 'premier service']))[0].id;
  await q('SELECT create_api_client($1,$2,$3)', ['service-b', sha('jeton-b'), null]);

  check(!!idA, 'un client se crée et porte un identifiant');
  const enBase = await q('SELECT name, token_sha256 FROM api_clients ORDER BY name');
  check(enBase.every((c) => /^[0-9a-f]{64}$/.test(c.token_sha256)),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : la table ne porte que des empreintes — lire api_clients ne donne aucun jeton utilisable');
  check(!enBase.some((c) => c.token_sha256 === 'jeton-a' || c.token_sha256 === 'jeton-b'),
    'et surtout pas le jeton en clair');

  const a = await verifier(sha('jeton-a'));
  check(a.ok === true && a.name === 'service-a', 'un jeton valide identifie son service');
  check((await verifier(sha('inconnu'))).ok === false, 'un jeton inconnu est refusé');
  check((await verifier('pas-une-empreinte')).ok === false, 'une empreinte mal formée est refusée sans interroger la table');

  // RÉVOQUER N'EN COUPE QU'UN.
  check((await q('SELECT revoke_api_client($1) AS fait', ['service-a']))[0].fait === true, 'la révocation aboutit');
  check((await verifier(sha('jeton-a'))).ok === false, 'le service révoqué est refusé');
  check((await verifier(sha('jeton-b'))).ok === true,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : révoquer un service ne coupe que lui — c’est tout l’intérêt d’un jeton par appelant');
  check((await q('SELECT revoke_api_client($1) AS fait', ['service-a']))[0].fait === false,
    'révoquer deux fois ne ment pas : la seconde rend false');

  const revoque = (await q(`SELECT active, revoked_at FROM api_clients WHERE name = 'service-a'`))[0];
  check(revoque.active === false && revoque.revoked_at !== null,
    'la ligne RESTE après révocation : on garde la trace de ce que ce service a créé');

  // LE COMPTAGE, qui prépare un plafond sans l'imposer aujourd'hui.
  const avant = (await q(`SELECT calls FROM api_clients WHERE name = 'service-b'`))[0].calls;
  await verifier(sha('jeton-b'));
  const apres = (await q(`SELECT calls, last_used_at FROM api_clients WHERE name = 'service-b'`))[0];
  check(apres.calls === avant + 1 && apres.last_used_at !== null, 'chaque appel est compté et daté');

  const idB = (await q(`SELECT id FROM api_clients WHERE name = 'service-b'`))[0].id;
  await q('SELECT count_client_links($1,$2)', [idB, 3]);
  await q('SELECT count_client_links($1,$2)', [idB, -5]);
  check((await q(`SELECT links_created FROM api_clients WHERE name = 'service-b'`))[0].links_created === 3,
    'les liens sont comptés, et un nombre négatif n’enlève rien');

  await assert.rejects(() => db.query('SELECT create_api_client($1,$2,NULL)', ['service-c', 'TROP-COURT']),
    'une empreinte hors forme est refusée par la contrainte'); n++;
  await assert.rejects(() => db.query('SELECT create_api_client($1,$2,NULL)', ['service-b', sha('autre')]),
    'deux services ne peuvent pas porter le même nom'); n++;
}


// ── 007 : qui a créé ce lien, qui l'a prolongé.
{
  const sha = (t) => createHash('sha256').update(t).digest('hex');
  const idX = (await q('SELECT create_api_client($1,$2,NULL) AS id', ['service-x', sha('x')]))[0].id;
  const idY = (await q('SELECT create_api_client($1,$2,NULL) AS id', ['service-y', sha('y')]))[0].id;

  await q(`INSERT INTO articles (arc_id, canonical_url, title, body)
           VALUES ('ATTRIB0000000000000000001','https://x/a','Attribué','Un corps.')`);
  const jours = (n) => new Date(Date.now() + n * 86400000).toISOString();

  // X crée.
  const c = await q(`SELECT * FROM create_gift_links(ARRAY['ATTRIB0000000000000000001'],$1::timestamptz,$2::uuid)`, [jours(10), idX]);
  check(c[0].state === 'created', 'X crée le lien');
  let l = (await q(`SELECT created_by, updated_by, updated_at FROM gift_links WHERE arc_id='ATTRIB0000000000000000001'`))[0];
  check(l.created_by === idX && l.updated_by === idX && l.updated_at !== null, 'le créateur est inscrit, et il est aussi le dernier intervenant');

  // Y prolonge : le créateur NE CHANGE PAS, le dernier intervenant si.
  const e = await q(`SELECT * FROM create_gift_links(ARRAY['ATTRIB0000000000000000001'],$1::timestamptz,$2::uuid)`, [jours(40), idY]);
  check(e[0].state === 'extended', 'Y prolonge');
  l = (await q(`SELECT created_by, updated_by FROM gift_links WHERE arc_id='ATTRIB0000000000000000001'`))[0];
  check(l.created_by === idX, 'C’EST LA PROPRIÉTÉ QUI COMPTE : le créateur reste le créateur, même quand un autre prolonge');
  check(l.updated_by === idY, 'et le dernier intervenant devient celui qui a repoussé la date');

  // X redemande une durée plus courte : rien ne change, donc personne n'a « modifié ».
  const u = await q(`SELECT * FROM create_gift_links(ARRAY['ATTRIB0000000000000000001'],$1::timestamptz,$2::uuid)`, [jours(5), idX]);
  check(u[0].state === 'unchanged', 'une durée plus courte ne raccourcit rien');
  l = (await q(`SELECT updated_by FROM gift_links WHERE arc_id='ATTRIB0000000000000000001'`))[0];
  check(l.updated_by === idY,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : demander sans rien changer ne fait pas de vous le dernier intervenant — sinon la colonne dirait « dernier à avoir demandé », pas « dernier à avoir modifié »');

  // Sans service nommé (appelant d'héritage), l'attribution reste vide plutôt que devinée.
  await q(`INSERT INTO articles (arc_id, canonical_url, title, body) VALUES ('HERITAGE00000000000000001','https://x/b','H','C.')`);
  await q(`SELECT create_gift_links(ARRAY['HERITAGE00000000000000001'],$1::timestamptz,NULL)`, [jours(10)]);
  check((await q(`SELECT created_by FROM gift_links WHERE arc_id='HERITAGE00000000000000001'`))[0].created_by === null,
    'sans service nommé, l’attribution reste NULL : une absence honnête, pas une attribution devinée');

  const vue = await q(`SELECT created_by, updated_by FROM gift_links_by_client WHERE arc_id='ATTRIB0000000000000000001'`);
  check(vue[0].created_by === 'service-x' && vue[0].updated_by === 'service-y',
    'la vue gift_links_by_client rend les NOMS, sans jointure à réécrire');

  check((await q("SELECT count(*)::int c FROM pg_proc WHERE proname='create_gift_links'"))[0].c === 1,
    'une seule fonction create_gift_links : le DROP a bien précédé le CREATE');
  check((await q("SELECT has_function_privilege('service_role','public.create_gift_links(text[],timestamptz,uuid)','EXECUTE') AS ok"))[0].ok,
    'et le rôle de service a retrouvé son droit — un DROP les emporte');
}


// ── 008 : le schéma entier parle anglais.
//
// POURQUOI UN TEST ET PAS UNE RELECTURE. Les migrations 001 à 005 étaient en anglais, 006 et 007 ont
// glissé vers le français sans que personne le remarque avant la mise en production. Un service
// extérieur lit ce schéma : il ne doit pas avoir à deviner deux langues. Ce cas le vérifie
// mécaniquement, pour les colonnes À VENIR autant que pour celles d'aujourd'hui.
{
  // Mots français rencontrés dans ce dépôt. Aucun n'est un morceau de mot anglais : le découpage se fait
  // sur les tirets bas, donc `created_at` ne déclenche pas `cree`.
  // Chaque entrée est un mot français SANS homographe anglais : `revocation` et `utilisation` sont
  // aussi des mots anglais et n'ont donc rien à faire ici — ils donneraient de fausses alertes.
  const francais = new Set([
    'nom', 'noms', 'actif', 'cree', 'creee', 'maj', 'lien', 'liens', 'appel', 'appels',
    'revoque', 'derniere', 'dernier', 'titre', 'jeton', 'jetons', 'envoi', 'envois', 'etat',
    'auteur', 'chapeau', 'rubrique', 'ouverture', 'ouvertures', 'motif',
  ]);
  const mots = (id) => id.split('_').filter(Boolean);

  const objets = await q(`
    SELECT 'colonne ' || table_name || '.' || column_name AS ou, column_name AS id
      FROM information_schema.columns WHERE table_schema = 'public'
    UNION ALL
    SELECT 'table ' || table_name, table_name FROM information_schema.tables WHERE table_schema = 'public'
    UNION ALL
    SELECT 'fonction ' || p.proname, p.proname FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public'
    UNION ALL
    SELECT 'contrainte ' || c.conname, c.conname FROM pg_constraint c
      JOIN pg_namespace ns ON ns.oid = c.connamespace WHERE ns.nspname = 'public'
    UNION ALL
    SELECT 'index ' || indexname, indexname FROM pg_indexes WHERE schemaname = 'public'`);

  const fautifs = objets.filter((o) => mots(o.id).some((m) => francais.has(m))).map((o) => o.ou);
  check(fautifs.length === 0,
    `C’EST LA PROPRIÉTÉ QUI COMPTE : aucun nom français dans le schéma public — trouvés : ${fautifs.join(', ')}`);

  // LES VALEURS AUSSI. Le motif de refus repart vers les journaux de l'appelant.
  const motifs = [
    (await q('SELECT * FROM verify_api_client($1)', ['pas-une-empreinte']))[0].reason,
    (await q('SELECT * FROM verify_api_client($1)', [createHash('sha256').update('jamais-vu').digest('hex')]))[0].reason,
    (await q('SELECT * FROM verify_api_client($1)', [createHash('sha256').update('jeton-a').digest('hex')]))[0].reason,
  ];
  check(motifs.join(' | ') === 'malformed digest | unknown token | revoked token',
    `les motifs de refus sont en anglais — reçus : ${motifs.join(' | ')}`);

  // LE RENOMMAGE N'A RIEN PERDU. Les lignes de 006 et 007 sont toujours là, avec leurs compteurs.
  const b = (await q(`SELECT calls, links_created, active FROM api_clients WHERE name = 'service-b'`))[0];
  check(b.links_created === 3 && b.calls >= 1 && b.active === true,
    'renommer a gardé les données : les compteurs du service-b ont survécu à ALTER ... RENAME');

  // REJOUABLE. Les gardes du 008 existent parce que RENAME COLUMN n'accepte pas IF EXISTS : sans elles,
  // une base déjà migrée casserait au second passage.
  await db.exec(readFileSync('gift-links/supabase/008-noms-anglais.sql', 'utf8'));
  check((await q(`SELECT count(*)::int c FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='api_clients' AND column_name='name'`))[0].c === 1,
    'le 008 se rejoue sans casser : chaque renommage est gardé');

  // MAIS REJOUER UNE MIGRATION ANCIENNE RESSUSCITE SA SIGNATURE. Le 008 vient de recréer
  // `create_gift_links` à cinq paramètres, que le 009 avait remplacée par celle à trois. Les migrations
  // sont en avant seulement : après avoir rejoué une ancienne, il faut rejouer les suivantes.
  check((await q("SELECT count(*)::int c FROM pg_proc WHERE proname = 'create_gift_links'"))[0].c === 2,
    'rejouer le 008 seul laisse DEUX create_gift_links — une migration en avant seulement ne se rejoue pas isolément');
  await db.exec(readFileSync('gift-links/supabase/009-attribution-par-envoi.sql', 'utf8'));
  check((await q("SELECT count(*)::int c FROM pg_proc WHERE proname = 'create_gift_links'"))[0].c === 1,
    'et rejouer le 009 derrière remet l’ordre : une seule fonction, la courante');
}


// ── 009 : l'attribution appartient à l'envoi, pas au lien.
//
// CE QUE CES CAS DÉFENDENT. Un lien est COMMUN à tous ses destinataires. Lui coller une campagne
// attribuait toutes ses lectures à la dernière déclarée — y compris celles d'une campagne antérieure.
// La bonne valeur était déjà dans la query string du visiteur ; elle n'avait rien à faire en base.
{
  await q(`INSERT INTO articles (arc_id, canonical_url, title, body)
           VALUES ('ENVOI00000000000000000009','https://x/c','Par envoi','Un corps.')`);
  const jours = (n) => new Date(Date.now() + n * 86400000).toISOString();

  const t = (await q(`SELECT token FROM create_gift_links(ARRAY['ENVOI00000000000000000009'],$1::timestamptz)`, [jours(10)]))[0].token;
  const ligne = (await q('SELECT channel, campaign FROM gift_links WHERE token = $1', [t]))[0];
  check(ligne.channel === null && ligne.campaign === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : créer un lien n’y écrit plus ni canal ni campagne — ce qui appartient à l’envoi ne se range pas sur l’article');

  // LE MÊME LIEN, DEUX CAMPAGNES. C'est le cas que l'ancien modèle attribuait faux.
  const lire = async (groupe) => (await q(
    'SELECT * FROM get_gift_article($1,$2,$3,NULL,$4,$5)',
    [t, 'Whatsapp', 'prospects', '0'.repeat(32), groupe]))[0];
  const lundi = await lire('prospects_chauds');
  const jeudi = await lire('prospects_abandon');
  check(lundi.status === 'ok' && jeudi.status === 'ok', 'les deux lectures passent');
  check(!('campaign' in lundi) && !('campaign' in jeudi), 'et aucune ne rend de campagne');

  const vues = await q(`SELECT campaign_group, count(*)::int AS lectures FROM gift_link_opens
                         WHERE token = $1 GROUP BY 1 ORDER BY 1`, [t]);
  check(vues.length === 2 && vues[0].campaign_group === 'prospects_abandon' && vues[1].campaign_group === 'prospects_chauds',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un même lien lu dans deux campagnes donne DEUX attributions distinctes — c’est précisément ce que l’ancien modèle écrasait');

  const parCampagne = await q(`SELECT campaign_group, reads, sends FROM gift_link_reads_by_campaign
                                WHERE campaign_group IN ('prospects_chauds','prospects_abandon') ORDER BY 1`);
  check(parCampagne.length === 2 && parCampagne.every((r) => r.reads >= 1),
    'la vue par campagne répond à « combien de lectures pour ce segment », et elle le fait juste');

  // REDEMANDER SANS RIEN CHANGER N'ÉCRIT PLUS RIEN. Avant 009, cette branche écrasait quand même le
  // canal et la campagne : un appel qui ne changeait rien changeait pourtant l’attribution de tous.
  const avant = (await q('SELECT * FROM gift_links WHERE token = $1', [t]))[0];
  const u = await q(`SELECT * FROM create_gift_links(ARRAY['ENVOI00000000000000000009'],$1::timestamptz)`, [jours(2)]);
  check(u[0].state === 'unchanged' && u[0].token === t, 'une durée plus courte rend le même lien, inchangé');
  const apres = (await q('SELECT * FROM gift_links WHERE token = $1', [t]))[0];
  check(JSON.stringify(avant) === JSON.stringify(apres),
    'et « inchangé » veut dire INCHANGÉ : pas une colonne touchée, pas même en silence');

  // LES SIGNATURES, APRÈS DEUX DROP.
  for (const [nom, args] of [['get_gift_article', 'text,text,text,text,text,text'],
                             ['create_gift_links', 'text[],timestamptz,uuid']])
    check((await q('SELECT count(*)::int c FROM pg_proc WHERE proname = $1', [nom]))[0].c === 1,
      `une seule fonction ${nom} : le DROP a bien précédé le CREATE`);
  check((await q("SELECT has_function_privilege('anon','public.get_gift_article(text,text,text,text,text,text)','EXECUTE') AS ok"))[0].ok,
    'anon a retrouvé son droit de lecture — un DROP les emporte, et sans lui la page tombe pour tout le monde');
  check((await q("SELECT has_function_privilege('service_role','public.create_gift_links(text[],timestamptz,uuid)','EXECUTE') AS ok"))[0].ok,
    'et le rôle de service son droit de création');

  // REJOUABLE, comme les précédentes.
  await db.exec(readFileSync('gift-links/supabase/009-attribution-par-envoi.sql', 'utf8'));
  check((await q("SELECT count(*)::int c FROM pg_proc WHERE proname = 'create_gift_links'"))[0].c === 1,
    'le 009 se rejoue sans laisser deux fonctions derrière lui');
}

console.log(`liens offerts (lot 1, schéma) : ${n} vérifications passées.`);
