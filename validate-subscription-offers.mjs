// Offres d'abonnement (018, puis 020) : la table, la RPC publique, la fonction de gestion et sa validation.
//
// Trois propriétés valent le test. La page ne lit QUE libellé, URL et date de fin, et rien d'autre
// n'est ouvert à la clé publique. Une offre ne s'affiche que par son lien (020 : site ET code, valable
// maintenant), jamais pour tous les lecteurs. Et un service sans le droit `manage_offers` ne gère rien.
// Tout tourne en local (PGlite), sans réseau ni secret.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { familleUrl, validerOffre } from './gift-links/functions/_shared/offres.mjs';
import { buildOffres, CIBLE_OFFRES } from './build-gift-links-function.mjs';

let n = 0; const check = (c, l) => { assert.ok(c, l); n++; };

const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
const migrations = readdirSync('gift-links/supabase').filter((f) => /^\d.*\.sql$/.test(f) && !f.startsWith('004')).sort();
check(migrations.includes('018-offres-abonnement.sql') && migrations.includes('020-offre-par-parametre.sql'), '018 et 020 sont présentes (019 : validate-send-id.mjs)');
for (const f of migrations) await db.exec(readFileSync(`gift-links/supabase/${f}`, 'utf8'));
const q = async (sql, args) => JSON.parse(JSON.stringify((await db.query(sql, args)).rows));
const rejette = async (sql, args, motif, libelle) => {
  let erreur = null;
  try { await db.query(sql, args); } catch (e) { erreur = e; }
  check(erreur && motif.test(`${erreur.code} ${erreur.message}`), `${libelle} — obtenu ${erreur ? `${erreur.code} ${erreur.message}` : 'aucune erreur'}`);
  return erreur;
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const client = async (nom, jeton, droit) => {
  const id = (await q('SELECT public.create_api_client($1,$2) AS id', [nom, sha(jeton)]))[0].id;
  if (droit) await q('UPDATE public.api_clients SET manage_offers = true WHERE id = $1', [id]);
  return id;
};
const MARKETING = await client('marketing-offres', 'jeton-fictif-marketing', true);
const WHATSAPP = await client('agent-whatsapp', 'jeton-fictif-whatsapp', false);
// 020 : un jeton créé a le droit par défaut ; « sans droit » se retire donc explicitement.
await q('UPDATE public.api_clients SET manage_offers = false WHERE id = $1', [WHATSAPP]);
const REVOQUE = await client('ancien-marketing', 'jeton-fictif-revoque', true);
await q("SELECT public.revoke_api_client('ancien-marketing')");

// ── 1. LES DROITS. La clé publique ne voit que la RPC, et la RPC ne rend que trois champs.
{
  check((await q("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subscription_offers'::regclass"))[0].relrowsecurity,
    'RLS active sur subscription_offers');
  check((await q("SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'subscription_offers'"))[0].n === 0,
    'aucune politique : RLS fermée, pour la lecture comme pour l’écriture');
  check((await q("SELECT column_name FROM information_schema.columns WHERE table_name='api_clients' AND column_name='manage_offers' AND column_default='true'")).length === 1,
    '020 : le droit de gérer les offres est vrai par défaut pour un jeton créé');
  const neuf = await client('jeton-neuf', 'jeton-fictif-neuf', false);
  check((await q('SELECT manage_offers FROM public.api_clients WHERE id = $1', [neuf]))[0].manage_offers === true,
    'C’EST LA PROPRIÉTÉ QUI COMPTE (décision du 24/11) : create_api_client crée un jeton qui a le droit');
  await q("SELECT public.revoke_api_client('jeton-neuf')");
  check((await q("SELECT to_regprocedure('public.get_subscription_offer(text)') AS f"))[0].f === null
    && (await q("SELECT to_regprocedure('public.current_subscription_offer_id(text)') AS f"))[0].f === null,
    'plus de lecture par site seul : l’offre « globale » n’existe plus');
  const cols = await q("SELECT pg_get_function_result('public.get_subscription_offer(text,text)'::regprocedure) AS r");
  check(cols[0].r === 'TABLE(label text, url text, ends_at timestamp with time zone)',
    `C’EST LA PROPRIÉTÉ QUI COMPTE : la RPC publique ne rend que libellé, URL et date de fin — obtenu ${cols[0].r}`);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    for (const [sql, quoi] of [
      ['SELECT * FROM public.subscription_offers', 'lecture de la table'],
      ["INSERT INTO public.subscription_offers (sites, ends_at) VALUES (ARRAY['www.lexpress.fr'], now() + interval '1 day')", 'écriture dans la table'],
      ['DELETE FROM public.subscription_offers', 'suppression dans la table'],
      [`SELECT public.create_subscription_offer('${MARKETING}', ARRAY['www.lexpress.fr'], now() + interval '1 day')`, 'création par la RPC'],
      [`SELECT public.end_subscription_offer_by_code('${MARKETING}', 'black-friday')`, 'fin d’une offre par code'],
      ['SELECT public.new_offer_code()', 'tirage d’un code'],
      [`SELECT * FROM public.list_subscription_offers('${MARKETING}')`, 'liste des offres'],
      [`SELECT public.end_subscription_offer('${MARKETING}', gen_random_uuid())`, 'fin d’une offre'],
      [`SELECT public.assert_offer_manager('${MARKETING}')`, 'contrôle de droit'],
      ['SELECT manage_offers FROM public.api_clients', 'lecture des droits des services'],
    ]) await rejette(sql, [], /42501|permission denied/, `${role} : ${quoi} refusée`);
    check((await q("SELECT * FROM public.get_subscription_offer('www.lexpress.fr', 'black-friday')")).length === 0,
      `${role} : la RPC publique répond, sans offre en cours`);
    await db.exec('RESET ROLE');
  }
}

// ── 2. L'OFFRE PAR SON LIEN (020). Site ET code, valable maintenant ; sinon rien, et le bouton par défaut.
const ins = (code, sites, debut, fin, label, finAnticipee = false) => q(
  `INSERT INTO public.subscription_offers (code, sites, starts_at, ends_at, label, url, ended_at)
   VALUES ($1, $2::text[], now() + $3::interval, now() + $4::interval, $5, NULL, CASE WHEN $6 THEN now() END) RETURNING id`,
  [code, sites, debut, fin, label, finAnticipee]);
const affichee = async (site, code) => (await q('SELECT * FROM public.get_subscription_offer($1, $2)', [site, code]))[0] ?? null;
{
  await ins('black-friday-2026', ['www.lexpress.fr', 'fr.lexpress.eu'], '-1 day', '+5 days', 'Black Friday');
  await ins('noel-2026', ['www.lexpress.fr'], '-2 days', '+20 days', 'Noël');
  await ins('expiree', ['www.lexpress.fr'], '-10 days', '-1 second', 'Expirée');
  await ins('pas-commencee', ['www.lexpress.fr'], '+1 hour', '+3 days', 'À venir');
  await ins('finie-tot', ['www.lexpress.fr'], '-1 day', '+3 days', 'Finie tôt', true);
  await ins('pologne', ['pl.lexpress.eu'], '-1 day', '+3 days', 'Oferta');
  check((await affichee('www.lexpress.fr', 'black-friday-2026'))?.label === 'Black Friday', 'offre valable, son code : rendue');
  check((await affichee('www.lexpress.fr', 'noel-2026'))?.label === 'Noël',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : deux offres coexistent, chacune rendue par son propre code');
  check((await affichee('fr.lexpress.eu', 'black-friday-2026'))?.label === 'Black Friday', 'même code, autre site visé : rendue');
  for (const [cas, site, code] of [
    ['sans code', 'www.lexpress.fr', null],
    ['code vide', 'www.lexpress.fr', ''],
    ['offre expirée', 'www.lexpress.fr', 'expiree'],
    ['offre pas encore commencée', 'www.lexpress.fr', 'pas-commencee'],
    ['offre terminée en avance', 'www.lexpress.fr', 'finie-tot'],
    ['code inconnu', 'www.lexpress.fr', 'inconnu-2026'],
    ['offre d’un autre site', 'www.lexpress.fr', 'pologne'],
    ['offre d’un autre site (EU)', 'www.lexpress.eu', 'black-friday-2026'],
    ['code en majuscules', 'www.lexpress.fr', 'BLACK-FRIDAY-2026'],
    ['site inconnu', 'lexpress.fr', 'black-friday-2026'],
    ['site nul', null, 'black-friday-2026'],
  ]) check(await affichee(site, code) === null, `C’EST LA PROPRIÉTÉ QUI COMPTE : ${cas} → rien, bouton par défaut`);
  check((await affichee('www.lexpress.fr', 'black-friday-2026')).url === null, 'sans URL, la RPC rend NULL : la page garde son lien par défaut');
  // Fin exacte : à ends_at, plus rien (fin exclue), comme en 018.
  await db.exec('BEGIN');
  await q("INSERT INTO public.subscription_offers (code, sites, starts_at, ends_at) VALUES ('a-l-instant', ARRAY['www.lexpress.fr'], now() - interval '1 day', now())");
  check(await affichee('www.lexpress.fr', 'a-l-instant') === null, 'à la date de fin exacte : plus rien');
  await db.exec('ROLLBACK');
  // Lecture seule : la RPC publique ne peut rien écrire (STABLE), ni compter une lecture d'article.
  check((await q("SELECT provolatile FROM pg_proc WHERE oid = 'public.get_subscription_offer(text,text)'::regprocedure"))[0].provolatile === 's',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : la lecture d’offre est STABLE, PostgreSQL y interdit toute écriture');
  const lectures = (await q('SELECT count(*)::int AS n FROM public.gift_link_opens'))[0].n;
  await db.exec('SET ROLE anon');
  for (let i = 0; i < 20; i++) await q('SELECT * FROM public.get_subscription_offer($1, $2)', ['www.lexpress.fr', i % 2 ? 'black-friday-2026' : 'inconnu']);
  await db.exec('RESET ROLE');
  check((await q('SELECT count(*)::int AS n FROM public.gift_link_opens'))[0].n === lectures, 'vingt lectures d’offre : aucune lecture d’article comptée');
  await q('DELETE FROM public.subscription_offers');
}

// ── 3. LES CONTRAINTES. Même si quelqu'un écrit à la main dans la table.
{
  const brut = (cols, vals) => `INSERT INTO public.subscription_offers (sites, ends_at, ${cols}) VALUES (ARRAY['www.lexpress.fr'], now() + interval '1 day', ${vals})`;
  for (const url of ['http://abonnements-digitaux.lexpress.fr/offres', 'https://abonnements-digitaux.lexpress.fr:443/offres',
    'https://evil.test/offres', 'https://lexpress.fr.evil.test/', 'https://www.lexpress.fr@evil.test/', 'https://user@www.lexpress.fr/',
    'https://www.lexpress.fr/a b', 'javascript:alert(1)', 'https://WWW.LEXPRESS.FR/', 'https://de.lexpress.eu/', 'https://www.lexpress.fr#x',
    'https://www.lexpress.fr\\@evil.test/', `https://www.lexpress.fr/${'a'.repeat(500)}`]) {
    await rejette(brut('url', '$1'), [url], /23514/, `URL refusée par la base : ${url.slice(0, 60)}`);
    check(familleUrl(url) === null, `et par la fonction : ${url.slice(0, 60)}`);
  }
  for (const url of ['https://abonnements-digitaux.lexpress.fr/offres?refTarif=1329', 'https://www.lexpress.fr/', 'https://lexpress.fr',
    'https://www.lexpress.eu/subscribe/', 'https://pl.lexpress.eu/subskrypcja/', 'https://fr.lexpress.eu/abonnement/?code=BF']) {
    const famille = (await q('SELECT public.offer_url_family($1) AS f', [url]))[0].f;
    check(famille !== null && famille === familleUrl(url), `URL acceptée, même famille en SQL et en JS : ${url}`);
  }
  await rejette(brut('label', '$1'), ['x'.repeat(41)], /23514/, 'libellé de 41 caractères refusé');
  await rejette(brut('label', '$1'), [' espace '], /23514/, 'libellé non nettoyé refusé');
  await rejette(brut('label', '$1'), ['deux\nlignes'], /23514/, 'libellé sur deux lignes refusé');
  await q(brut('label', '$1'), ['é'.repeat(40)]);
  check(true, '40 caractères accentués passent : la longueur se compte en caractères, pas en octets');
  await rejette("INSERT INTO public.subscription_offers (sites, ends_at) VALUES (ARRAY[]::text[], now() + interval '1 day')", [], /23514/, 'aucun site : refus');
  await rejette("INSERT INTO public.subscription_offers (sites, ends_at) VALUES (ARRAY['lexpress.fr'], now() + interval '1 day')", [], /23514/, 'site inconnu : refus');
  await rejette("INSERT INTO public.subscription_offers (sites, ends_at) VALUES (ARRAY['www.lexpress.fr','www.lexpress.fr'], now() + interval '1 day')", [], /23514/, 'site en double : refus');
  await rejette("INSERT INTO public.subscription_offers (sites, ends_at) VALUES (ARRAY['www.lexpress.fr', NULL], now() + interval '1 day')", [], /23514/, 'site nul : refus');
  await rejette("INSERT INTO public.subscription_offers (sites, starts_at, ends_at) VALUES (ARRAY['www.lexpress.fr'], now(), now() - interval '1 day')", [], /23514/, 'fin avant début : refus');
  await rejette("INSERT INTO public.subscription_offers (sites) VALUES (ARRAY['www.lexpress.fr'])", [], /23502/, 'C’EST LA PROPRIÉTÉ QUI COMPTE : la date de fin est obligatoire — une offre oubliée ne reste pas affichée pour toujours');
  for (const code of ['ab', 'x'.repeat(41), 'Black-Friday', 'black_friday', 'noël', 'a b c', 'abc/def', '']) {
    await rejette(brut('code', '$1'), [code], /23514/, `code refusé par la base : ${JSON.stringify(code.slice(0, 45))}`);
  }
  await rejette(brut('code', 'NULL'), [], /23502/, 'code nul refusé');
  await q(brut('code', '$1'), ['black-friday-2026']);
  await rejette(brut('code', '$1'), ['black-friday-2026'], /23505/, 'C’EST LA PROPRIÉTÉ QUI COMPTE : un code est unique — un lien ne désigne qu’une offre');
  const engendre = (await q(`${brut('label', "'x'")} RETURNING code`))[0].code;
  check(/^[0-9a-f]{16}$/.test(engendre), `sans code, la base en tire un, non devinable (16 hexadécimaux) : ${engendre}`);
  await q('DELETE FROM public.subscription_offers');
}

// ── 4. LA VALIDATION DE LA FONCTION, champ par champ.
{
  const now = new Date('2026-11-23T12:00:00Z');
  const ok = (corps) => validerOffre(corps, now);
  const base = { sites: ['www.lexpress.fr'], ends_at: '2026-11-30T23:59:00+01:00' };
  const v = ok(base);
  check(!v.erreur && v.offre.p_ends_at === '2026-11-30T22:59:00.000Z' && v.offre.p_starts_at === null && v.offre.p_url === null && v.offre.p_label === null,
    'le minimum : un site et une date de fin ; début, URL et libellé par défaut');
  for (const [cas, corps, motif] of [
    ['clé inconnue', { ...base, refTarif: 1 }, /non reconnue.*refTarif/],
    ['sans fin', { sites: ['www.lexpress.fr'] }, /ends_at.*obligatoire/],
    ['sans site', { ends_at: base.ends_at }, /sites est obligatoire/],
    ['site inconnu', { ...base, sites: ['lexpress.fr'] }, /site\(s\) inconnu/],
    ['site en double', { ...base, sites: ['pl.lexpress.eu', 'pl.lexpress.eu'] }, /doublon/],
    ['date sans fuseau', { ...base, ends_at: '2026-11-30T23:59:00' }, /avec fuseau/],
    ['date en nombre', { ...base, ends_at: 1764543540000 }, /avec fuseau/],
    ['date impossible', { ...base, ends_at: '2026-11-31T22:00:00Z' }, /date du calendrier/],
    ['29 février d’une année non bissextile', { ...base, ends_at: '2027-02-29T10:00:00Z' }, /date du calendrier/],
    ['microsecondes', { ...base, ends_at: '2026-12-01T10:00:00.0001Z' }, /avec fuseau/],
    ['heure impossible', { ...base, ends_at: '2026-12-01T24:00:00Z' }, /date du calendrier/],
    ['année hors de portée de PostgreSQL', { ...base, ends_at: '9999-12-31T23:30:00-01:00' }, /an 9999/],
    ['request_id mal formé', { ...base, request_id: 'a b' }, /request_id/],
    ['code trop court', { ...base, code: 'bf' }, /^code : 3 à 40/],
    ['code en majuscules', { ...base, code: 'Black-Friday' }, /^code : 3 à 40/],
    ['code accentué', { ...base, code: 'noël-2026' }, /^code : 3 à 40/],
    ['code trop long', { ...base, code: 'x'.repeat(41) }, /^code : 3 à 40/],
    ['code non texte', { ...base, code: 2026 }, /^code : 3 à 40/],
    ['fin passée', { ...base, ends_at: '2026-11-01T00:00:00Z' }, /dans le futur/],
    ['fin avant début', { ...base, starts_at: '2026-12-05T00:00:00Z' }, /après starts_at/],
    ['URL http', { ...base, url: 'http://abonnements-digitaux.lexpress.fr/offres' }, /url refusée/],
    ['URL hors domaine', { ...base, url: 'https://evil.test/' }, /url refusée/],
    ['URL d’une autre famille', { ...base, url: 'https://www.lexpress.eu/subscribe/' }, /ne peut pas servir www\.lexpress\.fr/],
    ['URL pour deux familles', { ...base, sites: ['www.lexpress.fr', 'www.lexpress.eu'], url: 'https://www.lexpress.fr/' }, /une offre par domaine/],
    ['libellé trop long', { ...base, label: 'x'.repeat(41) }, /entre 1 et 40/],
    ['libellé vide', { ...base, label: '   ' }, /entre 1 et 40/],
    ['libellé en balise', { ...base, label: '<b>Offre</b>' }, /< >/],
    ['libellé non texte', { ...base, label: 12 }, /un texte/],
    ['libellé pour deux langues', { ...base, sites: ['www.lexpress.fr', 'pl.lexpress.eu'], label: 'Offre' }, /une offre par langue/],
    ['corps tableau', [], /objet JSON/],
    ['corps nul', null, /objet JSON/],
  ]) {
    const r = ok(corps);
    check(r.erreur && motif.test(r.erreur), `${cas} : refus nommé — obtenu ${JSON.stringify(r.erreur)}`);
  }
  const fr = ok({ ...base, sites: ['www.lexpress.fr', 'fr.lexpress.eu'], label: '  Black Friday : -50 %  ' });
  check(!fr.erreur && fr.offre.p_label === 'Black Friday : -50 %', 'France et fr.lexpress.eu partagent une langue : un libellé commun passe, nettoyé');
  const eu = ok({ ...base, sites: ['www.lexpress.eu', 'fr.lexpress.eu', 'pl.lexpress.eu'], url: 'https://www.lexpress.eu/subscribe/?promo=bf' });
  check(!eu.erreur, 'trois sites Europe, une URL Europe, sans libellé : chaque site garde son texte dans sa langue');
  check(!ok({ ...base, starts_at: null, url: null, label: null, name: null, code: null }).erreur, 'les champs facultatifs acceptent null');
  check(ok({ ...base, code: 'black-friday-2026' }).offre.p_code === 'black-friday-2026' && ok(base).offre.p_code === null,
    'code choisi transmis tel quel ; absent, la base en tirera un');
}

// ── 5. LA FONCTION DÉPLOYABLE, exécutée contre la vraie base locale.
{
  check(readFileSync(CIBLE_OFFRES, 'utf8') === buildOffres(),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le fichier déployable correspond aux sources — régénérer par `npm run build`');
  const appels = [];
  const rpc = async (name, args) => {
    appels.push(name);
    const sql = {
      verify_api_client: ['SELECT * FROM public.verify_api_client($1)', [args.p_token_sha256]],
      list_subscription_offers: ['SELECT public.list_subscription_offers($1::uuid) AS r', [args.p_client_id]],
      end_subscription_offer: ['SELECT public.end_subscription_offer($1::uuid, $2::uuid) AS r', [args.p_client_id, args.p_id]],
      end_subscription_offer_by_code: ['SELECT public.end_subscription_offer_by_code($1::uuid, $2) AS r', [args.p_client_id, args.p_code]],
      create_subscription_offer: [`SELECT * FROM public.create_subscription_offer(p_client_id => $1::uuid,
        p_sites => ARRAY(SELECT jsonb_array_elements_text($2::jsonb)), p_ends_at => $3::timestamptz,
        p_starts_at => $4::timestamptz, p_url => $5, p_label => $6, p_name => $7, p_request_id => $8, p_code => $9)`,
        [args.p_client_id, JSON.stringify(args.p_sites), args.p_ends_at, args.p_starts_at, args.p_url, args.p_label, args.p_name, args.p_request_id, args.p_code]],
    }[name];
    try {
      await db.exec('SET ROLE service_role');
      const rows = await q(...sql);
      return { data: ['end_subscription_offer', 'end_subscription_offer_by_code', 'list_subscription_offers'].includes(name) ? rows[0].r : rows, error: null };
    } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
    finally { await db.exec('RESET ROLE'); }
  };
  let handler;
  const journal = [];
  const source = readFileSync(CIBLE_OFFRES, 'utf8').replace(/^import .*jsr:.*;$/m, '');
  vm.runInContext(stripTypeScriptTypes(source), vm.createContext({
    URL, Response, Request, TextEncoder, crypto, Date, Set, Map, Object,
    console: { log: (l) => journal.push(l), warn: (l) => journal.push(l), error: (l) => journal.push(l) },
    Deno: { env: { get: () => 'fictif' }, serve: (h) => { handler = h; } },
    createClient: () => ({ rpc }),
  }));
  const appel = async (method, jeton, corps, query = '') => {
    const r = await handler(new Request(`https://local.invalid/subscription-offers${query}`, {
      method, headers: jeton ? { 'x-gift-service-token': jeton } : {}, body: corps === undefined ? undefined : JSON.stringify(corps),
    }));
    return { status: r.status, corps: await r.json() };
  };
  const fin = new Date(Date.now() + 7 * 86400000).toISOString();

  check((await appel('POST', null, { sites: ['www.lexpress.fr'], ends_at: fin })).status === 401, 'sans jeton : 401');
  check((await appel('POST', 'jeton-inconnu', { sites: ['www.lexpress.fr'], ends_at: fin })).status === 401, 'jeton inconnu : 401');
  check((await appel('GET', 'jeton-fictif-revoque')).status === 401, 'jeton révoqué : 401, même s’il avait le droit');
  const interdit = await appel('POST', 'jeton-fictif-whatsapp', { sites: ['www.lexpress.fr'], ends_at: fin, label: 'Piratage' });
  check(interdit.status === 403,
    `C’EST LA PROPRIÉTÉ QUI COMPTE : un jeton valide SANS le droit manage_offers ne crée rien — obtenu ${interdit.status}`);
  check((await appel('GET', 'jeton-fictif-whatsapp')).status === 403 && (await appel('DELETE', 'jeton-fictif-whatsapp', undefined, '?id=00000000-0000-4000-8000-000000000001')).status === 403,
    'ni ne liste, ni ne termine');
  check((await q('SELECT count(*)::int AS n FROM public.subscription_offers'))[0].n === 0, 'et la table est restée vide');
  check((await appel('PUT', 'jeton-fictif-marketing', {})).status === 405, 'PUT : 405');
  const mauvais = await appel('POST', 'jeton-fictif-marketing', { sites: ['www.lexpress.fr'], ends_at: fin, url: 'https://evil.test/' });
  check(mauvais.status === 400 && /url refusée/.test(mauvais.corps.error), 'une URL hors domaine : 400 qui dit pourquoi');

  const demande = { sites: ['www.lexpress.fr', 'fr.lexpress.eu'], ends_at: fin, label: 'Black Friday : -50 %', name: 'black-friday-2026', request_id: 'bf-2026-fr-1', code: 'black-friday-2026' };
  const cree = await appel('POST', 'jeton-fictif-marketing', demande);
  const rejeu = await appel('POST', 'jeton-fictif-marketing', demande);
  check(rejeu.status === 201 && rejeu.corps.offer.id === cree.corps.offer.id && (await q('SELECT count(*)::int AS n FROM public.subscription_offers'))[0].n === 1,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un POST renvoyé avec le même request_id rend la même offre — jamais un doublon qui resterait affiché');
  const conflit = await appel('POST', 'jeton-fictif-marketing', { ...demande, label: 'Autre texte' });
  check(conflit.status === 400 && /request_id déjà utilisé/.test(conflit.corps.error), 'même request_id, autre demande : refus nommé');
  check(cree.status === 201 && cree.corps.offer.status === 'active' && cree.corps.client === 'marketing-offres', `création : 201 — obtenu ${JSON.stringify(cree.corps)}`);
  check(!('created_by' in cree.corps.offer), 'la réponse ne montre pas l’identifiant interne du service');
  check(cree.corps.offer.code === 'black-friday-2026' && cree.corps.offer.link_parameter === 'offre=black-friday-2026',
    'la création rend le code et le paramètre à ajouter au lien');
  const id = cree.corps.offer.id;
  const BF = 'black-friday-2026';
  check((await affichee('www.lexpress.fr', BF)).label === 'Black Friday : -50 %' && (await affichee('fr.lexpress.eu', BF)).label === 'Black Friday : -50 %',
    'la page de chaque site visé lit l’offre aussitôt, par son code');
  check(await affichee('www.lexpress.eu', BF) === null, 'et pas les autres sites');
  const pris = await appel('POST', 'jeton-fictif-marketing', { ...demande, request_id: 'bf-2026-fr-2' });
  check(pris.status === 409 && /code déjà utilisé/.test(pris.corps.error), `code déjà pris : 409 qui dit pourquoi — obtenu ${pris.status}`);
  const sansCode = await appel('POST', 'jeton-fictif-marketing', { sites: ['www.lexpress.fr'], ends_at: fin, label: 'Noël', request_id: 'noel-1' });
  check(sansCode.status === 201 && /^[0-9a-f]{16}$/.test(sansCode.corps.offer.code), 'sans code : l’API en tire un, non devinable, et le rend');
  const sansCodeRejeu = await appel('POST', 'jeton-fictif-marketing', { sites: ['www.lexpress.fr'], ends_at: fin, label: 'Noël', request_id: 'noel-1' });
  check(sansCodeRejeu.corps.offer.code === sansCode.corps.offer.code, 'rejoué sans code : le même code, pas un nouveau');
  check((await affichee('www.lexpress.fr', sansCode.corps.offer.code)).label === 'Noël' && (await affichee('www.lexpress.fr', BF)).label === 'Black Friday : -50 %',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : deux offres en cours sur le même site, chacune par son lien');
  check((await appel('DELETE', 'jeton-fictif-marketing', undefined, `?code=${sansCode.corps.offer.code}`)).corps.result === 'ended', 'fin par code');
  check(await affichee('www.lexpress.fr', sansCode.corps.offer.code) === null && (await affichee('www.lexpress.fr', BF)) !== null,
    'terminée par code : elle seule disparaît');

  const plus = await appel('POST', 'jeton-fictif-marketing', { sites: ['pl.lexpress.eu'], ends_at: fin, starts_at: new Date(Date.now() + 86400000).toISOString(), url: 'https://pl.lexpress.eu/subskrypcja/?promo=bf' });
  check(plus.status === 201 && plus.corps.offer.status === 'scheduled', 'offre programmée : 201, statut « scheduled »');
  const liste = await appel('GET', 'jeton-fictif-marketing');
  check(liste.status === 200 && liste.corps.offers.length === 3, `la liste rend les trois offres — obtenu ${liste.corps.offers?.length}`);
  check(liste.corps.offers.every((o) => /^[a-z0-9-]{3,40}$/.test(o.code)) && liste.corps.offers.some((o) => o.code === BF),
    'chaque offre de la liste porte son code');
  check(!('displayed_now' in liste.corps) && liste.corps.link_parameter === 'offre', 'plus d’offre « affichée par défaut » : displayed_now disparaît');
  check(liste.corps.offers[0].status === 'active', 'les offres en cours en tête');
  for (const q2 of ['', '?id=00000000-0000-4000-8000-0000000000ff&code=black-friday-2026', '?code=BF', '?code=a'])
    check((await appel('DELETE', 'jeton-fictif-marketing', undefined, q2)).status === 400, `DELETE ${q2 || 'sans désignateur'} : 400`);
  check((await appel('DELETE', 'jeton-fictif-marketing', undefined, '?code=inconnu-2026')).status === 404, 'code inconnu : 404');
  check((await appel('DELETE', 'jeton-fictif-whatsapp', undefined, `?code=${BF}`)).status === 403, 'fin par code sans droit : 403');

  check((await appel('DELETE', 'jeton-fictif-marketing', undefined, '?id=pas-un-uuid')).status === 400, 'id mal formé : 400');
  check((await appel('DELETE', 'jeton-fictif-marketing', undefined, '?id=00000000-0000-4000-8000-0000000000ff')).status === 404, 'offre inconnue : 404');
  const annule = await appel('DELETE', 'jeton-fictif-marketing', undefined, `?id=${plus.corps.offer.id}`);
  check(annule.status === 200 && annule.corps.result === 'cancelled', 'une offre à venir est annulée');
  const termine = await appel('DELETE', 'jeton-fictif-marketing', undefined, `?id=${id}`);
  check(termine.status === 200 && termine.corps.result === 'ended', 'une offre en cours se termine maintenant');
  check(await affichee('www.lexpress.fr', BF) === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : terminée, l’offre disparaît de la page — le bouton par défaut revient');
  const trace = (await q('SELECT ended_by, ended_at IS NOT NULL AS fini FROM public.subscription_offers WHERE id = $1', [id]))[0];
  check(trace.ended_by === MARKETING && trace.fini, 'la ligne reste, avec qui l’a terminée');
  check((await appel('DELETE', 'jeton-fictif-marketing', undefined, `?id=${id}`)).corps.result === 'already_ended', 'la terminer deux fois ne change rien');
  const rejeuApresFin = await appel('POST', 'jeton-fictif-marketing', demande);
  check(rejeuApresFin.status === 201 && rejeuApresFin.corps.offer.id === id && rejeuApresFin.corps.offer.status === 'ended' && await affichee('www.lexpress.fr', BF) === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un POST rejoué après la fin anticipée retrouve l’offre terminée — il ne la rallume pas');
  const programmee = { sites: ['pl.lexpress.eu'], ends_at: fin, starts_at: new Date(Date.now() + 86400000).toISOString(), request_id: 'pl-annulee-1' };
  const p1 = await appel('POST', 'jeton-fictif-marketing', programmee);
  await appel('DELETE', 'jeton-fictif-marketing', undefined, `?id=${p1.corps.offer.id}`);
  const p2 = await appel('POST', 'jeton-fictif-marketing', programmee);
  check(p2.corps.offer.id === p1.corps.offer.id && p2.corps.offer.status === 'ended', 'rejoué après annulation : la même offre, toujours annulée — elle ne se reprogramme pas');
  await q(`INSERT INTO public.subscription_offers (sites, starts_at, ends_at, created_by, request_id) VALUES (ARRAY['www.lexpress.eu'], '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', $1, 'ancienne-1')`, [MARKETING]);
  const tardif = await appel('POST', 'jeton-fictif-marketing', { sites: ['www.lexpress.eu'], starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-01-02T00:00:00Z', request_id: 'ancienne-1' });
  check(tardif.status === 201 && tardif.corps.offer.status === 'ended', `rejoué après expiration : l’offre déjà créée, pas un 400 — obtenu ${tardif.status}`);
  const neuveExpiree = await appel('POST', 'jeton-fictif-marketing', { sites: ['www.lexpress.eu'], starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-01-02T00:00:00Z', request_id: 'jamais-vue' });
  check(neuveExpiree.status === 400 && /à venir/.test(neuveExpiree.corps.error), 'mais une offre nouvelle déjà expirée reste refusée, par la base');
  // Commencée à l'instant même : la fin anticipée ne bute pas sur la contrainte de durée.
  await db.exec('BEGIN');
  const instant = (await q(`INSERT INTO public.subscription_offers (sites, starts_at, ends_at) VALUES (ARRAY['pl.lexpress.eu'], now(), now() + interval '1 day') RETURNING id`))[0].id;
  check((await q('SELECT public.end_subscription_offer($1, $2) AS r', [MARKETING, instant]))[0].r === 'ended', 'offre commencée à l’instant même : terminée, sans erreur');
  await db.exec('COMMIT');
  check(journal.every((l) => !/jeton-fictif|[0-9a-f]{64}/.test(l)), 'aucun jeton ni empreinte dans le journal');
  check(appels.filter((a) => a === 'verify_api_client').length > 0, 'chaque appel passe par la vérification du jeton existante');

  // Liste plafonnée : les offres en cours passent devant 500 offres à venir.
  await q('DELETE FROM public.subscription_offers');
  const polonaise = (await q(`INSERT INTO public.subscription_offers (sites, starts_at, ends_at) VALUES (ARRAY['pl.lexpress.eu'], now() - interval '2 days', now() + interval '5 days') RETURNING id`))[0].id;
  await q(`INSERT INTO public.subscription_offers (sites, starts_at, ends_at) SELECT ARRAY['www.lexpress.fr'], now() + interval '1 day', now() + interval '5 days' FROM generate_series(1, 500)`);
  const longue = await appel('GET', 'jeton-fictif-marketing');
  check(longue.corps.offers.length === 500 && longue.corps.truncated === true && longue.corps.offers[0].id === polonaise,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : liste tronquée, signalée, et l’offre en cours y figure en tête');
  await q('DELETE FROM public.subscription_offers');

  // La base refuse même si la fonction laissait passer : contrôles doublés.
  await rejette(`SELECT public.create_subscription_offer($1, ARRAY['www.lexpress.fr','www.lexpress.eu'], now() + interval '1 day', NULL, 'https://www.lexpress.fr/')`, [MARKETING], /22023/, 'la base refuse une URL pour deux familles');
  await rejette(`SELECT public.create_subscription_offer($1, ARRAY['www.lexpress.eu','pl.lexpress.eu'], now() + interval '1 day', NULL, NULL, 'Offre')`, [MARKETING], /22023/, 'la base refuse un libellé pour deux langues');
  await rejette(`SELECT public.create_subscription_offer($1, ARRAY['www.lexpress.fr'], now() - interval '1 day')`, [MARKETING], /22023/, 'la base refuse une fin passée');
  await rejette(`SELECT public.create_subscription_offer($1, ARRAY['www.lexpress.fr'], now() + interval '1 day')`, [WHATSAPP], /42501/, 'la base refuse un service sans droit');
  await rejette(`SELECT public.create_subscription_offer($1, ARRAY['www.lexpress.fr'], now() + interval '1 day')`, [REVOQUE], /42501/, 'et un service révoqué');
}

// ── 6. REJOUABLE, ET RETOUR ARRIÈRE SANS PERTE DE LIENS.
{
  const avant = (await q('SELECT count(*)::int AS n FROM public.subscription_offers'))[0].n;
  await db.exec(readFileSync('gift-links/supabase/018-offres-abonnement.sql', 'utf8'));
  check((await q('SELECT count(*)::int AS n FROM public.subscription_offers'))[0].n === avant
    && (await q("SELECT manage_offers FROM public.api_clients WHERE name = 'marketing-offres'"))[0].manage_offers === true,
    '018 rejouée : offres et droits conservés');
  // 018 rejouée remet sa valeur par défaut (faux) : 020 se rejoue ensuite, comme dans la chaîne de migrations.
  const codes = await q('SELECT id, code FROM public.subscription_offers ORDER BY id');
  await db.exec(readFileSync('gift-links/supabase/020-offre-par-parametre.sql', 'utf8'));
  check(JSON.stringify(await q('SELECT id, code FROM public.subscription_offers ORDER BY id')) === JSON.stringify(codes),
    '020 rejouée : chaque offre garde son code');
  // Retour arrière de 018 : refusé tant que 020 est en place ; d'abord celui de 020 (aucune offre en cours ici).
  let refus = null;
  try { await db.exec(readFileSync('gift-links/supabase/rollback/018-offres-abonnement.sql', 'utf8')); } catch (e) { refus = e.message; }
  await db.exec('ROLLBACK');
  check(refus && /rollback\/020/.test(refus), `retour arrière de 018 avant celui de 020 : refusé (${refus})`);
  await db.exec(readFileSync('gift-links/supabase/rollback/020-offre-par-parametre.sql', 'utf8'));
  const clients = (await q('SELECT count(*)::int AS n FROM public.api_clients'))[0].n;
  await db.exec(readFileSync('gift-links/supabase/rollback/018-offres-abonnement.sql', 'utf8'));
  check((await q("SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE '%subscription_offer%' OR proname LIKE 'offer\\_%'"))[0].n === 0
    && (await q("SELECT to_regclass('public.subscription_offers') AS t"))[0].t === null, 'retour arrière : table et fonctions supprimées');
  check((await q('SELECT count(*)::int AS n FROM public.api_clients'))[0].n === clients, 'retour arrière : aucun service supprimé');
  await db.exec(readFileSync('gift-links/supabase/018-offres-abonnement.sql', 'utf8'));
  check((await q("SELECT count(*)::int AS n FROM public.api_clients WHERE manage_offers"))[0].n === 0,
    'rejouée après retour arrière : le droit repart de zéro, à réaccorder délibérément');
}

await db.close();
console.log(`offres d'abonnement : ${n} vérifications passées (base locale, fonction exécutée, aucun réseau).`);
