// FICHIER ENGENDRÉ — ne pas modifier à la main.
// Régénérer : node build-gift-links-function.mjs
// Sources : gift-links/functions/_shared/apercu.mjs, gift-links/functions/_shared/arc-id.mjs, gift-links/functions/_shared/arc.mjs, gift-links/functions/create-gift-links/index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Ce qu'on peut lire SANS Arc.
//
// Vérifié le 29/09 sur trois articles premium : le corps n'est PAS dans le HTML livré, le paywall est
// appliqué côté serveur. Restent le titre, le chapeau et l'image — exactement de quoi faire un aperçu.
// C'est donc un repli honnête, pas un bouchon : le jour où Arc répond, seul `body` change.

const META = (html, attr, valeur) =>
  new RegExp(`<meta[^>]+${attr}=["']${valeur}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html)?.[1]
  ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${valeur}["']`, 'i').exec(html)?.[1]
  ?? null;

function decoder(s) {
  if (s == null) return null;
  const nommees = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ocirc: 'ô', ecirc: 'ê', icirc: 'î', ugrave: 'ù', laquo: '«', raquo: '»', rsquo: '’', hellip: '…', deg: '°' };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => nommees[n.toLowerCase()] ?? m);
}

// L'AUTEUR vient du JSON-LD, pas des balises meta : lexpress.fr n'expose pas `meta[name=author]`.
// Forme relevée le 1er oct. : "author":[{"@type":"Person","name":"Laureline Dupont",…}]
function auteurDepuisLdJson(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let doc;
    try { doc = JSON.parse(m[1]); } catch { continue; }
    const file = Array.isArray(doc) ? [...doc] : [doc];
    while (file.length) {
      const o = file.shift();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o['@graph'])) file.push(...o['@graph']);
      const a = o.author;
      if (!a) continue;
      const noms = (Array.isArray(a) ? a : [a])
        .map((x) => (typeof x === 'string' ? x : x && x.name))
        .filter((x) => typeof x === 'string' && x.trim() !== '');
      if (noms.length) return noms.join(', ');
    }
  }
  return null;
}

/** Extrait l'aperçu d'une page publique. `body` reste null : il n'y est pas. */
function apercuDepuisHtml(html, repliUrl) {
  if (typeof html !== 'string' || html === '') return { erreur: 'page vide' };
  const titre = decoder(META(html, 'property', 'og:title') ?? META(html, 'name', 'twitter:title')
    ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? null);
  if (!titre) return { erreur: 'aucun titre dans la page' };
  return {
    title: titre.replace(/\s*[-–|]\s*L.Express\s*$/i, '').trim(),
    standfirst: decoder(META(html, 'property', 'og:description') ?? META(html, 'name', 'description')),
    image_url: decoder(META(html, 'property', 'og:image')),
    canonical_url: decoder(META(html, 'property', 'og:url')) ?? repliUrl ?? null,
    section: decoder(META(html, 'property', 'article:section')),
    author: auteurDepuisLdJson(html) ?? decoder(META(html, 'name', 'author')),
    published_at: decoder(META(html, 'property', 'article:published_time')),
    body: null,   // JAMAIS deviné : un corps inventé serait pire que pas de corps
  };
}

// L'identifiant Arc est DÉJÀ dans l'URL : le suffixe de 26 caractères. Vérifié le 29/09 sur les pages
// publiques. Rien à inventer — Piano rend l'URL, on en extrait l'identifiant.
//
//   https://www.lexpress.fr/secret-defense/la-dgse-…-LQBW5JK75BDOBJHRA76NRFPJFY/
//                                                   └────────── _id Arc ──────────┘

const ARC_ID = /-([A-Z0-9]{26})\/?$/;
const ANCIEN_FORMAT = /_\d+\.html?$/i;

/**
 * Rend { arcId } ou { erreur } — jamais null silencieux : un appelant qui fournit une URL d'un autre
 * format doit l'apprendre, pas recevoir deux liens au lieu de trois.
 */
function arcIdDepuisUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return { erreur: 'url vide' };
  let u;
  try { u = new URL(url.trim()); } catch { return { erreur: `url illisible : ${url}` }; }

  if (!/(^|\.)lexpress\.fr$/i.test(u.hostname)) return { erreur: `domaine inattendu : ${u.hostname}` };

  // L'ancien format ne porte pas d'identifiant Arc. Ces articles sont déjà écartés par la règle des
  // 30 jours, mais un appelant qui en fournirait un doit recevoir un refus explicite, pas un silence.
  if (ANCIEN_FORMAT.test(u.pathname)) {
    return { erreur: `ancien format sans identifiant Arc : ${u.pathname}` };
  }

  const m = u.pathname.replace(/\/+$/, '').match(ARC_ID);
  if (!m) return { erreur: `aucun identifiant Arc dans l’URL : ${u.pathname}` };
  return { arcId: m[1], canonicalUrl: u.origin + u.pathname.replace(/\/+$/, '') };
}

/** Sépare le bon grain de l'ivraie sans rien perdre : les deux listes sont rendues. */
function trierUrls(urls) {
  const retenus = [], rejets = [];
  for (const url of Array.isArray(urls) ? urls : []) {
    const r = arcIdDepuisUrl(url);
    if (r.arcId) retenus.push({ url, arcId: r.arcId, canonicalUrl: r.canonicalUrl });
    else rejets.push({ url, erreur: r.erreur });
  }
  return { retenus, rejets };
}

// Le client de contenu. DEUX CHEMINS, et le second n'est pas un bouchon jetable.
//
// 1. Arc XP, quand les identifiants fonctionnent : titre, chapeau, image ET corps.
// 2. À défaut, la page publique : titre, chapeau, image, corps NULL.
//
// Le second chemin reste utile APRÈS la mise en service : si Arc tombe, on sert un aperçu réel plutôt
// que rien. L'appelant ne voit pas la différence dans la forme de la réponse, seulement dans `body`.

const UA = 'LExpress-GiftLinks/1 (+contenu offert WhatsApp)';

/**
 * @param {{arcId: string, canonicalUrl: string}} article
 * @param {{arcBase?: string, arcToken?: string, arcSite?: string, fetch?: typeof globalThis.fetch}} conf
 */
async function chargerArticle(article, conf = {}) {
  const f = conf.fetch ?? globalThis.fetch;

  if (conf.arcBase && conf.arcToken) {
    try {
      const url = `${conf.arcBase.replace(/\/+$/, '')}/content/v4/?_id=${encodeURIComponent(article.arcId)}`
        + `&website=${encodeURIComponent(conf.arcSite ?? 'lexpress')}`;
      const r = await f(url, { headers: { Authorization: `Bearer ${conf.arcToken}`, 'User-Agent': UA } });
      if (r.ok) {
        const doc = await r.json();
        const contenu = depuisArc(doc, article.canonicalUrl);
        if (contenu) return { ...contenu, source: 'arc' };
      }
      // Arc répond mal : on ne s'arrête pas, on retombe sur l'aperçu. Mais on dit d'où vient le contenu.
    } catch { /* idem : le repli ci-dessous */ }
  }

  const r = await f(article.canonicalUrl, { headers: { 'User-Agent': UA } });
  if (!r || !r.ok) return { erreur: `page injoignable (${r ? r.status : 'sans réponse'})` };
  const apercu = apercuDepuisHtml(await r.text(), article.canonicalUrl);
  if (apercu.erreur) return apercu;
  return { ...apercu, source: 'page-publique' };
}

// CORPS DE DÉMONSTRATION. Sur demande explicite seulement (`fake_body`), et jamais par défaut.
//
// Il sert à éprouver la mise en page de l'état « ok » tant qu'Arc ne répond pas. Il porte une bannière
// en clair : la page est publique, un lien peut être transféré, et un faux texte sans avertissement se
// lirait comme du journalisme de L'Express. Mieux vaut un article visiblement factice qu'un faux crédible.
function corpsDeDemonstration(article) {
  const chapeau = (article && article.standfirst) || '';
  return [
    '⚠️ TEXTE DE DÉMONSTRATION — ce n\'est pas l\'article réel.',
    'Le contenu éditorial n\'est pas encore accessible ; ce texte sert uniquement à vérifier la mise en page.',
    chapeau,
    'Premier paragraphe de remplissage. Il n\'a aucune valeur informative et ne doit jamais être diffusé.',
    'Deuxième paragraphe de remplissage, pour juger de l\'interligne et de la longueur de ligne.',
    'Troisième paragraphe de remplissage, pour voir le bas de page et le bouton d\'abonnement.',
  ].filter((l) => l !== '').join('\n\n');
}

/** Lecture d'un document Arc. Le corps est la concaténation des éléments de texte de content_elements. */
function depuisArc(doc, repliUrl) {
  if (!doc || typeof doc !== 'object') return null;
  const titre = doc.headlines?.basic ?? doc.headline?.basic ?? null;
  if (!titre) return null;
  const corps = Array.isArray(doc.content_elements)
    ? doc.content_elements.filter((e) => e?.type === 'text' && typeof e.content === 'string')
        .map((e) => e.content).join('\n\n').trim()
    : '';
  return {
    title: titre,
    standfirst: doc.subheadlines?.basic ?? doc.description?.basic ?? null,
    image_url: doc.promo_items?.basic?.url ?? doc.promo_items?.lead_art?.url ?? null,
    canonical_url: doc.canonical_url ? new URL(doc.canonical_url, 'https://www.lexpress.fr').href : repliUrl,
    section: doc.taxonomy?.primary_section?.name ?? doc.taxonomy?.sections?.[0]?.name ?? null,
    author: (Array.isArray(doc.credits?.by) ? doc.credits.by : [])
      .map((x) => x?.name).filter((x) => typeof x === 'string' && x.trim() !== '').join(', ') || null,
    published_at: doc.publish_date ?? doc.first_publish_date ?? null,
    body: corps === '' ? null : corps,   // corps vide = aperçu, pas « ok » menteur
  };
}

// POST /create-gift-links — le service ne connaît pas WhatsApp, et n'appelle jamais Lovable.
//
// Corps attendu : { urls: string[], channel?, campaign?, expires_in_days? }
// Réponse       : { links: [{ url, arc_id, token, link, expires_at, content }], rejected: [...] }
//
// AUTHENTIFICATION : un secret partagé dans l'en-tête `x-gift-service-token`. Sans lui, n'importe qui
// pourrait fabriquer des liens vers des articles premium — c'est la porte la plus sensible du service.


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
