// Offre d'abonnement du moment (migration 018), lue par la clé publique via la RPC get_subscription_offer.
// Hors offre, ou au moindre doute sur la réponse, le lecteur garde son bouton par défaut : jamais un bouton cassé.
import type { ArticleLanguage } from "./articleLanguage.ts";
import type { Edition, ReaderContext } from "./edition.ts";
import { readerDatabase } from "./deployment.ts";

export type OfferSite = "www.lexpress.fr" | "www.lexpress.eu" | "fr.lexpress.eu" | "pl.lexpress.eu";
export type SubscriptionOffer = { label: string | null; url: string | null; endsAt: number };

/** Site dont l'offre s'applique : France, ou le site Europe de la langue de l'article (anglais sans langue connue). */
export function offerSite(edition: Edition, language?: ArticleLanguage | null): OfferSite {
  if (edition === "FR") return "www.lexpress.fr";
  return language === "pl" ? "pl.lexpress.eu" : language === "fr" ? "fr.lexpress.eu" : "www.lexpress.eu";
}

/** Même règle que la base : https, hôte de la liste, du domaine du site, sans port, identifiants ni espace. */
export function isAllowedOfferUrl(url: string, site: OfferSite): boolean {
  if (url.length > 500 || /[\s\u0000-\u001f\u007f\\"<>`]/.test(url)) return false;
  const pattern = site === "www.lexpress.fr"
    ? /^https:\/\/(abonnements-digitaux\.lexpress\.fr|(www\.)?lexpress\.fr)([/?]|$)/
    : /^https:\/\/((www|fr|pl)\.)?lexpress\.eu([/?]|$)/;
  return pattern.test(url);
}

/** Valide la réponse de la RPC. Tout écart rend null : le lecteur garde alors son bouton par défaut. */
export function parseOffer(rows: unknown, site: OfferSite, now = Date.now()): SubscriptionOffer | null {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row: unknown = rows[0];
  if (!row || typeof row !== "object") return null;
  const { label, url, ends_at } = row as Record<string, unknown>;
  const endsAt = typeof ends_at === "string" ? Date.parse(ends_at) : NaN;
  if (!Number.isFinite(endsAt) || endsAt <= now) return null;
  if (label !== null && (typeof label !== "string" || label !== label.trim() || [...label].length < 1 || [...label].length > 40 || /[\u0000-\u001f\u007f<>]/.test(label))) return null;
  if (url !== null && (typeof url !== "string" || !isAllowedOfferUrl(url, site))) return null;
  return { label, url, endsAt };
}

/** Une requête, quatre secondes au plus ; n'échoue jamais : null = bouton par défaut. */
export async function getSubscriptionOffer(site: OfferSite, context: ReaderContext): Promise<SubscriptionOffer | null> {
  const db = readerDatabase(context);
  try {
    const res = await fetch(`${db.url}/rest/v1/rpc/get_subscription_offer`, {
      method: "POST", headers: { apikey: db.anonKey, Authorization: `Bearer ${db.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_site: site }), signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return parseOffer(await res.json(), site);
  } catch { return null; }
}
