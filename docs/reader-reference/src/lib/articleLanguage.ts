// Cibles et libellés du lecteur par langue d'article. Origine de chaque texte (« relevé » par GET
// public le 16 novembre 2026, ou « traduit ») : docs/evidence/europe-reader-labels-20261116.json.
import { copy, type Edition } from "./edition.ts";

export type ArticleLanguage = "en" | "fr" | "pl";
export type ReaderCopy = { [K in keyof typeof copy.EUR]: string };
const LANGUAGES: readonly string[] = ["en", "fr", "pl"];
const LOCALES = { en: "en-GB", fr: "fr-FR", pl: "pl-PL" } as const;

const EUROPE_HOSTS = new Map<string, ArticleLanguage>([["lexpress.eu", "en"], ["www.lexpress.eu", "en"], ["fr.lexpress.eu", "fr"], ["pl.lexpress.eu", "pl"]]);

export const EUROPE_ACTIONS = {
  en: { label: "Subscribe", subscription: "https://www.lexpress.eu/subscribe/" },
  fr: { label: "S'abonner", subscription: "https://fr.lexpress.eu/abonnement/" },
  pl: { label: "Subskrypcja", subscription: "https://pl.lexpress.eu/subskrypcja/" },
} as const;

// Polonais : mots fixes de la page de lecture, traduits une fois. Les articles, eux, viennent déjà traduits.
const PL: ReaderCopy = {
  title: "Artykuł w prezencie – L'Express Polska", description: "Otrzymujesz w prezencie artykuł L'Express. Miłej lektury.",
  giftedBy: "Artykuł w prezencie od", subscribe: "Subskrypcja", by: "Autor:", published: "Opublikowano",
  continueReading: "Czytaj dalej na pl.lexpress.eu", gifted: "Ten artykuł otrzymujesz w prezencie. Zapisz się do L'Express i odblokuj nieograniczony dostęp do wszystkich naszych artykułów.",
  expired: "Ten link wygasł.", withdrawn: "Ten artykuł nie jest już dostępny.", unknown: "Ten link nie istnieje.",
  limited: "Artykuły w prezencie są dostępne przez ograniczony czas.",
  unavailable: "Nie można teraz wyświetlić tego artykułu.", technical: "Problem techniczny uniemożliwia załadowanie artykułu. Spróbuj ponownie za chwilę.",
  retry: "Spróbuj ponownie", loading: "Ładowanie…", loadingArticle: "Ładowanie artykułu",
  notFound: "Nie znaleziono strony", invalidLink: "Link, z którego korzystasz, jest nieprawidłowy.",
  pageError: "Nie udało się załadować tej strony", pageErrorDetail: "Wystąpił problem techniczny. Spróbuj ponownie lub przejdź na stronę główną.", home: "Przejdź na stronę główną",
};
// fr.lexpress.eu : textes du lecteur France (décision du 16/11), sauf ce qui nomme lexpress.fr ou son abonnement.
const FR_EUROPE: ReaderCopy = { ...copy.FR, subscribe: "S'abonner", continueReading: "Lire la suite sur fr.lexpress.eu" };

export function isArticleLanguage(value: unknown): value is ArticleLanguage {
  return typeof value === "string" && LANGUAGES.includes(value);
}
/** Sans langue connue (chargement, panne, lien inconnu), le contexte décide : FR français, EUR anglais. */
export function readerCopy(edition: Edition, language?: ArticleLanguage | null): ReaderCopy {
  if (edition === "FR") return copy.FR;
  return language === "pl" ? PL : language === "fr" ? FR_EUROPE : copy.EUR;
}
export function formatArticleDate(iso: string | null | undefined, edition: Edition, language: ArticleLanguage): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(edition === "FR" ? "fr-FR" : LOCALES[language], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}
export function articleActions(edition: Edition, language: ArticleLanguage) {
  if (edition === "FR") return { label: "S'abonner à L'Express", subscription: "https://abonnements-digitaux.lexpress.fr/offres" };
  return EUROPE_ACTIONS[language];
}
export function canonicalLanguage(edition: Edition, value: string): ArticleLanguage | null {
  try {
    const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
    if (!authority || /[:@\\]/.test(authority)) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    if (edition === "FR") return ["lexpress.fr", "www.lexpress.fr"].includes(url.hostname) ? "fr" : null;
    return EUROPE_HOSTS.get(url.hostname) ?? null;
  } catch { return null; }
}
