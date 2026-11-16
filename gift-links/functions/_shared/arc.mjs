// Le client de contenu. DEUX CHEMINS, et le second n'est pas un bouchon jetable.
//
// 1. Arc XP, quand les identifiants fonctionnent : titre, chapeau, image ET corps.
// 2. À défaut, la page publique : titre, chapeau, image, corps NULL.
//
// Le second chemin reste utile APRÈS la mise en service : si Arc tombe, on sert un aperçu réel plutôt
// que rien. L'appelant ne voit pas la différence dans la forme de la réponse, seulement dans `body`.
import { apercuDepuisHtml } from './apercu.mjs';
import { SITES, EDITIONS, editionDepuisUrl, siteDepuisUrl } from './editions.mjs';

const UA = 'LExpress-GiftLinks/1 (+contenu offert WhatsApp)';

/**
 * @param {{arcId: string, canonicalUrl: string}} article
 * @param {{arcBase?: string, arcToken?: string, arcSite?: string, fetch?: typeof globalThis.fetch}} conf
 */
export async function chargerArticle(article, conf = {}) {
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
export function corpsDeDemonstration(article) {
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

export function assainir(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(DANGEREUX, '')
    .replace(BALISE_SEULE, '')
    .replace(ATTRIBUT_ON, '')
    .replace(URL_ACTIVE, '');
}

export function rendreElement(e, edition = 'FR') {
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
export function sansSubstance(html) {
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
export function depuisArc(doc, repliUrl, edition = 'FR') {
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
