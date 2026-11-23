// Lecteur : barre d'abonnement unique, offre du moment, liens internes retirés (retours d'Enzo du 20/11).
//
// Le patch docs/patches/reader-subscription-bar.patch s'applique au lecteur issu du patch Europe
// (gift-links/fixtures/reader-offers-before) et doit donner exactement docs/reader-reference. Ses sources
// passent un contrôle de types strict, puis ses vrais composants sont exécutés, RPC simulée.
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

let n = 0; const check = (c, l) => { assert.ok(c, l); n++; };
const dir = mkdtempSync(join(tmpdir(), 'platform934-offers-'));
const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)]);
try {
  const before = 'gift-links/fixtures/reader-offers-before';
  for (const file of walk(before)) {
    const target = join(dir, file.slice(before.length + 1).replace(/\.txt$/, ''));
    mkdirSync(dirname(target), { recursive: true }); copyFileSync(file, target);
  }
  const applied = spawnSync('patch', ['--batch', '-p1', '-i', resolve('docs/patches/reader-subscription-bar.patch')], { cwd: dir, encoding: 'utf8' });
  check(applied.status === 0, `patch appliqué : ${applied.stdout}${applied.stderr}`);
  for (const file of walk('docs/reader-reference')) {
    const relative = file.slice('docs/reader-reference/'.length);
    check(readFileSync(join(dir, relative), 'utf8') === readFileSync(file, 'utf8'), `référence identique au patch appliqué : ${relative}`);
  }

  writeFileSync(join(dir, 'stubs.d.ts'), `
declare namespace JSX { type Element = unknown; interface ElementChildrenAttribute { children: {} } interface IntrinsicAttributes { key?: string | number } interface IntrinsicElements { [tag: string]: Record<string, unknown> } }
declare module "react" { export function useEffect(effect: () => void, deps?: unknown[]): void; }
declare module "@tanstack/react-router" { export function createFileRoute(path: string): (options: { component: () => unknown }) => { useParams(): { token: string } }; export function useRouterState<T>(options: { select: (state: { location: { searchStr: string } }) => T }): T; }
declare module "@tanstack/react-query" { export function useQuery<T>(options: { queryKey: unknown[]; queryFn: () => Promise<T>; [option: string]: unknown }): { data: T | undefined; isPending: boolean; isFetching: boolean; refetch: () => void }; }
declare module "@/lib/useReader" { export function useReader(): import("./src/lib/edition.ts").ReaderContext; }
declare module "@/lib/piano" { export function sendPageDisplay(reader: unknown, data: Record<string, unknown>): void; }
declare module "@/components/GiftHeader" { export function GiftHeader(): unknown; }
declare module "@/lib/bodyHtml" { export function sanitizeBodyHtml(html: string): string; }
`);
  writeFileSync(join(dir, 'src/lib/deployment.ts'), 'import type { ReaderContext } from "./edition.ts";\nexport declare function readerDatabase(context: ReaderContext): { url: string; anonKey: string };\n');
  const typed = walk(join(dir, 'src')).filter((f) => /\.tsx?$/.test(f));
  const program = ts.createProgram([...typed, join(dir, 'stubs.d.ts')], { strict: true, noUncheckedIndexedAccess: true, noEmit: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2020, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, skipLibCheck: true, types: [], baseUrl: dir, paths: { '@/*': ['src/*'] } });
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => `${d.file?.fileName.slice(dir.length + 1)}:${d.file ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  assert.deepEqual(diagnostics, [], 'types stricts du lecteur'); n++;

  // ── Exécution des vrais modules, hooks et réseau simulés.
  let reader = { edition: 'FR', environment: 'TEST' };
  const queries = {};           // état rendu par useQuery, par première clé
  let fetchImpl = async () => new Response('[]');
  const requests = [];
  const React = { createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: { ...props, children } }) };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} }; cache.set(file, mod.exports);
    const extras = file === 'src/routes/a.$token.tsx' ? '\nexport { ArticleView, RefusalView, UnavailableView };' : '';
    const source = ts.transpileModule(readFileSync(join(dir, file), 'utf8') + extras, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    function require(name) {
      if (name === 'react') return { useEffect: () => {} };
      if (name === '@tanstack/react-router') return { createFileRoute: () => () => ({}), useRouterState: () => '' };
      if (name === '@tanstack/react-query') return { useQuery: (o) => { queries.last = o; return queries[o.queryKey[0]] ?? {}; } };
      if (name === '@/lib/useReader') return { useReader: () => reader };
      if (name === './deployment.ts' || name === '@/lib/deployment') return { readerDatabase: () => ({ url: 'https://db.invalid', anonKey: 'cle-publique-fictive' }) };
      if (name === '@/lib/piano') return { sendPageDisplay: () => {} };
      if (name === '@/components/GiftHeader') return { GiftHeader: () => ({ type: 'header', props: { children: [] } }) };
      if (name === '@/lib/bodyHtml') return { sanitizeBodyHtml: (s) => s };
      let target = name.startsWith('@/') ? 'src/' + name.slice(2) : posix.join(posix.dirname(file), name);
      if (!/\.tsx?$/.test(target)) target += existsSync(join(dir, target + '.tsx')) ? '.tsx' : '.ts';
      return load(target);
    }
    vm.runInNewContext(source, { exports: mod.exports, require, React, URL, URLSearchParams, AbortSignal, Response, console, Date, Number, String, Array, Object, JSON, parseInt,
      fetch: async (url, options) => { requests.push({ url, options }); return fetchImpl(url, options); } });
    return mod.exports;
  }
  const offers = load('src/lib/subscriptionOffer.ts');
  const link = load('src/lib/subscriptionLink.ts');
  const internal = load('src/lib/internalLinks.ts');
  const bar = load('src/components/SubscribeButton.tsx');
  const route = load('src/routes/a.$token.tsx');
  const all = (node) => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(all)];
  const anchors = (node) => all(node).filter((x) => x.type === 'a');
  const texts = (node) => node == null || typeof node === 'boolean' ? [] : typeof node !== 'object' ? [String(node)] : (node.props?.children ?? []).flat(Infinity).flatMap(texts);

  // ── 1. LE SITE DE L'OFFRE suit l'édition et la langue de l'article.
  for (const [edition, language, site] of [['FR', undefined, 'www.lexpress.fr'], ['FR', 'pl', 'www.lexpress.fr'], ['EUR', undefined, 'www.lexpress.eu'],
    ['EUR', 'en', 'www.lexpress.eu'], ['EUR', 'fr', 'fr.lexpress.eu'], ['EUR', 'pl', 'pl.lexpress.eu']]) {
    check(offers.offerSite(edition, language) === site, `site de l’offre ${edition}/${language} = ${site}`);
  }

  // ── 2. LE BOUTON PAR DÉFAUT est exactement celui d'aujourd'hui, par édition et par langue.
  const defauts = [
    ['FR', undefined, "S'abonner à L'Express", 'https://abonnements-digitaux.lexpress.fr/offres'],
    ['EUR', undefined, "Subscribe to L'Express Europe", 'https://www.lexpress.eu/subscribe/'],
    ['EUR', 'en', 'Subscribe', 'https://www.lexpress.eu/subscribe/'],
    ['EUR', 'fr', "S'abonner", 'https://fr.lexpress.eu/abonnement/'],
    ['EUR', 'pl', 'Subskrypcja', 'https://pl.lexpress.eu/subskrypcja/'],
  ];
  for (const [edition, language, label, url] of defauts) {
    const a = link.subscriptionAction('', edition, language, null);
    check(a.label === label && a.href === url, `sans offre, ${edition}/${language} garde « ${label} » vers ${url} — obtenu ${JSON.stringify(a)}`);
  }

  // ── 3. LES UTM (point 5) : at_* et s du visiteur s'ajoutent, à l'URL par défaut comme à celle de l'offre.
  const search = '?s=0123456789abcdef0123456789abcdef&at_medium=Newsletter&at_campaign=bf&at_campaign_group=chauds&utm_source=x&refTarif=1&redirect=https://evil.test';
  const avecOffre = link.subscriptionAction(search, 'FR', undefined, { label: 'Black Friday : -50 %', url: 'https://abonnements-digitaux.lexpress.fr/offres?refTarif=1329&at_medium=Offre', endsAt: Date.now() + 3600e3 });
  const cible = new URL(avecOffre.href);
  check(avecOffre.label === 'Black Friday : -50 %', 'C’EST LA PROPRIÉTÉ QUI COMPTE : l’offre en cours remplace le libellé');
  check(cible.origin + cible.pathname === 'https://abonnements-digitaux.lexpress.fr/offres', 'et la cible');
  check(cible.searchParams.get('refTarif') === '1329', 'les paramètres propres à l’offre (code promo) sont gardés');
  check(cible.searchParams.get('at_medium') === 'Newsletter' && cible.searchParams.getAll('at_medium').length === 1,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : les UTM du visiteur s’ajoutent à l’URL de l’offre, et l’emportent (set, jamais append)');
  check(cible.searchParams.get('s') === '0123456789abcdef0123456789abcdef' && cible.searchParams.get('at_campaign_group') === 'chauds', 's et at_campaign_group transmis');
  check(cible.searchParams.get('utm_source') === null && cible.searchParams.get('redirect') === null, 'rien d’autre du visiteur : ni utm_source, ni redirect');
  const libelleSeul = link.subscriptionAction('?at_medium=Whatsapp', 'EUR', 'pl', { label: 'Black Friday', url: null, endsAt: Date.now() + 1e6 });
  check(libelleSeul.label === 'Black Friday' && libelleSeul.href === 'https://pl.lexpress.eu/subskrypcja/?at_medium=Whatsapp', 'offre sans URL : lien par défaut du site, avec les UTM');
  const urlSeule = link.subscriptionAction('', 'EUR', 'fr', { label: null, url: 'https://fr.lexpress.eu/abonnement/?promo=bf', endsAt: Date.now() + 1e6 });
  check(urlSeule.label === "S'abonner" && urlSeule.href === 'https://fr.lexpress.eu/abonnement/?promo=bf', 'offre sans libellé : texte par défaut, dans la langue du site');
  const expiree = link.subscriptionAction('', 'FR', undefined, { label: 'Fini', url: 'https://www.lexpress.fr/', endsAt: Date.now() - 1 });
  check(expiree.label === "S'abonner à L'Express", 'une offre qui expire pendant la lecture ne s’affiche plus au rendu suivant');

  // ── 4. LA RÉPONSE DE LA RPC est vérifiée ; au moindre doute, bouton par défaut.
  const futur = new Date(Date.now() + 86400e3).toISOString();
  check(offers.parseOffer([], 'www.lexpress.fr') === null, 'aucune offre : null');
  const bon = offers.parseOffer([{ label: 'Offre', url: 'https://abonnements-digitaux.lexpress.fr/offres', ends_at: futur }], 'www.lexpress.fr');
  check(bon && bon.label === 'Offre' && bon.url === 'https://abonnements-digitaux.lexpress.fr/offres', 'une offre valide est retenue');
  check(offers.parseOffer([{ label: null, url: null, ends_at: futur }], 'pl.lexpress.eu')?.label === null, 'libellé et URL nuls : offre retenue, valeurs par défaut');
  for (const [cas, rows, site] of [
    ['deux lignes', [{ label: 'A', url: null, ends_at: futur }, { label: 'B', url: null, ends_at: futur }], 'www.lexpress.fr'],
    ['pas un tableau', { label: 'A', url: null, ends_at: futur }, 'www.lexpress.fr'],
    ['date passée', [{ label: 'A', url: null, ends_at: '2020-01-01T00:00:00Z' }], 'www.lexpress.fr'],
    ['date absente', [{ label: 'A', url: null }], 'www.lexpress.fr'],
    ['URL hors domaine', [{ label: 'A', url: 'https://evil.test/', ends_at: futur }], 'www.lexpress.fr'],
    ['URL javascript', [{ label: 'A', url: 'javascript:alert(1)', ends_at: futur }], 'www.lexpress.fr'],
    ['URL http', [{ label: 'A', url: 'http://www.lexpress.fr/', ends_at: futur }], 'www.lexpress.fr'],
    ['URL d’un autre domaine L’Express', [{ label: 'A', url: 'https://www.lexpress.eu/subscribe/', ends_at: futur }], 'www.lexpress.fr'],
    ['URL avec identifiants', [{ label: 'A', url: 'https://www.lexpress.fr@evil.test/', ends_at: futur }], 'www.lexpress.fr'],
    ['libellé trop long', [{ label: 'x'.repeat(41), url: null, ends_at: futur }], 'www.lexpress.fr'],
    ['libellé vide', [{ label: '', url: null, ends_at: futur }], 'www.lexpress.fr'],
    ['libellé non texte', [{ label: 42, url: null, ends_at: futur }], 'www.lexpress.fr'],
    ['libellé absent', [{ url: null, ends_at: futur }], 'www.lexpress.fr'],
  ]) check(offers.parseOffer(rows, site) === null, `réponse refusée, bouton par défaut : ${cas}`);

  reader = { edition: 'EUR', environment: 'TEST' };
  fetchImpl = async () => new Response(JSON.stringify([{ label: 'Promocja', url: 'https://pl.lexpress.eu/subskrypcja/?promo=1', ends_at: futur }]));
  requests.length = 0;
  const lue = await offers.getSubscriptionOffer('pl.lexpress.eu', reader);
  check(lue?.label === 'Promocja', 'la RPC est lue');
  check(requests.length === 1 && requests[0].url === 'https://db.invalid/rest/v1/rpc/get_subscription_offer', 'C’EST LA PROPRIÉTÉ QUI COMPTE : une seule requête, vers la RPC dédiée');
  check(JSON.parse(requests[0].options.body).p_site === 'pl.lexpress.eu' && Object.keys(JSON.parse(requests[0].options.body)).join() === 'p_site', 'avec le site seulement — ni jeton, ni paramètre du visiteur');
  check(requests[0].options.headers.apikey === 'cle-publique-fictive' && requests[0].options.signal, 'clé publique, délai borné');
  for (const [cas, impl] of [['HTTP 500', async () => new Response('{}', { status: 500 })], ['réseau coupé', async () => { throw new Error('offline'); }],
    ['JSON illisible', async () => new Response('<html>')], ['RPC absente (404)', async () => new Response('{"code":"PGRST202"}', { status: 404 })]]) {
    fetchImpl = impl;
    check(await offers.getSubscriptionOffer('www.lexpress.eu', reader) === null, `C’EST LA PROPRIÉTÉ QUI COMPTE : ${cas} → bouton par défaut, jamais une erreur`);
  }

  // ── 5. LA BARRE : une seule action, collée en bas, sur l'article comme sur un refus.
  queries['subscription-offer'] = { isPending: true };
  check(bar.SubscribeBar({ token: 'a'.repeat(32), search: '', language: 'pl' }) === null, 'offre en cours de lecture : pas de libellé qui change sous les yeux');
  check(queries.last.queryKey.join() === `subscription-offer,TEST,pl.lexpress.eu,${'a'.repeat(32)}` && queries.last.retry === false,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : une lecture par article affiché (clé : environnement, site, jeton), sans réessai — un article ouvert après le début d’une offre la voit');
  queries['subscription-offer'] = { isPending: false, data: null };
  const sansOffre = bar.SubscribeBar({ token: 'a'.repeat(32), search: '?at_medium=Whatsapp', language: 'pl' });
  check(/\bsticky\b/.test(sansOffre.props.className) && /\bbottom-0\b/.test(sansOffre.props.className) && !/\bfixed\b/.test(sansOffre.props.className),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : barre sticky en bas, pas fixed — en fin de page elle reprend sa place sous le contenu et ne recouvre jamais la fin de l’article');
  check(/safe-area-inset-bottom/.test(sansOffre.props.className), 'la barre évite la zone du geste d’accueil des téléphones');
  check(anchors(sansOffre).length === 1 && texts(sansOffre).join('') === 'Subskrypcja' && anchors(sansOffre)[0].props.href === 'https://pl.lexpress.eu/subskrypcja/?at_medium=Whatsapp', 'sans offre : le bouton d’aujourd’hui');
  queries['subscription-offer'] = { isPending: false, data: { label: 'Promocja', url: 'https://pl.lexpress.eu/subskrypcja/?promo=1', endsAt: Date.now() + 1e6 } };
  const avec = bar.SubscribeBar({ token: 'a'.repeat(32), search: '?s=abc', language: 'pl' });
  check(texts(avec).join('') === 'Promocja' && anchors(avec)[0].props.href === 'https://pl.lexpress.eu/subskrypcja/?promo=1&s=abc', 'avec offre : son libellé, son URL, les UTM du visiteur');

  // La page : la barre est le dernier élément, hors du contenu, et le seul bouton d'abonnement.
  const article = { status: 'ok', title: 'Titre', canonical_url: 'https://pl.lexpress.eu/a', image_url: 'https://pl.lexpress.eu/i.jpg', section: 'S', standfirst: 'C', published_at: '2026-11-20T10:00:00Z', author: 'A', language: 'pl',
    body: 'Lire <a href="https://pl.lexpress.eu/autre-article-ABCDEFGHIJKLMNOPQRSTUVWXYZ" target="_blank">cet article</a> et <a href="https://www.gouv.fr/rapport.pdf">le rapport</a>.\n\n<p>Voir <a href="/rubrique">la rubrique</a>.</p>' };
  const page = (data) => { queries['gift-article'] = { data, isPending: false, isFetching: false, refetch() {} }; return route.GiftArticleContent({ token: 'a'.repeat(32) }); };
  queries['subscription-offer'] = { isPending: false, data: null };
  for (const [cas, data, attendu] of [
    ['article', article, 'Subskrypcja'],
    ['aperçu', { ...article, status: 'preview', body: null }, 'Subskrypcja'],
    ['lien expiré polonais', { error: 'expired', language: 'pl' }, 'Subskrypcja'],
    ['lien retiré', { error: 'withdrawn' }, "Subscribe to L'Express Europe"],
    ['lien inconnu', { error: 'unknown' }, "Subscribe to L'Express Europe"],
  ]) {
    const rendu = page(data);
    const enfants = rendu.props.children.flat(Infinity).filter(Boolean);
    const derniere = enfants.at(-1);
    check(/\bflex-col\b/.test(rendu.props.className) && /\bmin-h-screen\b/.test(rendu.props.className), `${cas} : page en colonne, au moins la hauteur de l’écran`);
    check(derniere?.props?.className?.includes('sticky'), `${cas} : la barre est le dernier élément de la page`);
    const boutons = anchors(rendu).filter((a) => /abonnement|subscribe|subskrypcja|offres/.test(a.props.href));
    check(boutons.length === 1 && texts(boutons[0]).join('') === attendu,
      `C’EST LA PROPRIÉTÉ QUI COMPTE : ${cas} — un seul bouton d’abonnement, « ${attendu} » — obtenu ${boutons.map((b) => texts(b).join('')).join(' | ')}`);
    const main = enfants.find((e) => e.type === 'main');
    check(anchors(main).every((a) => !/abonnement|subscribe|subskrypcja|offres/.test(a.props.href)), `${cas} : aucun bouton d’abonnement dans le contenu`);
  }
  for (const [cas, data] of [['chargement', undefined], ['panne technique', { error: 'unavailable' }]]) {
    queries['gift-article'] = { data, isPending: data === undefined, isFetching: false, refetch() {} };
    const rendu = route.GiftArticleContent({ token: 'a'.repeat(32) });
    check(!all(rendu).some((x) => x.props?.className?.includes?.('sticky')), `${cas} : pas de barre, rien à proposer encore`);
  }
  reader = { edition: 'FR', environment: 'TEST' };
  const france = page({ ...article, canonical_url: 'https://www.lexpress.fr/a', language: 'fr', body: 'x' });
  check(anchors(france).filter((a) => a.props.href.startsWith('https://abonnements-digitaux.lexpress.fr/offres')).length === 1, 'France : un seul bouton, vers /offres');
  check(queries.last.queryKey.join() === `subscription-offer,TEST,www.lexpress.fr,${'a'.repeat(32)}`, 'France : l’offre lue est celle de www.lexpress.fr');

  // ── 6. LES LIENS INTERNES DU CORPS (point 6) : texte gardé, lien retiré, liens externes intacts.
  reader = { edition: 'EUR', environment: 'TEST' };
  const vue = route.ArticleView({ article });
  const corps = all(vue).filter((x) => x.props?.dangerouslySetInnerHTML).map((x) => x.props.dangerouslySetInnerHTML.__html).join('\n');
  check(corps.includes('Lire cet article et <a href="https://www.gouv.fr/rapport.pdf">le rapport</a>.'),
    `C’EST LA PROPRIÉTÉ QUI COMPTE : le lien interne disparaît, son texte reste, le lien externe reste — obtenu ${corps}`);
  check(corps.includes('<p>Voir la rubrique.</p>'), 'un lien relatif est retiré aussi');
  const u = internal.unlinkInternalLinks;
  for (const [cas, html, attendu] of [
    ['lexpress.fr', '<a href="https://www.lexpress.fr/x">a</a>', 'a'],
    ['sans www', "<a href='https://lexpress.fr/x'>a</a>", 'a'],
    ['abonnements', '<a href="https://abonnements-digitaux.lexpress.fr/offres">a</a>', 'a'],
    ['Europe fr', '<a href="https://fr.lexpress.eu/x">a</a>', 'a'],
    ['majuscules', '<A HREF="HTTPS://WWW.LEXPRESS.FR/x">a</A>', 'a'],
    ['point final', '<a href="https://www.lexpress.fr./x">a</a>', 'a'],
    ['port', '<a href="https://www.lexpress.fr:443/x">a</a>', 'a'],
    ['entités', '<a href="https&#58;//www.lexpress.fr/x">a</a>', 'a'],
    ['entités hex', '<a href="https:&#x2F;&#x2F;www.lexpress.fr/x">a</a>', 'a'],
    ['sans guillemets', '<a href=https://www.lexpress.fr/x>a</a>', 'a'],
    ['protocole implicite', '<a href="//www.lexpress.fr/x">a</a>', 'a'],
    ['ancre', '<a href="#note">a</a>', 'a'],
    ['sans href', '<a name="x">a</a>', 'a'],
    ['javascript', '<a href="javascript:alert(1)">a</a>', 'a'],
    ['non fermé', 'avant <a href="https://www.lexpress.fr/x">a et la suite', 'avant a et la suite'],
    ['guillemet non fermé', 'avant <a href="https://www.lexpress.fr/x>a</a>', 'avant a'],
    ['title qui cite un href externe', '<a title=" href=https://ext.example/" href="https://www.lexpress.fr/x">a</a>', 'a'],
    ['title qui cite un href, guillemets simples', "<a title=' href=\"https://ext.example/\"' href='https://www.lexpress.fr/x'>a</a>", 'a'],
    ['deux href : le premier compte', '<a href="https://www.lexpress.fr/x" href="https://ext.example/">a</a>', 'a'],
    ['fermeture orpheline', 'a</a> b', 'a b'],
    ['contenu riche', '<a href="https://www.lexpress.fr/x"><b>gras</b> et <i>it</i></a>', '<b>gras</b> et <i>it</i>'],
    ['chevron dans un attribut', '<a title="a>b" href="https://www.lexpress.fr/x">a</a>', 'a'],
    ['deux liens', '<a href="https://www.lexpress.fr/1">un</a> <a href="https://ext.example/2">deux</a>', 'un <a href="https://ext.example/2">deux</a>'],
    ['data-href trompeur', '<a data-href="https://ext.example/" href="https://www.lexpress.fr/x">a</a>', 'a'],
  ]) check(u(html) === attendu, `${cas} : ${JSON.stringify(u(html))}`);
  for (const garde of ['<a href="https://www.gouv.fr/r.pdf" target="_blank" rel="noopener">r</a>', '<a href="http://example.org/">e</a>',
    '<a href="https://lexpress.fr.example.org/">sosie</a>', '<a href="https://notlexpress.fr/">voisin</a>', '<abbr title="x">abbr</abbr>',
    '<a title="a > b" href="https://www.gouv.fr/r.pdf">rapport</a>', '<a title=" href=https://www.lexpress.fr/" href="https://ext.example/">ext</a>']) {
    check(u(garde) === garde, `gardé tel quel : ${garde}`);
  }
  check(u('texte sans lien, <b>gras</b>') === 'texte sans lien, <b>gras</b>', 'un paragraphe sans lien ne change pas');
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`Lecteur (barre et offres) : ${n} vérifications — patch appliqué, types stricts, barre unique, offre, UTM, liens internes (simulés).`);
