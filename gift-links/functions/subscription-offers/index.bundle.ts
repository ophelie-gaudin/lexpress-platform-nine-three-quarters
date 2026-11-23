// FICHIER ENGENDRÉ — ne pas modifier à la main.
// Régénérer : node build-gift-links-function.mjs
// Sources : gift-links/functions/_shared/offres.mjs, gift-links/functions/subscription-offers/index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Offres d'abonnement (018) : validation de ce que le marketing envoie, avant toute écriture.
//
// LA BASE VÉRIFIE AUSSI (contraintes et fonctions de 018). Ici, le but est de rendre un refus qui
// s'explique, champ par champ, au lieu d'une erreur PostgreSQL. Les deux règles disent la même chose ;
// le test les confronte sur les mêmes cas.

const OFFRE_CLES = Object.freeze(['sites', 'ends_at', 'starts_at', 'url', 'label', 'name', 'request_id']);
const OFFRE_SITES = Object.freeze({
  'www.lexpress.fr': Object.freeze({ famille: 'fr', langue: 'fr' }),
  'www.lexpress.eu': Object.freeze({ famille: 'eu', langue: 'en' }),
  'fr.lexpress.eu': Object.freeze({ famille: 'eu', langue: 'fr' }),
  'pl.lexpress.eu': Object.freeze({ famille: 'eu', langue: 'pl' }),
});
const LIBELLE_MAX = 40;
const URL_MAX = 500;
const NOM_MAX = 80;

// Même règle que offer_url_family() en SQL. https, hôte exact de la liste, rien entre l'hôte et le
// chemin (ni port, ni identifiants, ni fragment), aucun espace ni caractère de contrôle.
function familleUrl(url) {
  if (typeof url !== 'string' || url.length > URL_MAX || /[\s\u0000-\u001f\u007f\\"<>`]/.test(url)) return null;
  if (/^https:\/\/(abonnements-digitaux\.lexpress\.fr|(www\.)?lexpress\.fr)([/?]|$)/.test(url)) return 'fr';
  if (/^https:\/\/((www|fr|pl)\.)?lexpress\.eu([/?]|$)/.test(url)) return 'eu';
  return null;
}

// ISO 8601 avec fuseau explicite : « 2026-11-30T23:59:00+01:00 » ou « …Z ». Sans fuseau, la même
// chaîne désigne deux instants selon la machine qui la lit ; on préfère refuser que deviner.
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:(\d{2})(\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/;
function date(valeur, champ) {
  const m = typeof valeur === 'string' ? ISO.exec(valeur) : null;
  if (!m) {
    return { erreur: `${champ} doit être une date ISO 8601 avec fuseau, par exemple 2026-11-30T23:59:00+01:00 (reçu : ${JSON.stringify(valeur)})` };
  }
  // Le calendrier d'abord : Date.parse transforme un 31 novembre en 1er décembre sans rien dire.
  const [an, mois, jour, heure, minute, seconde] = [m[1], m[2], m[3], m[4], m[5], m[7] ?? '0'].map(Number);
  const jours = new Date(Date.UTC(an, mois, 0)).getUTCDate();
  if (mois < 1 || mois > 12 || jour < 1 || jour > jours || heure > 23 || minute > 59 || seconde > 59
      || Number(m[10] ?? 0) > 23 || Number(m[11] ?? 0) > 59) {
    return { erreur: `${champ} n'est pas une date du calendrier (reçu : ${JSON.stringify(valeur)})` };
  }
  const t = Date.parse(valeur);
  if (!Number.isFinite(t)) return { erreur: `${champ} n'est pas une date valide (reçu : ${JSON.stringify(valeur)})` };
  return { date: new Date(t) };
}

/**
 * Valide le corps d'une création. Rend { offre } prête pour create_subscription_offer, ou { erreur }.
 * `maintenant` est injectable pour les tests.
 */
function validerOffre(corps, maintenant = new Date()) {
  if (corps === null || typeof corps !== 'object' || Array.isArray(corps)) return { erreur: 'le corps doit être un objet JSON' };
  const inconnues = Object.keys(corps).filter((c) => !OFFRE_CLES.includes(c));
  if (inconnues.length > 0) return { erreur: `clé(s) non reconnue(s) : ${inconnues.join(', ')}`, accepted_keys: OFFRE_CLES };

  const sites = corps.sites;
  if (!Array.isArray(sites) || sites.length === 0) {
    return { erreur: `sites est obligatoire : une liste parmi ${Object.keys(OFFRE_SITES).join(', ')}` };
  }
  const inconnus = sites.filter((s) => typeof s !== 'string' || !Object.hasOwn(OFFRE_SITES, s));
  if (inconnus.length > 0) {
    return { erreur: `site(s) inconnu(s) : ${inconnus.map((s) => JSON.stringify(s)).join(', ')} — valeurs possibles : ${Object.keys(OFFRE_SITES).join(', ')}` };
  }
  if (new Set(sites).size !== sites.length) return { erreur: 'sites contient un doublon' };

  if (corps.ends_at === undefined) return { erreur: 'ends_at (date de fin) est obligatoire' };
  const fin = date(corps.ends_at, 'ends_at');
  if (fin.erreur) return fin;
  let debut = { date: null };
  if (corps.starts_at !== undefined && corps.starts_at !== null) {
    debut = date(corps.starts_at, 'starts_at');
    if (debut.erreur) return debut;
  }
  // Avec un request_id, un rejeu tardif doit retrouver l'offre déjà créée : la base vérifie le futur
  // seulement si elle crée vraiment une offre.
  const rejouable = typeof corps.request_id === 'string';
  if (!rejouable && fin.date.getTime() <= maintenant.getTime()) return { erreur: 'ends_at doit être dans le futur' };
  if (debut.date && fin.date.getTime() <= debut.date.getTime()) return { erreur: 'ends_at doit être après starts_at' };

  let url = null;
  if (corps.url !== undefined && corps.url !== null) {
    const famille = familleUrl(corps.url);
    if (!famille) {
      return { erreur: `url refusée : https uniquement, sur abonnements-digitaux.lexpress.fr, (www.)lexpress.fr ou (www.|fr.|pl.)lexpress.eu, sans port ni espace, ${URL_MAX} caractères au plus` };
    }
    const autres = sites.filter((s) => OFFRE_SITES[s].famille !== famille);
    if (autres.length > 0) {
      return { erreur: `url sur un domaine ${famille === 'fr' ? 'lexpress.fr' : 'lexpress.eu'} : elle ne peut pas servir ${autres.join(', ')}. Créer une offre par domaine.` };
    }
    url = corps.url;
  }

  let label = null;
  if (corps.label !== undefined && corps.label !== null) {
    if (typeof corps.label !== 'string') return { erreur: 'label doit être un texte' };
    label = corps.label.trim();
    const longueur = [...label].length;
    if (longueur < 1 || longueur > LIBELLE_MAX) return { erreur: `label doit faire entre 1 et ${LIBELLE_MAX} caractères (reçu : ${longueur})` };
    if (/[\u0000-\u001f\u007f<>]/.test(label)) return { erreur: 'label ne doit contenir ni retour à la ligne, ni caractère de contrôle, ni < >' };
    if (new Set(sites.map((s) => OFFRE_SITES[s].langue)).size > 1) {
      return { erreur: 'un libellé est écrit dans une langue : il ne peut viser que des sites de cette langue. Créer une offre par langue.' };
    }
  }

  let name = null;
  if (corps.name !== undefined && corps.name !== null) {
    if (typeof corps.name !== 'string' || corps.name.trim() === '' || [...corps.name.trim()].length > NOM_MAX || /[\u0000-\u001f\u007f]/.test(corps.name)) {
      return { erreur: `name doit être un texte d'une ligne, ${NOM_MAX} caractères au plus` };
    }
    name = corps.name.trim();
  }

  let requestId = null;
  if (corps.request_id !== undefined && corps.request_id !== null) {
    if (typeof corps.request_id !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(corps.request_id)) {
      return { erreur: 'request_id : 1 à 100 caractères parmi lettres, chiffres et . _ : -' };
    }
    requestId = corps.request_id;
  }

  return {
    offre: {
      p_sites: [...sites],
      p_ends_at: fin.date.toISOString(),
      p_starts_at: debut.date ? debut.date.toISOString() : null,
      p_url: url,
      p_label: label,
      p_name: name,
      p_request_id: requestId,
    },
  };
}

// Identifiant d'offre dans l'URL d'une fin anticipée.
const estUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Ce que la réponse montre d'une offre : tout sauf les identifiants internes des services.
function offrePublique(ligne, maintenant = new Date()) {
  const t = maintenant.getTime();
  const debut = Date.parse(ligne.starts_at), fin = Date.parse(ligne.ends_at);
  return {
    id: ligne.id, name: ligne.name ?? null, sites: ligne.sites,
    starts_at: ligne.starts_at, ends_at: ligne.ends_at,
    url: ligne.url ?? null, label: ligne.label ?? null,
    ended_at: ligne.ended_at ?? null,
    status: ligne.ended_at || fin <= t ? 'ended' : debut > t ? 'scheduled' : 'active',
  };
}

// /subscription-offers — l'offre d'abonnement du moment, déclarée par le marketing (migration 018).
//
//   GET                      liste : offres à venir, en cours, terminées depuis moins de 30 jours,
//                            et pour chaque site l'offre affichée en ce moment
//   POST   { sites, ends_at, starts_at?, url?, label?, name?, request_id? }   crée une offre
//                            (même request_id renvoyé = la même offre, jamais un doublon)
//   DELETE ?id=<uuid>        fin anticipée : annule une offre à venir, termine une offre en cours
//
// AUTHENTIFICATION : le même jeton par service que create-gift-links, dans `x-gift-service-token`.
// Un jeton valide ne suffit pas : le service doit avoir le droit `manage_offers`, accordé à la main.
// L'agent WhatsApp crée des liens ; il ne doit pas pouvoir changer le bouton de toutes les pages.
//
// La page de lecture ne passe JAMAIS par ici : elle lit l'offre en cours par la RPC publique
// get_subscription_offer, qui ne rend que libellé, URL et date de fin.

const env = (k: string) => Deno.env.get(k) ?? '';
const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });

// Une ligne JSON par événement, filtrable sur `evenement`. Jamais de jeton.
const journal = (niveau: 'error' | 'warn' | 'info', evenement: string, details: Record<string, unknown> = {}) => {
  const ligne = JSON.stringify({ fn: 'subscription-offers', evenement, ...details });
  if (niveau === 'error') console.error(ligne);
  else if (niveau === 'warn') console.warn(ligne);
  else console.log(ligne);
};

// Erreur de la base → réponse. Le droit manquant est un 403 ; une règle de 018 violée, un 400.
const refusBase = (error: { code?: string; message?: string }, client: string, geste: string) => {
  if (error.code === '42501') {
    journal('warn', 'offres_refusees', { client, geste, cause: 'droit manage_offers absent' });
    return json({ error: 'ce service n’a pas le droit de gérer les offres' }, 403);
  }
  if (error.code === '22023' || error.code === '23514') {
    journal('warn', 'offre_invalide', { client, geste, message: error.message });
    return json({ error: (error.message ?? 'offre refusée').replace(/^offres : /, '') }, 400);
  }
  journal('error', 'offres_base_indisponible', { client, geste, message: error.message });
  return json({ error: 'base indisponible, réessayez' }, 503);
};

Deno.serve(async (req) => {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return json({ error: 'méthode non autorisée' }, 405);

  const presente = req.headers.get('x-gift-service-token') ?? '';
  if (presente === '') {
    journal('warn', 'jeton_refuse', { cause: 'en-tête absent' });
    return json({ error: 'non autorisé' }, 401);
  }
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const empreinte = [...new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(presente))
  )].map((o) => o.toString(16).padStart(2, '0')).join('');

  const { data: clients, error: erreurAuth } = await db.rpc('verify_api_client', { p_token_sha256: empreinte });
  if (erreurAuth) {
    journal('error', 'verification_indisponible', { message: erreurAuth.message });
    return json({ error: 'vérification indisponible, réessayez' }, 503);
  }
  const client = Array.isArray(clients) ? clients[0] : clients;
  if (!client?.ok) {
    journal('warn', 'jeton_refuse', { cause: client?.reason ?? 'jeton inconnu' });
    return json({ error: 'non autorisé' }, 401);
  }
  const clientId: string = client.client_id;
  const clientName: string = client.name;

  if (req.method === 'GET') {
    const { data, error } = await db.rpc('list_subscription_offers', { p_client_id: clientId });
    if (error) return refusBase(error, clientName, 'liste');
    // Un seul appel : liste, offre affichée par site (la fonction de la page) et statuts viennent de la
    // même photographie de la base. Rien n'est recalculé ici.
    const liste = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    return json({ ...liste, client: clientName });
  }

  if (req.method === 'DELETE') {
    const id = new URL(req.url).searchParams.get('id');
    if (!estUuid(id)) return json({ error: 'paramètre id manquant ou mal formé (uuid attendu)' }, 400);
    const { data, error } = await db.rpc('end_subscription_offer', { p_client_id: clientId, p_id: id });
    if (error) return refusBase(error, clientName, 'fin');
    const resultat = Array.isArray(data) ? data[0] : data;
    if (resultat === 'unknown') return json({ error: 'offre inconnue', id, client: clientName }, 404);
    journal('info', 'offre_terminee', { client: clientName, id, result: resultat });
    return json({ id, result: resultat, client: clientName });
  }

  let corps: unknown;
  try { corps = await req.json(); } catch {
    return json({ error: 'corps JSON illisible' }, 400);
  }
  const valide = validerOffre(corps);
  if (valide.erreur) {
    journal('warn', 'offre_invalide', { client: clientName, erreur: valide.erreur });
    return json({ error: valide.erreur, accepted_keys: valide.accepted_keys }, 400);
  }
  const { data, error } = await db.rpc('create_subscription_offer', { p_client_id: clientId, ...valide.offre });
  if (error) return refusBase(error, clientName, 'création');
  const ligne = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  journal('info', 'offre_creee', { client: clientName, id: ligne.id, sites: ligne.sites, ends_at: ligne.ends_at });
  return json({ offer: offrePublique(ligne), client: clientName }, 201);
});
