import { canonicalLanguage, type ArticleLanguage } from "./articleLanguage.ts";
import type { ReaderContext } from "./edition.ts";
import { readerDatabase } from "./deployment.ts";

export type GiftArticle = {
  status: "ok" | "preview";
  canonical_url: string;
  title: string;
  standfirst: string;
  image_url: string;
  body: string | null;
  section: string;
  author?: string | null;
  published_at: string;
  language: ArticleLanguage;
};

export type GiftArticleRefusal = {
  /** "unavailable" = technical failure (network, HTTP error, malformed response), never an editorial status. */
  error: "expired" | "withdrawn" | "unknown" | "unavailable";
};

export type GiftArticleResult = GiftArticle | GiftArticleRefusal;

export function isRefusal(result: GiftArticleResult): result is GiftArticleRefusal {
  return "error" in result;
}

/** One request per attempt; a server failure never retries a less precise RPC. */
export async function getGiftArticle(token: string, context: ReaderContext, search = "", referrer: string | null = null): Promise<GiftArticleResult> {
  if (!/^[a-f0-9]{32}$/.test(token)) return { error: "unknown" };
  const params = new URLSearchParams(search);
  const args: Record<string, string | null> = {
    p_token: token, p_utm_source: params.get("at_medium"), p_utm_campaign: params.get("at_campaign"),
    p_referrer: referrer, p_send_id: params.get("at_recipient_id") || params.get("s"), p_campaign_group: params.get("at_campaign_group"),
  };
  // Déployer la migration additive 017 avant ce lecteur.
  const rpc = "get_gift_article_for_edition_v2";
  args["p_edition"] = context.edition;
  const db = readerDatabase(context);
  try {
    const res = await fetch(`${db.url}/rest/v1/rpc/${rpc}`, {
      method: "POST", headers: { apikey: db.anonKey, Authorization: `Bearer ${db.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(args), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { error: "unavailable" };
    const rows: unknown = await res.json();
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!row || typeof row !== "object") return { error: "unavailable" };
    if (["expired", "withdrawn", "unknown"].includes(row.status)) return { error: row.status };
    if ((row.status === "ok" || row.status === "preview") && typeof row.title === "string" && typeof row.canonical_url === "string") {
      const expected = canonicalLanguage(context.edition, row.canonical_url);
      if (!expected || row.language !== expected) return { error: "unavailable" };
      return row as GiftArticle;
    }
    return { error: "unavailable" };
  } catch { return { error: "unavailable" }; }
}
