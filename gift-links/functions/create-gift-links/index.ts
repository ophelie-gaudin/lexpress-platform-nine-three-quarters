// POST /create-gift-links — le service ne connaît pas WhatsApp, et n'appelle jamais Lovable.
//
// Corps attendu : { urls: string[], expires_in_days? }
//                 `channel` et `campaign` sont tolérés et IGNORÉS — voir l'appel RPC.
// Réponse       : { links: [{ url, arc_id, token, link, expires_at, content }], rejected: [...] }
//
// AUTHENTIFICATION : un jeton PAR SERVICE dans l'en-tête `x-gift-service-token`, révocable un par un.
// Sans lui, n'importe qui pourrait fabriquer des liens vers des articles premium — c'est la porte la
// plus sensible du service.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { trierUrls } from '../_shared/arc-id.mjs';
import { chargerArticle, corpsDeDemonstration } from '../_shared/arc.mjs';
import { CLES_ACCEPTEES, clesInconnues, corpsUtilisable, dureeDemandee } from '../_shared/corps.mjs';

const env = (k: string) => Deno.env.get(k) ?? '';

// Un appelant navigateur envoie d'abord un OPTIONS. Sans réponse à cette pré-vérification, l'appel est
// bloqué AVANT d'atteindre le code — et le diagnostic ne dit rien d'utile (« Failed to fetch »).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-gift-service-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'méthode non autorisée' }, 405);

  // ── QUI APPELLE. Un jeton par service, révocable un par un (migration 006).
  //
  // LE JETON EN CLAIR NE QUITTE PAS CETTE FONCTION : on envoie son empreinte SHA-256 à la base. Lire la
  // table `api_clients` ne donne donc rien d'utilisable, comme pour un mot de passe.
  //
  // LE 401 EST NU. La base sait distinguer « jeton inconnu » de « jeton révoqué » ; l'appelant, non.
  // Le lui dire renseignerait qui cherche à deviner.
  const presente = req.headers.get('x-gift-service-token') ?? '';
  if (presente === '') return json({ error: 'non autorisé' }, 401);

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  const empreinte = [...new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(presente))
  )].map((o) => o.toString(16).padStart(2, '0')).join('');

  // PLUS DE SECRET PARTAGÉ. Le repli `GIFT_SERVICE_TOKEN` a vécu du 7 octobre au soir du 7 octobre,
  // le temps que le job nocturne n8n passe sur son propre jeton — c'est fait, prouvé par 21 liens
  // attribués. Un secret qui ouvre la porte sans nommer personne est exactement ce qu'on voulait
  // supprimer : il rendait toute révocation collective.
  //
  // ET UNE PANNE N'EST PAS UN REFUS. Si la base ne répond pas, l'appelant recevait le même 401 qu'un
  // jeton révoqué — et la documentation l'envoyait réparer des jetons parfaitement valides. Un 503 dit
  // la vérité : ce n'est pas vous, revenez.
  const { data: clients, error: erreurAuth } = await db.rpc('verify_api_client', { p_token_sha256: empreinte });
  if (erreurAuth) return json({ error: 'vérification indisponible, réessayez' }, 503);
  const client = Array.isArray(clients) ? clients[0] : clients;
  if (!client?.ok) return json({ error: 'non autorisé' }, 401);
  const clientId: string = client.client_id;
  const clientName: string = client.name;

  let corps: Record<string, unknown>;
  // `null` est un JSON valide : sans ce garde, la lecture des clés plus bas lève une exception non
  // gérée et l'appelant reçoit une erreur du runtime au lieu d'un refus qui s'explique.
  try {
    const brut = await req.json();
    if (!corpsUtilisable(brut)) return json({ error: 'le corps doit être un objet JSON' }, 400);
    corps = brut as Record<string, unknown>;
  } catch { return json({ error: 'corps JSON illisible' }, 400); }

  // ── UNE CLÉ INCONNUE EST UN REFUS, PAS UN HAUSSEMENT D'ÉPAULES.
  //
  // `channel` et `campaign` ont été acceptées puis ignorées en silence du 8 octobre au soir. Un appelant
  // qui les envoyait croyait attribuer ses liens ; il ne faisait rien, et rien ne le lui disait. Une
  // faute de frappe sur `expires_in_days` se payait de la même façon : quinze jours au lieu de trente,
  // sans un mot.
  //
  // L'ATTRIBUTION NE SE MET PAS ICI. Elle voyage dans la query string du lien qu'on diffuse —
  // `?s=…&at_medium=…&at_campaign=…&at_campaign_group=…` — parce qu'un lien est COMMUN à tous ses
  // destinataires et qu'une campagne posée sur lui écraserait celle de tous les autres.
  const inconnues = clesInconnues(corps);
  if (inconnues.length > 0) {
    return json({
      error: `clé(s) non reconnue(s) : ${inconnues.join(', ')}`,
      accepted_keys: CLES_ACCEPTEES,
      hint: inconnues.some((c) => c === 'channel' || c === 'campaign')
        ? "`channel` et `campaign` n'existent plus. Un lien est commun à tous ses destinataires : posez l'attribution dans la query string du lien diffusé (?s=…&at_medium=…&at_campaign=…&at_campaign_group=…), elle y est enregistrée lecture par lecture."
        : undefined,
    }, 400);
  }

  const { retenus, rejets } = trierUrls(corps.urls as string[]);
  if (retenus.length === 0) {
    return json({ error: 'aucune URL exploitable', rejected: rejets }, 400);
  }

  // LA DURÉE SE VALIDE AVANT D'ÉCRIRE QUOI QUE CE SOIT. Elle était lue APRÈS la mise en cache : un
  // `1e300` levait une exception une fois le contenu partagé déjà modifié. Et `-1`, `0`, `false` ou
  // `"abc"` devenaient silencieusement quinze jours — l'appelant croyait avoir demandé autre chose.
  const duree = dureeDemandee(corps.expires_in_days);
  if (duree.erreur) return json({ error: duree.erreur }, 400);
  const jours = duree.jours as number;

  const conf = { arcBase: env('ARC_BASE'), arcToken: env('ARC_TOKEN'), arcSite: env('ARC_SITE') || 'lexpress' };

  // Le contenu D'ABORD, les liens ENSUITE : create_gift_links refuse un article absent du cache, et on
  // préfère ce refus à un lien qui pointerait sur une page vide.
  //
  // EN PARALLÈLE, et ce n'est pas du confort : l'appel type porte TROIS articles. En série, trois
  // chargements de page s'additionnent et la requête dépasse le temps imparti — constaté le 1er oct.,
  // une URL passait, trois échouaient.
  const charges = await Promise.all(retenus.map(async (a) => ({ a, contenu: await chargerArticle(a, conf) })));

  const prets: Array<Record<string, unknown>> = [];
  const aCacher: Array<Record<string, unknown>> = [];
  for (const { a, contenu } of charges) {
    if ((contenu as { erreur?: string }).erreur) {
      rejets.push({ url: a.url, erreur: (contenu as { erreur: string }).erreur });
      continue;
    }
    const c = contenu as Record<string, unknown>;
    // Corps de démonstration : sur demande explicite, jamais par défaut. `is_demo` voyage avec la ligne
    // pour que la base refuse de le poser sur un article qu'elle a déjà — ce que cette fonction ne peut
    // pas savoir, puisqu'elle ne voit que le chargement courant.
    const demo = corps.fake_body === true && !c.body;
    if (demo) c.body = corpsDeDemonstration(c);
    aCacher.push({
      arc_id: a.arcId,
      canonical_url: c.canonical_url ?? a.canonicalUrl,
      title: c.title, standfirst: c.standfirst, image_url: c.image_url,
      body: c.body, section: c.section, author: c.author, published_at: c.published_at,
      is_demo: demo,
    });
    prets.push({ ...a, source: c.source, body: c.body });
  }

  // LE CACHE PASSE PAR LA BASE, PAS PAR UN UPSERT. Un `upsert` écrase : Arc indisponible, et le corps
  // complet d'un lien DÉJÀ diffusé devenait un aperçu. `cache_articles` ne dégrade aucun champ, refuse
  // qu'une démonstration recouvre un vrai corps, et dédoublonne un lot qui contient deux fois le même
  // article — ce que PostgreSQL rejetait en bloc (21000).
  if (aCacher.length > 0) {
    const { error } = await db.rpc('cache_articles', { p_articles: aCacher });
    if (error) return json({ error: `mise en cache refusée : ${error.message}`, rejected: rejets }, 500);
  }

  if (prets.length === 0) return json({ error: 'aucun article exploitable', rejected: rejets }, 502);

  const { data, error } = await db.rpc('create_gift_links', {
    p_arc_ids: [...new Set(prets.map((p) => p.arcId as string))],
    // NI `channel` NI `campaign` (8 oct. 2026). Le lien est COMMUN à tous ses destinataires : lui coller
    // une campagne attribuait toutes les lectures à la dernière déclarée, y compris les plus anciennes.
    // L'attribution appartient à l'envoi et voyage dans la query string du lien diffusé —
    // `?s=…&at_medium=…&at_campaign=…&at_campaign_group=…` — puis se range dans `gift_link_opens`,
    // une ligne par lecture. Les deux clés restent acceptées dans le corps pour ne pas casser les
    // appelants en place ; elles ne sont simplement plus transmises.
    // QUI DEMANDE. Rattache le lien à son service : créé par lui, et prolongé par lui si la date bouge.
    // NULL pour l'appelant sans jeton nommé — une absence honnête plutôt qu'une attribution devinée.
    p_client_id: clientId,
    p_expires_at: Number.isFinite(jours) && jours > 0
      ? new Date(Date.now() + jours * 86400000).toISOString() : null,
  });
  if (error) return json({ error: `création refusée : ${error.message}`, rejected: rejets }, 500);

  const parArc = new Map((data ?? []).map((l: Record<string, string>) => [l.arc_id, l]));
  const racine = (env('GIFT_LINK_BASE') || 'https://articles.lexpress.fr').replace(/\/+$/, '');

  const liens: Array<Record<string, unknown>> = [];
  for (const p of prets) {
    const l = parArc.get(p.arcId as string);

    // UN LIEN RETIRÉ N'EST PAS RESSUSCITÉ par un appel d'API : withdrawn_at est une décision éditoriale.
    // Il part dans les refus, avec son motif, plutôt que de rendre un lien qui mènerait à un refus.
    if (!l || l.state === 'withdrawn' || !l.token) {
      rejets.push({ url: p.url, erreur: 'lien retiré : rouvrir withdrawn_at à la main, délibérément' });
      continue;
    }
    liens.push({
      url: p.url, arc_id: p.arcId, token: l.token,
      link: `${racine}/a/${l.token}`,
      expires_at: l.expires_at,
      // L'appelant SAIT ce qu'il envoie : un article complet, ou seulement son aperçu.
      content: p.body ? 'full' : 'preview',
      source: p.source,
      // created : lien neuf. extended : date repoussée. unchanged : déjà valable plus longtemps.
      state: l.state,
    });
  }

  // CE QUE CET APPEL A PRODUIT. Compté à la fin, jamais à l'entrée : un appel qui échoue en chemin ne
  // doit pas porter au compte d'un service des liens qu'il n'a pas obtenus. Aucun plafond aujourd'hui
  // (décision d'Ophélie, 7 oct.) — mais le jour où il en faudra un, les chiffres seront déjà là.
  await db.rpc('count_client_links', { p_client_id: clientId, p_links: liens.length });

  return json({ links: liens, rejected: rejets, client: clientName });
});
