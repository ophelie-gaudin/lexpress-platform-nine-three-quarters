// Retour arrière de 018 sans perte (revue adverse du 24/11, constat 3), base PGlite locale, sans réseau.
//
// 1. L'interrupteur réversible préféré au DROP : retirer EXECUTE sur get_subscription_offer à la clé
//    publique coupe toutes les offres, et le remettre rend exactement les droits d'avant.
// 2. Le dernier recours : sauvegarde, retour arrière (DROP), ré-application de 018, restauration ; offres,
//    droits manage_offers et réponses des RPC identiques à l'avant. Restauration rejouable, et refusée,
//    sans rien écrire, sur une sauvegarde altérée, avant 018, ou sur une table qui a changé entre-temps.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { sqlSauvegarde, sqlRestauration, sqlRetourArriere, sqlVerification, lireSauvegarde } from './gift-links/supabase/sauvegarde/offres.mjs';

let n = 0; const check = (c, l) => { assert.ok(c, l); n++; };
const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
// Une session qui n'est pas en UTC : la sauvegarde ne doit pas en dépendre.
await db.exec("SET TimeZone = 'Europe/Paris'");
// Schéma de 018 (et 019) : ce retour arrière s'emploie après celui de 020 (validate-offre-par-parametre.mjs).
for (const f of readdirSync('gift-links/supabase').filter((f) => /^\d.*\.sql$/.test(f) && !f.startsWith('004') && f < '020').sort()) {
  await db.exec(readFileSync(`gift-links/supabase/${f}`, 'utf8'));
}
const q = async (sql, args) => JSON.parse(JSON.stringify((await db.query(sql, args)).rows));
const erreur = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return `${e.code} ${e.message}`; } };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const client = async (nom, droit) => {
  const id = (await q('SELECT public.create_api_client($1,$2) AS id', [nom, sha(nom)]))[0].id;
  if (droit) await q('UPDATE public.api_clients SET manage_offers = true WHERE id = $1', [id]);
  return id;
};
const MARKETING = await client('marketing-offres', true);
await client('agent-whatsapp', false);
await client('marketing-ancien', true);
await q("SELECT public.revoke_api_client('marketing-ancien')"); // révoqué, droit gardé : à restaurer tel quel

const creer = (sites, debut, fin, extra = {}) => q(
  'SELECT (public.create_subscription_offer($1, $2, $3, $4, $5, $6, $7, $8)).id AS id',
  [MARKETING, sites, fin, debut, extra.url ?? null, extra.label ?? null, extra.name ?? null, extra.request_id ?? null]);
const heure = (h) => new Date(Date.now() + h * 3600_000).toISOString();
await creer(['www.lexpress.fr'], heure(-0.01), heure(240), { label: 'Offre longue -30 %', url: 'https://abonnements-digitaux.lexpress.fr/offres?refTarif=1', name: 'Longue « hiver »', request_id: 'longue-1' });
await creer(['www.lexpress.fr'], heure(-0.005), heure(2), { label: "Flash l'hiver $$ ;--", url: 'https://www.lexpress.fr/abo?code=A%20B&x=1', name: "Nom avec ' et $restauration$ 🎁" });
await creer(['pl.lexpress.eu'], heure(24), heure(48), { label: 'Oferta 🎁', name: null });
await creer(['www.lexpress.eu'], heure(-0.001), heure(5), {});
const finie = (await creer(['www.lexpress.eu'], heure(-0.002), heure(10), { label: 'Finie tôt' }))[0].id;
check((await q('SELECT public.end_subscription_offer($1, $2) AS r', [MARKETING, finie]))[0].r === 'ended', 'une offre terminée en avance fait partie du jeu');

const SITES = ['www.lexpress.fr', 'www.lexpress.eu', 'fr.lexpress.eu', 'pl.lexpress.eu'];
const etat = async () => ({
  table: await q('SELECT to_jsonb(o) AS o FROM public.subscription_offers o ORDER BY id'),
  droits: await q('SELECT id, name, active FROM public.api_clients WHERE manage_offers ORDER BY id'),
  page: await Promise.all(SITES.map((s) => q('SELECT * FROM public.get_subscription_offer($1)', [s]))),
  liste: await q('SELECT public.list_subscription_offers($1) AS l', [MARKETING]),
});
const sansHorloge = (e) => JSON.parse(JSON.stringify(e, (k, v) => (k === 'now' || k === 'generated_at' ? undefined : v)));
const avant = await etat();
check(avant.table.length === 5 && avant.droits.length === 2, `jeu de départ : 5 offres, 2 jetons avec le droit (${avant.table.length}, ${avant.droits.length})`);
check(avant.page[0][0]?.label === "Flash l'hiver $$ ;--", 'la page FR affiche Flash avant tout geste');

// ── 1. L'INTERRUPTEUR : couper la lecture publique, sans rien supprimer.
{
  // L'ensemble des droits, trié : REVOKE puis GRANT rend les mêmes droits, dans un autre ordre d'affichage.
  const acl = async () => (await q("SELECT string_agg(a::text, ',' ORDER BY a::text) AS a FROM pg_proc, unnest(proacl) a WHERE oid = 'public.get_subscription_offer(text)'::regprocedure"))[0].a;
  const aclAvant = await acl();
  await db.exec('REVOKE EXECUTE ON FUNCTION public.get_subscription_offer(text) FROM anon, authenticated;');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    const e = await erreur("SELECT * FROM public.get_subscription_offer('www.lexpress.fr')");
    await db.exec('RESET ROLE');
    check(e && /^42501/.test(e), `interrupteur coupé : ${role} ne lit plus l’offre (${e})`);
  }
  check(sansHorloge(await etat()).table.length === 5, 'interrupteur : aucune offre touchée');
  await db.exec('GRANT EXECUTE ON FUNCTION public.get_subscription_offer(text) TO anon, authenticated;');
  check(await acl() === aclAvant, `interrupteur remis : droits identiques à l’avant (${aclAvant})`);
  await db.exec('SET ROLE anon');
  check((await q("SELECT label FROM public.get_subscription_offer('www.lexpress.fr')"))[0]?.label === "Flash l'hiver $$ ;--", 'interrupteur remis : la page relit Flash');
  await db.exec('RESET ROLE');
}

// ── 2. SAUVEGARDE, puis la ligne de commande telle que le runbook l'emploie.
const dir = mkdtempSync(join(tmpdir(), 'p934-sauvegarde-'));
try {
  const cli = (...args) => spawnSync(process.execPath, ['gift-links/supabase/sauvegarde/offres.mjs', ...args], { encoding: 'utf8' });
  const sortie = cli('sql-sauvegarde');
  check(sortie.status === 0 && sortie.stdout === sqlSauvegarde(), 'la ligne de commande rend la requête de sauvegarde');
  check(/^\s*(--.*\n)*SELECT /.test(sortie.stdout) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE)\b/i.test(sortie.stdout),
    'la sauvegarde est une seule lecture');
  const [{ sauvegarde }] = await q(sqlSauvegarde());
  check(sauvegarde.offres.length === 5 && sauvegarde.droits.length === 2, 'sauvegarde : 5 offres, 2 droits');
  await db.exec("SET TimeZone = 'UTC'");
  const [{ sauvegarde: memeEnUtc }] = await q(sqlSauvegarde());
  await db.exec("SET TimeZone = 'Europe/Paris'");
  check(memeEnUtc.empreinte === sauvegarde.empreinte, 'sauvegarde indépendante du fuseau de la session');
  // Le fichier tel que l'API Management le rend : [{"sauvegarde": {...}}].
  const fichier = join(dir, 'sauvegarde.json');
  writeFileSync(fichier, JSON.stringify([{ sauvegarde }]));
  const restauration = cli('sql-restauration', fichier);
  check(restauration.status === 0 && restauration.stdout === sqlRestauration(lireSauvegarde(readFileSync(fichier, 'utf8'))),
    'la ligne de commande rend la restauration depuis le fichier de l’API');
  const sqlR = restauration.stdout;
  check(!sqlR.includes("Flash l'hiver") && !sqlR.includes('$restauration$ 🎁'), 'les valeurs voyagent en base64, jamais en clair dans le SQL');

  // Vérification : n'écrit rien, passe sur la base intacte.
  {
    const avantVerif = JSON.stringify(sansHorloge(await etat()));
    await db.exec(sqlVerification(sauvegarde));
    check(JSON.stringify(sansHorloge(await etat())) === avantVerif, 'vérification : passe sur la base intacte, sans rien écrire');
    check(/ROLLBACK;\s*$/.test(sqlVerification(sauvegarde)) && cli('sql-verification', fichier).stdout === sqlVerification(sauvegarde), 'vérification : se termine par ROLLBACK, même SQL par la ligne de commande');
  }
  // Seconde revue GPT : un droit retiré ou une offre supprimée APRÈS la sauvegarde ne doivent jamais être
  // remis par une « restauration à blanc » ; vérification et retour arrière gardé doivent refuser.
  for (const [quoi, changer, annuler] of [
    ['droit manage_offers retiré', "UPDATE public.api_clients SET manage_offers = false WHERE name = 'marketing-ancien'", "UPDATE public.api_clients SET manage_offers = true WHERE name = 'marketing-ancien'"],
    ['offre supprimée', null, null],
  ]) {
    let supprimee = null;
    if (changer) await db.exec(changer);
    else supprimee = (await q('DELETE FROM public.subscription_offers WHERE id = (SELECT min(id::text)::uuid FROM public.subscription_offers) RETURNING to_jsonb(subscription_offers) AS o'))[0].o;
    const apresChangement = JSON.stringify(sansHorloge(await etat()));
    const eR = await erreur(sqlRestauration(sauvegarde)); await db.exec('ROLLBACK');
    check(eR && /différents|différentes/.test(eR), `${quoi} : la restauration sur la base intacte refuse (${eR})`);
    check(JSON.stringify(sansHorloge(await etat())) === apresChangement, `${quoi} : rien n’est remis`);
    const eV = await erreur(sqlVerification(sauvegarde)); await db.exec('ROLLBACK');
    check(eV && /modifiés après la sauvegarde/.test(eV), `${quoi} : la vérification refuse`);
    const eG = await erreur(sqlRetourArriere(sauvegarde)); await db.exec('ROLLBACK');
    check(eG && /modifiés après la sauvegarde/.test(eG), `${quoi} : le retour arrière gardé refuse, rien supprimé`);
    if (annuler) await db.exec(annuler);
    else {
      await q(`INSERT INTO public.subscription_offers SELECT * FROM jsonb_populate_record(NULL::public.subscription_offers, $1::jsonb)`, [JSON.stringify(supprimee)]);
    }
  }
  check(JSON.stringify(sansHorloge(await etat())) === JSON.stringify(sansHorloge(avant)), 'base remise à l’état sauvegardé pour la suite');

  // Restaurer avant le retour arrière : rejouable, rien ne change.
  await db.exec(sqlR);
  check(JSON.stringify(sansHorloge(await etat())) === JSON.stringify(sansHorloge(avant)), 'restauration sur la base intacte : aucun changement (rejouable)');

  // Sauvegarde incomplète ou altérée : refusée AVANT tout DROP (revue GPT du 24/11).
  for (const [quoi, faux] of [
    ['ligne incomplète', { ...sauvegarde, offres: [{ id: 'missing fields' }, ...sauvegarde.offres.slice(1)] }],
    ['empreinte mal formée', { ...sauvegarde, empreinte: 'incorrect' }],
    ['date hors forme', { ...sauvegarde, offres: sauvegarde.offres.map((o, i) => (i === 0 ? { ...o, ends_at: 'demain' } : o)) }],
  ]) {
    writeFileSync(join(dir, 'faux.json'), JSON.stringify([{ sauvegarde: faux }]));
    check(cli('sql-retour-arriere', join(dir, 'faux.json')).status !== 0 && cli('sql-restauration', join(dir, 'faux.json')).status !== 0,
      `sauvegarde refusée dès la génération : ${quoi}`);
  }
  const memeNombre = { ...sauvegarde, offres: sauvegarde.offres.map((o, i) => (i === 0 ? { ...o, label: 'Pirate' } : o)) };
  const eAltere = await erreur(sqlRetourArriere(memeNombre));
  await db.exec('ROLLBACK');
  check(eAltere && /altérée/.test(eAltere), `retour arrière gardé : sauvegarde altérée à nombre de lignes égal, refusé (${eAltere})`);
  check((await q("SELECT to_regclass('public.subscription_offers') AS t"))[0].t !== null, 'refus : table toujours là');

  // Le marketing termine une offre APRÈS la sauvegarde : le retour arrière gardé refuse au lieu de perdre la fin.
  {
    const enCours = (await q("SELECT id FROM public.subscription_offers WHERE ended_at IS NULL AND ends_at > now() AND starts_at <= now() ORDER BY id LIMIT 1"))[0].id;
    await db.exec('BEGIN');
    await q('SELECT public.end_subscription_offer($1, $2)', [MARKETING, enCours]);
    const e = await erreur(sqlRetourArriere(sauvegarde).replace(/^BEGIN;$/m, 'SAVEPOINT garde;').replace(/^COMMIT;$/m, 'RELEASE SAVEPOINT garde;'));
    await db.exec('ROLLBACK'); // annule la fin de l'offre : la base revient à l'état sauvegardé
    check(e && /offres différentes de la sauvegarde/.test(e), `retour arrière gardé : offre terminée après la sauvegarde, refusé (${e})`);
  }
  check(cli('sql-retour-arriere', fichier).status === 0, 'la ligne de commande rend le retour arrière gardé');
  check(cli('sql-retour-arriere', fichier).stdout === sqlRetourArriere(sauvegarde), 'retour arrière gardé : même SQL par la ligne de commande');

  // ── 3. RETOUR ARRIÈRE GARDÉ (le DROP), puis restauration refusée tant que 018 n'est pas là.
  await db.exec(sqlRetourArriere(sauvegarde));
  check((await q("SELECT to_regclass('public.subscription_offers') AS t"))[0].t === null, 'retour arrière : table supprimée');
  const avant018 = await erreur(sqlR);
  check(avant018 && /appliquer 018/.test(avant018), `restauration refusée avant 018 (${avant018})`);
  await db.exec('ROLLBACK'); // la transaction de la restauration a échoué : la refermer comme le ferait l'API

  // ── 4. RÉ-APPLICATION de 018 : table vide, droits retombés à faux. Puis restauration.
  await db.exec(readFileSync('gift-links/supabase/018-offres-abonnement.sql', 'utf8'));
  check((await q('SELECT count(*)::int AS n FROM public.subscription_offers'))[0].n === 0, 'ré-application : table vide');
  check((await q('SELECT count(*)::int AS n FROM public.api_clients WHERE manage_offers'))[0].n === 0, 'ré-application : plus aucun droit');

  // Sauvegarde altérée : refus, rien d'écrit.
  const altere = { ...sauvegarde, offres: sauvegarde.offres.map((o, i) => (i === 0 ? { ...o, label: 'Pirate' } : o)) };
  const e1 = await erreur(sqlRestauration(altere));
  await db.exec('ROLLBACK');
  check(e1 && /altérée/.test(e1), `sauvegarde altérée refusée (${e1})`);
  check((await q('SELECT count(*)::int AS n FROM public.subscription_offers'))[0].n === 0, 'refus : aucune offre écrite');

  await db.exec(sqlR);
  const apres = await etat();
  check(JSON.stringify(apres.table) === JSON.stringify(avant.table), 'C’EST LA PROPRIÉTÉ QUI COMPTE : offres identiques ligne à ligne, dates à la microseconde');
  check(JSON.stringify(apres.droits) === JSON.stringify(avant.droits), 'droits manage_offers identiques (jeton révoqué compris)');
  check(JSON.stringify(apres.page) === JSON.stringify(avant.page), 'la page lit la même offre sur les quatre sites');
  check(JSON.stringify(sansHorloge(apres.liste)) === JSON.stringify(sansHorloge(avant.liste)), 'la liste du marketing est la même');

  // Rejouer la restauration : rien ne change.
  await db.exec(sqlR);
  check(JSON.stringify(sansHorloge(await etat())) === JSON.stringify(sansHorloge(avant)), 'restauration rejouée : aucun changement');

  // Une offre modifiée ou créée entre-temps : la restauration refuse au lieu de mélanger.
  await creer(['www.lexpress.fr'], heure(1), heure(3), { label: 'Nouvelle' });
  const e2 = await erreur(sqlR);
  await db.exec('ROLLBACK');
  check(e2 && /offres différentes/.test(e2), `offre en plus : restauration refusée (${e2})`);
  check((await q('SELECT count(*)::int AS n FROM public.subscription_offers'))[0].n === 6, 'refus : la table est restée telle quelle');

  // Fichier qui n'est pas une sauvegarde.
  check(cli('sql-restauration', join(dir, 'absent.json')).status !== 0, 'fichier absent : échec');
  writeFileSync(join(dir, 'autre.json'), '[{"x":1}]');
  check(cli('sql-restauration', join(dir, 'autre.json')).status !== 0, 'autre document : échec');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`Offres, retour arrière : ${n} contrôles — interrupteur réversible, sauvegarde, DROP, ré-application, restauration identique et rejouable, refus sûrs (PGlite, simulé).`);
