// Textes et cibles relevés par GET public, 16 novembre 2026.
export type ArticleLanguage = "en" | "fr" | "pl";
export const EUROPE_ACTIONS = {
  en: { label: "Subscribe", home: "https://www.lexpress.eu/", subscription: "https://www.lexpress.eu/subscribe/" },
  fr: { label: "S'abonner", home: "https://fr.lexpress.eu/", subscription: "https://fr.lexpress.eu/abonnement/" },
  pl: { label: "Subskrypcja", home: "https://pl.lexpress.eu/", subscription: "https://pl.lexpress.eu/subskrypcja/" },
} as const;
export function articleActions(edition: "FR" | "EUR", language: ArticleLanguage) {
  if (edition === "FR") return { label: "S'abonner à L'Express", home: "https://www.lexpress.fr/", subscription: "https://abonnements-digitaux.lexpress.fr/offres" };
  return EUROPE_ACTIONS[language];
}
export function canonicalLanguage(edition: "FR" | "EUR", value: string): ArticleLanguage | null {
  try {
    const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
    if (!authority || /[:@\\]/.test(authority)) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    if (edition === "FR") return ["lexpress.fr", "www.lexpress.fr"].includes(url.hostname) ? "fr" : null;
    const hosts: Record<string, ArticleLanguage> = { "lexpress.eu": "en", "www.lexpress.eu": "en", "fr.lexpress.eu": "fr", "pl.lexpress.eu": "pl" };
    return Object.hasOwn(hosts, url.hostname) ? hosts[url.hostname] : null;
  } catch { return null; }
}
