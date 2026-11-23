import { articleActions, type ArticleLanguage } from "./articleLanguage.ts";
import { copy, editions, type Edition } from "./edition.ts";
import type { SubscriptionOffer } from "./subscriptionOffer.ts";

/**
 * Builds the subscription URL from the visitor's own link.
 *
 * Whitelist only: parameters named `at_*` plus `s`. Nothing else is forwarded —
 * a gifted link is public and gets forwarded, so copying everything would let
 * anyone inject their own dimensions into Piano. `set` is used, never `append`,
 * so a parameter repeated in the link keeps a single value. A parameter that is
 * absent stays absent: no defaults, no fallback, no fabricated tracking.
 *
 * With an offer URL (table « offres », 018), the same parameters are added to it;
 * its own parameters (promo code…) are kept, and an `at_*` of the visitor wins.
 */
export function buildSubscriptionUrl(search?: string, edition: Edition = "FR", language?: ArticleLanguage, offerUrl?: string | null): string {
  const incoming = new URLSearchParams(search ?? "");
  const url = new URL(offerUrl ?? (language ? articleActions(edition, language).subscription : editions[edition].subscription));

  for (const [key, value] of incoming) {
    if (value && (key.startsWith("at_") || key === "s")) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

/** Label and target of the subscription bar: the current offer when there is one, else today's button. */
export function subscriptionAction(search: string, edition: Edition, language?: ArticleLanguage, offer?: SubscriptionOffer | null, now = Date.now()) {
  const current = offer && offer.endsAt > now ? offer : null;
  return {
    label: current?.label ?? (language ? articleActions(edition, language).label : copy[edition].subscribe),
    href: buildSubscriptionUrl(search, edition, language, current?.url),
  };
}
