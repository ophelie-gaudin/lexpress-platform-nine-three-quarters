// FICHIER ENGENDRÉ — ne pas modifier à la main.
// Régénérer : node build-gift-links-function.mjs
// Sources : gift-links/functions/_shared/editions.mjs, gift-links/functions/_shared/apercu.mjs, gift-links/functions/_shared/arc-id.mjs, gift-links/functions/_shared/arc.mjs, gift-links/functions/_shared/corps.mjs, gift-links/functions/create-gift-links/index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Édition de stockage FR/EUR distincte de la langue et du site Arc.
// Vérifié par GET des pages publiques le 16 novembre 2026 (Fusion.arcSite et html lang).
const SITES = Object.freeze([
  Object.freeze({ edition: 'FR', language: 'fr', arcSite: 'lexpress', publicOrigin: 'https://www.lexpress.fr', readerOrigin: 'https://articles.lexpress.fr', hosts: Object.freeze(['lexpress.fr', 'www.lexpress.fr']) }),
  Object.freeze({ edition: 'EUR', language: 'en', arcSite: 'lexpress-europe', publicOrigin: 'https://www.lexpress.eu', readerOrigin: 'https://articles.lexpress.eu', hosts: Object.freeze(['lexpress.eu', 'www.lexpress.eu']) }),
  Object.freeze({ edition: 'EUR', language: 'pl', arcSite: 'lexpress-europe-pl', publicOrigin: 'https://pl.lexpress.eu', readerOrigin: 'https://articles.lexpress.eu', hosts: Object.freeze(['pl.lexpress.eu']) }),
  Object.freeze({ edition: 'EUR', language: 'fr', arcSite: 'lexpress-europe-fr', publicOrigin: 'https://fr.lexpress.eu', readerOrigin: 'https://articles.lexpress.eu', hosts: Object.freeze(['fr.lexpress.eu']) }),
]);
const EDITIONS = Object.freeze({ FR: SITES[0], EUR: SITES[1] });
function siteDepuisUrl(value) {
  if (typeof value !== 'string') return null;
  // URL normalise :443 en port vide. Examiner l'autorité brute avant cette normalisation.
  const authority = /^https:\/\/([^/?#]+)/i.exec(value.trim())?.[1];
  if (!authority || /[:@\\]/.test(authority)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  return SITES.find(site => site.hosts.includes(url.hostname.toLowerCase())) ?? null;
}
function editionDepuisUrl(value) {
  return siteDepuisUrl(value)?.edition ?? null;
}

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
/** Liste explicite des hôtes dont le serveur accepte d'aller chercher une page. */
const HOTES = new Set(SITES.flatMap(e => e.hosts));

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
  if (u.username || u.password) return { erreur: 'identifiants URL refusés' };
  if (u.protocol !== 'https:') return { erreur: `protocole refusé : ${u.protocol}` };
  if (u.port !== '') return { erreur: `port refusé : ${u.port}` };
  if (!siteDepuisUrl(url)) return { erreur: `domaine inattendu : ${u.hostname}` };

  // L'ancien format ne porte pas d'identifiant Arc. Ces articles sont déjà écartés par la règle des
  // 30 jours, mais un appelant qui en fournirait un doit recevoir un refus explicite, pas un silence.
  if (ANCIEN_FORMAT.test(u.pathname)) {
    return { erreur: `ancien format sans identifiant Arc : ${u.pathname}` };
  }

  const m = u.pathname.replace(/\/+$/, '').match(ARC_ID);
  if (!m) return { erreur: `aucun identifiant Arc dans l’URL : ${u.pathname}` };
  return { edition: editionDepuisUrl(u.href), language: siteDepuisUrl(url).language, arcId: m[1], canonicalUrl: u.origin + u.pathname.replace(/\/+$/, '') };
}

/** Sépare le bon grain de l'ivraie sans rien perdre : les deux listes sont rendues. */
function trierUrls(urls) {
  const retenus = [], rejets = [];
  for (const url of Array.isArray(urls) ? urls : []) {
    const r = arcIdDepuisUrl(url);
    if (r.arcId) retenus.push({ url, edition: r.edition, language: r.language, arcId: r.arcId, canonicalUrl: r.canonicalUrl });
    else rejets.push({ url, erreur: r.erreur });
  }
  // UN IDENTIFIANT ARC N'A QU'UNE LANGUE (revue adverse, 16 nov. 2026). Le même identifiant demandé
  // par deux hôtes Europe rendait un seul jeton annoncé sous deux langues. Les deux demandes sont
  // refusées : on ne devine pas laquelle est la bonne.
  const langues = new Map();
  for (const r of retenus) {
    const cle = `${r.edition}:${r.arcId}`;
    langues.set(cle, (langues.get(cle) ?? new Set()).add(r.language));
  }
  const nets = [];
  for (const r of retenus) {
    const vues = langues.get(`${r.edition}:${r.arcId}`);
    if (vues.size > 1) rejets.push({ url: r.url, erreur: `même identifiant Arc demandé sous deux langues (${[...vues].sort().join(', ')})` });
    else nets.push(r);
  }
  return { retenus: nets, rejets };
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
  const edition = article.edition ?? editionDepuisUrl(article.canonicalUrl);
  if (!EDITIONS[edition] || editionDepuisUrl(article.canonicalUrl) !== edition) return { erreur: 'édition invalide' };
  const siteConfig = siteDepuisUrl(article.canonicalUrl);
  const site = siteConfig.arcSite;

  if (conf.arcBase && conf.arcToken) {
    try {
      const url = `${conf.arcBase.replace(/\/+$/, '')}/content/v4/?_id=${encodeURIComponent(article.arcId)}`
        + `&website=${encodeURIComponent(site)}`;
      const r = await f(url, { headers: { Authorization: `Bearer ${conf.arcToken}`, 'User-Agent': UA } });
      if (r.ok) {
        const doc = await r.json();
        const valid = doc._id === article.arcId && doc.websites?.[site];
        if (valid && SITES.filter(s => s.edition === 'EUR' && doc.websites?.[s.arcSite]).length > 1) return { erreur: 'article publié sur plusieurs sites Europe : langue ambiguë' };
        const contenu = valid ? depuisArc(doc, article.canonicalUrl, edition) : null;
        if (contenu) return { ...contenu, source: 'arc' };
      }
      // Arc répond mal : on ne s'arrête pas, on retombe sur l'aperçu. Mais on dit d'où vient le contenu.
    } catch { /* idem : le repli ci-dessous */ }
  }

  let target = new URL(new URL(article.canonicalUrl).pathname, siteConfig.publicOrigin).href;
  let r;
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (siteDepuisUrl(target) !== siteConfig) return { erreur: 'redirection hors domaine ou édition' };
    r = await f(target, { redirect: 'manual', headers: { 'User-Agent': UA } });
    if ([301, 302, 303, 307, 308].includes(r?.status)) {
      const location = r.headers.get('location');
      if (!location) return { erreur: 'redirection sans destination' };
      const absolute = location.trim().startsWith('//') ? 'https:' + location.trim() : location.trim();
      if (/^https?:\/\//i.test(absolute) && siteDepuisUrl(absolute) !== siteConfig) return { erreur: 'redirection hors domaine ou édition' };
      try { target = new URL(location, target).href; } catch { return { erreur: 'redirection invalide' }; }
      continue;
    }
    break;
  }
  if (!r?.ok) return { erreur: `page injoignable (${r ? r.status : 'sans réponse'})` };
  if (r.url && siteDepuisUrl(r.url) !== siteConfig) return { erreur: 'redirection hors domaine ou édition' };
  const apercu = apercuDepuisHtml(await r.text(), target);
  // Une balise og:url ne peut déplacer le cache vers une autre édition.
  if (siteDepuisUrl(apercu.canonical_url) !== siteConfig) apercu.canonical_url = target;
  // Forme normalisée : la base lie la langue à l'hôte de cette adresse, et le lecteur la relit.
  // Un og:url précédé d'un espace passait le filtre mais faisait refuser tout le lot par la base.
  else apercu.canonical_url = new URL(apercu.canonical_url).href;
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
  if (article?.edition === 'EUR') return [
    '⚠️ DEMONSTRATION TEXT — this is not the real article.',
    'Editorial content is unavailable. This text only tests the page layout.',
    chapeau, 'First sample paragraph. Do not distribute as editorial content.',
    'Second sample paragraph to check line spacing.',
  ].filter(Boolean).join('\n\n');
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

function rendreElement(e, edition = 'FR') {
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
    const alt = sansBalises(legende) || (edition === 'EUR' ? 'Article illustration' : 'Illustration de l\'article');
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
function depuisArc(doc, repliUrl, edition = 'FR') {
  if (!doc || typeof doc !== 'object') return null;
  const titre = doc.headlines?.basic ?? doc.headline?.basic ?? null;
  if (!titre) return null;
  const corps = Array.isArray(doc.content_elements)
    ? doc.content_elements.map(e => rendreElement(e, edition)).filter((h) => h !== '').join('\n\n').trim()
    : '';
  return {
    title: titre,
    standfirst: doc.subheadlines?.basic ?? doc.description?.basic ?? null,
    image_url: doc.promo_items?.basic?.url ?? doc.promo_items?.lead_art?.url ?? null,
    canonical_url: canonicalArc(doc, repliUrl, edition),
    section: doc.taxonomy?.primary_section?.name ?? doc.taxonomy?.sections?.[0]?.name ?? null,
    author: (Array.isArray(doc.credits?.by) ? doc.credits.by : [])
      .map((x) => x?.name).filter((x) => typeof x === 'string' && x.trim() !== '').join(', ') || null,
    published_at: doc.publish_date ?? doc.first_publish_date ?? null,
    body: sansSubstance(corps) ? null : corps,   // corps vide = aperçu, pas « ok » menteur
  };
}

function canonicalArc(doc, fallback, edition) {
  const config = siteDepuisUrl(fallback) ?? EDITIONS[edition];
  const site = config?.arcSite;
  const value = doc.websites?.[site]?.website_url ?? doc.canonical_url;
  try {
    const candidate = new URL(value ?? fallback, config?.publicOrigin ?? 'https://www.lexpress.fr').href;
    return siteDepuisUrl(candidate) === config ? candidate : fallback;
  } catch { return fallback; }
}

// Ce que le service accepte dans le corps d'une requête, et ce qu'il en refuse.
//
// POURQUOI UN MODULE À PART. Ces règles vivaient dans la fonction Edge, qui ne tourne que sous Deno :
// aucun test Node ne pouvait les EXÉCUTER. Les contrôles se contentaient de chercher des chaînes dans
// le fichier déployable — une revue adverse a montré qu'on pouvait désactiver le refus
// d'authentification sans qu'une seule assertion bronche. Ici, les cas appellent le vrai code et
// regardent le vrai résultat.

/** Les seules clés que l'appelant peut poser. Toute autre est un refus nommé. */
const CLES_ACCEPTEES = ['urls', 'expires_in_days', 'fake_body'];

/**
 * UNE CLÉ INCONNUE EST UN REFUS, PAS UN HAUSSEMENT D'ÉPAULES.
 *
 * `channel` et `campaign` ont été acceptées puis ignorées en silence. Un appelant qui les envoyait
 * croyait attribuer ses liens ; il ne faisait rien, et rien ne le lui disait. Une faute de frappe sur
 * `expires_in_days` se payait pareil : quinze jours au lieu de trente, sans un mot.
 */
function clesInconnues(corps) {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return [];
  return Object.keys(corps).filter((c) => !CLES_ACCEPTEES.includes(c));
}

/**
 * LA DURÉE, VALIDÉE AVANT TOUTE ÉCRITURE.
 *
 * `-1`, `0`, `false` et `"abc"` devenaient quinze jours en silence ; `1e300` levait une exception une
 * fois le contenu partagé déjà modifié. Rend `{ jours }` ou `{ erreur }`.
 */
function dureeDemandee(valeur) {
  // ON EXIGE UN NOMBRE, PAS QUELQUE CHOSE QUI S'Y CONVERTIT. `Number(true)` vaut 1 : `expires_in_days:
  // true` serait devenu un jour, en silence. `"30"` passerait aussi, et le jour où quelqu'un écrit
  // `"30 jours"` il recevrait quinze. Trouvé par un cas écrit pour cette révision.
  if (valeur !== undefined && typeof valeur !== 'number') {
    return { erreur: `expires_in_days doit être un nombre (reçu : ${JSON.stringify(valeur)})` };
  }
  const jours = valeur === undefined ? 15 : valeur;
  if (!Number.isFinite(jours) || !Number.isInteger(jours) || jours < 1 || jours > 365) {
    return { erreur: `expires_in_days doit être un entier entre 1 et 365 (reçu : ${JSON.stringify(valeur)})` };
  }
  return { jours };
}

/** Un corps JSON doit être un objet. `null` et `[]` sont du JSON valide, et n'ont rien à faire ici. */
function corpsUtilisable(brut) {
  return brut !== null && typeof brut === 'object' && !Array.isArray(brut);
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

// ── CE QUI SE VOIT À 3 H DU MATIN.
//
// Cette fonction a longtemps été muette : elle expliquait précisément ses refus — « aucun article
// exploitable », « mise en cache refusée : … » — mais UNIQUEMENT dans la réponse HTTP. Le diagnostic
// d'une panne nocturne dépendait donc de n8n, dont la rétention est de 14 jours OU 10 000 exécutions
// toutes confondues : un workflow bavard chasse les autres, et le motif disparaît avant qu'on le lise.
// Côté Supabase il ne restait qu'un `502` sans cause.
//
// UNE LIGNE JSON PAR ÉVÉNEMENT, pour que l'explorateur de logs puisse filtrer sur `evenement`.
//
// NI LE JETON DE SERVICE NI LE JETON D'UN LIEN N'Y FIGURENT JAMAIS. Le second EST l'accès à l'article
// premium : l'écrire dans un journal reviendrait à déposer la clé à côté de la porte. On nomme le
// service appelant et l'URL d'origine, qui sont publics, jamais de quoi ouvrir quoi que ce soit.
const journal = (niveau: 'error' | 'warn', evenement: string, details: Record<string, unknown> = {}) => {
  const ligne = JSON.stringify({ fn: 'create-gift-links', evenement, ...details });
  if (niveau === 'error') console.error(ligne);
  else console.warn(ligne);
};

// Les refus portent une URL et un motif ; on en garde dix, de quoi comprendre sans inonder le journal
// le jour où un appelant envoie une liste entière.
const apercuRejets = (rejets: Array<Record<string, unknown>>) =>
  rejets.slice(0, 10).map((r) => ({ url: r.url, erreur: r.erreur }));

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
  if (presente === '') {
    journal('warn', 'jeton_refuse', { cause: 'en-tête absent' });
    return json({ error: 'non autorisé' }, 401);
  }

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
  if (erreurAuth) {
    journal('error', 'verification_indisponible', { message: erreurAuth.message });
    return json({ error: 'vérification indisponible, réessayez' }, 503);
  }
  const client = Array.isArray(clients) ? clients[0] : clients;
  if (!client?.ok) {
    // Le 401 rendu reste nu — ne pas renseigner qui cherche à deviner. Le journal, lui, est interne :
    // il peut dire si le jeton est inconnu ou révoqué, et c'est exactement ce qu'on veut savoir quand
    // un service en place cesse brusquement de passer.
    journal('warn', 'jeton_refuse', { cause: client?.reason ?? 'jeton inconnu' });
    return json({ error: 'non autorisé' }, 401);
  }
  const clientId: string = client.client_id;
  const clientName: string = client.name;

  let corps: Record<string, unknown>;
  // `null` est un JSON valide : sans ce garde, la lecture des clés plus bas lève une exception non
  // gérée et l'appelant reçoit une erreur du runtime au lieu d'un refus qui s'explique.
  try {
    const brut = await req.json();
    if (!corpsUtilisable(brut)) {
      journal('warn', 'corps_invalide', { client: clientName, cause: 'pas un objet JSON' });
      return json({ error: 'le corps doit être un objet JSON' }, 400);
    }
    corps = brut as Record<string, unknown>;
  } catch {
    journal('warn', 'corps_invalide', { client: clientName, cause: 'JSON illisible' });
    return json({ error: 'corps JSON illisible' }, 400);
  }

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
    journal('warn', 'cles_inconnues', { client: clientName, cles: inconnues });
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
    journal('warn', 'aucune_url_exploitable', { client: clientName, rejets: apercuRejets(rejets) });
    return json({ error: 'aucune URL exploitable', rejected: rejets }, 400);
  }

  // LA DURÉE SE VALIDE AVANT D'ÉCRIRE QUOI QUE CE SOIT. Elle était lue APRÈS la mise en cache : un
  // `1e300` levait une exception une fois le contenu partagé déjà modifié. Et `-1`, `0`, `false` ou
  // `"abc"` devenaient silencieusement quinze jours — l'appelant croyait avoir demandé autre chose.
  const duree = dureeDemandee(corps.expires_in_days);
  if (duree.erreur) {
    journal('warn', 'duree_invalide', { client: clientName, demande: corps.expires_in_days, erreur: duree.erreur });
    return json({ error: duree.erreur }, 400);
  }
  const jours = duree.jours as number;

  const conf = { arcBase: env('ARC_BASE'), arcToken: env('ARC_TOKEN') };

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
    if (demo) c.body = corpsDeDemonstration({ ...c, edition: a.edition });
    aCacher.push({
      edition: a.edition, language: a.language, arc_id: a.arcId,
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
    if (error) {
      journal('error', 'cache_refuse', { client: clientName, articles: aCacher.length, message: error.message });
      return json({ error: `mise en cache refusée : ${error.message}`, rejected: rejets }, 500);
    }
  }

  // LE CAS QUI COMPTE. Un 502 ici veut dire qu'AUCUN article n'a pu être chargé : Arc muet, article
  // déplacé, accès changé. C'est la panne qu'on découvrait jusqu'ici en voyant quelqu'un recevoir un
  // mur d'abonnement. Le motif de chaque URL part dans le journal, par URL.
  if (prets.length === 0) {
    journal('error', 'aucun_article_exploitable', { client: clientName, demandes: retenus.length, rejets: apercuRejets(rejets) });
    return json({ error: 'aucun article exploitable', rejected: rejets }, 502);
  }

  const parArc = new Map<string, Record<string, string>>();
  for (const edition of [...new Set(prets.map(p => p.edition as string))]) {
    const { data, error } = await db.rpc('create_gift_links_for_edition', {
      p_edition: edition,
      p_arc_ids: [...new Set(prets.filter(p => p.edition === edition).map(p => p.arcId as string))],
      p_client_id: clientId,
      p_expires_at: new Date(Date.now() + jours * 86400000).toISOString(),
    });
    if (error) {
      journal('error', 'creation_refusee', { client: clientName, edition, message: error.message });
      return json({ error: `création refusée : ${error.message}`, rejected: rejets }, 500);
    }
    for (const l of data ?? []) parArc.set(`${edition}:${l.arc_id}`, l);
  }

  const liens: Array<Record<string, unknown>> = [];
  for (const p of prets) {
    const l = parArc.get(`${p.edition}:${p.arcId}`);

    // UN LIEN RETIRÉ N'EST PAS RESSUSCITÉ par un appel d'API : withdrawn_at est une décision éditoriale.
    // Il part dans les refus, avec son motif, plutôt que de rendre un lien qui mènerait à un refus.
    if (!l || l.state === 'withdrawn' || !l.token) {
      rejets.push({ url: p.url, erreur: 'lien retiré : rouvrir withdrawn_at à la main, délibérément' });
      continue;
    }
    liens.push({
      url: p.url, edition: p.edition, language: p.language, arc_id: p.arcId, token: l.token,
      link: l.link,
      expires_at: l.expires_at,
      // L'appelant SAIT ce qu'il envoie : un article complet, ou seulement son aperçu.
      content: p.body ? 'full' : 'preview',
      source: p.source,
      // created : lien neuf. extended : date repoussée. unchanged : déjà valable plus longtemps.
      state: l.state,
    });
  }

  // ── LES DEUX DÉGRADATIONS QUI NE LÈVENT AUCUNE ERREUR.
  //
  // Un appel peut rendre 200 et décevoir quand même. Deux cas, et ce sont les plus coûteux parce qu'ils
  // ne ressemblent pas à des pannes : une partie du lot refusée pendant que le reste passe, et un lien
  // rendu en APERÇU — un lien qui mène au mur d'abonnement, c'est-à-dire exactement ce que ce service
  // existe pour éviter. L'appelant le sait, il reçoit `content: "preview"` ; encore faut-il que
  // quelqu'un le lise. Le journal le dit aussi, au niveau `warn`.
  if (rejets.length > 0 && liens.length > 0) {
    journal('warn', 'lot_partiel', { client: clientName, crees: liens.length, refuses: rejets.length, rejets: apercuRejets(rejets) });
  }
  const apercus = liens.filter((l) => l.content === 'preview');
  if (apercus.length > 0) {
    journal('warn', 'apercu_seulement', {
      client: clientName,
      arc_ids: apercus.map((l) => l.arc_id),
      sources: [...new Set(apercus.map((l) => l.source))],
    });
  }

  // CE QUE CET APPEL A PRODUIT. Compté à la fin, jamais à l'entrée : un appel qui échoue en chemin ne
  // doit pas porter au compte d'un service des liens qu'il n'a pas obtenus. Aucun plafond aujourd'hui
  // (décision d'Ophélie, 7 oct.) — mais le jour où il en faudra un, les chiffres seront déjà là.
  await db.rpc('count_client_links', { p_client_id: clientId, p_links: liens.length });

  return json({ links: liens, rejected: rejets, client: clientName });
});
