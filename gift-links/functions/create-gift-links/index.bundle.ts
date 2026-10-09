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
/** Les deux seuls hôtes dont le serveur accepte d'aller chercher une page. */
const HOTES = new Set(['www.lexpress.fr', 'lexpress.fr']);

function arcIdDepuisUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return { erreur: 'url vide' };
  let u;
  try { u = new URL(url.trim()); } catch { return { erreur: `url illisible : ${url}` }; }

  // LE SERVEUR IRA CHERCHER CETTE URL LUI-MÊME. Elle décide donc d'une requête sortante, et doit être
  // tenue plus court qu'un lien que le lecteur suivra dans un corps d'article — ceux-là pointent où ils
  // veulent, et c'est très bien.
  //
  // RELEVÉ PAR UNE REVUE ADVERSE (8 oct. 2026). Le filtre acceptait tout sous-domaine, tout port et
  // tout protocole : `http://interne.lexpress.fr:8443/…` passait, et faisait appeler une machine
  // interne depuis le runtime. Deux hôtes, https, aucun port.
  if (u.protocol !== 'https:') return { erreur: `protocole refusé : ${u.protocol}` };
  if (u.port !== '') return { erreur: `port refusé : ${u.port}` };
  if (!HOTES.has(u.hostname.toLowerCase())) return { erreur: `domaine inattendu : ${u.hostname}` };

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
  // UNE REDIRECTION PEUT SORTIR DU DOMAINE. L'URL d'entrée est filtrée, pas sa destination finale :
  // une page de lexpress.fr qui renverrait ailleurs ferait lire au serveur ce qu'il n'a pas accepté
  // d'aller chercher. On regarde où l'on a atterri, pas seulement où l'on allait.
  if (typeof r.url === 'string' && r.url !== '') {
    let hote;
    try { hote = new URL(r.url).hostname.toLowerCase(); } catch { hote = null; }
    if (hote && !HOTES.has(hote)) return { erreur: `redirection hors domaine : ${hote}` };
  }
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

// CE QU'ON GARDE DU CORPS, ET CE QU'ON ÉCARTE — explicitement (7 oct. 2026).
//
// Jusqu'ici le corps ne retenait que `type === 'text'`. Tout le reste tombait : images, citations,
// encadrés. Ce n'était pas une décision, c'était un effet de bord — et un article long arrivait sans une
// seule respiration. Ophélie l'a relevé sur un article dont les deux citations avaient disparu.
//
// GARDÉS : le texte, les citations, les images. Ce sont du propos et du regard, pas de l'habillage.
//
// ÉCARTÉS, ET C'EST VOULU : `link_list` et `interstitial_link` — les « à lire aussi » — mènent au
// paywall. Les servir dans un article OFFERT reviendrait à promettre une lecture libre puis à buter le
// lecteur trois paragraphes plus loin. `custom_embed`, `oembed_response`, `raw_html` et le reste sont
// écartés faute de pouvoir en garantir le rendu sur une page qu'on ne maîtrise pas entièrement.
//
// TOUT TYPE INCONNU TOMBE. Un format Arc qu'on n'a jamais vu ne doit pas se retrouver tel quel dans la
// page : mieux vaut un paragraphe manquant qu'un bloc illisible.
const echapper = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sansBalises = (v) => String(v).replace(/<[^>]*>/g, '').trim();
const texteDe = (liste) => (Array.isArray(liste) ? liste : [])
  .filter((x) => x?.type === 'text' && typeof x.content === 'string')
  .map((x) => x.content.trim()).filter((x) => x !== '').join(' ');

// CE QUI NE DOIT JAMAIS ATTEINDRE LA PAGE (8 oct. 2026).
//
// RELEVÉ PAR UNE REVUE ADVERSE. Le contrat de la page affirmait que `<script>`, `<iframe>`, `<style>`
// et les attributs `on*` « n'arriveront jamais ». C'était faux : le HTML des éléments `text` passait
// tel quel. Un `<img src=x onerror=…>` dans un article Arc traversait tout le service.
//
// LA PAGE A SA PROPRE LISTE BLANCHE, et c'est bien — mais une promesse écrite dans un contrat doit être
// tenue par celui qui l'écrit. Deux barrières valent mieux qu'une, et personne ne sait à l'avance
// laquelle cédera.
//
// ON RETIRE, ON N'ÉCHAPPE PAS. Échapper rendrait les balises visibles au lecteur ; le corps légitime en
// porte — du gras, des liens, des intertitres — et doit continuer de s'afficher.
const DANGEREUX = /<\s*(script|iframe|style|object|embed|form|link|meta|base)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi;
const BALISE_SEULE = /<\s*\/?\s*(script|iframe|style|object|embed|form|link|meta|base)\b[^>]*>/gi;
const ATTRIBUT_ON = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ACTIVE = /\s+(href|src|xlink:href)\s*=\s*(?:"\s*(?:javascript|data|vbscript):[^"]*"|'\s*(?:javascript|data|vbscript):[^']*'|\s*(?:javascript|data|vbscript):[^\s>]*)/gi;

function assainir(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(DANGEREUX, '')
    .replace(BALISE_SEULE, '')
    .replace(ATTRIBUT_ON, '')
    .replace(URL_ACTIVE, '');
}

function rendreElement(e) {
  if (!e || typeof e !== 'object') return '';

  if (e.type === 'text') return typeof e.content === 'string' ? assainir(e.content).trim() : '';

  if (e.type === 'quote') {
    // La citation porte ses propres content_elements, et `citation` pour l'attribution — vide le plus
    // souvent sur un pullquote. Relevé sur un vrai document le 7 oct.
    const propos = texteDe(e.content_elements);
    if (propos === '') return '';
    const signature = typeof e.citation?.content === 'string' ? sansBalises(e.citation.content) : '';
    return '<blockquote>' + assainir(propos) + (signature ? '<cite>' + echapper(signature) + '</cite>' : '') + '</blockquote>';
  }

  if (e.type === 'image') {
    // FORME NON OBSERVÉE sur un corps réel au moment d'écrire : les articles examinés n'en portaient
    // pas. On reste donc défensif — sans URL https exploitable, l'élément tombe plutôt que de produire
    // une image brisée.
    const url = typeof e.url === 'string' ? e.url.trim() : '';
    if (!/^https:\/\//.test(url)) return '';
    const legende = [e.caption, e.subtitle, e.credits_caption_display]
      .find((x) => typeof x === 'string' && x.trim() !== '') ?? '';
    const alt = sansBalises(legende) || 'Illustration de l\'article';
    return '<figure><img src="' + echapper(url) + '" alt="' + echapper(alt) + '" loading="lazy">'
      + (legende ? '<figcaption>' + assainir(legende) + '</figcaption>' : '') + '</figure>';
  }

  return '';
}

// UN CORPS QUI NE DIT RIEN N'EST PAS UN CORPS (7 oct. 2026).
//
// Relevé sur une page de dossier : Arc rendait un unique élément texte valant « <br/> ». Cinq caractères,
// donc non vide, donc annoncé « article complet » — et la page promettait une lecture offerte pour
// n'afficher que son chapeau. Le mensonge qu'on évite partout ailleurs, par une faute de mesure.
//
// ON MESURE DONC LA SUBSTANCE, pas la longueur : du texte une fois les balises retirées, OU une image.
// Un article qui ne serait qu'une photo légendée reste un article.
function sansSubstance(html) {
  if (typeof html !== 'string' || html.trim() === '') return true;
  if (/<img\b/i.test(html)) return false;
  // LES ESPACES SE DÉGUISENT. `&nbsp;` et `&#160;` étaient traités, mais pas `&#xA0;`, `&#32;` ni
  // `&#8203;` — l'espace de largeur nulle. Un article composé de ces seules entités passait pour
  // complet. On décode toute entité numérique et on regarde ce qui reste.
  const decode = (s) => s
    .replace(/&(nbsp|ensp|emsp|thinsp|zwnj|zwj|shy);/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
  // \u200B à \u200D : largeurs nulles. \uFEFF : marque d'ordre d'octets. Invisibles, donc sans substance.
  return decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ').trim() === '';
}

/** Lecture d'un document Arc. Le corps est la concaténation des éléments de texte de content_elements. */
function depuisArc(doc, repliUrl) {
  if (!doc || typeof doc !== 'object') return null;
  const titre = doc.headlines?.basic ?? doc.headline?.basic ?? null;
  if (!titre) return null;
  const corps = Array.isArray(doc.content_elements)
    ? doc.content_elements.map(rendreElement).filter((h) => h !== '').join('\n\n').trim()
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
    body: sansSubstance(corps) ? null : corps,   // corps vide = aperçu, pas « ok » menteur
  };
}

// POST /create-gift-links — le service ne connaît pas WhatsApp, et n'appelle jamais Lovable.
//
// Corps attendu : { urls: string[], expires_in_days? }
//                 `channel` et `campaign` sont tolérés et IGNORÉS — voir l'appel RPC.
// Réponse       : { links: [{ url, arc_id, token, link, expires_at, content }], rejected: [...] }
//
// AUTHENTIFICATION : un jeton PAR SERVICE dans l'en-tête `x-gift-service-token`, révocable un par un.
// Sans lui, n'importe qui pourrait fabriquer des liens vers des articles premium — c'est la porte la
// plus sensible du service.


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
    if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) {
      return json({ error: 'le corps doit être un objet JSON' }, 400);
    }
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
  const CONNUES = ['urls', 'expires_in_days', 'fake_body'];
  const inconnues = Object.keys(corps).filter((c) => !CONNUES.includes(c));
  if (inconnues.length > 0) {
    return json({
      error: `clé(s) non reconnue(s) : ${inconnues.join(', ')}`,
      accepted_keys: CONNUES,
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
  const jours = corps.expires_in_days === undefined ? 15 : Number(corps.expires_in_days);
  if (!Number.isFinite(jours) || !Number.isInteger(jours) || jours < 1 || jours > 365) {
    return json({ error: `expires_in_days doit être un entier entre 1 et 365 (reçu : ${JSON.stringify(corps.expires_in_days)})` }, 400);
  }

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
