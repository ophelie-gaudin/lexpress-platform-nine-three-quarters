// Offres d'abonnement (018) : la table, la RPC publique, la fonction de gestion et sa validation.
//
// Trois propriétés valent le test. La page ne lit QUE libellé, URL et date de fin, et rien d'autre
// n'est ouvert à la clé publique. Le choix entre offres qui se chevauchent est déterministe. Et un
// service sans le droit `manage_offers` ne change pas le bouton de toutes les pages.
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
check(migrations.at(-1) === '018-offres-abonnement.sql', '018 est la dernière migration');
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
const REVOQUE = await client('ancien-marketing', 'jeton-fictif-revoque', true);
await q("SELECT public.revoke_api_client('ancien-marketing')");

// ── 1. LES DROITS. La clé publique ne voit que la RPC, et la RPC ne rend que trois champs.
{
  check((await q("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subscription_offers'::regclass"))[0].relrowsecurity,
    'RLS active sur subscription_offers');
  check((await q("SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'subscription_offers'"))[0].n === 0,
    'aucune politique : RLS fermée, pour la lecture comme pour l’écriture');
  check((await q("SELECT column_name FROM information_schema.columns WHERE table_name='api_clients' AND column_name='manage_offers' AND column_default='false'")).length === 1,
    'le droit de gérer les offres est faux par défaut — les jetons existants ne l’ont pas');
  const cols = await q("SELECT pg_get_function_result('public.get_subscription_offer(text)'::regprocedure) AS r");
  check(cols[0].r === 'TABLE(label text, url text, ends_at timestamp with time zone)',
    `C’EST LA PROPRIÉTÉ QUI COMPTE : la RPC publique ne rend que libellé, URL et date de fin — obtenu ${cols[0].r}`);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    for (const [sql, quoi] of [
      ['SELECT * FROM public.subscription_offers', 'lecture de la table'],
      ["INSERT INTO public.subscription_offers (sites, ends_at) VALUES (ARRAY['www.lexpress.fr'], now() + interval '1 day')", 'écriture dans la table'],
      ['DELETE FROM public.subscription_offers', 'suppression dans la table'],
      [`SELECT public.create_subscription_offer('${MARKETING}', ARRAY['www.lexpress.fr'], now() + interval '1 day')`, 'création par la RPC'],
      [`SELECT * FROM public.list_subscription_offers('${MARKETING}')`, 'liste des offres'],
      [`SELECT public.end_subscription_offer('${MARKETING}', gen_random_uuid())`, 'fin d’une offre'],
      [`SELECT public.assert_offer_manager('${MARKETING}')`, 'contrôle de droit'],
      ['SELECT manage_offers FROM public.api_clients', 'lecture des droits des services'],
    ]) await rejette(sql, [], /42501|permission denied/, `${role} : ${quoi} refusée`);
    check((await q("SELECT * FROM public.get_subscription_offer('www.lexpress.fr')")).length === 0,
      `${role} : la RPC publique répond, sans offre en cours`);
    await db.exec('RESET ROLE');
  }
}

// ── 2. LA SÉLECTION. Début le plus récent, puis création la plus récente, puis identifiant.
const ins = (sites, debut, fin, label, extra = '') => q(
  `INSERT INTO public.subscription_offers (sites, starts_at, ends_at, label, created_at${extra ? ', id' : ''})
   VALUES ($1::text[], now() + $2::interval, now() + $3::interval, $4, ${extra ? `now() + $5::interval, $6::uuid` : 'now()'}) RETURNING id`,
  extra ? [sites, debut, fin, label, ...extra] : [sites, debut, fin, label]);
const affichee = async (site) => (await q('SELECT * FROM public.get_subscription_offer($1)', [site]))[0] ?? null;
{
  await ins(['www.lexpress.fr'], '-10 days', '+20 days', 'Offre longue');
  check((await affichee('www.lexpress.fr'))?.label === 'Offre longue', 'une offre en cours est rendue');
  check(await affichee('www.lexpress.eu') === null && await affichee('pl.lexpress.eu') === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : une offre ne s’affiche que sur les sites qu’elle vise');
  await ins(['www.lexpress.fr'], '-1 day', '+2 days', 'Offre flash');
  check((await affichee('www.lexpress.fr')).label === 'Offre flash',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : deux offres se chevauchent — la plus récemment commencée gagne');
  await ins(['www.lexpress.fr'], '+1 day', '+30 days', 'Offre à venir');
  check((await affichee('www.lexpress.fr')).label === 'Offre flash', 'une offre à venir ne s’affiche pas encore');
  await ins(['www.lexpress.fr'], '-30 days', '-1 second', 'Offre finie');
  check((await affichee('www.lexpress.fr')).label === 'Offre flash', 'une offre terminée ne s’affiche plus');
  // Égalité de début : la création la plus récente, puis l'identifiant le plus grand.
  await q(`INSERT INTO public.subscription_offers (id, sites, starts_at, ends_at, label, created_at) VALUES
    ('00000000-0000-4000-8000-000000000001', ARRAY['pl.lexpress.eu'], '2026-01-01T00:00:00Z', now() + interval '5 days', 'A', '2026-01-01T00:00:00Z'),
    ('00000000-0000-4000-8000-000000000002', ARRAY['pl.lexpress.eu'], '2026-01-01T00:00:00Z', now() + interval '5 days', 'B', '2026-01-02T00:00:00Z'),
    ('00000000-0000-4000-8000-000000000003', ARRAY['pl.lexpress.eu'], '2026-01-01T00:00:00Z', now() + interval '5 days', 'C', '2026-01-02T00:00:00Z')`);
  check((await affichee('pl.lexpress.eu')).label === 'C', 'même début, même création : l’identifiant départage — jamais un tirage');
  // Départage à la microseconde : deux créations dans la même milliseconde, l'aînée a le plus grand id.
  await q(`INSERT INTO public.subscription_offers (id, sites, starts_at, ends_at, label, created_at) VALUES
    ('00000000-0000-4000-8000-0000000000f2', ARRAY['www.lexpress.eu'], '2026-01-01T00:00:00Z', now() + interval '5 days', 'Aînée', '2026-01-01T00:00:00.000100Z'),
    ('00000000-0000-4000-8000-0000000000f1', ARRAY['www.lexpress.eu'], '2026-01-01T00:00:00Z', now() + interval '5 days', 'Cadette', '2026-01-01T00:00:00.000900Z')`);
  check((await affichee('www.lexpress.eu')).label === 'Cadette', 'la création la plus récente gagne, à la microseconde près');
  check((await q('SELECT site, id FROM public.displayed_subscription_offers($1)', [MARKETING])).find((r) => r.site === 'www.lexpress.eu').id === '00000000-0000-4000-8000-0000000000f1',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : la liste du marketing et la page désignent la même offre — une seule fonction SQL choisit');
  check((await affichee('www.lexpress.fr')).url === null, 'sans URL, la RPC rend NULL : la page garde son lien par défaut');
  check((await q("SELECT * FROM public.get_subscription_offer('lexpress.fr')")).length === 0
    && (await q('SELECT * FROM public.get_subscription_offer(NULL)')).length === 0, 'un site inconnu ou nul ne rend rien');
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
    ['heure impossible', { ...base, ends_at: '2026-12-01T24:00:00Z' }, /date du calendrier/],
    ['request_id mal formé', { ...base, request_id: 'a b' }, /request_id/],
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
  check(!ok({ ...base, starts_at: null, url: null, label: null, name: null }).erreur, 'les champs facultatifs acceptent null');
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
      list_subscription_offers: ['SELECT * FROM public.list_subscription_offers($1::uuid)', [args.p_client_id]],
      displayed_subscription_offers: ['SELECT * FROM public.displayed_subscription_offers($1::uuid)', [args.p_client_id]],
      end_subscription_offer: ['SELECT public.end_subscription_offer($1::uuid, $2::uuid) AS r', [args.p_client_id, args.p_id]],
      create_subscription_offer: [`SELECT * FROM public.create_subscription_offer(p_client_id => $1::uuid,
        p_sites => ARRAY(SELECT jsonb_array_elements_text($2::jsonb)), p_ends_at => $3::timestamptz,
        p_starts_at => $4::timestamptz, p_url => $5, p_label => $6, p_name => $7, p_request_id => $8)`,
        [args.p_client_id, JSON.stringify(args.p_sites), args.p_ends_at, args.p_starts_at, args.p_url, args.p_label, args.p_name, args.p_request_id]],
    }[name];
    try {
      await db.exec('SET ROLE service_role');
      const rows = await q(...sql);
      return { data: name === 'end_subscription_offer' ? rows[0].r : rows, error: null };
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

  const demande = { sites: ['www.lexpress.fr', 'fr.lexpress.eu'], ends_at: fin, label: 'Black Friday : -50 %', name: 'black-friday-2026', request_id: 'bf-2026-fr-1' };
  const cree = await appel('POST', 'jeton-fictif-marketing', demande);
  const rejeu = await appel('POST', 'jeton-fictif-marketing', demande);
  check(rejeu.status === 201 && rejeu.corps.offer.id === cree.corps.offer.id && (await q('SELECT count(*)::int AS n FROM public.subscription_offers'))[0].n === 1,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un POST renvoyé avec le même request_id rend la même offre — jamais un doublon qui resterait affiché');
  const conflit = await appel('POST', 'jeton-fictif-marketing', { ...demande, label: 'Autre texte' });
  check(conflit.status === 400 && /request_id déjà utilisé/.test(conflit.corps.error), 'même request_id, autre demande : refus nommé');
  check(cree.status === 201 && cree.corps.offer.status === 'active' && cree.corps.client === 'marketing-offres', `création : 201 — obtenu ${JSON.stringify(cree.corps)}`);
  check(!('created_by' in cree.corps.offer), 'la réponse ne montre pas l’identifiant interne du service');
  const id = cree.corps.offer.id;
  check((await affichee('www.lexpress.fr')).label === 'Black Friday : -50 %' && (await affichee('fr.lexpress.eu')).label === 'Black Friday : -50 %',
    'la page de chaque site visé lit l’offre aussitôt');
  check(await affichee('www.lexpress.eu') === null, 'et pas les autres');

  const plus = await appel('POST', 'jeton-fictif-marketing', { sites: ['pl.lexpress.eu'], ends_at: fin, starts_at: new Date(Date.now() + 86400000).toISOString(), url: 'https://pl.lexpress.eu/subskrypcja/?promo=bf' });
  check(plus.status === 201 && plus.corps.offer.status === 'scheduled', 'offre programmée : 201, statut « scheduled »');
  const liste = await appel('GET', 'jeton-fictif-marketing');
  check(liste.status === 200 && liste.corps.offers.length === 2, 'la liste rend les deux offres');
  check(liste.corps.displayed_now['www.lexpress.fr'] === id && liste.corps.displayed_now['pl.lexpress.eu'] === null,
    'et dit, site par site, quelle offre est affichée en ce moment');

  check((await appel('DELETE', 'jeton-fictif-marketing', undefined, '?id=pas-un-uuid')).status === 400, 'id mal formé : 400');
  check((await appel('DELETE', 'jeton-fictif-marketing', undefined, '?id=00000000-0000-4000-8000-0000000000ff')).status === 404, 'offre inconnue : 404');
  const annule = await appel('DELETE', 'jeton-fictif-marketing', undefined, `?id=${plus.corps.offer.id}`);
  check(annule.status === 200 && annule.corps.result === 'deleted', 'une offre à venir est supprimée : personne ne l’a vue');
  const termine = await appel('DELETE', 'jeton-fictif-marketing', undefined, `?id=${id}`);
  check(termine.status === 200 && termine.corps.result === 'ended', 'une offre en cours se termine maintenant');
  check(await affichee('www.lexpress.fr') === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : terminée, l’offre disparaît de la page — le bouton par défaut revient');
  const trace = (await q('SELECT ended_by, ended_at IS NOT NULL AS fini FROM public.subscription_offers WHERE id = $1', [id]))[0];
  check(trace.ended_by === MARKETING && trace.fini, 'la ligne reste, avec qui l’a terminée');
  check((await appel('DELETE', 'jeton-fictif-marketing', undefined, `?id=${id}`)).corps.result === 'already_ended', 'la terminer deux fois ne change rien');
  // Commencée à l'instant même : la fin anticipée ne bute pas sur la contrainte de durée.
  await db.exec('BEGIN');
  const instant = (await q(`INSERT INTO public.subscription_offers (sites, starts_at, ends_at) VALUES (ARRAY['pl.lexpress.eu'], now(), now() + interval '1 day') RETURNING id`))[0].id;
  check((await q('SELECT public.end_subscription_offer($1, $2) AS r', [MARKETING, instant]))[0].r === 'deleted', 'offre commencée à l’instant même : supprimée, sans erreur');
  await db.exec('COMMIT');
  check(journal.every((l) => !/jeton-fictif|[0-9a-f]{64}/.test(l)), 'aucun jeton ni empreinte dans le journal');
  check(appels.filter((a) => a === 'verify_api_client').length > 0, 'chaque appel passe par la vérification du jeton existante');

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
