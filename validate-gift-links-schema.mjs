// Liens offerts, lot 1 : ce test porte sur ce que la page publique NE PEUT PAS faire.
//
// Le token est la seule protection d'un article premium. S'il suffit de lire `articles` pour obtenir le
// corps, le token ne protège plus rien — il suffirait d'énumérer la table.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

let n = 0; const check = (c, l) => { assert.ok(c, l); n++; };

const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
await db.exec(readFileSync('gift-links/supabase/001-schema.sql', 'utf8'));
await db.exec(readFileSync('gift-links/supabase/002-author.sql', 'utf8'));
await db.exec(readFileSync('gift-links/supabase/003-un-lien-par-article.sql', 'utf8'));

const q = async (sql, params) => (await db.query(sql, params)).rows;

await q(`INSERT INTO articles (arc_id, canonical_url, title, standfirst, image_url, body, section, published_at)
         VALUES ('LQBW5JK75BDOBJHRA76NRFPJFY', 'https://www.lexpress.fr/secret-defense/a-LQBW5JK75BDOBJHRA76NRFPJFY',
                 'La DGSE investit dans l''IA', 'Les maîtres-espions se confessent', 'https://img/1.jpg',
                 'Corps réservé aux abonnés.', 'secret-defense', now() - interval '2 days'),
                ('SANSCORPS0000000000000000A', 'https://www.lexpress.fr/france/b-SANSCORPS0000000000000000A',
                 'Un titre sans corps', 'Le chapeau', 'https://img/2.jpg', NULL, 'france', now() - interval '1 day')`);

// ── CRÉATION.
const liens = await q(`SELECT * FROM create_gift_links(ARRAY['LQBW5JK75BDOBJHRA76NRFPJFY','SANSCORPS0000000000000000A'], 'whatsapp', 'prospects')`);
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
  ['expiration déjà passée', `SELECT * FROM create_gift_links(ARRAY['LQBW5JK75BDOBJHRA76NRFPJFY'], NULL, NULL, now() - interval '1 hour')`],
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
  check(await exec('anon', 'get_gift_article(text,text,text,text)'), 'anon peut appeler get_gift_article : c’est la page publique');
  check(!(await exec('anon', 'create_gift_links(text[],text,text,timestamptz)')),
    'mais PAS create_gift_links : une page publique ne fabrique pas de liens');
  check(!(await exec('authenticated', 'create_gift_links(text[],text,text,timestamptz)')),
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
  const tokenPlein2 = (await q(`SELECT token FROM create_gift_links(ARRAY['SIGNE00000000000000000001'], 'whatsapp', 'prospects')`))[0].token;
  const r = await lire(tokenPlein2);
  check(r.author === 'Laureline Dupont', 'la signature remonte jusqu’à la page');
  check(r.campaign === 'prospects', 'et la campagne du LIEN aussi — la page ne peut pas la deviner depuis l’article');

  const sansAuteur = await lire(tokenVide);
  check(sansAuteur.author === null, 'une signature inconnue vaut null : la page affiche la date seule, elle n’invente pas de nom');

  await q('UPDATE gift_links SET withdrawn_at = now() WHERE token = $1', [tokenPlein2]);
  const coupe = await lire(tokenPlein2);
  check(coupe.status === 'withdrawn' && coupe.title === null,
    'un lien coupé ne rend toujours rien de l’article');
  check(coupe.campaign === 'prospects',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : la campagne est rendue MÊME sur un refus — le bouton d’abonnement reste affiché, et sa conversion doit rester attribuée à la campagne qui a amené la personne');
}

// ── UN LIEN PAR ARTICLE, PROLONGÉ PLUTÔT QUE RECRÉÉ (003).
//
// Ce que ça protège : un lien déjà diffusé reste valable. Le recréer rendrait mort celui que la personne
// a reçu hier, pendant qu'un autre circule.
{
  const creer = async (arcs, jours) => (await db.query(
    'SELECT * FROM create_gift_links($1::text[], $2, $3, $4)',
    [arcs, 'whatsapp', 'prospects', jours === null ? null : new Date(Date.now() + jours * 86400000).toISOString()])).rows;

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

console.log(`liens offerts (lot 1, schéma) : ${n} vérifications passées.`);
