// Identifiant d'envoi élargi (019) : `s` accepte l'identifiant d'un e-mail HubSpot, sans rien changer
// pour WhatsApp, et une valeur bricolée reste NULL sans jamais empêcher l'article de s'afficher.
//
// Tout passe par la RPC que la page appelle (`get_gift_article_for_edition_v2`), sous le rôle `anon`,
// puis par l'ancienne (`get_gift_article`). Base PGlite locale, sans réseau ni secret.
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
    const r = rpc === 'v2'
      ? await q('SELECT * FROM get_gift_article_for_edition_v2($1, $2, $3, $4, NULL, $5, NULL)', [edition, token, 'Newsletter', 'bf', s])
      : await q('SELECT * FROM get_gift_article($1, $2, $3, NULL, $4, NULL)', [token, 'Newsletter', 'bf', s]);
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
const avant = { def: await definition(), acl: await droits() };

// ── 2. 019 appliquée.
await db.exec(sql(MIGRATION));
{
  const apres = await definition();
  // Définition attendue : celle de 015, ligne d'assainissement remplacée ; commentaires ignorés.
  const sansCommentaires = (d) => d.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  const ancienne = "p_send_id ~ '^[0-9a-f]{32}$'", nouvelle = "p_send_id ~ '^[A-Za-z0-9_-]{1,64}$'";
  check(avant.def.split(ancienne).length === 2, '015 contient une seule fois l’ancien assainissement');
  check(sansCommentaires(apres) === sansCommentaires(avant.def.replace(ancienne, () => nouvelle)),
    '019 = définition de 015 à la seule ligne d’assainissement près (aucune ligne ajoutée, retirée ni modifiée ailleurs)');
  check(await droits() === avant.acl, `droits identiques à 015 — ${await droits()}`);
  check((await q("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'get_gift_article_for_edition'"))[0].n === 1,
    'une seule fonction de ce nom : pas de seconde signature');
}

for (const [rpc, edition, token] of [['v2', 'FR', FR], ['v2', 'EUR', PL], ['legacy', 'FR', FR]]) {
  for (const [s, quoi] of ACCEPTES) {
    const r = await lire(edition, token, s, rpc);
    const o = await derniere();
    check(r.status === 'ok' && r.body && o.send_id === s && o.utm_source === 'Newsletter' && o.utm_campaign === 'bf',
      `${rpc} ${edition} : ${quoi} enregistré tel quel — obtenu ${o.send_id}`);
  }
  for (const [s, quoi] of REFUSES) {
    const nb = await lectures();
    const r = await lire(edition, token, s, rpc);
    check(r.status === 'ok' && r.body, `${rpc} ${edition} : ${quoi} → l'article s'affiche quand même`);
    check(await lectures() === nb + 1 && (await derniere()).send_id === null, `${rpc} ${edition} : ${quoi} → send_id NULL, lecture comptée`);
  }
  const sans = await lire(edition, token, null, rpc);
  check(sans.status === 'ok' && (await derniere()).send_id === null, `${rpc} ${edition} : sans s → NULL`);
}

// Un lien expiré, retiré ou inconnu ne compte toujours rien, quel que soit `s`.
{
  const nb = await lectures();
  await q("UPDATE gift_links SET expires_at = now() - interval '1 day' WHERE token = $1", [PL]);
  check((await lire('EUR', PL, HUBSPOT)).status === 'expired', 'expiré reste expiré avec un s HubSpot');
  await q("UPDATE gift_links SET expires_at = now() + interval '1 day', withdrawn_at = now() WHERE token = $1", [PL]);
  check((await lire('EUR', PL, HUBSPOT)).status === 'withdrawn', 'retiré reste retiré');
  check((await lire('FR', 'f'.repeat(32), HUBSPOT)).status === 'unknown', 'inconnu reste inconnu');
  check((await lire('EUR', FR, HUBSPOT)).status === 'unknown', 'jeton d’une autre édition : inconnu');
  check(await lectures() === nb, 'aucune lecture comptée pour ces refus');
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
await q('SELECT * FROM get_gift_article_for_edition_v2($1, $2, NULL, NULL, NULL, $3, NULL)', ['FR', FR, 'GARDE_123']);
await db.exec(sql(ROLLBACK));
{
  check(await definition() === avant.def, 'retour arrière : définition de 015 exactement');
  check(await droits() === avant.acl, 'retour arrière : droits intacts');
  const r = await lire('FR', FR, HUBSPOT);
  check(r.status === 'ok' && (await derniere()).send_id === null, 'retour arrière : identifiant numérique → NULL, article affiché');
  await lire('FR', FR, HEX);
  check((await derniere()).send_id === HEX, 'retour arrière : WhatsApp inchangé');
  check((await q("SELECT count(*)::int AS n FROM gift_link_opens WHERE send_id = 'GARDE_123'"))[0].n === 1,
    'retour arrière : les lectures déjà enregistrées sont gardées');
  check((await commentaire()).startsWith('Identifiant de l\'ENVOI (?s=…), 32 hexa'), 'retour arrière : commentaire de colonne de 005 restauré');
}
await db.exec(sql(MIGRATION));
await db.exec(sql(MIGRATION)); // rejouable
{
  await lire('FR', FR, HUBSPOT);
  check((await derniere()).send_id === HUBSPOT, 'ré-application : identifiant HubSpot de nouveau accepté');
  check(await droits() === avant.acl, 'ré-application : droits intacts');
}

await db.close();
console.log(`Identifiant d'envoi (019) : ${n} contrôles — 32 hexa et identifiant HubSpot acceptés, valeurs bricolées à NULL sans casser la page, refus inchangés, purge, retour arrière et rejeu vérifiés.`);
