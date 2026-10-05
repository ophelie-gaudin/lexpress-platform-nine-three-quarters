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
export function arcIdDepuisUrl(url) {
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
export function trierUrls(urls) {
  const retenus = [], rejets = [];
  for (const url of Array.isArray(urls) ? urls : []) {
    const r = arcIdDepuisUrl(url);
    if (r.arcId) retenus.push({ url, arcId: r.arcId, canonicalUrl: r.canonicalUrl });
    else rejets.push({ url, erreur: r.erreur });
  }
  return { retenus, rejets };
}
