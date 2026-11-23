// Liens du corps d'article (retour d'Enzo du 20/11, point 6) : aucune navigation interne.
// Un lien vers lexpress.fr ou lexpress.eu mène au mur d'abonnement ; on garde son texte, on retire le lien.
// Seul un lien http(s) absolu vers un autre site reste cliquable (un rapport, un PDF officiel…).
// Dans le doute (adresse relative, illisible, masquée par des entités), le lien est retiré.

const INTERNAL_HOST = /(^|\.)lexpress\.(fr|eu)$/;
// Entités nommées qu'un navigateur décode dans un href, dont toutes celles qui changent la structure d'une
// adresse (? @ # / \ : …). Une entité « &nom; » absente de cette liste rend le lien illisible : il est retiré,
// car le navigateur pourrait la décoder en un caractère qui change l'hôte.
const NAMED: Record<string, string> = {
  amp: "&", AMP: "&", quot: '"', QUOT: '"', apos: "'", lt: "<", LT: "<", gt: ">", GT: ">", nbsp: " ",
  colon: ":", sol: "/", bsol: "\\", quest: "?", commat: "@", num: "#", percnt: "%", period: ".", excl: "!",
  dollar: "$", lpar: "(", rpar: ")", ast: "*", midast: "*", plus: "+", comma: ",", semi: ";", equals: "=",
  lowbar: "_", Hat: "^", grave: "`", lsqb: "[", lbrack: "[", rsqb: "]", rbrack: "]", lcub: "{", lbrace: "{",
  rcub: "}", rbrace: "}", verbar: "|", vert: "|", VerticalLine: "|", Tab: "\t", NewLine: "\n", hyphen: "-", dash: "-",
};
// Sans point-virgule, le navigateur ne décode que les entités historiques ; celles-ci suffisent aux adresses.
const LEGACY = ["amp", "AMP", "quot", "QUOT", "lt", "LT", "gt", "GT", "nbsp"];

/** Décode comme un navigateur ; null si une entité reste inconnue (le lien sera retiré). */
function decodeEntities(value: string): string | null {
  let unknown = false;
  const decoded = value.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*)(;?)/g, (whole, name: string, semicolon: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    }
    if (semicolon) {
      const known = NAMED[name];
      if (known === undefined) unknown = true;
      return known ?? whole;
    }
    const legacy = LEGACY.find((prefix) => name.startsWith(prefix));
    return legacy ? (NAMED[legacy] ?? "") + name.slice(legacy.length) : whole;
  });
  return unknown ? null : decoded;
}

/** Vrai seulement pour un lien http(s) absolu vers un site qui n'est pas L'Express. */
export function keepsLink(href: string | null | undefined): boolean {
  if (!href) return false;
  // Comme le navigateur : seuls les espaces et caractères de contrôle ASCII sont retirés aux extrémités.
  // trim() retirerait aussi une espace insécable, que le navigateur garde : le lien deviendrait relatif,
  // donc interne, alors qu'on le croirait externe.
  const decoded = decodeEntities(href);
  if (decoded === null) return false;
  const value = decoded.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
  if (!/^https?:\/\//i.test(value.replace(/[\u0000- ]/g, ""))) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return !INTERNAL_HOST.test(url.hostname.toLowerCase().replace(/\.$/, ""));
  } catch {
    return false;
  }
}

// Toute balise, guillemets compris : un « < » ou un « > » à l'intérieur d'une valeur d'attribut (alt d'une
// image…) ne compte jamais comme une balise. Seules les balises a sont modifiées ; les autres passent telles quelles.
// Un commentaire HTML est lu d'un bloc, jusqu'à son « --> » : un « <a » cité dedans n'est pas une balise.
const TAG = /<!--[\s\S]*?(?:-->|$)|<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(>?)/g;
// Un attribut à la fois : la valeur entre guillemets d'un attribut (title…) n'est jamais lue comme un href.
// Valeur sans guillemets : jusqu'au prochain espace ou « > », comme le navigateur (un « = » en fait partie).
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Le href que le navigateur suivrait : le premier attribut href, null s'il n'y en a pas. */
function hrefOf(attributes: string): string | null {
  for (const match of attributes.matchAll(ATTRIBUTE)) {
    if (match[1]?.toLowerCase() === "href") return match[2] ?? match[3] ?? match[4] ?? "";
  }
  return null;
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Retire les liens internes d'un fragment HTML déjà assaini, en gardant leur texte. */
export function unlinkInternalLinks(html: string): string {
  let out = "";
  let from = 0;
  // Les liens ne s'imbriquent pas en HTML : la fermeture suivante clôt le lien ouvert.
  let open: "kept" | "removed" | null = null;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    out += html.slice(from, match.index);
    const [tag, closing, name = "", attributes = "", end] = match;
    if (tag.startsWith("<!--")) { out += tag; from = match.index + tag.length; continue; }
    if (!end) {
      // Balise mal formée (guillemet jamais fermé…) : on ne sait plus où finissent les attributs. Le reste du
      // fragment devient du texte échappé : ni lien, ni attribut, ni balise ne peut en sortir.
      return out + escapeText(html.slice(match.index));
    }
    from = match.index + tag.length;
    if (name.toLowerCase() !== "a") { out += tag; continue; }
    if (closing) {
      if (open === "kept") out += tag;
      open = null;
    } else {
      open = keepsLink(hrefOf(attributes)) ? "kept" : "removed";
      if (open === "kept") out += tag;
    }
  }
  return out + html.slice(from);
}
