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
import { chargerArticle, depuisArc, rendreElement, sansSubstance } from './gift-links/functions/_shared/arc.mjs';

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

// ── LA FORME RÉELLE D'UN DOCUMENT ARC. Relevée le 2 oct. 2026 sur api.lexpress.arcpublishing.com.
//
// Écrit d'après la documentation, le lecteur n'avait jamais vu de réponse. Ce cas le confronte à la
// vraie forme : canonical_url RELATIVE, description.basic VIDE (le chapeau est dans subheadlines),
// content_elements mêlant text et link_list, et du HTML DANS le corps.
//
// LE CONTENU EST FICTIF, LA STRUCTURE NE L'EST PAS (8 oct. 2026). La fixture portait un vrai article
// de L'Express — 600 caractères de texte payant, son titre, sa signature, sa légende photo. Un dépôt
// qu'on partage n'a pas à publier ce que le service existe pour encadrer. Titre, signature, image et
// corps sont inventés ; chaque particularité que ces cas éprouvent est conservée telle quelle.
{
  const doc = JSON.parse(readFileSync('gift-links/fixtures/arc-article-reel.json', 'utf8'));
  const c = depuisArc(doc, 'https://repli');
  check(c.title.startsWith('Fixture de démonstration'), 'le titre vient de headlines.basic');
  check(c.standfirst.startsWith('Ce document reproduit'),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le chapeau vient de subheadlines — description.basic est VIDE sur les articles réels, s’y fier donnerait un aperçu sans chapeau');
  check(c.author === 'Jane Doe', 'la signature vient de credits.by[].name');
  check(c.section === 'Entreprises', 'la rubrique vient de taxonomy.primary_section');
  check(c.published_at === '2026-09-24T09:00:00Z', 'la date de publication est reprise telle quelle');
  check(c.canonical_url === 'https://www.lexpress.fr' + doc.canonical_url,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : Arc rend une URL RELATIVE — la servir telle quelle donnerait un lien mort depuis la page offerte');
  check(c.image_url.startsWith('https://cloudfront-'), 'l’image vient de promo_items.basic');
  check(!/link_list/.test(c.body) && c.body.length > 200, 'seuls les éléments de texte forment le corps ; les blocs « à lire aussi » sont écartés');
  check(/<a href=|<b>/.test(c.body),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le corps contient du HTML — affiché tel quel, le lecteur verrait les balises ; injecté sans filtre, n’importe quel contenu passerait');

  // ET LA FIXTURE NE REPUBLIE RIEN. Le dépôt se partage ; il ne doit pas contenir l'article payant que
  // le service sert à encadrer.
  const brut = readFileSync('gift-links/fixtures/arc-article-reel.json', 'utf8');
  check(!/Carmignac|Bouillin|espionne/i.test(brut),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : aucune phrase d’un vrai article dans la fixture — un dépôt qu’on partage ne republie pas le contenu payant qu’il protège');
  check(/Lorem ipsum/.test(brut), 'le corps est du texte de remplissage, reconnaissable au premier coup d’œil');
}

// ── CE QUI NE DOIT JAMAIS ATTEINDRE LA PAGE (8 oct. 2026).
//
// RELEVÉ PAR UNE REVUE ADVERSE. `LOVABLE.md` promettait que `<script>`, `<iframe>` et les attributs
// `on*` n'arriveraient jamais. C'était faux : le HTML des éléments `text` passait tel quel. Ces cas
// rendent la promesse vraie, et la garderont vraie.
{
  const { rendreElement } = await import('./gift-links/functions/_shared/arc.mjs');
  const rendu = (html) => rendreElement({ type: 'text', content: html });

  check(!/onerror/i.test(rendu('<img src=x onerror=alert(1)>')),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un attribut `on*` ne traverse pas — la page le poserait dans le DOM, et le code d’un article piégé s’exécuterait chez le lecteur');
  check(!/<script/i.test(rendu('<script>vol()</script><p>Vrai texte.</p>'))
        && /Vrai texte/.test(rendu('<script>vol()</script><p>Vrai texte.</p>')),
    'un `<script>` est retiré, et le texte légitime qui l’entoure reste');
  for (const [nom, html] of [['iframe', '<iframe src="https://ailleurs"></iframe><p>Suite.</p>'],
                             ['style', '<style>body{display:none}</style><p>Suite.</p>'],
                             ['object', '<object data="x"></object><p>Suite.</p>']])
    check(!new RegExp('<' + nom, 'i').test(rendu(html)) && /Suite/.test(rendu(html)),
      `un \`<${nom}>\` est retiré sans emporter le reste`);
  check(!/javascript:/i.test(rendu('<a href="javascript:vol()">lien</a>')),
    'une URL `javascript:` est retirée de son attribut');

  // ET LE CORPS LÉGITIME SURVIT. Un article porte du gras, des intertitres, et des liens qui sortent
  // du site — vers un PDF de la Ville de Paris, par exemple. Les écarter viderait les articles.
  const vrai = rendu('<p><b>Gras</b> et <a href="https://cdn.paris.fr/x.pdf">un lien externe</a></p>');
  check(/<b>Gras<\/b>/.test(vrai) && /cdn\.paris\.fr/.test(vrai),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le gras et les liens vers l’extérieur passent intacts — assainir n’est pas appauvrir, un article cite ailleurs');

  // LES ESPACES QUI SE DÉGUISENT. `&nbsp;` était traité, pas `&#xA0;` ni l’espace de largeur nulle.
  const { sansSubstance } = await import('./gift-links/functions/_shared/arc.mjs');
  for (const vide of ['<p>&#xA0;</p>', '<p>&#32;</p>', '<p>&#8203;</p>', '<p>&#x200B;</p>'])
    check(sansSubstance(vide), `« ${vide} » ne fait pas un corps, quelle que soit la façon d’écrire l’espace`);
  check(!sansSubstance('<p>Du vrai texte.</p>'), 'et du texte reste du texte');
}

// ── LE SERVEUR N'IRA CHERCHER QUE CE QU'ON LUI AUTORISE (8 oct. 2026).
{
  const { arcIdDepuisUrl } = await import('./gift-links/functions/_shared/arc-id.mjs');
  const ok = (u) => !!arcIdDepuisUrl(u).arcId;
  const ARTICLE = '/politique/x-LQBW5JK75BDOBJHRA76NRFPJFY';

  check(ok('https://www.lexpress.fr' + ARTICLE) && ok('https://lexpress.fr' + ARTICLE),
    'les deux hôtes légitimes passent');
  check(!ok('http://www.lexpress.fr' + ARTICLE), 'http est refusé : la réponse serait lisible en chemin');
  check(!ok('https://www.lexpress.fr:8443' + ARTICLE),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un port est refusé — l’URL décide d’une requête SORTANTE du serveur, et un port arbitraire la dirige vers un service interne');
  check(!ok('https://interne.lexpress.fr' + ARTICLE),
    'et un sous-domaine quelconque aussi : le filtre nomme deux hôtes, il n’accepte pas une famille');
  check(!ok('https://lexpress.fr.attaquant.net' + ARTICLE),
    'un domaine qui RESSEMBLE au bon est refusé');
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
  // IMPORTER CE MODULE N'ÉCRIT PLUS RIEN (8 oct. 2026). Il réécrivait le fichier à l'import, et la
  // comparaison ci-dessous constatait une égalité qu'elle venait de fabriquer : elle ne pouvait pas
  // échouer. La chaîne de tests ne régénère plus non plus — sinon elle masquerait le même défaut d'un
  // cran plus haut. Un oubli de `npm run build` doit se voir ICI, pas en production.
  const { build, CIBLE } = await import('./build-gift-links-function.mjs');
  check(readFileSync(CIBLE, 'utf8') === build(),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le fichier déployable correspond aux sources — régénérer par `npm run build`. On a déjà payé le prix d’une copie divergente avec le validateur embarqué du workflow n8n : source corrigée, copie déployée inchangée, prospect sans réponse');

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
  check(/x-gift-service-token/.test(b) && /presente === ''/.test(b) && /!client\?\.ok/.test(b),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : sans jeton reconnu en base, le service REFUSE tout — fabriquer des liens vers des articles premium est la porte la plus sensible');
}


// ── CE QU'ON GARDE DU CORPS, ET CE QU'ON ÉCARTE (7 oct. 2026).
//
// Le corps ne retenait que les paragraphes : un article long arrivait sans une seule respiration, et ses
// citations disparaissaient. Ces cas fixent la liste de ce qu'on garde — et surtout de ce qu'on écarte
// DÉLIBÉRÉMENT, pour que personne ne « répare » plus tard en rouvrant la porte aux « à lire aussi ».
{
  const q = rendreElement({ type: 'quote', citation: { type: 'text', content: 'Zack' },
    content_elements: [{ type: 'text', content: 'Votre classe politique ne réalise pas' }] });
  check(/^<blockquote>Votre classe politique ne réalise pas<cite>Zack<\/cite><\/blockquote>$/.test(q),
    'une citation devient un blockquote, signature comprise');
  check(rendreElement({ type: 'quote', content_elements: [] }) === '',
    'une citation vide ne laisse pas une coquille dans la page');

  const img = rendreElement({ type: 'image', url: 'https://cdn/x.jpg', caption: 'Une <b>légende</b>' });
  check(/<figure><img src="https:\/\/cdn\/x\.jpg" alt="Une légende" loading="lazy"><figcaption>Une <b>légende<\/b><\/figcaption><\/figure>/.test(img),
    'une image devient une figure légendée, et l’attribut alt est débarrassé de ses balises');
  check(rendreElement({ type: 'image', url: 'javascript:alert(1)' }) === '',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : une URL qui n’est pas https est écartée — une page publique ne doit pas porter un schéma d’URL exécutable');
  check(rendreElement({ type: 'image' }) === '', 'et une image sans URL tombe plutôt que de produire une image brisée');
  check(/alt="Illustration de l’article"|alt="Illustration de l'article"/.test(
    rendreElement({ type: 'image', url: 'https://cdn/y.jpg' })),
    'sans légende, l’attribut alt reste renseigné : la page doit rester lisible sans les images');

  check(rendreElement({ type: 'link_list', items: [{}] }) === '',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : les « à lire aussi » sont écartés — ils mènent au paywall, et promettre une lecture libre pour buter le lecteur trois paragraphes plus loin serait pire que de ne rien proposer');
  check(rendreElement({ type: 'interstitial_link' }) === '', 'idem pour les liens intercalaires');
  for (const t of ['custom_embed', 'oembed_response', 'raw_html', 'table', 'gallery', 'inconnu_de_demain'])
    check(rendreElement({ type: t, content: '<script>x</script>' }) === '',
      `un type ${t} tombe : un format dont on ne maîtrise pas le rendu ne traverse pas`);

  const doc = { headlines: { basic: 'T' }, content_elements: [
    { type: 'text', content: '<p>Un</p>' },
    { type: 'quote', content_elements: [{ type: 'text', content: 'Dit' }] },
    { type: 'link_list' },
    { type: 'image', url: 'https://cdn/i.jpg' }] };
  const corps = depuisArc(doc, URL_OK).body;
  check(corps.includes('<blockquote>Dit</blockquote>') && corps.includes('<figure>') && !corps.includes('link_list'),
    'le corps assemblé garde texte, citation et image, dans l’ordre du document');
}


// ── 006 : l'authentification par service, côté fonction Edge.
{
  const b = readFileSync('gift-links/functions/create-gift-links/index.bundle.ts', 'utf8');
  check(/crypto\.subtle\.digest\('SHA-256'/.test(b),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le jeton est haché DANS la fonction — il n’arrive jamais en clair à la base, pas plus qu’un mot de passe');
  check(/verify_api_client/.test(b) && /p_token_sha256: empreinte/.test(b),
    'et c’est bien l’empreinte qui part à la vérification');
  check(!/p_token_sha256: presente|p_token: presente/.test(b), 'jamais le jeton lui-même');
  check((b.match(/error: 'non autorisé' \}, 401\)/g) || []).length >= 2,
    'le refus est un 401 NU : la fonction ne dit pas si le jeton est inconnu ou révoqué — le distinguer renseignerait qui cherche à deviner');
  check(/count_client_links/.test(b) && b.indexOf('count_client_links') > b.indexOf('const liens'),
    'les liens sont comptés À LA FIN : un appel qui échoue en chemin ne charge pas le compte d’un service');
  // 7 oct. au soir : le repli a vécu le temps de basculer le job nocturne n8n sur son propre jeton.
  // Preuve faite — 21 liens attribués à `n8n-agent-whatsapp` — donc le secret partagé disparaît.
  // On vise la LECTURE de la variable, pas le mot : le commentaire qui explique le retrait a sa place
  // dans le fichier, et un test qui interdirait d'en parler effacerait la mémoire de la décision.
  check(!/env\(['"]GIFT_SERVICE_TOKEN['"]\)/.test(b) && !/Deno\.env\.get\(['"]GIFT_SERVICE_TOKEN['"]\)/.test(b),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : plus aucun secret partagé n’ouvre la porte — un tel secret ne nomme personne, et le révoquer les couperait tous');
  check(!/if\s*\(\s*clientId\s*\)/.test(b),
    'et plus de chemin où le service reste anonyme : sans client reconnu, la fonction rend 401 avant tout travail');

  // 008 : CE QUE L'APPELANT LIT EST EN ANGLAIS, jusqu'au nom de service rendu quand aucun jeton nommé
  // n'a été présenté. `client: "héritage"` aurait été le dernier mot français de la réponse publique.
  check(/client: clientName/.test(b) && !/'héritage'/.test(b) && !/= 'legacy'/.test(b),
    'la réponse nomme le service appelant, et il n’y a plus d’appelant anonyme à nommer « legacy »');
  check(/client\.name/.test(b) && !/client\.nom/.test(b),
    'et la fonction lit bien la colonne `name` rendue par verify_api_client');

  // 009 : ce qui appartient à l'envoi ne part plus sur le lien.
  check(!/p_channel/.test(b) && !/p_campaign\b/.test(b),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : la fonction n’envoie plus ni canal ni campagne — le lien est commun à tous ses destinataires, lui en coller une attribuait toutes les lectures à la dernière déclarée');

  // ON EXÉCUTE, ON NE LIT PLUS (8 oct. 2026). Ces règles vivaient dans un fichier que seul Deno peut
  // lancer : les cas cherchaient des chaînes. Une revue adverse a désactivé le refus d'authentification
  // sans qu'une assertion bronche. Elles vivent maintenant dans un module que Node appelle pour de vrai.
  {
    const { clesInconnues, dureeDemandee, corpsUtilisable, CLES_ACCEPTEES } =
      await import('./gift-links/functions/_shared/corps.mjs');

    check(clesInconnues({ urls: [], channel: 'wa', campaign: 'x' }).join() === 'channel,campaign',
      'C’EST LA PROPRIÉTÉ QUI COMPTE : les clés inconnues sont NOMMÉES — ignorées en silence, un appelant croit attribuer ses liens et ne fait rien');
    check(clesInconnues({ urls: [], expires_in_days: 1, fake_body: true }).length === 0,
      'et les trois clés acceptées passent');
    check(CLES_ACCEPTEES.join() === 'urls,expires_in_days,fake_body', 'la liste est close');

    check(dureeDemandee(undefined).jours === 15, 'sans durée, quinze jours');
    for (const mauvais of [0, -1, 'abc', 1e300, 366, 1.5, null, true, false, '30', [], {}])
      check(!!dureeDemandee(mauvais).erreur, `durée refusée : ${JSON.stringify(mauvais)}`);
    check(/doit être un nombre/.test(dureeDemandee(true).erreur),
      'C’EST LA PROPRIÉTÉ QUI COMPTE : on exige un NOMBRE, pas une valeur qui s’y convertit — `Number(true)` vaut 1, et `expires_in_days: true` serait devenu un jour en silence');
    check(dureeDemandee(30).jours === 30 && dureeDemandee(365).jours === 365, 'et les durées valides passent');
    check(/reçu : 0/.test(dureeDemandee(0).erreur),
      'le refus RÉPÈTE ce qu’il a reçu : `-1` devenait quinze jours en silence, et l’appelant croyait avoir demandé autre chose');

    for (const pas of [null, [], 'texte', 42]) check(!corpsUtilisable(pas), `corps refusé : ${JSON.stringify(pas)}`);
    check(corpsUtilisable({ urls: [] }), 'un objet passe');
  }

  check(/clé\(s\) non reconnue\(s\)/.test(b) && /accepted_keys/.test(b),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : une clé inconnue reçoit un 400 qui la NOMME — ignorée en silence, un appelant croirait attribuer ses liens, ou aurait mal tapé `expires_in_days` et perdrait quinze jours sans un mot');
  check(/CLES_ACCEPTEES/.test(b),
    'et le fichier déployable utilise bien la liste du module, pas une copie qui pourrait diverger');
  check(/channel.*campaign.*n'existent plus|n'existent plus/.test(b),
    'le refus dit où mettre l’attribution, au lieu de laisser l’appelant deviner');

  // 011 : ce qui abîmait un lien DÉJÀ diffusé. Relevé par une revue adverse le 8 oct. 2026.
  check(/rpc\('cache_articles'/.test(b) && !/from\('articles'\)\.upsert/.test(b),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le cache passe par la base, pas par un upsert — un upsert écrase, et Arc indisponible transformait en aperçu le corps complet d’un lien déjà entre les mains de lecteurs');
  check(/is_demo: demo/.test(b),
    'et la démonstration s’annonce comme telle : seule la base sait si l’article a déjà un vrai corps');
  check(/new Set\(prets\.map/.test(b),
    'les identifiants sont dédoublonnés : deux URLs du même article faisaient échouer le lot entier');
  check(/Number\.isInteger\(jours\)/.test(b) && b.indexOf('expires_in_days doit être') < b.indexOf("rpc('cache_articles'"),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : la durée est validée AVANT toute écriture — elle l’était après, et un nombre absurde levait une exception une fois le contenu partagé déjà modifié');
  check(/erreurAuth/.test(b) && /503/.test(b),
    'une panne de la base rend 503, pas 401 : un jeton valide ne doit pas être accusé quand c’est le service qui tombe');
  check(/le corps doit être un objet JSON/.test(b),
    'et un corps `null`, JSON parfaitement valide, reçoit un refus au lieu d’une exception du runtime');
}


// ── UN CORPS QUI NE DIT RIEN N'EST PAS UN CORPS (7 oct. 2026).
//
// Relevé sur une vraie page de dossier : Arc rendait « <br/> ». Cinq caractères, donc non vide, donc
// annoncé « article complet » — et la page offerte n'affichait que son chapeau. Mesurer la longueur ne
// suffit pas, il faut mesurer la substance.
{
  for (const vide of ['<br/>', '   ', '<p>&nbsp;</p>', '<p></p><br>', '<div><span></span></div>'])
    check(sansSubstance(vide), `« ${vide} » ne fait pas un corps`);
  check(!sansSubstance('<p>Un vrai paragraphe.</p>'), 'du texte, si');
  check(!sansSubstance('<figure><img src="https://x/i.jpg"></figure>'),
    'une image non plus ne doit pas être prise pour du vide : un article qui ne serait qu’une photo légendée reste un article');

  const dossier = { headlines: { basic: 'Dossier' }, content_elements: [{ type: 'text', content: '<br/>' }] };
  check(depuisArc(dossier, URL_OK).body === null,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un corps sans substance vaut null — la page sert alors son aperçu honnête, au lieu de promettre une lecture offerte et de ne rien montrer');
  const vrai = { headlines: { basic: 'Vrai' }, content_elements: [{ type: 'text', content: '<p>Du contenu.</p>' }] };
  check(depuisArc(vrai, URL_OK).body === '<p>Du contenu.</p>', 'et un vrai corps passe intact');
}

console.log(`liens offerts (lot 2, contenu) : ${n} vérifications passées.`);
