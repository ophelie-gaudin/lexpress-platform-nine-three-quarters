import { articleActions } from "@/lib/articleLanguage";
import { copy, formatPublicationDate } from "@/lib/edition";
import { useReader } from "@/lib/useReader";
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { sendPageDisplay } from "@/lib/piano";

import { GiftHeader } from "@/components/GiftHeader";
import { SubscribeButton } from "@/components/SubscribeButton";
import { sanitizeBodyHtml } from "@/lib/bodyHtml";
import { getGiftArticle, isRefusal, type GiftArticle } from "@/lib/giftArticle";

export const Route = createFileRoute("/a/$token")({
  component: GiftArticlePage,
});

function GiftArticlePage() {
  const { token } = Route.useParams();
  return <GiftArticleContent token={token} />;
}

export function GiftArticleContent({ token }: { token: string }) {
  const reader = useReader();
  const t = copy[reader.edition];
  const search = useRouterState({ select: (s) => s.location.searchStr });

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ["gift-article", reader.environment, reader.edition, token, search],
    queryFn: () => getGiftArticle(token, reader, search, typeof document === "undefined" ? null : document.referrer || null),
    staleTime: Infinity,
    enabled: typeof window !== "undefined",
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Piano: one page.display per resolved state (technical failures excluded).
  const pianoState = data ? (isRefusal(data) ? data.error : data.status) : null;
  useEffect(() => {
    if (!pianoState || pianoState === "unavailable" || !data) return;
    sendPageDisplay(reader, {
      page: "article_offert",
      page_chapter1: "article_offert",
      gift_status: pianoState,
      ...(!isRefusal(data) && { article_title: data.title, article_section: data.section }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, pianoState, reader.edition, reader.environment]);

  return (
    <div className="min-h-screen bg-background">
      <GiftHeader />
      <main className="pb-16">
        {isPending || !data ? (
          <ArticleSkeleton />
        ) : isRefusal(data) && data.error === "unavailable" ? (
          <UnavailableView onRetry={() => refetch()} retrying={isFetching} />
        ) : isRefusal(data) ? (
          <RefusalView
            message={
              data.error === "expired"
                ? t.expired
                : data.error === "withdrawn"
                  ? t.withdrawn
                  : t.unknown
            }
            search={search}
          />
        ) : (
          <ArticleView article={data} search={search} />
        )}
      </main>
    </div>
  );
}

function ArticleView({ article, search }: { article: GiftArticle; search: string }) {
  const { edition } = useReader();
  const t = copy[edition === "EUR" && article.language === "fr" ? "FR" : edition];
  const actions = articleActions(edition, article.language);
  const date = formatPublicationDate(article.published_at, edition);
  const body = article.status === "ok" ? (article.body ?? "").trim() : "";
  const hasBody = body.length > 0;

  return (
    <article lang={article.language}>
      <div className="measure px-5">
        {/* Full width; never stretched. Very tall photos are center-cropped to a
            comfortable height instead of letterboxed. */}
        <img
          src={article.image_url}
          alt=""
          className="mt-8 h-auto max-h-[60vh] w-full object-cover object-center"
        />
      </div>

      <div className="measure px-5">
        <p className="mt-7 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-express">
          {article.section}
        </p>

        <h1 className="mt-3 font-serif text-[1.9rem] font-semibold leading-[1.15] tracking-[-0.01em] text-foreground sm:text-[2.35rem]">
          {article.title}
        </h1>

        <p className="mt-4 font-serif text-lg leading-relaxed text-muted-foreground">
          {article.standfirst}
        </p>

        <div className="mt-5 border-t border-rule pt-3">
          {article.author && (
            <p className="text-base font-semibold text-foreground">
              {t.by} {article.author}
            </p>
          )}
          {date && <p className="mt-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {t.published} {date}
          </p>}
        </div>

        {hasBody ? (
          <div className="article-body mt-8">
            {body.split(/\n{2,}/).map((paragraph, index) => {
              const html = sanitizeBodyHtml(paragraph);
              const Tag = /<(?:p|h2|h3|ul|ol|blockquote|figure)\b/i.test(html) ? "div" : "p";
              return <Tag key={index} dangerouslySetInnerHTML={{ __html: html }} />;
            })}
          </div>
        ) : (
          <div className="mt-8">
            <a
              href={article.canonical_url}
              className="inline-flex w-full items-center justify-center rounded-sm border border-express px-6 py-4 text-base font-semibold text-express transition-colors hover:bg-express hover:text-express-foreground"
            >
              {new URL(article.canonical_url).hostname}
            </a>
          </div>
        )}

        <div className="mt-12 border-t border-rule pt-8">
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            {t.gifted}
          </p>
          <SubscribeButton search={search} language={article.language} />
          <a href={actions.home} className="mt-4 inline-block underline">{new URL(actions.home).hostname}</a>
        </div>
      </div>
    </article>
  );
}

function RefusalView({ message, search }: { message: string; search: string }) {
  const t = copy[useReader().edition];
  return (
    <div className="measure px-5 pt-20">
      <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-foreground">
        {message}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        {t.limited}
      </p>
      <div className="mt-8">
        <SubscribeButton search={search} />
      </div>
    </div>
  );
}

function UnavailableView({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const t = copy[useReader().edition];
  return (
    <div className="measure px-5 pt-20">
      <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-foreground">
        {t.unavailable}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        {t.technical}
      </p>
      <div className="mt-8">
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex w-full items-center justify-center rounded-sm border border-express px-6 py-4 text-base font-semibold text-express transition-colors hover:bg-express hover:text-express-foreground disabled:opacity-60"
        >
          {retrying ? t.loading : t.retry}
        </button>
      </div>
    </div>
  );
}

function ArticleSkeleton() {
  const t = copy[useReader().edition];
  return (
    <div aria-busy="true" aria-label={t.loadingArticle}>
      <div className="measure px-5">
        <div className="mt-8 aspect-[3/2] w-full animate-pulse bg-muted object-[50%_20%] sm:aspect-[21/9]" />
      </div>
      <div className="measure px-5">
        <div className="mt-7 h-3 w-24 animate-pulse rounded-sm bg-muted" />
        <div className="mt-4 h-8 w-full animate-pulse rounded-sm bg-muted" />
        <div className="mt-2.5 h-8 w-4/5 animate-pulse rounded-sm bg-muted" />
        <div className="mt-6 h-4 w-full animate-pulse rounded-sm bg-muted" />
        <div className="mt-2.5 h-4 w-11/12 animate-pulse rounded-sm bg-muted" />
        <div className="mt-10 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded-sm bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}
