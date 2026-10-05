// Le client de contenu. DEUX CHEMINS, et le second n'est pas un bouchon jetable.
//
// 1. Arc XP, quand les identifiants fonctionnent : titre, chapeau, image ET corps.
// 2. À défaut, la page publique : titre, chapeau, image, corps NULL.
//
// Le second chemin reste utile APRÈS la mise en service : si Arc tombe, on sert un aperçu réel plutôt
// que rien. L'appelant ne voit pas la différence dans la forme de la réponse, seulement dans `body`.
import { apercuDepuisHtml } from './apercu.mjs';

const UA = 'LExpress-GiftLinks/1 (+contenu offert WhatsApp)';

/**
 * @param {{arcId: string, canonicalUrl: string}} article
 * @param {{arcBase?: string, arcToken?: string, arcSite?: string, fetch?: typeof globalThis.fetch}} conf
 */
export async function chargerArticle(article, conf = {}) {
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
export function corpsDeDemonstration(article) {
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
export function depuisArc(doc, repliUrl) {
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
