// Édition de stockage FR/EUR distincte de la langue et du site Arc.
// Vérifié par GET des pages publiques le 16 novembre 2026 (Fusion.arcSite et html lang).
export const SITES = Object.freeze([
  Object.freeze({ edition: 'FR', language: 'fr', arcSite: 'lexpress', publicOrigin: 'https://www.lexpress.fr', readerOrigin: 'https://articles.lexpress.fr', hosts: Object.freeze(['lexpress.fr', 'www.lexpress.fr']) }),
  Object.freeze({ edition: 'EUR', language: 'en', arcSite: 'lexpress-europe', publicOrigin: 'https://www.lexpress.eu', readerOrigin: 'https://articles.lexpress.eu', hosts: Object.freeze(['lexpress.eu', 'www.lexpress.eu']) }),
  Object.freeze({ edition: 'EUR', language: 'pl', arcSite: 'lexpress-europe-pl', publicOrigin: 'https://pl.lexpress.eu', readerOrigin: 'https://articles.lexpress.eu', hosts: Object.freeze(['pl.lexpress.eu']) }),
  Object.freeze({ edition: 'EUR', language: 'fr', arcSite: 'lexpress-europe-fr', publicOrigin: 'https://fr.lexpress.eu', readerOrigin: 'https://articles.lexpress.eu', hosts: Object.freeze(['fr.lexpress.eu']) }),
]);
export const EDITIONS = Object.freeze({ FR: SITES[0], EUR: SITES[1] });
export function siteDepuisUrl(value) {
  if (typeof value !== 'string') return null;
  // URL normalise :443 en port vide. Examiner l'autorité brute avant cette normalisation.
  const authority = /^https:\/\/([^/?#]+)/i.exec(value.trim())?.[1];
  if (!authority || /[:@\\]/.test(authority)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  return SITES.find(site => site.hosts.includes(url.hostname.toLowerCase())) ?? null;
}
export function editionDepuisUrl(value) {
  return siteDepuisUrl(value)?.edition ?? null;
}
