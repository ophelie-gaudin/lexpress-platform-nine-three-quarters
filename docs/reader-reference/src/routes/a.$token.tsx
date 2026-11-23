import { formatArticleDate, readerCopy, type ArticleLanguage } from "@/lib/articleLanguage";
import { useReader } from "@/lib/useReader";
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { sendPageDisplay } from "@/lib/piano";

import { GiftHeader } from "@/components/GiftHeader";
import { SubscribeBar } from "@/components/SubscribeButton";
import { sanitizeBodyHtml } from "@/lib/bodyHtml";
import { unlinkInternalLinks } from "@/lib/internalLinks";
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

  // Une seule barre d'abonnement, en bas de l'écran, sur l'article comme sur un refus. Pas pendant le
  // chargement ni sur une panne technique : il n'y a encore rien à proposer, et la langue est inconnue.
  const bar = !data || (isRefusal(data) && data.error === "unavailable") ? null : { language: data.language };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <GiftHeader />
      <main className="flex-1 pb-16">
        {isPending || !data ? (
          <ArticleSkeleton />
        ) : !isRefusal(data) ? (
          <ArticleView article={data} />
        ) : data.error === "unavailable" ? (
          <UnavailableView onRetry={() => refetch()} retrying={isFetching} />
        ) : data.error === "unknown" ? (
          <RefusalView error="unknown" />
        ) : (
          <RefusalView error={data.error} language={data.language} />
        )}
      </main>
      {bar && <SubscribeBar token={token} search={search} language={bar.language} />}
    </div>
  );
}

function ArticleView({ article }: { article: GiftArticle }) {
  const { edition } = useReader();
  // Habillage dans la langue de l'article : en, fr (fr.lexpress.eu) ou pl. Le lecteur France ne change pas.
  const t = readerCopy(edition, article.language);
  const date = formatArticleDate(article.published_at, edition, article.language);
  const body = article.status === "ok" ? (article.body ?? "").trim() : "";
  const hasBody = body.length > 0;

  return (
    <article>
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
        <p lang={article.language} className="mt-7 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-express">
          {article.section}
        </p>

        <h1 lang={article.language} className="mt-3 font-serif text-[1.9rem] font-semibold leading-[1.15] tracking-[-0.01em] text-foreground sm:text-[2.35rem]">
          {article.title}
        </h1>

        <p lang={article.language} className="mt-4 font-serif text-lg leading-relaxed text-muted-foreground">
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
          <div lang={article.language} className="article-body mt-8">
            {body.split(/\n{2,}/).map((paragraph, index) => {
              // Liens vers lexpress.fr / lexpress.eu retirés, texte gardé : aucune navigation interne.
              const html = unlinkInternalLinks(sanitizeBodyHtml(paragraph));
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
              {t.continueReading}
            </a>
          </div>
        )}

        <div className="mt-12 border-t border-rule pt-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t.gifted}
          </p>
        </div>
      </div>
    </article>
  );
}

function RefusalView({ error, language }: { error: "expired" | "withdrawn" | "unknown"; language?: ArticleLanguage }) {
  const t = readerCopy(useReader().edition, language);
  return (
    <div className="measure px-5 pt-20">
      <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-foreground">
        {t[error]}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        {t.limited}
      </p>
    </div>
  );
}

function UnavailableView({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const t = readerCopy(useReader().edition);
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
  const t = readerCopy(useReader().edition);
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
