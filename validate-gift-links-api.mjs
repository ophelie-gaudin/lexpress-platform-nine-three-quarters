// Liens offerts, lot 2 : ce que le service refuse, et ce qu'il avoue.
//
// Deux propriétés valent le test. D'abord, une URL inexploitable est REJETÉE NOMMÉMENT : l'appelant qui
// demande trois liens doit savoir qu'il n'en a que deux, sinon il envoie un message amputé. Ensuite, le
// service dit toujours si le lien mène à l'article complet ou au seul aperçu — tant qu'Arc ne répond
// pas, tout est aperçu, et le prétendre complet serait mentir au prospect.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arcIdDepuisUrl, trierUrls } from './gift-links/functions/_shared/arc-id.mjs';
import { apercuDepuisHtml } from './gift-links/functions/_shared/apercu.mjs';
import { chargerArticle, depuisArc } from './gift-links/functions/_shared/arc.mjs';

let n = 0; const check = (c, l) => { assert.ok(c, l); n++; };

const URL_OK = 'https://www.lexpress.fr/societe/religion/a-lyon-lecole-des-chartreux-XGLQ6NY6CJD6LLBLBBMEF7A2V4';

// ── L'IDENTIFIANT EST DÉJÀ DANS L'URL.
{
  const r = arcIdDepuisUrl(URL_OK);
  check(r.arcId === 'XGLQ6NY6CJD6LLBLBBMEF7A2V4', 'le suffixe de 26 caractères EST l’identifiant Arc');
  check(r.canonicalUrl === URL_OK, 'l’URL canonique est conservée telle quelle');
  check(arcIdDepuisUrl(URL_OK + '/').arcId === r.arcId, 'une barre oblique finale ne change rien');

  for (const [cas, url, attendu] of [
    ['ancien format', 'https://www.lexpress.fr/politique/vieil-article_1302698.html', /ancien format/],
    ['autre domaine', 'https://example.com/a-ABCDEFGHIJKLMNOPQRSTUVWXYZ', /domaine inattendu/],
    ['sans identifiant', 'https://www.lexpress.fr/politique/sans-suffixe', /aucun identifiant/],
    ['url illisible', 'pas une url', /illisible/],
    ['url vide', '', /vide/],
  ]) {
    const e = arcIdDepuisUrl(url).erreur;
    check(typeof e === 'string' && attendu.test(e),
      `C’EST LA PROPRIÉTÉ QUI COMPTE : ${cas} donne un refus NOMMÉ — obtenu ${JSON.stringify(e)}`);
  }
  check(arcIdDepuisUrl(URL_OK).erreur === undefined, 'et une URL valide ne produit aucune erreur');
}

// ── LE TRI NE PERD RIEN.
{
  const { retenus, rejets } = trierUrls([URL_OK, 'https://www.lexpress.fr/a_123.html', null]);
  check(retenus.length === 1 && rejets.length === 2,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : les deux listes sont rendues — un appelant qui demande trois liens apprend qu’il n’en a qu’un');
  check(rejets.every((r) => typeof r.erreur === 'string' && r.erreur.length > 0), 'chaque rejet porte son motif');
  check(trierUrls(null).retenus.length === 0, 'une entrée absente ne fait pas tomber le service');
}

// ── L'APERÇU VIENT DE LA PAGE PUBLIQUE, ET LE CORPS N'Y EST PAS.
const PAGE = `<html><head>
  <title>Un titre de secours - L'Express</title>
  <meta property="og:title" content="A Lyon, l&#8217;&eacute;cole des Chartreux"/>
  <meta content="Dans l&rsquo;&eacute;tablissement priv&eacute;" property="og:description"/>
  <meta property="og:image" content="https://www.lexpress.fr/img/1.jpg"/>
  <meta property="og:url" content="${URL_OK}"/>
  <meta property="article:section" content="Religion et laïcité"/>
  <meta property="article:published_time" content="2026-09-16T15:00:00Z"/>
  </head><body><p>Le corps n'est pas livré : le paywall est appliqué côté serveur.</p></body></html>`;
{
  const a = apercuDepuisHtml(PAGE, URL_OK);
  check(a.title === 'A Lyon, l’école des Chartreux', `les entités HTML sont décodées — obtenu ${JSON.stringify(a.title)}`);
  check(a.standfirst === 'Dans l’établissement privé', 'l’ordre des attributs de la balise meta n’a pas d’importance');
  check(a.image_url === 'https://www.lexpress.fr/img/1.jpg' && a.section === 'Religion et laïcité', 'image et rubrique sont lues');
  check(a.body === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le corps reste NULL — il n’est pas dans la page, et un corps inventé serait pire que pas de corps');
  check(apercuDepuisHtml('<html><head></head></html>').erreur !== undefined, 'une page sans titre est un refus, pas un article vide');
  check(apercuDepuisHtml('', null).erreur !== undefined, 'une page vide aussi');

  const sansOg = apercuDepuisHtml('<html><head><title>Mon titre - L’Express</title></head></html>', URL_OK);
  check(sansOg.title === 'Mon titre', 'à défaut d’og:title, le <title> sert, débarrassé du suffixe du journal');
}

// ── LA SIGNATURE. Relevée au branchement de la page : elle n'affichait que la date.
{
  const ld = (corps) => `<html><head><meta property="og:title" content="T"/>` +
    `<script type="application/ld+json">${corps}</script></head></html>`;
  check(apercuDepuisHtml(ld('{"@type":"NewsArticle","author":[{"@type":"Person","name":"Laureline Dupont"}]}')).author === 'Laureline Dupont',
    'l’auteur vient du JSON-LD — lexpress.fr n’expose pas meta[name=author]');
  check(apercuDepuisHtml(ld('[{"@type":"X"},{"author":[{"name":"A"},{"name":"B"}]}]')).author === 'A, B',
    'deux signatures sont rendues toutes les deux');
  check(apercuDepuisHtml(ld('{"@graph":[{"author":{"name":"Seule"}}]}')).author === 'Seule',
    'la forme @graph est traversée, et un auteur unique n’a pas besoin d’être un tableau');
  check(apercuDepuisHtml(ld('{ ceci n’est pas du JSON')).author === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un JSON-LD illisible ne fait pas tomber l’aperçu — on perd la signature, pas l’article');
  check(apercuDepuisHtml(ld('{"author":[{"@type":"Person"}]}')).author === null,
    'un auteur sans nom ne donne pas une signature vide');
  check(apercuDepuisHtml('<html><head><meta property="og:title" content="T"/><meta name="author" content="Repli"/></head></html>').author === 'Repli',
    'à défaut de JSON-LD, meta[name=author] sert de repli');

  const docArc = { headlines: { basic: 'T' }, credits: { by: [{ name: 'X' }, { name: '' }, { nom: 'ignoré' }] } };
  check(depuisArc(docArc, URL_OK).author === 'X', 'côté Arc, la signature vient de credits.by[].name');
  check(depuisArc({ headlines: { basic: 'T' } }, URL_OK).author === null, 'et son absence vaut null, pas une chaîne vide');
}

// ── LE DOCUMENT ARC : LE CORPS N'ARRIVE QUE PAR LÀ.
{
  const doc = {
    headlines: { basic: 'Titre Arc' }, subheadlines: { basic: 'Chapeau Arc' },
    promo_items: { basic: { url: 'https://img/arc.jpg' } },
    taxonomy: { primary_section: { name: 'Secret défense' } },
    publish_date: '2026-09-20T06:00:00Z', canonical_url: '/secret-defense/a-XYZ',
    content_elements: [{ type: 'text', content: 'Premier paragraphe.' }, { type: 'image' }, { type: 'text', content: 'Second.' }],
  };
  const c = depuisArc(doc, URL_OK);
  check(c.body === 'Premier paragraphe.\n\nSecond.', 'seuls les éléments de texte forment le corps');
  check(c.canonical_url === 'https://www.lexpress.fr/secret-defense/a-XYZ', 'une URL relative est rendue absolue');
  check(depuisArc({ ...doc, content_elements: [] }, URL_OK).body === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un document Arc sans texte rend un corps NULL — la page affichera l’aperçu plutôt qu’un article vide');
  check(depuisArc({ content_elements: [] }, URL_OK) === null, 'un document sans titre n’est pas un article');
  check(depuisArc(null) === null && depuisArc('bruit') === null, 'une réponse Arc inattendue ne fait pas tomber le service');
}

// ── LE REPLI. Arc indisponible ne doit pas priver le prospect de son aperçu.
{
  const article = { arcId: 'XGLQ6NY6CJD6LLBLBBMEF7A2V4', canonicalUrl: URL_OK };
  const page = async () => ({ ok: true, status: 200, text: async () => PAGE });

  const sansArc = await chargerArticle(article, { fetch: page });
  check(sansArc.source === 'page-publique' && sansArc.body === null, 'sans identifiants Arc : aperçu, et c’est annoncé comme tel');

  let appels = 0;
  const arcCasse = async (u) => { appels++; return String(u).includes('/content/v4/') ? { ok: false, status: 403, text: async () => '' } : page(); };
  const repli = await chargerArticle(article, { arcBase: 'https://api.arc', arcToken: 'x', fetch: arcCasse });
  check(appels === 2 && repli.source === 'page-publique',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : Arc qui refuse ne laisse PAS le prospect sans rien — on retombe sur l’aperçu réel');

  const arcOk = async (u) => String(u).includes('/content/v4/')
    ? { ok: true, status: 200, json: async () => ({ headlines: { basic: 'T' }, content_elements: [{ type: 'text', content: 'Le corps.' }] }) }
    : page();
  const complet = await chargerArticle(article, { arcBase: 'https://api.arc', arcToken: 'x', fetch: arcOk });
  check(complet.source === 'arc' && complet.body === 'Le corps.', 'avec Arc : le corps arrive, et la source le dit');

  const mort = await chargerArticle(article, { fetch: async () => ({ ok: false, status: 404, text: async () => '' }) });
  check(typeof mort.erreur === 'string', 'page injoignable : une erreur nommée, pas un article vide');
}

// ── LE VRAI DOCUMENT ARC. Relevé le 2 oct. 2026 sur api.lexpress.arcpublishing.com, structure réelle.
//
// Écrit d'après la documentation, le lecteur n'avait jamais vu de réponse. Ce cas le confronte à la
// vraie forme : canonical_url RELATIVE, description.basic VIDE (le chapeau est dans subheadlines),
// content_elements mêlant text et link_list, et du HTML DANS le corps.
{
  const doc = JSON.parse(readFileSync('gift-links/fixtures/arc-article-reel.json', 'utf8'));
  const c = depuisArc(doc, 'https://repli');
  check(c.title.startsWith('Maxime Carmignac'), 'le titre vient de headlines.basic');
  check(c.standfirst.startsWith('La directrice générale'),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le chapeau vient de subheadlines — description.basic est VIDE sur les articles réels, s’y fier donnerait un aperçu sans chapeau');
  check(c.author === 'Arnaud Bouillin', 'la signature vient de credits.by[].name');
  check(c.section === 'Entreprises', 'la rubrique vient de taxonomy.primary_section');
  check(c.published_at === '2026-09-24T09:00:00Z', 'la date de publication est reprise telle quelle');
  check(c.canonical_url === 'https://www.lexpress.fr' + doc.canonical_url,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : Arc rend une URL RELATIVE — la servir telle quelle donnerait un lien mort depuis la page offerte');
  check(c.image_url.startsWith('https://cloudfront-'), 'l’image vient de promo_items.basic');
  check(!/link_list/.test(c.body) && c.body.length > 200, 'seuls les éléments de texte forment le corps ; les blocs « à lire aussi » sont écartés');
  check(/<a href=|<b>/.test(c.body),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le corps contient du HTML — affiché tel quel, le lecteur verrait les balises ; injecté sans filtre, n’importe quel contenu passerait');
}

// ── LE CORPS DE DÉMONSTRATION. Sur demande explicite, et reconnaissable au premier coup d'œil.
{
  const { corpsDeDemonstration } = await import('./gift-links/functions/_shared/arc.mjs');
  const t = corpsDeDemonstration({ standfirst: 'Le chapeau réel.' });
  check(/TEXTE DE DÉMONSTRATION/.test(t) && t.indexOf('TEXTE DE DÉMONSTRATION') < 40,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : l’avertissement est en TÊTE — la page est publique et un lien se transfère ; un faux texte sans mention se lirait comme du journalisme de L’Express');
  check(t.includes('Le chapeau réel.'), 'le vrai chapeau est repris, pour juger de la mise en page');
  check(corpsDeDemonstration({}).length > 100, 'et il tient debout sans chapeau');

  const b = readFileSync('gift-links/functions/create-gift-links/index.bundle.ts', 'utf8');
  check(/corps\.fake_body === true && !c\.body/.test(b),
    'il n’est posé que sur demande explicite, et JAMAIS par-dessus un vrai corps');
}

// ── LE FICHIER DÉPLOYÉ EST ENGENDRÉ DES MÊMES SOURCES.
//
// On a déjà payé le prix d'une copie divergente : le workflow n8n embarque SA copie du validateur, la
// source corrigée n'y changeait rien, et le prospect ne recevait aucune réponse. Ici, le fichier
// déployable est reconstruit et comparé.
{
  const { readFileSync } = await import('node:fs');
  const { build, CIBLE } = await import('./build-gift-links-function.mjs');
  check(readFileSync(CIBLE, 'utf8') === build(),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le fichier déployable correspond aux sources — régénérer par `node build-gift-links-function.mjs`');

  const b = readFileSync(CIBLE, 'utf8');
  check(!/^import\s+\{[^}]*\}\s+from\s+'\./m.test(b), 'aucun import local ne subsiste : le fichier se suffit à lui-même');
  check((b.match(/^import .*$/gm) ?? []).every((l) => /jsr:|npm:|https:/.test(l)), 'les seuls imports restants sont distants');
  check(b.indexOf('import ') < b.indexOf('const META'), 'les imports restent en tête du fichier');
  check(/function apercuDepuisHtml/.test(b) && /function trierUrls/.test(b) && /async function chargerArticle/.test(b),
    'les trois modules sont bien inlinés');
  check(/Deno\.serve/.test(b), 'et le point d’entrée aussi');
  check(/Promise\.all\(retenus\.map/.test(b),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : les trois articles sont chargés EN PARALLÈLE — en série, la requête dépasse le temps imparti (constaté le 1er oct. : une URL passait, trois échouaient)');
  check(/req\.method === 'OPTIONS'/.test(b) && /Access-Control-Allow-Headers/.test(b),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : la pré-vérification OPTIONS reçoit une réponse — sans elle, un appelant navigateur est bloqué AVANT le code, avec un « Failed to fetch » qui ne dit rien');
  check(/x-gift-service-token/.test(b) && /attendu === ''/.test(b),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : sans secret configuré, le service REFUSE tout — fabriquer des liens vers des articles premium est la porte la plus sensible');
}

console.log(`liens offerts (lot 2, contenu) : ${n} vérifications passées.`);
