// Migration 020 (24/11) : une offre ne s'affiche que par son lien, et un jeton créé a le droit de gérer
// les offres. Ce test vérifie la migration elle-même, sur une base PGlite dans l'état de la PROD du 24/11
// (018 et 019 en place, fonction subscription-offers v1), sans réseau ni secret :
//   1. rien d'autre ne change : lecture d'article (v1, v2, _for_edition, v3), create_gift_links, fonctions
//      des jetons — empreintes md5(pg_get_functiondef) et droits identiques ; jetons existants intacts ;
//   2. la fonction v1 déjà déployée continue de créer, lister et terminer après 020 ;
//   3. 020 est rejouable ; son retour arrière est gardé (offre en cours = refus) et remet EXACTEMENT 018
//      (mêmes empreintes, mêmes droits, défaut `manage_offers` faux) ; 020 se ré-applique ensuite.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { sqlSauvegardeCodes, sqlVerificationCodes, sqlRestaurationCodes, sqlRetourArriere020, lireSauvegardeCodes } from './gift-links/supabase/sauvegarde/codes-020.mjs';

let n = 0; const check = (c, l) => { assert.ok(c, l); n++; };
const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
const lire = (f) => readFileSync(`gift-links/supabase/${f}`, 'utf8');
for (const f of readdirSync('gift-links/supabase').filter((f) => /^\d.*\.sql$/.test(f) && !f.startsWith('004') && f < '020').sort()) await db.exec(lire(f));
const M020 = lire('020-offre-par-parametre.sql');
const R020 = lire('rollback/020-offre-par-parametre.sql');
const q = async (sql, args) => JSON.parse(JSON.stringify((await db.query(sql, args)).rows));
const erreur = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return `${e.code} ${e.message}`; } };
const sha = (s) => createHash('sha256').update(s).digest('hex');

// Empreintes : définition complète (corps, options, signature) et droits de chaque fonction.
const empreintes = async (filtre) => Object.fromEntries((await q(`
  SELECT p.oid::regprocedure::text AS f, md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '') AS h
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname ~ $1 ORDER BY 1`, [filtre])).map((r) => [r.f, r.h]));
const PROTEGEES = '^(get_gift_article|create_gift_links|create_api_client|verify_api_client|revoke_api_client|count_client_links)';
const OFFRES = '(subscription_offer|^offer_|^assert_offer_manager$|^new_offer_code$)';
const colonnes = async (table) => q(`SELECT column_name, column_default, is_nullable, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`, [table]);
const commentaires = async () => q(`SELECT obj_description('public.subscription_offers'::regclass) AS t,
  col_description('public.api_clients'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.api_clients'::regclass AND attname = 'manage_offers')) AS c`);

// ── L'ÉTAT DE LA PROD DU 24/11, avec des données : jetons avec et sans droit, un révoqué, offres variées.
const jeton = async (nom) => (await q('SELECT public.create_api_client($1,$2) AS id', [nom, sha(nom)]))[0].id;
const MARKETING = await jeton('marketing-offres');
await q('UPDATE public.api_clients SET manage_offers = true WHERE id = $1', [MARKETING]);
for (const nom of ['hubspot-emails', 'n8n-agent-whatsapp', 'regwall']) await jeton(nom);
await jeton('ancien'); await q("SELECT public.revoke_api_client('ancien')");
check((await q('SELECT count(*)::int AS n FROM public.api_clients WHERE manage_offers'))[0].n === 1, 'avant 020 : un jeton créé n’a pas le droit (018)');
const creer = (sites, debutH, finH, label) => q('SELECT (public.create_subscription_offer($1, $2, $3, $4, NULL, $5)).id AS id',
  [MARKETING, sites, new Date(Date.now() + finH * 3600e3).toISOString(), new Date(Date.now() + debutH * 3600e3).toISOString(), label]);
await creer(['www.lexpress.fr'], -1, 48, 'En cours');
await creer(['pl.lexpress.eu'], 24, 48, 'Do przodu');
await q('SELECT public.cache_articles($1::jsonb)', [JSON.stringify([{ edition: 'FR', arc_id: 'ENVOI_020', canonical_url: 'https://www.lexpress.fr/envoi-020', title: 'Article offert', body: 'Le corps.' }])]);
const lien = (await q("SELECT token FROM public.create_gift_links_for_edition('FR', ARRAY['ENVOI_020'])"))[0].token;

const protegeesAvant = await empreintes(PROTEGEES);
const offres018 = await empreintes(OFFRES);
const colonnesClients018 = await colonnes('api_clients');
const colonnesOffres018 = await colonnes('subscription_offers');
const commentaires018 = await commentaires();
const jetonsAvant = await q('SELECT id, name, active, manage_offers, token_sha256, calls, links_created FROM public.api_clients ORDER BY id');
check(Object.keys(protegeesAvant).length >= 10, `fonctions protégées relevées : ${Object.keys(protegeesAvant).join(', ')}`);

// ── 1. 020 : RIEN D'AUTRE NE CHANGE.
await db.exec(M020);
check(JSON.stringify(await empreintes(PROTEGEES)) === JSON.stringify(protegeesAvant),
  'C’EST LA PROPRIÉTÉ QUI COMPTE : lecture d’article (v1, v2, _for_edition, v3), create_gift_links et fonctions des jetons — empreintes et droits identiques');
check(JSON.stringify(await q('SELECT id, name, active, manage_offers, token_sha256, calls, links_created FROM public.api_clients ORDER BY id')) === JSON.stringify(jetonsAvant),
  'C’EST LA PROPRIÉTÉ QUI COMPTE : jetons existants intacts — aucun ne reçoit le droit (décision du 24/11)');
const ap = await empreintes(OFFRES);
for (const f of ['end_subscription_offer(uuid,uuid)', 'assert_offer_manager(uuid)', 'offer_site_family(text)', 'offer_site_language(text)', 'offer_url_family(text)', 'offer_sites_valid(text[])']) {
  check(ap[f] === offres018[f], `${f} inchangée`);
}
check(!('get_subscription_offer(text)' in ap) && !('current_subscription_offer_id(text)' in ap) && 'get_subscription_offer(text,text)' in ap,
  'lecture publique : (site, code) seulement');
check(/anon=X/.test(ap['get_subscription_offer(text,text)']) && !/anon=X/.test(ap['end_subscription_offer_by_code(uuid,text)'])
  && !/anon=X/.test(ap['new_offer_code()']) && !/anon=X/.test(ap['create_subscription_offer(uuid,text[],timestamp with time zone,timestamp with time zone,text,text,text,text,text)']),
  'droits : la clé publique n’exécute que la lecture d’offre');
const codes = await q('SELECT id, code FROM public.subscription_offers ORDER BY id');
check(codes.length === 2 && codes.every((c) => /^[0-9a-f]{16}$/.test(c.code)) && codes[0].code !== codes[1].code,
  'les offres déjà enregistrées reçoivent chacune un code distinct, non devinable');
const nouveau = await jeton('nouveau-service');
check((await q('SELECT manage_offers FROM public.api_clients WHERE id = $1', [nouveau]))[0].manage_offers === true,
  'C’EST LA PROPRIÉTÉ QUI COMPTE : un jeton créé après 020 a le droit de gérer les offres');
// Lecture d'article : toujours la même réponse, comptée une fois.
const avantLectures = (await q('SELECT count(*)::int AS n FROM public.gift_link_opens'))[0].n;
const article = await q("SELECT status FROM public.get_gift_article_for_edition_v3('FR', $1, 'Recette020', NULL, NULL, 'abc_123', NULL)", [lien]);
check(article.length === 1 && (await q('SELECT count(*)::int AS n FROM public.gift_link_opens'))[0].n === avantLectures + 1,
  `lecture d’article v3 : répond (${article[0]?.status}) et compte une lecture, comme avant`);

// ── 2. LA FONCTION v1 DÉJÀ DÉPLOYÉE continue de fonctionner après 020 (avant le déploiement de v2).
{
  const rpc = async (name, args) => {
    const sql = {
      verify_api_client: ['SELECT * FROM public.verify_api_client($1)', [args.p_token_sha256]],
      list_subscription_offers: ['SELECT public.list_subscription_offers($1::uuid) AS r', [args.p_client_id]],
      end_subscription_offer: ['SELECT public.end_subscription_offer($1::uuid, $2::uuid) AS r', [args.p_client_id, args.p_id]],
      // Appel par noms, sans p_code : exactement ce que v1 envoie à PostgREST.
      create_subscription_offer: [`SELECT * FROM public.create_subscription_offer(p_client_id => $1::uuid,
        p_sites => ARRAY(SELECT jsonb_array_elements_text($2::jsonb)), p_ends_at => $3::timestamptz,
        p_starts_at => $4::timestamptz, p_url => $5, p_label => $6, p_name => $7, p_request_id => $8)`,
        [args.p_client_id, JSON.stringify(args.p_sites), args.p_ends_at, args.p_starts_at, args.p_url, args.p_label, args.p_name, args.p_request_id]],
    }[name];
    check(Object.keys(args).every((k) => k !== 'p_code'), `v1 n’envoie pas p_code (${name})`);
    try {
      await db.exec('SET ROLE service_role');
      const rows = await q(...sql);
      return { data: ['end_subscription_offer', 'list_subscription_offers'].includes(name) ? rows[0].r : rows, error: null };
    } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
    finally { await db.exec('RESET ROLE'); }
  };
  let handler;
  const source = readFileSync('gift-links/fixtures/subscription-offers-v1.bundle.ts.txt', 'utf8').replace(/^import .*jsr:.*;$/m, '');
  vm.runInContext(stripTypeScriptTypes(source), vm.createContext({
    URL, Response, Request, TextEncoder, crypto, Date, Set, Map, Object, console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: () => 'fictif' }, serve: (h) => { handler = h; } }, createClient: () => ({ rpc }),
  }));
  const appel = async (method, corps, query = '') => {
    const r = await handler(new Request(`https://local.invalid/subscription-offers${query}`, {
      method, headers: { 'x-gift-service-token': 'marketing-offres' }, body: corps === undefined ? undefined : JSON.stringify(corps),
    }));
    return { status: r.status, corps: await r.json() };
  };
  const cree = await appel('POST', { sites: ['www.lexpress.eu'], ends_at: new Date(Date.now() + 86400e3).toISOString(), label: 'Offer', request_id: 'v1-apres-020' });
  check(cree.status === 201 && cree.corps.offer.status === 'active', `v1 après 020 : création 201 — obtenu ${cree.status} ${JSON.stringify(cree.corps).slice(0, 120)}`);
  const code = (await q('SELECT code FROM public.subscription_offers WHERE id = $1', [cree.corps.offer.id]))[0].code;
  check(/^[0-9a-f]{16}$/.test(code), 'v1 après 020 : l’offre reçoit un code engendré');
  const liste = await appel('GET');
  check(liste.status === 200 && liste.corps.offers.length === 3, 'v1 après 020 : liste 200');
  const fin = await appel('DELETE', undefined, `?id=${cree.corps.offer.id}`);
  check(fin.status === 200 && fin.corps.result === 'ended', 'v1 après 020 : fin par id 200');
}

// ── 3. REJOUABLE.
{
  const avant = { f: await empreintes(`${PROTEGEES}|${OFFRES}`), codes: await q('SELECT id, code FROM public.subscription_offers ORDER BY id') };
  await db.exec(M020);
  check(JSON.stringify(await empreintes(`${PROTEGEES}|${OFFRES}`)) === JSON.stringify(avant.f)
    && JSON.stringify(await q('SELECT id, code FROM public.subscription_offers ORDER BY id')) === JSON.stringify(avant.codes),
    '020 rejouée : mêmes fonctions, mêmes droits, mêmes codes');
}

// ── 4. RETOUR ARRIÈRE GARDÉ, puis EXACT.
{
  const e018 = await erreur(lire('rollback/018-offres-abonnement.sql'));
  await db.exec('ROLLBACK');
  check(e018 && /rollback\/020/.test(e018) && (await q("SELECT to_regclass('public.subscription_offers') AS t"))[0].t !== null,
    `retour arrière de 018 avec 020 en place : refusé, rien supprimé (${e018})`);
  const avantRefus = await empreintes(OFFRES);
  const e = await erreur(R020);
  await db.exec('ROLLBACK');
  check(e && /offre\(s\) en cours ou à venir/.test(e),
    `C’EST LA PROPRIÉTÉ QUI COMPTE : retour arrière refusé tant qu’une offre vit — elle deviendrait globale (${e})`);
  check(JSON.stringify(await empreintes(OFFRES)) === JSON.stringify(avantRefus), 'refus : rien n’a changé');

  // Un code choisi, déjà envoyé dans des liens : il doit survivre au retour arrière puis à la ré-application.
  await q("UPDATE public.subscription_offers SET code = 'black-friday-2026' WHERE id = (SELECT min(id::text)::uuid FROM public.subscription_offers)");
  await q('UPDATE public.subscription_offers SET ended_at = now() WHERE ended_at IS NULL AND ends_at > now()');
  // Sauvegarde des codes (lecture seule), contrôlée, vérifiée sans écriture.
  const [{ sauvegarde }] = await q(sqlSauvegardeCodes());
  check(/^\s*(--.*\n)*SELECT /.test(sqlSauvegardeCodes()) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/.test(sqlSauvegardeCodes()), 'sauvegarde des codes : une seule lecture');
  const docCodes = lireSauvegardeCodes(JSON.stringify([{ sauvegarde }]));
  check(docCodes.codes.length === 3 && docCodes.codes.some((c) => c.code === 'black-friday-2026'), 'sauvegarde : 3 codes, dont le code choisi');
  const codesAvant = await q('SELECT id, code FROM public.subscription_offers ORDER BY id');
  await db.exec(sqlVerificationCodes(docCodes));
  check(JSON.stringify(await q('SELECT id, code FROM public.subscription_offers ORDER BY id')) === JSON.stringify(codesAvant), 'vérification des codes : passe, n’écrit rien');
  for (const [quoi, faux] of [
    ['code mal formé', { ...docCodes, codes: [{ id: docCodes.codes[0].id, code: 'Pas Un Code' }] }],
    ['doublon', { ...docCodes, codes: [docCodes.codes[0], { ...docCodes.codes[1], code: docCodes.codes[0].code }] }],
    ['autre format', { ...docCodes, format: 'x' }],
  ]) {
    let refus = null; try { lireSauvegardeCodes(JSON.stringify(faux)); } catch (err) { refus = err.message; }
    check(refus !== null, `sauvegarde des codes refusée dès la lecture : ${quoi}`);
  }

  // Revue GPT du 24/11, constat 1 : une offre créée (puis terminée) APRÈS la sauvegarde perdrait son code
  // au retour arrière. Vérification et retour arrière gardé refusent, sans rien supprimer.
  {
    const tardive = (await q(`SELECT (public.create_subscription_offer($1, ARRAY['www.lexpress.fr'], now() + interval '1 day', NULL, NULL, 'Tardive', NULL, NULL, 'apres-sauvegarde')).id AS id`, [MARKETING]))[0].id;
    await q('SELECT public.end_subscription_offer($1, $2)', [MARKETING, tardive]);
    const eV = await erreur(sqlVerificationCodes(docCodes)); await db.exec('ROLLBACK');
    check(eV && /différents de la sauvegarde/.test(eV), `offre créée après la sauvegarde : la vérification refuse (${eV})`);
    const eG = await erreur(sqlRetourArriere020(docCodes)); await db.exec('ROLLBACK');
    check(eG && /retour arrière de 020 refusé.*différents de la sauvegarde/.test(eG), `et le retour arrière gardé refuse (${eG})`);
    check((await q("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'subscription_offers' AND column_name = 'code'"))[0].n === 1,
      'refus : la colonne code est toujours là');
    await q('DELETE FROM public.subscription_offers WHERE id = $1', [tardive]);
  }
  check((sqlRetourArriere020(docCodes).match(/^BEGIN;$/gm) ?? []).length === 1 && (sqlRetourArriere020(docCodes).match(/^COMMIT;$/gm) ?? []).length === 1
    && sqlRetourArriere020(docCodes).includes(R020.split('-- ── Définitions de 018, recopiées à l\'identique.')[1].replace(/\nCOMMIT;\n?$/, '')),
    'retour arrière gardé : une seule transaction, définitions de 018 recopiées sans altération');
  await db.exec(sqlRetourArriere020(docCodes));
  check(JSON.stringify(await empreintes(OFFRES)) === JSON.stringify(offres018),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : après retour arrière, les fonctions des offres sont exactement celles de 018 (empreintes et droits)');
  check(JSON.stringify(await empreintes(PROTEGEES)) === JSON.stringify(protegeesAvant), 'et les fonctions protégées n’ont jamais bougé');
  check(JSON.stringify(await colonnes('api_clients')) === JSON.stringify(colonnesClients018), 'api_clients : colonnes et défaut (manage_offers faux) de 018');
  check(JSON.stringify(await colonnes('subscription_offers')) === JSON.stringify(colonnesOffres018), 'subscription_offers : colonnes de 018 (code retiré)');
  check(JSON.stringify(await commentaires()) === JSON.stringify(commentaires018), 'commentaires de 018');
  check((await q('SELECT count(*)::int AS n FROM public.subscription_offers'))[0].n === 3, 'les offres (terminées) restent');
  check((await q('SELECT manage_offers FROM public.api_clients WHERE id = $1', [nouveau]))[0].manage_offers === true,
    'le jeton créé sous 020 garde son droit (à décider jeton par jeton, runbook)');
  check((await q("SELECT * FROM public.get_subscription_offer('www.lexpress.fr')")).length === 0, 'la lecture de 018 répond (aucune offre en cours)');
  // 018 seule, après retour arrière : un jeton créé n'a plus le droit.
  const apres = await jeton('apres-retour');
  check((await q('SELECT manage_offers FROM public.api_clients WHERE id = $1', [apres]))[0].manage_offers === false, 'après retour arrière : défaut faux, comme en 018');

  const avant020 = await erreur(sqlRestaurationCodes(docCodes));
  await db.exec('ROLLBACK');
  check(avant020 && /appliquer 020/.test(avant020), `restauration des codes avant 020 : refusée (${avant020})`);

  await db.exec(M020);
  check((await q("SELECT count(*)::int AS n FROM public.subscription_offers WHERE code ~ '^[0-9a-f]{16}$'"))[0].n === 3, '020 ré-appliquée : nouveaux codes engendrés');
  check(JSON.stringify(await empreintes(`${OFFRES}`)) === JSON.stringify(ap), '020 ré-appliquée : mêmes fonctions et droits que la première fois');
  const eVerif = await erreur(sqlVerificationCodes(docCodes)); await db.exec('ROLLBACK');
  check(eVerif && /différents de la sauvegarde/.test(eVerif), 'vérification après ré-application : signale les codes perdus');
  // Une offre créée depuis a pris le code sauvegardé : la restauration refuse, sans rien écrire.
  const intruse = (await q(`SELECT (public.create_subscription_offer($1, ARRAY['www.lexpress.fr'], now() + interval '1 day', NULL, NULL, 'Intruse', NULL, NULL, 'black-friday-2026')).id AS id`, [MARKETING]))[0].id;
  const codesIntrus = await q('SELECT id, code FROM public.subscription_offers ORDER BY id');
  const eConflit = await erreur(sqlRestaurationCodes(docCodes)); await db.exec('ROLLBACK');
  check(eConflit && /déjà pris par une offre créée depuis : black-friday-2026/.test(eConflit), `code repris entre-temps : restauration refusée (${eConflit})`);
  check(JSON.stringify(await q('SELECT id, code FROM public.subscription_offers ORDER BY id')) === JSON.stringify(codesIntrus), 'refus : aucun code changé');
  await q('DELETE FROM public.subscription_offers WHERE id = $1', [intruse]);
  // Revue GPT, constat 2 : un code existant égal à l'ancien code provisoire (déterministe) ne bloque plus.
  const ancienProvisoire = `tmp-${createHash('md5').update(docCodes.codes[0].id).digest('hex')}`;
  const piege = (await q(`SELECT (public.create_subscription_offer($1, ARRAY['www.lexpress.fr'], now() + interval '1 day', NULL, NULL, 'Piège', NULL, NULL, $2)).id AS id`, [MARKETING, ancienProvisoire]))[0].id;
  const altere = { ...docCodes, codes: docCodes.codes.map((c, i) => (i === 0 ? { ...c, code: 'pirate-001' } : c)) };
  const eAltere = await erreur(sqlRestaurationCodes(altere)); await db.exec('ROLLBACK');
  check(eAltere && /altérée/.test(eAltere), 'sauvegarde des codes altérée : refusée');
  await db.exec(sqlRestaurationCodes(docCodes));
  check((await q('SELECT code FROM public.subscription_offers WHERE id = $1', [piege]))[0].code === ancienProvisoire,
    'une offre dont le code ressemble à un code provisoire ne bloque pas la restauration, et garde son code');
  await q('DELETE FROM public.subscription_offers WHERE id = $1', [piege]);
  check(JSON.stringify(await q('SELECT id, code FROM public.subscription_offers ORDER BY id')) === JSON.stringify(codesAvant),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : après retour arrière et ré-application, chaque offre retrouve son code — un lien envoyé ne désigne jamais une autre offre');
  await db.exec(sqlRestaurationCodes(docCodes));
  check(JSON.stringify(await q('SELECT id, code FROM public.subscription_offers ORDER BY id')) === JSON.stringify(codesAvant), 'restauration des codes rejouée : aucun changement');
  await db.exec(sqlVerificationCodes(docCodes));
  check(true, 'vérification après restauration : passe');
}

await db.close();
console.log(`migration 020 : ${n} contrôles — empreintes protégées inchangées, v1 compatible, rejouable, retour arrière gardé et exact (PGlite, simulé).`);
