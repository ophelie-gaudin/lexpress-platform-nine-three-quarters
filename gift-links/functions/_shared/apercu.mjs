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
export function apercuDepuisHtml(html, repliUrl) {
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
