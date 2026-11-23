// Liens du corps d'article (retour d'Enzo du 20/11, point 6) : aucune navigation interne.
// Un lien vers lexpress.fr ou lexpress.eu mène au mur d'abonnement ; on garde son texte, on retire le lien.
// Seul un lien http(s) absolu vers un autre site reste cliquable (un rapport, un PDF officiel…).
// Dans le doute (adresse relative, illisible, masquée par des entités), le lien est retiré.

const INTERNAL_HOST = /(^|\.)lexpress\.(fr|eu)$/;
const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", sol: "/", tab: "\t", newline: "\n", period: "." };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Vrai seulement pour un lien http(s) absolu vers un site qui n'est pas L'Express. */
export function keepsLink(href: string | null | undefined): boolean {
  if (!href) return false;
  const value = decodeEntities(href).trim();
  if (!/^https?:\/\//i.test(value.replace(/[\u0000- ]/g, ""))) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return !INTERNAL_HOST.test(url.hostname.toLowerCase().replace(/\.$/, ""));
  } catch {
    return false;
  }
}

const ATTRIBUTES = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)`;
const ANCHOR = new RegExp(String.raw`<a\b${ATTRIBUTES}>([\s\S]*?)<\/a\s*>`, "gi");
const OPENING = new RegExp(String.raw`<a\b${ATTRIBUTES}>`, "gi");
const HREF = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

function hrefOf(attributes: string): string | null {
  const match = HREF.exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

/** Retire les liens internes d'un fragment HTML déjà assaini, en gardant leur texte. */
export function unlinkInternalLinks(html: string): string {
  const paired = html.replace(ANCHOR, (whole: string, attributes: string, inner: string) => (keepsLink(hrefOf(attributes)) ? whole : inner));
  // Une balise ouvrante sans fermeture ferait un lien jusqu'à la fin du paragraphe : elle part aussi.
  const opened = paired.replace(OPENING, (tag: string, attributes: string) => (keepsLink(hrefOf(attributes)) ? tag : ""));
  // Dernier filet : une balise mal formée (guillemet non fermé) que les deux passes n'ont pas reconnue.
  return opened.replace(/<a\b[^>]*>?/gi, (tag: string) => (keepsLink(hrefOf(tag.slice(2))) ? tag : ""));
}
