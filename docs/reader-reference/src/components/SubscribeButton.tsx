import { articleActions, type ArticleLanguage } from "@/lib/articleLanguage";
import { copy } from "@/lib/edition";
import { useReader } from "@/lib/useReader";
import { buildSubscriptionUrl } from "@/lib/subscriptionLink";

export function SubscribeButton({ search, language }: { search: string; language?: ArticleLanguage }) {
  const { edition } = useReader();
  return (
    <a
      href={buildSubscriptionUrl(search, edition, language)}
      className="inline-flex w-full items-center justify-center rounded-sm bg-express px-6 py-4 text-center text-base font-semibold tracking-wide text-express-foreground transition-opacity hover:opacity-90"
    >
      {language ? articleActions(edition, language).label : copy[edition].subscribe}
    </a>
  );
}
