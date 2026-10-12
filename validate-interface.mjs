// L'interface web : ce qu'elle refuse, et ce qu'elle ne laisse jamais filtrer.
//
// Deux propriétés valent le test avant toute question d'ergonomie.
//
// LA PREMIÈRE : SANS SESSION, LE SERVICE N'EST PAS APPELÉ. Pas « l'appel échoue » — PAS APPELÉ. Derrière
// cette page, un bouton fabrique des accès complets à des articles payants ; une URL Vercel est publique.
// Le test compte les appels sortants et exige zéro.
//
// LA SECONDE : LE JETON DE SERVICE NE DESCEND JAMAIS DANS LE NAVIGATEUR, ni dans une réponse, ni dans un
// journal. C'est la raison d'être des fonctions serveur : la page parle à `/api/creer`, et `/api/creer`
// seul connaît le jeton.
//
// Les handlers sont écrits en `fetch(Request) → Response` justement pour que ce fichier puisse les
// EXÉCUTER sous Node, sans la plateforme. Des contrôles qu'aucun test n'exécute ne prouvent rien : on a
// déjà découvert qu'on pouvait désactiver une authentification sans qu'une seule assertion bronche.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlerCreer, handlerSession, decouperAdresses, MAX_ADRESSES, API_PAR_DEFAUT } from './interface/handlers.mjs';
import { enteteSession, motDePasseValide, sessionValide, signerSession, lireCookie, origineAcceptable } from './interface/session.mjs';
import { expliquer, expliquerPanne, TRADUCTIONS } from './interface/motifs.mjs';
import { titreDepuisAdresse, rubriqueDepuisAdresse, decrireEtat, formaterEcheance } from './interface/presentation.mjs';
import { CLES_ACCEPTEES } from './gift-links/functions/_shared/corps.mjs';

let n = 0; const check = (c, l) => { assert.ok(c, l); n++; };

const JETON = 'jeton-de-service-de-test-jamais-reel';
const SECRET = 'x'.repeat(48);
const ENV = { INTERFACE_SECRET_SESSION: SECRET, INTERFACE_MOT_DE_PASSE: 'motdepasse-equipe-2026', GIFT_SERVICE_TOKEN: JETON };
const URL_OK = 'https://www.lexpress.fr/societe/religion/a-lyon-lecole-des-chartreux-XGLQ6NY6CJD6LLBLBBMEF7A2V4';
const URL_OK2 = 'https://www.lexpress.fr/politique/elections/en-2027-faut-il-mentir-RQOLMEM5NZE3BNTWPJEEGC5B5Y';

const cookieValide = (decalageMs = 3600_000) => `session=${signerSession(SECRET, Date.now() + decalageMs)}`;

const requete = (chemin, { methode = 'POST', corps, cookie, origine } = {}) => new Request(`https://liens.lexpress.fr${chemin}`, {
  method: methode,
  headers: {
    'content-type': 'application/json',
    ...(cookie ? { cookie } : {}),
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

// ── LA PORTE. Un mot de passe partagé, un cookie signé.
{
  const ouvrir = handlerSession({ env: ENV });

  const sansCookie = await (await ouvrir(requete('/api/session', { methode: 'GET' }))).json();
  check(sansCookie.ouverte === false, 'sans cookie, la session est fermée');

  const refus = (await avecJournal(() => ouvrir(requete('/api/session', { corps: { motDePasse: 'motdepasse-equipe-2025' } })))).resultat;
  check(refus.status === 401, 'un mot de passe faux reçoit 401');
  check(!refus.headers.get('set-cookie'), 'et aucun cookie n’est posé');

  const ok = await ouvrir(requete('/api/session', { corps: { motDePasse: ENV.INTERFACE_MOT_DE_PASSE } }));
  const biscuit = ok.headers.get('set-cookie');
  check(ok.status === 200 && (await ok.json()).ouverte === true, 'le bon mot de passe ouvre la session');
  for (const attribut of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'])
    check(biscuit.includes(attribut), `le cookie porte ${attribut} — HttpOnly le met hors de portée d’un script de la page`);
  check(!biscuit.includes(ENV.INTERFACE_MOT_DE_PASSE), 'C’EST LA PROPRIÉTÉ QUI COMPTE : le mot de passe n’est pas recopié dans le cookie');

  const valeur = biscuit.slice('session='.length).split(';')[0];
  check(sessionValide(SECRET, valeur), 'le cookie rendu est accepté à la requête suivante');
  check(!sessionValide(SECRET, valeur.slice(0, -2) + 'zz'), 'une signature modifiée est refusée');
  check(!sessionValide(SECRET, signerSession('un-autre-secret-de-quarante-huit-caracteres-xx', Date.now() + 1000)),
    'un cookie signé avec un autre secret est refusé');
  check(!sessionValide(SECRET, signerSession(SECRET, Date.now() - 1000)), 'un cookie périmé est refusé');
  check(!sessionValide(SECRET, 'nimportequoi') && !sessionValide(SECRET, null) && !sessionValide(SECRET, 'a.b'),
    'un cookie bricolé est un refus ordinaire, jamais une exception');
  check(!sessionValide('trop-court', valeur), 'un secret trop court ne valide rien — la configuration bâclée ferme la porte, elle ne l’ouvre pas');

  const sortie = await ouvrir(requete('/api/session', { methode: 'DELETE' }));
  check(/Max-Age=0/.test(sortie.headers.get('set-cookie')), 'fermer la session efface le cookie');

  check((await ouvrir(requete('/api/session', { methode: 'PUT' }))).status === 405, 'une autre méthode est refusée');
  const ailleurs = (await avecJournal(() => ouvrir(requete('/api/session', { corps: { motDePasse: ENV.INTERFACE_MOT_DE_PASSE }, origine: 'https://evil.example' })))).resultat;
  check(ailleurs.status === 403, 'une requête venue d’une autre origine est refusée');
  check((await ouvrir(requete('/api/session', { corps: { motDePasse: ENV.INTERFACE_MOT_DE_PASSE }, origine: 'https://liens.lexpress.fr' }))).status === 200,
    'et la même origine passe');
}

// ── LA CONFIGURATION INCOMPLÈTE FERME LA PORTE. Le repli naturel — « pas de mot de passe configuré,
//    donc pas de contrôle » — publierait l'interface au premier déploiement mal réglé.
{
  for (const [cas, env] of [
    ['aucune variable', {}],
    ['secret de session trop court', { INTERFACE_SECRET_SESSION: 'court', INTERFACE_MOT_DE_PASSE: 'motdepasse-equipe-2026' }],
    ['mot de passe trop court', { INTERFACE_SECRET_SESSION: SECRET, INTERFACE_MOT_DE_PASSE: 'court' }],
  ]) {
    const { resultat } = await avecJournal(() => handlerSession({ env })(requete('/api/session', { corps: { motDePasse: 'court' } })));
    check(resultat.status === 503, `C’EST LA PROPRIÉTÉ QUI COMPTE : ${cas} → 503, pas une porte ouverte`);
    check(!resultat.headers.get('set-cookie'), `${cas} ne pose aucun cookie`);
  }
  check(motDePasseValide('', '') === false, 'un mot de passe vide ne correspond jamais à une configuration vide');
  check(motDePasseValide('court', 'court') === false, 'un mot de passe de moins de douze caractères est refusé côté configuration');
  check(motDePasseValide('motdepasse-equipe-2026', 'motdepasse-equipe-2026'), 'et un mot de passe correct passe');
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
  for (const [statut, forme] of [[503, /momentanément indisponible/], [500, /Rien n'a été diffusé/], [502, /n'a pu être chargé/], [401, /administre/]]) {
    const service = serviceFeint({ statut, corps: { error: 'motif technique du service' } });
    const { resultat } = await avecJournal(() => handlerCreer({ env: ENV, fetch: service.fetch })(
      requete('/api/creer', { corps: { adresses: URL_OK }, cookie: cookieValide() })));
    const d = await resultat.json();
    check(resultat.status === statut, `un ${statut} du service reste un ${statut} pour la page`);
    check(forme.test(d.panne), `et son message est celui du cas ${statut} : ${JSON.stringify(d.panne)}`);
    check(d.liens.length === 0, `aucun lien n’est inventé sur un ${statut}`);
    check(d.detail === 'motif technique du service', `le motif du service reste joint pour le diagnostic (${statut})`);
  }
  check(/administre/.test(expliquerPanne(401)) && /n'est pas votre adresse/.test(expliquerPanne(401)),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : un 401 dit explicitement que l’adresse de l’utilisateur n’est pas en cause, et vers qui se tourner — sinon la personne cherche l’erreur dans sa propre demande');

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
    check(!/supabase\.co|INTERFACE_MOT_DE_PASSE|INTERFACE_SECRET_SESSION/.test(contenu), `${ou} ne connaît ni la base ni les secrets`);
  }
  // On regarde le CODE, pas les commentaires : ce fichier-ci explique justement pourquoi `innerHTML`
  // est proscrit, et un test qui ne sait pas distinguer les deux interdirait de l’écrire.
  const codeSeul = script.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  check(!/innerHTML|insertAdjacentHTML|document\.write/.test(codeSeul),
    'C’EST LA PROPRIÉTÉ QUI COMPTE : le script n’insère aucun HTML — les libellés affichés viennent de ce que la personne a collé, et `textContent` ne les interprète pas');
  check(/textContent/.test(codeSeul), 'il remplit `textContent`, ce qui échappe tout seul');
  check(!/<script>|<script >/.test(page) && !/onclick=|onsubmit=/.test(page),
    'aucun script en ligne dans la page — la politique de sécurité du contenu peut rester stricte');
  check(/script-src 'self'/.test(config.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value),
    'et la politique de sécurité du contenu n’autorise que les scripts du site');
  check(/frame-ancestors 'none'/.test(config.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value),
    'la page ne peut pas être enchâssée dans un autre site');

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
