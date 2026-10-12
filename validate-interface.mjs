// L'interface web : ce qu'elle refuse, et ce qu'elle ne laisse jamais filtrer.
//
// Trois propriétés valent le test avant toute question d'ergonomie.
//
// LA PREMIÈRE : SANS SESSION, LE SERVICE N'EST PAS APPELÉ. Pas « l'appel échoue » — PAS APPELÉ. Derrière
// cette page, un bouton fabrique des accès complets à des articles payants ; une URL Vercel est publique.
// Le test compte les appels sortants et exige zéro.
//
// LA DEUXIÈME : LE JETON NE REDESCEND JAMAIS DANS LE NAVIGATEUR une fois saisi, ni dans une réponse, ni
// dans un journal, ni en clair dans le cookie. Il est scellé par chiffrement : un cookie seulement
// signé promènerait le jeton en clair à chaque requête et dans les journaux du moindre mandataire.
//
// LA TROISIÈME : C'EST LE JETON DE LA PERSONNE QUI PART AU SERVICE, jamais un jeton du déploiement. Le
// test pose un jeton leurre dans l'environnement et vérifie qu'il n'est pas employé — c'est ce qui
// garantit que `gift_links_by_client` nomme la personne, et qu'on peut la couper seule.
//
// Les handlers sont écrits en `fetch(Request) → Response` justement pour que ce fichier puisse les
// EXÉCUTER sous Node, sans la plateforme. Des contrôles qu'aucun test n'exécute ne prouvent rien : on a
// déjà découvert qu'on pouvait désactiver une authentification sans qu'une seule assertion bronche.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlerCreer, handlerSession, sonderJeton, decouperAdresses, MAX_ADRESSES, API_PAR_DEFAUT } from './interface/handlers.mjs';
import { handlerAcces } from './interface/handlers.mjs';
import { FORME_JETON, ouvrirJeton, scellerJeton, lireCookie, origineAcceptable } from './interface/session.mjs';
import { CALCULS_SIMULTANES, LONGUEUR_MIN_CLE, TropDeCalculs, accesValide, cleValide, signerAcces } from './interface/acces.mjs';
import { trierUrls } from './gift-links/functions/_shared/arc-id.mjs';
import { expliquer, expliquerPanne, TRADUCTIONS } from './interface/motifs.mjs';
import { titreDepuisAdresse, rubriqueDepuisAdresse, decrireEtat, formaterEcheance } from './interface/presentation.mjs';
import { CLES_ACCEPTEES } from './gift-links/functions/_shared/corps.mjs';

let n = 0; const check = (c, l) => { assert.ok(c, l); n++; };

// Le jeton d'une personne : 64 hexadécimaux, la forme que rend `openssl rand -hex 32`.
const JETON = 'f3'.repeat(32);
const JETON_AUTRE = 'ab'.repeat(32);
const SECRET = 'x'.repeat(48);
const CLE = 'la-cle-partagee-de-lequipe-2026';
// LE LEURRE. Un jeton posé dans l'environnement du déploiement : il ne doit JAMAIS partir au service.
// S'il partait, tous les liens seraient attribués au déploiement et non à la personne.
const JETON_LEURRE = '99'.repeat(32);
const ENV = { INTERFACE_SECRET_SESSION: SECRET, INTERFACE_CLE_ACCES: CLE, GIFT_SERVICE_TOKEN: JETON_LEURRE };
const URL_OK = 'https://www.lexpress.fr/societe/religion/a-lyon-lecole-des-chartreux-XGLQ6NY6CJD6LLBLBBMEF7A2V4';
const URL_OK2 = 'https://www.lexpress.fr/politique/elections/en-2027-faut-il-mentir-RQOLMEM5NZE3BNTWPJEEGC5B5Y';

const cookieValide = (decalageMs = 3600_000, jeton = JETON) => `session=${scellerJeton(SECRET, jeton, Date.now() + decalageMs)}`;

/** Le service feint pour la SONDE d'ouverture de session : 401 refuse, 400 reconnaît. */
const sondeur = (statut) => {
  const appels = [];
  return { appels, fetch: async (url, options) => {
    appels.push({ url, entetes: options.headers, corps: JSON.parse(options.body) });
    return new Response(JSON.stringify({ error: 'aucune URL exploitable' }), { status: statut });
  } };
};

const cookieAcces = (decalageMs = 3600_000, cle = CLE) => `acces=${signerAcces(SECRET, cle, Date.now() + decalageMs)}`;

/**
 * Par défaut, les requêtes de ce fichier portent le cookie du RIDEAU : les blocs qui suivent
 * éprouvent la seconde barrière, pas la première. Passer `rideau: false` pour l'ôter.
 */
const requete = (chemin, { methode = 'POST', corps, cookie, origine, rideau = true } = {}) => new Request(`https://liens.lexpress.fr${chemin}`, {
  method: methode,
  headers: {
    'content-type': 'application/json',
    ...((cookie || rideau) ? { cookie: [rideau ? cookieAcces() : null, cookie].filter(Boolean).join('; ') } : {}),
    ...(origine ? { origin: origine } : {}),
  },
  ...(corps === undefined || methode === 'GET' || methode === 'DELETE' ? {} : { body: JSON.stringify(corps) }),
});

/** Un service feint, qui COMPTE ses appels et garde ce qu'on lui a envoyé. */
function serviceFeint(reponse) {
  const appels = [];
  const fetch = async (url, options) => {
    appels.push({ url, entetes: options.headers, corps: JSON.parse(options.body) });
    if (typeof reponse === 'function') return reponse(appels.length);
    return new Response(JSON.stringify(reponse.corps), { status: reponse.statut ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, appels };
}

/** Capture les lignes de journal écrites pendant un appel : on vérifie ce qu'elles NE contiennent pas. */
async function avecJournal(action) {
  const lignes = [];
  const warn = console.warn, error = console.error;
  console.warn = (l) => lignes.push(l); console.error = (l) => lignes.push(l);
  try { return { resultat: await action(), lignes }; }
  finally { console.warn = warn; console.error = error; }
}

const LIEN_COMPLET = {
  url: URL_OK, arc_id: 'XGLQ6NY6CJD6LLBLBBMEF7A2V4', token: 'd6329e8d37d7421eae68d32a45262f33',
  link: 'https://articles.lexpress.fr/a/d6329e8d37d7421eae68d32a45262f33',
  expires_at: new Date(Date.now() + 15 * 86400000).toISOString(), content: 'full', source: 'arc', state: 'created',
};
const LIEN_APERCU = { ...LIEN_COMPLET, url: URL_OK2, arc_id: 'RQOLMEM5NZE3BNTWPJEEGC5B5Y', content: 'preview', state: 'extended' };
// Une adresse de forme valide, que seul le SERVICE peut refuser : il faut consulter la base pour savoir
// qu'un article a été retiré. L'interface ne peut pas le deviner, et ne doit pas essayer.
const URL_RETIREE = 'https://www.lexpress.fr/monde/europe/un-article-retire-WDWDWDWDWDWDWDWDWDWDWDWDWD';

// ── LA PREMIÈRE BARRIÈRE : LA CLÉ D'ACCÈS PARTAGÉE.
//
// Elle ouvre la PAGE, elle ne donne aucun pouvoir. Ce qui compte dans ces contrôles : qu'elle garde
// aussi l'API. Une barrière qui ne vit que dans l'apparence de la page se contourne en appelant
// `/api/creer` à la main — ce qui en ferait une décoration.
{
  const ouvrir = handlerAcces({ env: ENV });

  const refus = (await avecJournal(() => ouvrir(requete('/api/acces', { corps: { cle: 'la-cle-partagee-de-lequipe-2025' } })))).resultat;
  check(refus.status === 401, 'une clé fausse reçoit 401');
  check(!refus.headers.get('set-cookie'), 'et ne pose aucun cookie');

  const ok = await ouvrir(requete('/api/acces', { corps: { cle: CLE } }));
  const biscuit = ok.headers.get('set-cookie');
  check(ok.status === 200 && (await ok.json()).acces === true, 'la bonne clé ouvre le rideau');
  for (const attribut of ['HttpOnly', 'Secure', 'SameSite=Strict'])
    check(biscuit.includes(attribut), `le cookie du rideau porte ${attribut}`);
  const valeur = biscuit.slice('acces='.length).split(';')[0];
  check(!biscuit.includes(CLE) && !Buffer.from(valeur.split('.')[0], 'base64url').toString().includes(CLE),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : la clé n’est pas recopiée dans le cookie — celui-ci ne porte qu’une date de fin');
  check(accesValide(SECRET, CLE, valeur), 'et le cookie rendu est accepté ensuite');
  check(!accesValide(SECRET, CLE, signerAcces(SECRET, CLE, Date.now() - 1000)), 'un rideau périmé est refusé');
  check(!accesValide(SECRET, CLE, `${valeur.split('.')[0]}.signatureBidon`), 'une signature retouchée est refusée');
  check(!accesValide('y'.repeat(48), CLE, valeur), 'un cookie signé avec un autre secret est refusé');
  check(!accesValide(SECRET, CLE, 'nimportequoi') && !accesValide(SECRET, CLE, null), 'un cookie bricolé est un refus ordinaire');

  // ── UNE ROTATION QUI NE COUPE RIEN N'EST PAS UNE ROTATION. Relevé par une revue adverse.
  check(!accesValide(SECRET, 'une-toute-autre-cle-partagee', valeur),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : changer la clé d’accès invalide SUR-LE-CHAMP les rideaux déjà ouverts — la signature est liée à la clé en vigueur, pas au seul secret du déploiement');
  check(!accesValide(SECRET, '', valeur) && !accesValide(SECRET, 'courte', valeur),
    'et retirer la clé de la configuration ferme la porte, y compris pour qui l’avait déjà franchie');

  // Fermeture par défaut : une couche de sécurité qu'on saute en silence est le pire des deux mondes.
  for (const [cas, env] of [
    ['clé absente', { INTERFACE_SECRET_SESSION: SECRET }],
    ['clé trop courte', { INTERFACE_SECRET_SESSION: SECRET, INTERFACE_CLE_ACCES: 'courte' }],
  ]) {
    const { resultat } = await avecJournal(() => handlerAcces({ env })(requete('/api/acces', { corps: { cle: 'courte' } })));
    check(resultat.status === 503, `C’EST LA PROPRIÉTÉ QUI COMPTE : ${cas} → 503. La barrière ne se saute pas en silence quand sa variable manque`);
    check(!resultat.headers.get('set-cookie'), `${cas} n’ouvre rien`);
  }
  check((await cleValide('courte', 'courte', SECRET)) === false, `une clé de moins de ${LONGUEUR_MIN_CLE} caractères ne vaut rien, même si elle correspond`);
  check((await cleValide('', '', SECRET)) === false, 'une clé vide ne correspond jamais à une configuration vide');

  // ── LE COÛT PROTÉGEAIT DE LA DEVINETTE ET OUVRAIT UN DÉNI DE SERVICE. Relevé par une revue adverse :
  //    n'importe qui pouvait déclencher un quart de seconde de calcul, payé par NOTRE serveur.
  {
    const bloquees = [];
    const tentatives = Array.from({ length: CALCULS_SIMULTANES + 3 }, () =>
      cleValide('x'.repeat(40), CLE, SECRET).catch((e) => { bloquees.push(e); return null; }));
    await Promise.all(tentatives);
    check(bloquees.length >= 3 && bloquees.every((e) => e instanceof TropDeCalculs),
      `C’EST LA PROPRIÉTÉ QUI COMPTE : au-delà de ${CALCULS_SIMULTANES} calculs simultanés, les suivants sont refusés SANS calculer — le processeur qu’on protège est celui de l’instance, et il se borne par instance`);

    const t0 = Date.now();
    check((await cleValide('trop-courte', CLE, SECRET)) === false && (await cleValide('y'.repeat(300), CLE, SECRET)) === false,
      'une valeur hors des longueurs admises est refusée');
    check(Date.now() - t0 < 50, 'et elle est refusée SANS payer le scrypt — ce qui se refuse sans calculer se refuse sans calculer');

    const sature = (await avecJournal(() => Promise.all(
      Array.from({ length: CALCULS_SIMULTANES + 3 }, () => handlerAcces({ env: ENV })(requete('/api/acces', { corps: { cle: 'z'.repeat(40) } }))),
    ))).resultat;
    check(sature.some((r) => r.status === 429), 'et la route rend 429 plutôt que de laisser saturer l’instance');
    check(sature.every((r) => r.status !== 200), 'aucune de ces tentatives n’ouvre quoi que ce soit');
  }

  const ailleurs = (await avecJournal(() => ouvrir(requete('/api/acces', { corps: { cle: CLE }, origine: 'https://evil.example' })))).resultat;
  check(ailleurs.status === 403, 'une requête venue d’une autre origine est refusée');
  check(/Max-Age=0/.test((await ouvrir(requete('/api/acces', { methode: 'DELETE' }))).headers.get('set-cookie')), 'le rideau se referme');

  // LE COÛT. Sur une plateforme sans état, on ne peut pas compter les tentatives : on les fait payer.
  const acces = readFileSync('./interface/acces.mjs', 'utf8');
  const N = Number(acces.match(/N:\s*(\d+)/)[1]);
  check(N >= 65536, `chaque essai coûte un calcul scrypt sérieux (N = ${N}) — une clé choisie par un humain est devinable, et un compteur en mémoire ne voit rien sur Vercel`);
}

// ── LE RIDEAU GARDE L'API, PAS SEULEMENT L'AFFICHAGE.
{
  const service = serviceFeint({ corps: { links: [LIEN_COMPLET], rejected: [] } });
  const sonde = sondeur(400);

  const jetonSansRideau = (await avecJournal(() => handlerSession({ env: ENV, fetch: sonde.fetch })(
    requete('/api/session', { corps: { jeton: JETON }, rideau: false })))).resultat;
  check(jetonSansRideau.status === 403 && (await jetonSansRideau.json()).etape === 'acces',
    'sans clé d’accès, on ne peut même pas présenter un jeton');
  check(sonde.appels.length === 0, 'et le service n’est pas appelé pour l’éprouver');

  // LE CAS QUI PROUVE QUE LA BARRIÈRE N'EST PAS DÉCORATIVE : une session parfaitement valide, mais
  // pas de rideau. Si ça passait, il suffirait d'appeler /api/creer à la main pour l'ignorer.
  const creerSansRideau = (await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
    requete('/api/creer', { corps: { adresses: URL_OK }, cookie: cookieValide(), rideau: false })))).resultat;
  check(creerSansRideau.status === 403 && (await creerSansRideau.json()).etape === 'acces',
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un cookie de session VALIDE ne suffit pas sans le rideau — la barrière garde l’API, pas l’apparence de la page');
  check(service.appels.length === 0, 'et aucun appel ne part au service');

  const rideauPerime = (await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
    new Request('https://liens.lexpress.fr/api/creer', { method: 'POST', headers: { 'content-type': 'application/json',
      cookie: `${signerAcces(SECRET, Date.now() - 1000).replace(/^/, 'acces=')}; ${cookieValide()}` },
      body: JSON.stringify({ adresses: URL_OK }) })))).resultat;
  check(rideauPerime.status === 403, 'un rideau périmé referme l’API, même avec une session encore valide');

  // L'INVERSE AUSSI : le rideau seul ne crée rien. Il ne donne aucun pouvoir, c'est tout son sens.
  const rideauSeul = (await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
    requete('/api/creer', { corps: { adresses: URL_OK } })))).resultat;
  check(rideauSeul.status === 403 && (await rideauSeul.json()).etape === 'jeton',
    'C’EST L’AUTRE MOITIÉ : la clé d’accès seule ne crée aucun lien — elle ouvre la page, elle n’autorise rien');
  check(service.appels.length === 0, 'et là non plus rien ne part au service');

  const etats = await (await handlerSession({ env: ENV })(requete('/api/session', { methode: 'GET' }))).json();
  check(etats.acces === true && etats.ouverte === false, 'la page sait quelle barrière reste à franchir, et c’est le serveur qui le lui dit');
}

// ── LA SECONDE BARRIÈRE : chacun son jeton, scellé dans un cookie chiffré.
{
  // La forme d'abord : une valeur collée de travers n'a pas à consommer un appel au service.
  const sonde = sondeur(400);
  const ouvrir = handlerSession({ env: ENV, fetch: sonde.fetch });
  for (const [cas, valeur] of [
    ['vide', ''], ['trop court', 'f3'.repeat(20)], ['majuscules', 'F3'.repeat(32)],
    ['avec un espace', `${'f3'.repeat(31)}f 3`], ['pas hexadécimal', 'z3'.repeat(32)], ['absent', undefined],
  ]) {
    const { resultat } = await avecJournal(() => ouvrir(requete('/api/session', { corps: { jeton: valeur } })));
    check(resultat.status === 400, `un jeton ${cas} est refusé sur sa forme`);
  }
  check(sonde.appels.length === 0,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : aucune de ces valeurs n’a été envoyée au service — un refus de forme ne consomme pas d’appel');
  check(FORME_JETON.test(JETON) && !FORME_JETON.test(`${JETON} `), 'la forme attendue est 64 hexadécimaux exactement');

  // LA SONDE : une demande VIDE. Le service authentifie d'abord, donc 401 = refusé, 400 = reconnu.
  const refuseur = sondeur(401);
  const refus = (await avecJournal(() => handlerSession({ env: ENV, fetch: refuseur.fetch })(
    requete('/api/session', { corps: { jeton: JETON } })))).resultat;
  check(refus.status === 401, 'un jeton que le service refuse reçoit 401');
  check(!refus.headers.get('set-cookie'), 'et aucune session n’est ouverte');
  check(/révoqué/.test((await refus.json()).erreur), 'le message envisage la révocation, qui est le cas le plus courant');
  check(refuseur.appels[0].corps.urls.length === 0 && Object.keys(refuseur.appels[0].corps).length === 1,
    'LA SONDE N’ÉCRIT RIEN : une demande vide, aucune autre clé — pas d’article chargé, pas de lien créé');
  check(refuseur.appels[0].entetes['x-gift-service-token'] === JETON, 'et c’est bien le jeton saisi qui est éprouvé');

  const ok = await handlerSession({ env: ENV, fetch: sondeur(400).fetch })(requete('/api/session', { corps: { jeton: JETON } }));
  const biscuit = ok.headers.get('set-cookie');
  check(ok.status === 200 && (await ok.json()).ouverte === true, 'un jeton reconnu ouvre la session');
  for (const attribut of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'])
    check(biscuit.includes(attribut), `le cookie porte ${attribut} — HttpOnly le met hors de portée d’un script de la page`);

  const valeur = biscuit.slice('session='.length).split(';')[0];
  check(!biscuit.includes(JETON) && !Buffer.from(valeur.split('.')[1], 'base64url').toString('utf8').includes(JETON),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le jeton n’est PAS en clair dans le cookie — un cookie seulement signé le promènerait à chaque requête et dans les journaux du moindre mandataire');
  check(ouvrirJeton(SECRET, valeur) === JETON, 'et le serveur, lui, le retrouve intact');

  check(ouvrirJeton(SECRET, scellerJeton(SECRET, JETON, Date.now() - 1000)) === null, 'un cookie périmé ne rend rien');
  check(ouvrirJeton('y'.repeat(48), valeur) === null, 'un cookie scellé avec une autre clé ne rend rien');
  check(ouvrirJeton('trop-court', valeur) === null, 'une clé trop courte ne descelle rien — la configuration bâclée ferme la porte, elle ne l’ouvre pas');
  const [iv, chiffre, sceau] = valeur.split('.');
  check(ouvrirJeton(SECRET, `${iv}.${chiffre.slice(0, -2)}AA.${sceau}`) === null,
    'un chiffre retouché est rejeté par le sceau AES-GCM, pas déchiffré en n’importe quoi');
  check(ouvrirJeton(SECRET, `${iv}.${chiffre}`) === null && ouvrirJeton(SECRET, 'nimportequoi') === null && ouvrirJeton(SECRET, null) === null,
    'un cookie bricolé est un refus ordinaire, jamais une exception');

  const vivante = await handlerSession({ env: ENV })(requete('/api/session', { methode: 'GET', cookie: cookieValide() }));
  check((await vivante.json()).ouverte === true, 'la page sait que la session est ouverte sans jamais revoir le jeton');
  check((await (await handlerSession({ env: ENV })(requete('/api/session', { methode: 'GET' }))).json()).ouverte === false,
    'et qu’elle est fermée quand il n’y a pas de cookie');

  const sortie = await handlerSession({ env: ENV })(requete('/api/session', { methode: 'DELETE' }));
  check(/Max-Age=0/.test(sortie.headers.get('set-cookie')), 'fermer la session efface le cookie');
  check((await handlerSession({ env: ENV })(requete('/api/session', { methode: 'PUT' }))).status === 405, 'une autre méthode est refusée');

  const ailleurs = (await avecJournal(() => handlerSession({ env: ENV, fetch: sonde.fetch })(
    requete('/api/session', { corps: { jeton: JETON }, origine: 'https://evil.example' })))).resultat;
  check(ailleurs.status === 403, 'une requête venue d’une autre origine est refusée');
}

// ── UN SERVICE INJOIGNABLE N'EST PAS UN JETON REFUSÉ.
//
// Confondre les deux enverrait quelqu'un chercher une faute dans un jeton parfaitement valide pendant
// que la base est en panne.
{
  for (const [cas, reseau] of [
    ['réseau coupé', async () => { throw new TypeError('fetch failed'); }],
    ['délai dépassé', async () => { const e = new Error('expiré'); e.name = 'TimeoutError'; throw e; }],
    ['service en 503', async () => new Response('{}', { status: 503 })],
  ]) {
    const { resultat } = await avecJournal(() => handlerSession({ env: ENV, fetch: reseau })(
      requete('/api/session', { corps: { jeton: JETON } })));
    check(resultat.status === 503, `C’EST LA PROPRIÉTÉ QUI COMPTE : ${cas} → 503, surtout pas 401`);
    check(/momentanément indisponible/.test((await resultat.json()).erreur), `${cas} dit « revenez », pas « votre jeton est faux »`);
    check(!resultat.headers.get('set-cookie'), `${cas} n’ouvre aucune session`);
  }
  check((await sonderJeton({ fetch: async () => new Response('{}', { status: 400 }), url: 'https://x', jeton: JETON })).reconnu === true,
    'un 400 — « aucune URL exploitable » — prouve que l’authentification est passée : le jeton est reconnu');
  check((await sonderJeton({ fetch: async () => new Response('{}', { status: 401 }), url: 'https://x', jeton: JETON })).reconnu === false,
    'et seul un 401 prouve le contraire');
  // SEUL LE 400 VAUT RECONNAISSANCE. Relevé par une revue adverse : accepter « tout sauf 401 et 503 »
  // laissait un 502 de passerelle ouvrir une session qui ne pouvait rien créer.
  for (const statut of [200, 404, 500, 502, 504]) {
    const r = await sonderJeton({ fetch: async () => new Response('{}', { status: statut }), url: 'https://x', jeton: JETON });
    check(r.indisponible === true && r.reconnu !== true,
      `C’EST LA PROPRIÉTÉ QUI COMPTE : un ${statut} ne prouve aucune authentification — il dit « revenez », il n’ouvre pas une session qui ne pourrait rien créer`);
  }
  check(trierUrls([]).retenus.length === 0,
    'et la sonde repose bien sur le module réel : une liste vide ne retient aucune URL, donc le service répond 400 avant tout chargement');
}

// ── LA CONFIGURATION INCOMPLÈTE FERME LA PORTE. Sans clé de scellement, le repli naturel serait de
//    poser le jeton en clair dans le cookie : exactement ce qu'on refuse.
{
  for (const [cas, env] of [['aucune variable', {}], ['clé trop courte', { INTERFACE_SECRET_SESSION: 'court' }]]) {
    const sonde = sondeur(400);
    const { resultat } = await avecJournal(() => handlerSession({ env, fetch: sonde.fetch })(
      requete('/api/session', { corps: { jeton: JETON } })));
    check(resultat.status === 503, `C’EST LA PROPRIÉTÉ QUI COMPTE : ${cas} → 503, pas une porte ouverte`);
    check(!resultat.headers.get('set-cookie'), `${cas} ne pose aucun cookie`);
    check(sonde.appels.length === 0, `${cas} n’appelle même pas le service`);
  }
}

// ── SANS SESSION, LE SERVICE N'EST PAS APPELÉ. La propriété centrale.
{
  for (const [cas, options] of [
    ['aucun cookie', {}],
    ['cookie bricolé', { cookie: 'session=faux.faux' }],
    ['cookie périmé', { cookie: cookieValide(-1000) }],
  ]) {
    const service = serviceFeint({ corps: { links: [LIEN_COMPLET], rejected: [] } });
    const r = await handlerCreer({ env: ENV, fetch: service.fetch })(requete('/api/creer', { corps: { adresses: URL_OK }, ...options }));
    check(r.status === 403, `${cas} → 403, et l’interface redemande le mot de passe`);
    check(service.appels.length === 0, `C’EST LA PROPRIÉTÉ QUI COMPTE : ${cas} → le service n’est PAS appelé (zéro appel sortant)`);
  }
  const service = serviceFeint({ corps: { links: [LIEN_COMPLET], rejected: [] } });
  const ailleurs = (await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
    requete('/api/creer', { corps: { adresses: URL_OK }, cookie: cookieValide(), origine: 'https://evil.example' })))).resultat;
  check(ailleurs.status === 403 && service.appels.length === 0, 'une requête venue d’ailleurs, même avec un cookie valide, n’appelle pas le service');
  check((await handlerCreer({ env: ENV, fetch: service.fetch })(requete('/api/creer', { methode: 'GET' }))).status === 405,
    'une méthode autre que POST est refusée');
}

// ── LE JETON NE SORT NI DANS LA RÉPONSE, NI DANS UN JOURNAL.
{
  const service = serviceFeint({ corps: { links: [LIEN_COMPLET, LIEN_APERCU], rejected: [{ url: URL_RETIREE, erreur: 'lien retiré : rouvrir withdrawn_at à la main, délibérément' }], client: 'interface-web' } });
  const { resultat, lignes } = await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
    requete('/api/creer', { corps: { adresses: `${URL_OK}\n${URL_OK2}\n${URL_RETIREE}\nhttps://www.lexpress.fr/a_12.html`, jours: 20 }, cookie: cookieValide() })));
  const brut = await resultat.text();

  check(!brut.includes(JETON), 'C’EST LA PROPRIÉTÉ QUI COMPTE : le jeton de service n’apparaît pas dans la réponse');
  check(lignes.every((l) => !l.includes(JETON)), 'ni dans une ligne de journal');
  check(lignes.every((l) => !l.includes(ENV.INTERFACE_MOT_DE_PASSE)), 'le mot de passe de l’équipe non plus');
  check(lignes.every((l) => !l.includes(LIEN_COMPLET.token)), 'ET LE JETON D’UN LIEN NON PLUS : il EST l’accès à l’article premium, l’écrire dans un journal reviendrait à déposer la clé à côté de la porte');
  check(lignes.every((l) => { try { return typeof JSON.parse(l).evenement === 'string'; } catch { return false; } }),
    'chaque ligne de journal est un JSON filtrable sur `evenement`');

  // Ce qui part vers le service : les clés acceptées, et rien d'autre.
  check(service.appels.length === 1, 'un seul appel sortant pour un lot');
  check(service.appels[0].url === API_PAR_DEFAUT, 'l’appel part vers la fonction de création');
  check(service.appels[0].entetes['x-gift-service-token'] === JETON, 'le jeton voyage dans l’en-tête prévu, côté serveur seulement');
  check(service.appels[0].entetes['x-gift-service-token'] !== JETON_LEURRE && !brut.includes(JETON_LEURRE),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le jeton posé dans l’environnement du déploiement N’EST PAS employé — c’est celui de la personne qui part, donc `gift_links_by_client` la nomme et on peut la couper seule');
  const envoye = service.appels[0].corps;
  check(Object.keys(envoye).every((c) => CLES_ACCEPTEES.includes(c)),
    'le corps envoyé n’emploie QUE les clés acceptées par le service — une clé inconnue est un refus, pas un haussement d’épaules');
  check(envoye.expires_in_days === 20, 'la durée demandée est transmise telle quelle');
  check(envoye.urls.length === 3 && !envoye.urls.some((u) => u.includes('_12.html')),
    'l’adresse manifestement inexploitable n’est pas envoyée : un refus immédiat plutôt qu’un chargement d’article pour rien');
  check(envoye.urls.includes(URL_RETIREE),
    'en revanche une adresse de forme valide EST envoyée : seule la base sait qu’un article a été retiré, et l’interface ne doit pas le deviner');

  const d = JSON.parse(brut);
  check(d.resume.demandes === 4 && d.resume.obtenus === 2 && d.resume.refuses === 2 && d.resume.apercus === 1,
    'le résumé compte les trois issues séparément');
  check(d.refuses.length === 2, 'les refus de l’interface et ceux du service sont réunis dans une seule liste — un refus n’est jamais perdu en route');
  check(d.client === 'interface-web', 'le service appelant est nommé');
  check(d.liens[0].titre === 'A lyon lecole des chartreux' && d.liens[0].lien === LIEN_COMPLET.link,
    'chaque lien porte un libellé lisible tiré de l’adresse');
  check(typeof d.liens[0].valableJusquau === 'string' && d.liens[0].valableJusquau.includes('2026'),
    'et une date de fin écrite en français');
  check(d.refuses[0].explication && /trop ancien/.test(d.refuses[0].explication), 'un refus est traduit en français');
  check(/décision éditoriale/.test(d.refuses[1].explication), 'et le refus venu du service est traduit lui aussi');
  check(d.refuses[0].motif === 'ancien format sans identifiant Arc : /a_12.html',
    'LE MOTIF BRUT RESTE JOINT : une traduction qui avale l’original rend le diagnostic impossible le jour où le service renvoie un motif inconnu d’ici');
}

// ── DEUX PERSONNES, DEUX JETONS. L'attribution ne vaut que si elle distingue.
{
  const vus = [];
  for (const jeton of [JETON, JETON_AUTRE]) {
    const service = serviceFeint({ corps: { links: [LIEN_COMPLET], rejected: [] } });
    await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
      requete('/api/creer', { corps: { adresses: URL_OK }, cookie: cookieValide(3600_000, jeton) })));
    vus.push(service.appels[0].entetes['x-gift-service-token']);
  }
  check(vus[0] === JETON && vus[1] === JETON_AUTRE && vus[0] !== vus[1],
    'C’EST LA PROPRIÉTÉ QUI COMPTE : deux sessions ouvertes avec deux jetons appellent le service avec deux jetons — sinon tous les liens porteraient le même nom');
}

// ── L'APERÇU : UN 200 QUI EST POURTANT UN ÉCHEC.
{
  const service = serviceFeint({ corps: { links: [LIEN_APERCU], rejected: [] } });
  const { resultat, lignes } = await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
    requete('/api/creer', { corps: { adresses: URL_OK2 }, cookie: cookieValide() })));
  const d = await resultat.json();
  check(resultat.status === 200, 'le service a répondu 200 : l’appel a techniquement réussi');
  check(d.liens[0].apercu === true, 'et pourtant le lien est signalé comme aperçu');
  check(/n'ouvre PAS l'article/.test(d.liens[0].avertissement), 'C’EST LA PROPRIÉTÉ QUI COMPTE : l’avertissement dit que le lecteur verra le mur d’abonnement, pas une phrase vague');
  check(/Ne le diffusez pas/.test(d.liens[0].avertissement), 'et il dit quoi faire : ne pas diffuser');
  check(lignes.some((l) => JSON.parse(l).evenement === 'apercu_seulement'),
    'l’événement porte le même nom que côté fonction Edge — un lien vers le mur d’abonnement est un échec des deux côtés');
  check(JSON.parse(lignes.find((l) => JSON.parse(l).evenement === 'apercu_seulement')).adresses[0] === URL_OK2,
    'et il nomme l’adresse, qui est publique');
  check(d.liens[0].etatPhrase === 'Durée prolongée' && /MÊME lien/.test(d.liens[0].etatDetail),
    'un lien prolongé explique qu’il s’agit du même lien qu’avant');
}

// ── UNE PANNE N'EST PAS UN REFUS D'ARTICLE.
//
// La page de lecture a affiché « cet article n'est plus disponible » pendant des jours pour une simple
// coupure réseau : un échec technique déguisé en décision éditoriale, et un diagnostic impossible.
{
  for (const [statut, forme] of [[503, /momentanément indisponible/], [500, /Rien n'a été diffusé/], [502, /n'a pu être chargé/]]) {
    const service = serviceFeint({ statut, corps: { error: 'motif technique du service' } });
    const { resultat } = await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
      requete('/api/creer', { corps: { adresses: URL_OK }, cookie: cookieValide() })));
    const d = await resultat.json();
    check(resultat.status === statut, `un ${statut} du service reste un ${statut} pour la page`);
    check(forme.test(d.panne), `et son message est celui du cas ${statut} : ${JSON.stringify(d.panne)}`);
    check(d.liens.length === 0, `aucun lien n’est inventé sur un ${statut}`);
    check(d.detail === 'motif technique du service', `le motif du service reste joint pour le diagnostic (${statut})`);
  }
  // LE JETON RÉVOQUÉ PENDANT LA SESSION. Le cookie ne vaut plus rien : le garder laisserait la
  // personne recliquer sur un bouton qui ne peut plus rien produire.
  {
    const service = serviceFeint({ statut: 401, corps: { error: 'non autorisé' } });
    const { resultat } = await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
      requete('/api/creer', { corps: { adresses: URL_OK }, cookie: cookieValide() })));
    const d = await resultat.json();
    check(resultat.status === 403, 'C’EST LA PROPRIÉTÉ QUI COMPTE : un jeton révoqué en cours de session renvoie à l’écran du jeton, il ne fait pas croire à une panne');
    check(/Max-Age=0/.test(resultat.headers.get('set-cookie') ?? ''), 'et la session est effacée sur-le-champ');
    check(/révoqué/.test(d.erreur) && /n'est pas votre adresse/.test(d.erreur),
      'le message nomme la cause et dit que l’adresse demandée n’y est pour rien — sinon la personne cherche la faute dans sa propre demande');
  }

  const injoignable = { fetch: async () => { throw new TypeError('fetch failed'); } };
  const r = await avecJournal(() => handlerCreer({ env: ENV, fetch: injoignable.fetch })(
    requete('/api/creer', { corps: { adresses: URL_OK }, cookie: cookieValide() })));
  check(r.resultat.status === 503 && /réessayez/.test((await r.resultat.json()).panne),
    'le service injoignable donne un message qui dit « revenez », pas « votre article est refusé »');

  const expire = { fetch: async () => { const e = new Error('expiré'); e.name = 'TimeoutError'; throw e; } };
  const t = await avecJournal(() => handlerCreer({ env: ENV, fetch: expire.fetch })(
    requete('/api/creer', { corps: { adresses: URL_OK }, cookie: cookieValide() })));
  check(t.resultat.status === 504 && /moins d'adresses/.test((await t.resultat.json()).panne),
    'un dépassement de délai propose de réduire le lot au lieu d’afficher une erreur de plateforme');
}

// ── CE QUE L'INTERFACE REFUSE ELLE-MÊME, SANS DÉPENSER D'APPEL.
{
  const faire = async (corps) => {
    const service = serviceFeint({ corps: { links: [LIEN_COMPLET], rejected: [] } });
    const { resultat } = await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
      requete('/api/creer', { corps, cookie: cookieValide() })));
    return { d: await resultat.json(), statut: resultat.status, appels: service.appels.length };
  };

  const vide = await faire({ adresses: '   \n  ' });
  check(vide.statut === 400 && vide.appels === 0, 'une demande vide est refusée sans appeler le service');

  const trop = await faire({ adresses: Array.from({ length: MAX_ADRESSES + 1 }, (_, i) => `https://www.lexpress.fr/x/a-${'A'.repeat(25)}${i}`).join('\n') });
  check(trop.statut === 400 && trop.appels === 0 && new RegExp(`${MAX_ADRESSES} au maximum`).test(trop.d.erreur),
    `le plafond de ${MAX_ADRESSES} adresses est dit par le serveur, pas seulement par la page — une limite qui ne vit que dans le navigateur se contourne en rechargeant`);

  for (const jours of [0, -1, 400, 1.5, 'abc']) {
    const r = await faire({ adresses: URL_OK, jours });
    check(r.statut === 400 && r.appels === 0, `une durée de ${JSON.stringify(jours)} est refusée avant tout appel`);
  }
  const defaut = await faire({ adresses: URL_OK });
  check(defaut.statut === 200, 'sans durée précisée, la demande passe (quinze jours par défaut, côté service)');

  const aucune = await faire({ adresses: 'https://example.com/x\nhttps://www.lexpress.fr/vieux_1.html' });
  check(aucune.statut === 400 && aucune.appels === 0, 'aucune adresse exploitable : refus immédiat, zéro appel');
  check(aucune.d.refuses.length === 2 && aucune.d.refuses.every((r) => r.explication),
    'et chaque adresse reçoit sa propre explication — jamais un « ça ne marche pas » global');
  check(/aucune des adresses/i.test(aucune.d.panne), 'avec une phrase qui dit ce qui s’est passé');
}

// ── LE DÉCOUPAGE DE CE QU'ON COLLE. Une adresse ne contient jamais d'espace : tout blanc sépare.
{
  check(decouperAdresses(`${URL_OK}\n  ${URL_OK2}  \n\n`).length === 2, 'les lignes vides et les espaces sont ignorés');
  check(decouperAdresses(`${URL_OK} ${URL_OK2}`).length === 2, 'deux adresses collées sur une même ligne sont séparées');
  check(decouperAdresses(`${URL_OK}\n${URL_OK}`).length === 1, 'une adresse en double ne compte qu’une fois');
  check(decouperAdresses([URL_OK, URL_OK2]).length === 2, 'un tableau est accepté aussi bien qu’un texte');
  check(decouperAdresses(null).length === 0 && decouperAdresses(42).length === 0, 'et n’importe quoi d’autre donne une liste vide, pas une exception');
}

// ── LES TRADUCTIONS. Chaque motif que le service sait produire a sa phrase.
{
  for (const motif of [
    'ancien format sans identifiant Arc : /x_1.html',
    'aucun identifiant Arc dans l’URL : /politique',
    'domaine inattendu : example.com',
    'protocole refusé : http:',
    'port refusé : 8443',
    'url illisible : xxx',
    'url vide',
    'lien retiré : rouvrir withdrawn_at à la main, délibérément',
    'page injoignable (404)',
    'redirection hors domaine : ailleurs.fr',
    'page vide',
    'aucun titre dans la page',
  ]) check(typeof expliquer(motif) === 'string', `le motif « ${motif} » a une phrase en français`);
  check(expliquer('un motif que personne n’a encore écrit') === null,
    'un motif inconnu rend null — l’interface affiche alors le motif brut plutôt qu’une phrase inventée');
  check(/décision éditoriale/.test(expliquer('lien retiré : …')),
    'le retrait dit que rouvrir est une décision éditoriale, pas un bouton de cette page');
  check(TRADUCTIONS.length >= 12, 'les traductions couvrent les motifs connus du service');
}

// ── LA MISE EN FRANÇAIS.
{
  check(titreDepuisAdresse(URL_OK) === 'A lyon lecole des chartreux', 'l’identifiant Arc est retiré du libellé');
  check(rubriqueDepuisAdresse(URL_OK) === 'societe › religion', 'la rubrique se lit dans le chemin');
  check(titreDepuisAdresse('pas une url') === 'pas une url', 'une adresse illisible est rendue telle quelle, pas remplacée par du vide');
  check(rubriqueDepuisAdresse('https://www.lexpress.fr/a-XXXXXXXXXXXXXXXXXXXXXXXXXX') === null, 'et une adresse sans rubrique n’en invente pas');

  const dans3j = formaterEcheance(new Date(Date.now() + 3 * 86400000).toISOString());
  check(dans3j.jours === 3 && /20\d\d/.test(dans3j.texte), 'l’échéance est datée en clair et comptée en jours');
  const dans6h = formaterEcheance(new Date(Date.now() + 6 * 3600000).toISOString());
  check(dans6h.jours === 1, 'un lien qui expire dans six heures reste « valable aujourd’hui » — un compte à rebours faux-ami pousse à recréer un lien qui marche encore');
  check(formaterEcheance('pas une date').texte === null, 'une date illisible ne produit pas « Invalid Date »');
  check(/même lien/i.test(decrireEtat('extended').detail) && /jamais/.test(decrireEtat('unchanged').detail),
    'les trois états expliquent ce qui s’est passé, pas seulement leur nom');
  check(decrireEtat('etat_inconnu').phrase === 'Lien disponible', 'un état inconnu ne casse pas l’affichage');
}

// ── LE NAVIGATEUR NE DOIT RIEN SAVOIR, ET RIEN INTERPRÉTER.
{
  const page = readFileSync('./public/index.html', 'utf8');
  const script = readFileSync('./public/interface.js', 'utf8');
  const style = readFileSync('./public/interface.css', 'utf8');
  const adaptateurCreer = readFileSync('./api/creer.mjs', 'utf8');
  const config = JSON.parse(readFileSync('./vercel.json', 'utf8'));

  for (const [ou, contenu] of [['la page', page], ['le script', script], ['la feuille de style', style]]) {
    check(!/GIFT_SERVICE_TOKEN|x-gift-service-token/.test(contenu), `C’EST LA PROPRIÉTÉ QUI COMPTE : ${ou} ne nomme même pas le jeton de service`);
    check(!/supabase\.co|INTERFACE_SECRET_SESSION|INTERFACE_CLE_ACCES/.test(contenu), `${ou} ne connaît ni la base ni les secrets du déploiement`);
  }
  // On regarde le CODE, pas les commentaires : ce fichier-ci explique justement pourquoi `innerHTML`
  // est proscrit, et un test qui ne sait pas distinguer les deux interdirait de l’écrire.
  const codeSeul = script.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  check(!/localStorage|sessionStorage|document\.cookie/.test(codeSeul),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le script ne range le jeton nulle part — ni en mémoire du navigateur, ni dans un cookie qu’il pourrait relire. Il le poste une fois, le serveur le scelle, et la page ne le revoit jamais');
  check(/value = ''/.test(codeSeul), 'et il vide le champ de saisie : un jeton ne reste pas affiché dans une page ouverte');
  check(/!depart\.acces \? 'acces'/.test(codeSeul),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : au chargement, le rideau passe AVANT la session — les deux cookies n’ont pas la même durée de vie, et sans cette priorité la page montrerait le formulaire à quelqu’un dont chaque demande sera refusée');
  check(/ferme\('\/api\/session'\)/.test(codeSeul) && /ferme\('\/api\/acces'\)/.test(codeSeul),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : « Fermer la session » referme AUSSI le rideau — sinon, sur un poste partagé, le suivant est dispensé de la clé');
  check(/if \(!session \|\| !rideau\)[\s\S]{0,400}return;/.test(codeSeul),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : une déconnexion qui échoue est DITE, et la page ne bascule pas — l’afficher sans l’avoir obtenue ferait partir quelqu’un rassuré à tort, en laissant sa session ouverte au suivant');
  check(/\.ok/.test(codeSeul), 'et c’est la réponse du serveur qui en décide, pas l’absence d’exception');
  check(!/etape === 'demande'[\s\S]{0,200}localStorage/.test(codeSeul), 'et la page ne mémorise aucune étape franchie de son côté : c’est le serveur qui la dit');
  check(!/innerHTML|insertAdjacentHTML|document\.write/.test(codeSeul),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le script n’insère aucun HTML — les libellés affichés viennent de ce que la personne a collé, et `textContent` ne les interprète pas');
  check(/textContent/.test(codeSeul), 'il remplit `textContent`, ce qui échappe tout seul');
  check(!/<script>|<script >/.test(page) && !/onclick=|onsubmit=/.test(page),
    'aucun script en ligne dans la page — la politique de sécurité du contenu peut rester stricte');
  check(/script-src 'self'/.test(config.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value),
    'et la politique de sécurité du contenu n’autorise que les scripts du site');
  check(/frame-ancestors 'none'/.test(config.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value),
    'la page ne peut pas être enchâssée dans un autre site');

  const adaptateurAcces = readFileSync('./api/acces.mjs', 'utf8');
  check(adaptateurAcces.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length <= 4,
    'l’adaptateur du rideau ne contient aucune logique non plus');
  check(/process\.env/.test(adaptateurCreer) && /handlerCreer/.test(adaptateurCreer),
    'l’adaptateur Vercel branche l’environnement sur le handler testé');
  check(adaptateurCreer.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length <= 4,
    'C’EST LA PROPRIÉTÉ QUI COMPTE : l’adaptateur ne contient AUCUNE logique — sinon la plateforme exécuterait du code que ce fichier ne teste pas');

  // Les règles ne sont pas recopiées : elles sont importées du service lui-même.
  const handlers = readFileSync('./interface/handlers.mjs', 'utf8');
  check(/_shared\/arc-id\.mjs/.test(handlers) && /_shared\/corps\.mjs/.test(handlers),
    'les handlers importent les règles du service, ils ne les réécrivent pas');
  check(!/\[A-Z0-9\]\{26\}/.test(handlers) && !/expires_in_days doit/.test(handlers),
    'aucune règle du service n’est recopiée ici — une copie finit par diverger, et c’est l’utilisateur qui paie la différence');
  check(config.functions['api/*.mjs'].maxDuration >= 30,
    'les fonctions ont le temps de charger plusieurs articles avant que la plateforme ne coupe');
}

console.log(`interface web (liens offerts) : ${n} vérifications passées.`);
