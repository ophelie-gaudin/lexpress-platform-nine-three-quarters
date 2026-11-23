import { articleActions, type ArticleLanguage } from "./articleLanguage.ts";
import { copy, editions, type Edition } from "./edition.ts";
import type { SubscriptionOffer } from "./subscriptionOffer.ts";

/**
 * Builds the subscription URL from the visitor's own link.
 *
 * Whitelist only: parameters named `at_*` plus `s`. Nothing else is forwarded —
 * a gifted link is public and gets forwarded, so copying everything would let
 * anyone inject their own dimensions into Piano. One value per key, never two,
 * so a parameter repeated in the link keeps a single value. A parameter that is
 * absent stays absent: no defaults, no fallback, no fabricated tracking.
 *
 * With an offer URL (table « offres », 018), the same parameters are added to it;
 * its own parameters (promo code…) are kept, and an `at_*` of the visitor wins.
 */
export function buildSubscriptionUrl(search?: string, edition: Edition = "FR", language?: ArticleLanguage, offerUrl?: string | null): string {
  const url = new URL(offerUrl ?? (language ? articleActions(edition, language).subscription : editions[edition].subscription));
  const forwarded = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(search ?? "")) {
    if (value && (key.startsWith("at_") || key === "s")) forwarded.set(key, value);
  }
  if (forwarded.size === 0) return url.toString();

  // The offer's own query is kept byte for byte (a promo code stays encoded as written); only the
  // forwarded keys are replaced, then appended. searchParams.set would re-encode the whole query.
  // Same parser as the visitor's keys (form-urlencoded, invalid UTF-8 included), so a key matches exactly.
  // The leading "?" is consumed by the parser, so a literal "?" starting a key is kept as part of it.
  const keyOf = (segment: string) => [...new URLSearchParams(`?${segment}`).keys()][0] ?? "";
  const query = url.search.slice(1);
  const kept = query === "" ? [] : query.split("&").filter((segment) => segment === "" || !forwarded.has(keyOf(segment)));
  const added = [...forwarded].map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  url.search = `?${[...kept, ...added].join("&")}`;
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
