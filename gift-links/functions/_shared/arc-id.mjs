import { SITES, editionDepuisUrl, siteDepuisUrl } from './editions.mjs';
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
export const HOTES = new Set(SITES.flatMap(e => e.hosts));

export function arcIdDepuisUrl(url) {
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
export function trierUrls(urls) {
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
