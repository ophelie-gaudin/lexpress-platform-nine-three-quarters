// POST /create-gift-links — le service ne connaît pas WhatsApp, et n'appelle jamais Lovable.
//
// Corps attendu : { urls: string[], channel?, campaign?, expires_in_days? }
// Réponse       : { links: [{ url, arc_id, token, link, expires_at, content }], rejected: [...] }
//
// AUTHENTIFICATION : un secret partagé dans l'en-tête `x-gift-service-token`. Sans lui, n'importe qui
// pourrait fabriquer des liens vers des articles premium — c'est la porte la plus sensible du service.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { trierUrls } from '../_shared/arc-id.mjs';
import { chargerArticle, corpsDeDemonstration } from '../_shared/arc.mjs';

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

  const attendu = env('GIFT_SERVICE_TOKEN');
  if (attendu === '' || req.headers.get('x-gift-service-token') !== attendu) {
    return json({ error: 'non autorisé' }, 401);
  }

  let corps: Record<string, unknown>;
  try { corps = await req.json(); } catch { return json({ error: 'corps JSON illisible' }, 400); }

  const { retenus, rejets } = trierUrls(corps.urls as string[]);
  if (retenus.length === 0) {
    return json({ error: 'aucune URL exploitable', rejected: rejets }, 400);
  }

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
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
    // Corps de démonstration : sur demande explicite, jamais par défaut, et jamais par-dessus un vrai corps.
    if (corps.fake_body === true && !c.body) c.body = corpsDeDemonstration(c);
    aCacher.push({
      arc_id: a.arcId,
      canonical_url: c.canonical_url ?? a.canonicalUrl,
      title: c.title, standfirst: c.standfirst, image_url: c.image_url,
      body: c.body, section: c.section, author: c.author, published_at: c.published_at,
      fetched_at: new Date().toISOString(),
    });
    prets.push({ ...a, source: c.source, body: c.body });
  }

  if (aCacher.length > 0) {
    const { error } = await db.from('articles').upsert(aCacher, { onConflict: 'arc_id' });
    if (error) return json({ error: `mise en cache refusée : ${error.message}`, rejected: rejets }, 500);
  }

  if (prets.length === 0) return json({ error: 'aucun article exploitable', rejected: rejets }, 502);

  const jours = Number(corps.expires_in_days ?? 15);
  const { data, error } = await db.rpc('create_gift_links', {
    p_arc_ids: prets.map((p) => p.arcId),
    p_channel: (corps.channel as string) ?? null,
    p_campaign: (corps.campaign as string) ?? null,
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

  return json({ links: liens, rejected: rejets });
});
