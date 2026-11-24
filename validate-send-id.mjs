// Identifiant d'envoi élargi (019) : la nouvelle RPC `get_gift_article_for_edition_v3` accepte
// l'identifiant d'un e-mail HubSpot dans `s`, sans rien changer pour WhatsApp, et une valeur bricolée
// reste NULL sans jamais empêcher l'article de s'afficher.
//
// LA PROPRIÉTÉ DE SÉCURITÉ (revues adverses du 24/11) : les RPC existantes, appelées par la page publiée
// le 20/10 (qui préfère `at_recipient_id`, possible identifiant de contact), restent STRICTES : 32
// hexadécimaux ou NULL. Un ancien onglet ou un retour arrière du lecteur ne peut donc pas faire entrer
// un identifiant de contact. Tout passe par les RPC, sous le rôle `anon`. Base PGlite, sans réseau.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let n = 0; const check = (c, l) => { assert.ok(c, l); n++; };
const MIGRATION = 'gift-links/supabase/019-identifiant-envoi-elargi.sql';
const ROLLBACK = 'gift-links/supabase/rollback/019-identifiant-envoi-elargi.sql';

const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
const migrations = readdirSync('gift-links/supabase').filter((f) => /^\d.*\.sql$/.test(f) && !f.startsWith('004')).sort();
check(migrations.includes('019-identifiant-envoi-elargi.sql'), '019 est présente');
for (const f of migrations.filter((f) => f < '019')) await db.exec(readFileSync(`gift-links/supabase/${f}`, 'utf8'));
const q = async (sql, args) => JSON.parse(JSON.stringify((await db.query(sql, args)).rows));
const sql = (f) => readFileSync(f, 'utf8');

await q('SELECT cache_articles($1::jsonb)', [JSON.stringify([
  { edition: 'FR', arc_id: 'ENVOI_FR', canonical_url: 'https://www.lexpress.fr/envoi', title: 'Article offert', body: 'Le corps.' },
  { edition: 'EUR', arc_id: 'ENVOI_PL', language: 'pl', canonical_url: 'https://pl.lexpress.eu/envoi', title: 'Artykuł', body: 'Treść.' },
])]);
const FR = (await q("SELECT token FROM create_gift_links_for_edition('FR', ARRAY['ENVOI_FR'])"))[0].token;
const PL = (await q("SELECT token FROM create_gift_links_for_edition('EUR', ARRAY['ENVOI_PL'])"))[0].token;

const lire = async (edition, token, s, rpc = 'v2') => {
  await db.exec('SET ROLE anon');
  try {
    const r = rpc === 'legacy'
      ? await q('SELECT * FROM get_gift_article($1, $2, $3, NULL, $4, NULL)', [token, 'Newsletter', 'bf', s])
      : await q(`SELECT * FROM get_gift_article_for_edition_${rpc}($1, $2, $3, $4, NULL, $5, NULL)`, [edition, token, 'Newsletter', 'bf', s]);
    return r[0];
  } finally { await db.exec('RESET ROLE'); }
};
const derniere = async () => (await q('SELECT send_id, utm_source, utm_campaign FROM gift_link_opens ORDER BY id DESC LIMIT 1'))[0];
const lectures = async () => (await q('SELECT count(*)::int AS n FROM gift_link_opens'))[0].n;
const definition = async () => (await q("SELECT pg_get_functiondef('public.get_gift_article_for_edition(text,text,text,text,text,text,text)'::regprocedure) AS d"))[0].d;
const commentaire = async () => (await q("SELECT col_description(attrelid, attnum) AS c FROM pg_attribute WHERE attrelid = 'public.gift_link_opens'::regclass AND attname = 'send_id'"))[0].c;
const droits = async () => (await q("SELECT proacl::text AS a FROM pg_proc WHERE oid = 'public.get_gift_article_for_edition(text,text,text,text,text,text,text)'::regprocedure"))[0].a;

const HEX = '0123456789abcdef0123456789abcdef';
const HUBSPOT = '123456789012';
const ACCEPTES = [
  [HEX, '32 hexadécimaux (WhatsApp)'],
  [HUBSPOT, 'identifiant numérique d’e-mail HubSpot'],
  ['Email_2026-11-BF', 'lettres, chiffres, « _ » et « - »'],
  ['7', 'un seul caractère'],
  ['A'.repeat(64), '64 caractères, la limite'],
];
const REFUSES = [
  ['123 456', 'espace'], ['prenom.nom@exemple.fr', 'adresse e-mail (« @ », « . »)'], ['<script>', '« < »'],
  ['+33612345678', 'téléphone international (« + »)'], ['A'.repeat(65), '65 caractères'], ['', 'chaîne vide'],
  ['abc\n', 'saut de ligne final'], ['é123', 'lettre accentuée'], ['١٢٣', 'chiffres non latins'],
  ['abc%20def', 'encodage resté dans la valeur'], ['a'.repeat(10000), 'valeur très longue'],
];

// ── 1. AVANT 019 : l'identifiant HubSpot était perdu. C'est ce que la migration corrige.
{
  const r = await lire('FR', FR, HUBSPOT);
  check(r.status === 'ok' && (await derniere()).send_id === null, 'avant 019 : un identifiant numérique devient NULL');
}
const defs = async () => q("SELECT p.oid::regprocedure::text AS f, pg_get_functiondef(p.oid) AS d, proacl::text AS a FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'get_gift_article%' ORDER BY 1");
const avant = { def: await definition(), acl: await droits(), toutes: await defs() };
const V3 = 'public.get_gift_article_for_edition_v3(text,text,text,text,text,text,text)';

// ── 2. 019 appliquée.
await db.exec(sql(MIGRATION));
{
  const apres = await defs();
  check(JSON.stringify(apres.filter((f) => !f.f.includes('_v3'))) === JSON.stringify(avant.toutes),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : get_gift_article, _for_edition et _v2 inchangées (définitions et droits)');
  const v3 = apres.find((f) => f.f.includes('_v3'));
  check(v3 && v3.a === avant.acl, `v3 créée, mêmes droits que les autres — ${v3?.a}`);
  // v3 = définition de 015 à trois écarts connus près (commentaires ignorés).
  const src = async (sig) => (await q(`SELECT prosrc AS s FROM pg_proc WHERE oid = '${sig}'::regprocedure`))[0].s;
  const sansCommentaires = (d) => d.split('\n').filter((l) => !/^\s*(--.*)?$/.test(l)).join('\n');
  let attendu = (await src('public.get_gift_article_for_edition(text,text,text,text,text,text,text)'))
    .replace("p_send_id ~ '^[0-9a-f]{32}$'", () => "p_send_id ~ '^[A-Za-z0-9_-]{1,64}$'")
    .replace('  v_group text;\nBEGIN', '  v_group text;\n  v_lang  text;\nBEGIN')
    .replaceAll("NULL::timestamptz;", 'NULL::timestamptz, NULL::text;')
    .replace("  IF NOT FOUND THEN\n    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text;\n    RETURN;\n  END IF;\n",
      "  IF NOT FOUND THEN\n    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text;\n    RETURN;\n  END IF;\n\n  SELECT a.language INTO v_lang FROM public.articles a WHERE a.edition = v_link.edition AND a.arc_id = v_link.arc_id;\n")
    .replace("'withdrawn'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text;", "'withdrawn'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, v_lang;")
    .replace("'expired'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text;", "'expired'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, v_lang;")
    .replace('a.section, a.author, a.published_at\n', 'a.section, a.author, a.published_at, a.language\n');
  check(sansCommentaires(await src(V3)) === sansCommentaires(attendu),
    'v3 = corps de 015 à trois écarts près : assainissement de s, langue sur retiré/expiré, langue de l’article (aucune autre ligne changée)');
}

// Les anciennes RPC restent strictes : l'ancienne page (at_recipient_id prioritaire) ne fait rien entrer.
for (const [rpc, edition, token] of [['v2', 'FR', FR], ['v2', 'EUR', PL], ['legacy', 'FR', FR]]) {
  for (const s of [HUBSPOT, '987654321', 'Email_2026-11-BF']) {
    await lire(edition, token, s, rpc);
    check((await derniere()).send_id === null, `${rpc} ${edition} après 019 : ${s} → NULL (ancienne page, onglet ouvert ou retour arrière)`);
  }
  await lire(edition, token, HEX, rpc);
  check((await derniere()).send_id === HEX, `${rpc} ${edition} après 019 : 32 hexa WhatsApp gardés`);
}

for (const [edition, token] of [['FR', FR], ['EUR', PL]]) {
  for (const [s, quoi] of ACCEPTES) {
    const r = await lire(edition, token, s, 'v3');
    const o = await derniere();
    check(r.status === 'ok' && r.body && o.send_id === s && o.utm_source === 'Newsletter' && o.utm_campaign === 'bf',
      `v3 ${edition} : ${quoi} enregistré tel quel — obtenu ${o.send_id}`);
  }
  for (const [s, quoi] of REFUSES) {
    const nb = await lectures();
    const r = await lire(edition, token, s, 'v3');
    check(r.status === 'ok' && r.body, `v3 ${edition} : ${quoi} → l'article s'affiche quand même`);
    check(await lectures() === nb + 1 && (await derniere()).send_id === null, `v3 ${edition} : ${quoi} → send_id NULL, lecture comptée`);
  }
  const sans = await lire(edition, token, null, 'v3');
  check(sans.status === 'ok' && (await derniere()).send_id === null, `v3 ${edition} : sans s → NULL`);
}

// v3 répond comme v2 dans tous les états, et compte les lectures de la même façon.
{
  await q('SELECT cache_articles($1::jsonb)', [JSON.stringify([{ edition: 'EUR', arc_id: 'ENVOI_FR_EU', language: 'fr', canonical_url: 'https://fr.lexpress.eu/apercu', title: 'Aperçu', body: '' }])]);
  const APERCU = (await q("SELECT token FROM create_gift_links_for_edition('EUR', ARRAY['ENVOI_FR_EU'])"))[0].token;
  const compare = async (libelle, edition, token) => {
    const n0 = await lectures();
    const a = await lire(edition, token, HEX, 'v2');
    const n1 = await lectures();
    const b = await lire(edition, token, HEX, 'v3');
    const n2 = await lectures();
    check(JSON.stringify(a) === JSON.stringify(b) && n1 - n0 === n2 - n1, `v3 = v2 : ${libelle} (${a?.status}, ${a?.language ?? 'sans langue'}, ${n1 - n0} lecture)`);
  };
  await compare('lien FR lisible', 'FR', FR);
  await compare('lien PL lisible', 'EUR', PL);
  await compare('aperçu sans corps', 'EUR', APERCU);
  await compare('jeton inconnu', 'FR', 'f'.repeat(32));
  await compare('jeton d’une autre édition', 'EUR', FR);
  await compare('jeton mal formé', 'FR', 'abc');
  await compare('édition inconnue', 'DE', FR);
  await q("UPDATE gift_links SET expires_at = now() - interval '1 day' WHERE token = $1", [PL]);
  await compare('lien expiré (langue gardée)', 'EUR', PL);
  await q("UPDATE gift_links SET expires_at = now() + interval '1 day', withdrawn_at = now() WHERE token = $1", [PL]);
  await compare('lien retiré (langue gardée)', 'EUR', PL);
  await q('UPDATE gift_links SET withdrawn_at = NULL WHERE token = $1', [PL]);
}

// Un lien expiré, retiré ou inconnu ne compte toujours rien, quel que soit `s`.
{
  const nb = await lectures();
  await q("UPDATE gift_links SET expires_at = now() - interval '1 day' WHERE token = $1", [PL]);
  check((await lire('EUR', PL, HUBSPOT, 'v3')).status === 'expired', 'expiré reste expiré avec un s HubSpot');
  await q("UPDATE gift_links SET expires_at = now() + interval '1 day', withdrawn_at = now() WHERE token = $1", [PL]);
  check((await lire('EUR', PL, HUBSPOT, 'v3')).status === 'withdrawn', 'retiré reste retiré');
  check((await lire('FR', 'f'.repeat(32), HUBSPOT, 'v3')).status === 'unknown', 'inconnu reste inconnu');
  check((await lire('EUR', FR, HUBSPOT, 'v3')).status === 'unknown', 'jeton d’une autre édition : inconnu');
  check(await lectures() === nb, 'aucune lecture comptée pour ces refus');
  await q('UPDATE gift_links SET withdrawn_at = NULL WHERE token = $1', [PL]);
}

// Les comptes par campagne comptent les e-mails comme des envois.
{
  const v = await q("SELECT edition, sends FROM gift_link_reads_by_campaign WHERE utm_campaign = 'bf' AND utm_source = 'Newsletter' ORDER BY edition");
  check(JSON.stringify(v) === JSON.stringify([{ edition: 'EUR', sends: ACCEPTES.length }, { edition: 'FR', sends: ACCEPTES.length }]),
    `la vue compte chaque envoi accepté, e-mail HubSpot compris, par édition — ${JSON.stringify(v)}`);
}

// La purge à 90 jours efface aussi les nouveaux identifiants.
{
  await q("UPDATE gift_link_opens SET opened_at = now() - interval '100 days' WHERE send_id = $1", [HUBSPOT]);
  await q('SELECT purge_send_ids(90)');
  check((await q('SELECT count(*)::int AS n FROM gift_link_opens WHERE send_id = $1', [HUBSPOT]))[0].n === 0,
    'purge à 90 jours : identifiant HubSpot effacé');
}

// ── 3. Retour arrière, puis ré-application.
await lire('FR', FR, 'GARDE_123', 'v3');
await db.exec(sql(ROLLBACK));
{
  const apres = await defs();
  check(JSON.stringify(apres.filter((f) => !f.f.includes('_v3'))) === JSON.stringify(avant.toutes), 'retour arrière : anciennes RPC exactement comme avant');
  const v3 = apres.find((f) => f.f.includes('_v3'));
  check(v3 && v3.a === avant.acl, 'retour arrière : v3 GARDÉE (un onglet déjà chargé l’appelle encore), mêmes droits');
  check(v3.d.includes("p_send_id ~ '^[0-9a-f]{32}$'") && !v3.d.includes('{1,64}'), 'retour arrière : v3 redevenue stricte');
  for (const [s, attendu] of [[HUBSPOT, null], ['987654321', null], [HEX, HEX]]) {
    const r = await lire('FR', FR, s, 'v3');
    check(r.status === 'ok' && r.body && (await derniere()).send_id === attendu, `retour arrière : v3 répond, ${s} → ${attendu}`);
  }
  check(JSON.stringify(await lire('EUR', PL, HEX, 'v3')) === JSON.stringify(await lire('EUR', PL, HEX, 'v2')), 'retour arrière : v3 répond toujours comme v2');
  check((await q("SELECT count(*)::int AS n FROM gift_link_opens WHERE send_id = 'GARDE_123'"))[0].n === 1,
    'retour arrière : les lectures déjà enregistrées sont gardées');
  check((await commentaire()).startsWith('Identifiant de l\'ENVOI (?s=…), 32 hexa'), 'retour arrière : commentaire de colonne de 005 restauré');
}
await db.exec(sql(MIGRATION));
await db.exec(sql(MIGRATION)); // rejouable
{
  await lire('FR', FR, HUBSPOT, 'v3');
  check((await derniere()).send_id === HUBSPOT, 'ré-application : identifiant HubSpot de nouveau accepté par v3');
  await lire('FR', FR, HUBSPOT, 'v2');
  check((await derniere()).send_id === null, 'ré-application : v2 toujours stricte');
}

// ── 4. Base où l'ANCIENNE 019 (motif élargi dans la fonction de 015) avait été appliquée : cas de TEST.
{
  const ancienne = (await definition()).replace("p_send_id ~ '^[0-9a-f]{32}$'", () => "p_send_id ~ '^[A-Za-z0-9_-]{1,64}$'");
  await db.exec(ancienne);
  let e = null; try { await db.exec(sql(MIGRATION)); } catch (x) { e = x.message; }
  await db.exec('ROLLBACK');
  check(e && /appliquer rollback\/019/.test(e), `019 refuse une base à fonction 015 élargie (${e})`);
  await db.exec(sql(ROLLBACK));
  check(await definition() === avant.def, 'le retour arrière répare la fonction de 015 (stricte)');
  await db.exec(sql(MIGRATION));
  await lire('FR', FR, HUBSPOT, 'v2');
  check((await derniere()).send_id === null, 'après réparation et 019 : v2 stricte');
}

await db.close();
console.log(`Identifiant d'envoi (019) : ${n} contrôles — anciennes RPC strictes (aucun identifiant de contact par l'ancienne page), v3 accepte HubSpot, v3 = v2 ailleurs, valeurs bricolées à NULL, purge, retour arrière (v3 gardée, stricte), rejeu et réparation vérifiés.`);
