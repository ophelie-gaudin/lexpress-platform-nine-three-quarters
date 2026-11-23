// /subscription-offers — l'offre d'abonnement du moment, déclarée par le marketing (migration 018).
//
//   GET                      liste : offres à venir, en cours, terminées depuis moins de 30 jours,
//                            et pour chaque site l'offre affichée en ce moment
//   POST   { sites, ends_at, starts_at?, url?, label?, name? }   crée une offre
//   DELETE ?id=<uuid>        fin anticipée : supprime une offre à venir, termine une offre en cours
//
// AUTHENTIFICATION : le même jeton par service que create-gift-links, dans `x-gift-service-token`.
// Un jeton valide ne suffit pas : le service doit avoir le droit `manage_offers`, accordé à la main.
// L'agent WhatsApp crée des liens ; il ne doit pas pouvoir changer le bouton de toutes les pages.
//
// La page de lecture ne passe JAMAIS par ici : elle lit l'offre en cours par la RPC publique
// get_subscription_offer, qui ne rend que libellé, URL et date de fin.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { estUuid, offrePublique, offresAffichees, validerOffre } from '../_shared/offres.mjs';

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
    const lignes = (data ?? []) as Array<Record<string, unknown>>;
    return json({ offers: lignes.map((l) => offrePublique(l)), displayed_now: offresAffichees(lignes), client: clientName });
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
