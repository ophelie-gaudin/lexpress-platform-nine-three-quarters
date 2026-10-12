// Les deux fonctions serveur de l'interface. Écrites comme des handlers `fetch(Request) → Response` :
// c'est le format que Vercel accepte tel quel, ET celui que Node 22 sait exécuter sans rien installer,
// donc celui qui se teste pour de vrai. Les contrôles d'un handler qu'aucun test n'exécute ne prouvent
// rien — on a déjà découvert qu'on pouvait désactiver une authentification sans qu'une assertion bronche.
//
// LES RÈGLES NE SONT PAS RECOPIÉES ICI. `trierUrls` et `dureeDemandee` sont les modules que la fonction
// Edge exécute elle-même. Une interface qui refait sa propre validation finit par accepter ce que le
// service refuse, ou l'inverse — et c'est l'utilisateur qui paie la différence.
import { trierUrls } from '../gift-links/functions/_shared/arc-id.mjs';
import { dureeDemandee } from '../gift-links/functions/_shared/corps.mjs';
import { expliquer, expliquerPanne } from './motifs.mjs';
import { AVERTISSEMENT_APERCU, decrireEtat, formaterEcheance, rubriqueDepuisAdresse, titreDepuisAdresse } from './presentation.mjs';
import {
  DUREE_SESSION_S, FORME_JETON, enteteDeconnexion, enteteSession, lireCookie,
  origineAcceptable, ouvrirJeton, scellerJeton,
} from './session.mjs';
import {
  DUREE_ACCES_S, LONGUEUR_MIN_CLE, accesValide, attenteBrouillage, cleValide,
  enteteAcces, enteteFinAcces, signerAcces,
} from './acces.mjs';

export const API_PAR_DEFAUT = 'https://ovifzentveeehhtlnugk.supabase.co/functions/v1/create-gift-links';

/**
 * DIX ADRESSES PAR DEMANDE. Chaque adresse déclenche un chargement d'article ; au-delà, la fonction
 * dépasse le temps imparti et l'utilisateur reçoit une erreur de plateforme illisible plutôt qu'un
 * refus qui s'explique. Le plafond est dit à l'avance, et il est dit par le serveur : une limite qui ne
 * vit que dans le navigateur se contourne en rechargeant la page.
 */
export const MAX_ADRESSES = 10;

/** Au-delà, on rend un 504 nous-mêmes : un message net vaut mieux qu'une coupure de la plateforme. */
const DELAI_SERVICE_MS = 25_000;

// Ni mot de passe, ni jeton de service, ni jeton de lien. Le jeton d'un lien EST l'accès à l'article :
// l'écrire dans un journal reviendrait à déposer la clé à côté de la porte. On nomme les adresses, qui
// sont publiques.
const journal = (niveau, evenement, details = {}) => {
  const ligne = JSON.stringify({ fn: 'interface-liens-offerts', evenement, ...details });
  if (niveau === 'error') console.error(ligne);
  else console.warn(ligne);
};

const json = (corps, status = 200, entetes = {}) => new Response(JSON.stringify(corps), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...entetes },
});

/** Découpe ce que la personne a collé. Tout blanc sépare : une adresse n'en contient jamais. */
export function decouperAdresses(brut) {
  if (Array.isArray(brut)) brut = brut.join('\n');
  if (typeof brut !== 'string') return [];
  return [...new Set(brut.split(/\s+/).map((s) => s.trim()).filter((s) => s !== ''))];
}

// ── DEUX BARRIÈRES, ET ELLES NE PROTÈGENT PAS LA MÊME CHOSE.
//
//   1. la CLÉ D'ACCÈS, partagée : elle ouvre la PAGE. Elle ne donne aucun pouvoir.
//   2. le JETON PERSONNEL : il crée les liens, et les met au nom de celui qui l'a saisi.
//
// LA PREMIÈRE GARDE AUSSI L'API, pas seulement l'affichage. Une barrière qui ne vit que dans
// l'apparence de la page se contourne en appelant `/api/creer` à la main — ce qui en ferait une
// décoration. `/api/session` et `/api/creer` la vérifient donc toutes les deux, en premier.
const rideauOuvert = (env, request, maintenant) =>
  accesValide(env.INTERFACE_SECRET_SESSION ?? '', lireCookie(request.headers.get('cookie'), 'acces'), maintenant);

const RIDEAU_FERME = { erreur: "Clé d’accès requise.", etape: 'acces' };

// ── /api/acces — la clé partagée, première barrière.
export function handlerAcces({ env, maintenant = () => Date.now() }) {
  return async (request) => {
    const url = new URL(request.url);
    const secret = env.INTERFACE_SECRET_SESSION ?? '';

    if (request.method === 'DELETE') return json({ acces: false }, 200, { 'set-cookie': enteteFinAcces() });
    if (request.method !== 'POST') return json({ erreur: 'méthode non autorisée' }, 405);
    if (!origineAcceptable(request.headers.get('origin'), url.host)) {
      journal('warn', 'origine_refusee', { chemin: url.pathname });
      return json({ erreur: 'origine refusée' }, 403);
    }

    // LA CLÉ EST OBLIGATOIRE, PAS OPTIONNELLE. Sauter la barrière en silence quand sa variable manque
    // est le genre de repli qui se découvre après coup.
    const attendue = env.INTERFACE_CLE_ACCES ?? '';
    if (secret.length < 32 || attendue.length < LONGUEUR_MIN_CLE) {
      journal('error', 'configuration_incomplete', {
        secret_session: secret.length >= 32, cle_acces: attendue.length >= LONGUEUR_MIN_CLE,
      });
      return json({ erreur: "Cette interface n'est pas configurée : prévenez la personne qui l'administre." }, 503);
    }

    let corps;
    try { corps = await request.json(); } catch { corps = null; }
    const fournie = corps && typeof corps === 'object' && typeof corps.cle === 'string' ? corps.cle : '';

    if (!(await cleValide(fournie, attendue, secret))) {
      await attenteBrouillage();
      journal('warn', 'cle_acces_refusee', {});
      return json({ erreur: 'Clé d’accès incorrecte.' }, 401);
    }
    return json({ acces: true }, 200, { 'set-cookie': enteteAcces(signerAcces(secret, maintenant() + DUREE_ACCES_S * 1000)) });
  };
}

// ── /api/session — ouvrir, vérifier, fermer.
//
// CHACUN ENTRE SON PROPRE JETON. L'interface n'en détient aucun : elle scelle celui qu'on lui donne
// dans un cookie chiffré, et le ressort à chaque demande. Ce qu'elle crée est donc attribué à la
// personne, se révoque pour elle seule, et un départ ne coupe personne d'autre.

/**
 * LA SEULE VÉRIFICATION QUI PROUVE QUELQUE CHOSE : DEMANDER AU SERVICE.
 *
 * On lui envoie une demande VIDE — `{"urls": []}`. Le service authentifie d'abord : un jeton refusé
 * rend `401` avant d'avoir rien lu. Un jeton reconnu passe l'authentification puis bute sur « aucune
 * URL exploitable », un `400`. Donc : 401 = refusé, autre chose = reconnu.
 *
 * CETTE SONDE N'ÉCRIT RIEN ET N'APPELLE PAS ARC. Aucun article n'est chargé, aucun lien créé, aucune
 * ligne posée. Elle laisse deux traces, et il faut les connaître : le compteur `appels` du client
 * avance d'une unité, et le journal de la fonction Edge reçoit une ligne `aucune_url_exploitable` à
 * chaque ouverture de session. C'est le prix d'une vérification honnête — l'alternative serait
 * d'accepter n'importe quoi et de ne le découvrir qu'au premier vrai lot.
 *
 * UN SERVICE INJOIGNABLE N'EST PAS UN JETON REFUSÉ. Confondre les deux enverrait quelqu'un chercher
 * une faute dans un jeton parfaitement valide pendant que la base est en panne.
 */
export async function sonderJeton({ fetch, url, jeton, delaiMs = 10_000 }) {
  let reponse;
  try {
    reponse = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gift-service-token': jeton },
      body: JSON.stringify({ urls: [] }),
      signal: AbortSignal.timeout(delaiMs),
    });
  } catch { return { indisponible: true }; }
  if (reponse.status === 401) return { reconnu: false };
  if (reponse.status === 503) return { indisponible: true };
  return { reconnu: true };
}

export function handlerSession({ env, fetch = globalThis.fetch, maintenant = () => Date.now() }) {
  return async (request) => {
    const url = new URL(request.url);
    const secret = env.INTERFACE_SECRET_SESSION ?? '';
    const cookie = lireCookie(request.headers.get('cookie'));

    if (request.method === 'GET') {
      // La page a besoin des DEUX états pour savoir quel écran montrer.
      return json({
        acces: rideauOuvert(env, request, maintenant()),
        ouverte: ouvrirJeton(secret, cookie, maintenant()) !== null,
      });
    }
    if (request.method === 'DELETE') {
      return json({ ouverte: false }, 200, { 'set-cookie': enteteDeconnexion() });
    }
    if (request.method !== 'POST') return json({ erreur: 'méthode non autorisée' }, 405);
    if (!origineAcceptable(request.headers.get('origin'), url.host)) {
      journal('warn', 'origine_refusee', { chemin: url.pathname });
      return json({ erreur: 'origine refusée' }, 403);
    }

    // CONFIGURATION INCOMPLÈTE = PORTE FERMÉE, et le dire. Sans clé de scellement, le repli naturel
    // serait de poser le jeton en clair dans le cookie : exactement ce qu'on refuse.
    if (secret.length < 32) {
      journal('error', 'configuration_incomplete', { secret_session: false });
      return json({ erreur: "Cette interface n'est pas configurée : prévenez la personne qui l'administre." }, 503);
    }
    // Le rideau d'abord : sans lui, on ne consomme même pas un appel au service pour éprouver un jeton.
    if (!rideauOuvert(env, request, maintenant())) return json(RIDEAU_FERME, 403);

    let corps;
    try { corps = await request.json(); } catch { corps = null; }
    const jeton = corps && typeof corps === 'object' && typeof corps.jeton === 'string' ? corps.jeton.trim() : '';
    if (!FORME_JETON.test(jeton)) {
      // Refus de FORME, sans appeler le service : une valeur collée de travers n'a pas à consommer un
      // appel. Le message dit ce qui est attendu, parce que « jeton invalide » n'aide personne.
      journal('warn', 'jeton_mal_forme', { longueur: jeton.length });
      return json({ erreur: 'Ce n’est pas un jeton : il en faut un de 64 caractères, chiffres et lettres de a à f. Recopiez-le en entier, sans espace.' }, 400);
    }

    const sonde = await sonderJeton({ fetch, url: env.GIFT_API_URL || API_PAR_DEFAUT, jeton });
    if (sonde.indisponible) {
      journal('error', 'verification_indisponible', {});
      return json({ erreur: expliquerPanne(503) }, 503);
    }
    if (!sonde.reconnu) {
      journal('warn', 'jeton_refuse', {});
      return json({ erreur: "Ce jeton n’est pas reconnu, ou il a été révoqué. Demandez-en un nouveau à la personne qui administre le service." }, 401);
    }

    const scelle = scellerJeton(secret, jeton, maintenant() + DUREE_SESSION_S * 1000);
    return json({ ouverte: true, jours: DUREE_SESSION_S / 86400 }, 200, { 'set-cookie': enteteSession(scelle) });
  };
}

// ── /api/creer — la seule porte qui touche au service.
export function handlerCreer({ env, fetch = globalThis.fetch, maintenant = () => Date.now() }) {
  return async (request) => {
    const url = new URL(request.url);
    if (request.method !== 'POST') return json({ erreur: 'méthode non autorisée' }, 405);
    if (!origineAcceptable(request.headers.get('origin'), url.host)) {
      journal('warn', 'origine_refusee', { chemin: url.pathname });
      return json({ erreur: 'origine refusée' }, 403);
    }
    if (!rideauOuvert(env, request, maintenant())) return json(RIDEAU_FERME, 403);
    // LE JETON VIENT DU COOKIE DE LA PERSONNE, PAS DE L'ENVIRONNEMENT. Le déploiement n'en détient
    // aucun : ce qui est créé ici est attribué à celui ou celle qui a ouvert la session, et se révoque
    // pour lui seul.
    //
    // 403 ET NON 401 : l'interface distingue « votre session est finie, remettez votre jeton » de
    // « le service a refusé ce jeton », qui n'appelle pas du tout le même geste.
    const jeton = ouvrirJeton(env.INTERFACE_SECRET_SESSION ?? '', lireCookie(request.headers.get('cookie')), maintenant());
    if (jeton === null) return json({ erreur: expliquerPanne(403), etape: 'jeton' }, 403);

    let corps;
    try { corps = await request.json(); } catch { corps = null; }
    if (!corps || typeof corps !== 'object' || Array.isArray(corps)) {
      return json({ erreur: 'Demande illisible.' }, 400);
    }

    const adresses = decouperAdresses(corps.adresses);
    if (adresses.length === 0) return json({ erreur: "Aucune adresse n'a été fournie." }, 400);
    if (adresses.length > MAX_ADRESSES) {
      return json({ erreur: `${adresses.length} adresses d'un coup, c'est trop : ${MAX_ADRESSES} au maximum par demande. Faites plusieurs lots.` }, 400);
    }

    const duree = dureeDemandee(corps.jours === undefined ? undefined : Number(corps.jours));
    if (duree.erreur) {
      return json({ erreur: 'La durée doit être un nombre entier de jours, entre 1 et 365.' }, 400);
    }

    // ── ON TRIE AVANT D'APPELER. Une adresse manifestement inexploitable reçoit son motif tout de
    // suite, sans dépenser un appel au service ni un chargement d'article. Les règles sont celles du
    // service lui-même, pas une approximation.
    const { retenus, rejets } = trierUrls(adresses);
    const refusesLocaux = rejets.map((r) => ({
      adresse: r.url, titre: titreDepuisAdresse(r.url), motif: r.erreur, explication: expliquer(r.erreur),
    }));
    if (retenus.length === 0) {
      return json({
        panne: "Aucune des adresses fournies n'est celle d'un article de lexpress.fr qui puisse être offert.",
        liens: [], refuses: refusesLocaux,
        resume: { demandes: adresses.length, obtenus: 0, apercus: 0, refuses: refusesLocaux.length },
      }, 400);
    }

    let reponse, charge;
    const horloge = AbortSignal.timeout(DELAI_SERVICE_MS);
    try {
      reponse = await fetch(env.GIFT_API_URL || API_PAR_DEFAUT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-gift-service-token': jeton },
        body: JSON.stringify({ urls: retenus.map((r) => r.url), expires_in_days: duree.jours }),
        signal: horloge,
      });
      charge = await reponse.json();
    } catch (e) {
      // UNE PANNE DE TRANSPORT N'EST PAS UN REFUS D'ARTICLE. Le message doit dire « revenez », pas
      // « votre article est refusé » : la page de lecture a affiché pendant des jours « cet article
      // n'est plus disponible » pour une simple coupure réseau, et personne n'a pu diagnostiquer.
      const expire = e?.name === 'TimeoutError' || horloge.aborted;
      journal('error', 'service_injoignable', { adresses: retenus.length, expire, message: String(e?.message ?? e) });
      return json({
        panne: expliquerPanne(expire ? 504 : 503), liens: [], refuses: refusesLocaux,
        resume: { demandes: adresses.length, obtenus: 0, apercus: 0, refuses: refusesLocaux.length },
      }, expire ? 504 : 503);
    }

    // LE JETON A ÉTÉ RÉVOQUÉ PENDANT LA SESSION. La session ne vaut plus rien : on efface le cookie
    // plutôt que de laisser la personne recliquer sur un bouton qui ne peut plus rien produire.
    if (reponse.status === 401) {
      journal('warn', 'jeton_revoque_en_session', {});
      return json({ erreur: expliquerPanne(401), etape: 'jeton' }, 403, { 'set-cookie': enteteDeconnexion() });
    }

    const refusesService = (charge?.rejected ?? []).map((r) => ({
      adresse: r.url, titre: titreDepuisAdresse(r.url ?? ''), motif: r.erreur, explication: expliquer(r.erreur),
    }));
    const refuses = [...refusesLocaux, ...refusesService];

    if (!reponse.ok || !Array.isArray(charge?.links) || charge.links.length === 0) {
      journal('error', 'aucun_lien_obtenu', {
        statut: reponse.status, adresses: retenus.length,
        // Le motif du service, pas une paraphrase : c'est lui qu'on relira à 9 h du matin.
        motif: typeof charge?.error === 'string' ? charge.error : null,
      });
      return json({
        panne: expliquerPanne(reponse.status),
        detail: typeof charge?.error === 'string' ? charge.error : null,
        liens: [], refuses,
        resume: { demandes: adresses.length, obtenus: 0, apercus: 0, refuses: refuses.length },
      }, reponse.status === 400 ? 400 : reponse.status);
    }

    const t = maintenant();
    const liens = charge.links.map((l) => {
      const echeance = formaterEcheance(l.expires_at, t);
      const etat = decrireEtat(l.state);
      const apercu = l.content === 'preview';
      return {
        adresse: l.url, titre: titreDepuisAdresse(l.url), rubrique: rubriqueDepuisAdresse(l.url),
        lien: l.link,
        valableJusquau: echeance.texte, joursRestants: echeance.jours,
        etat: l.state, etatPhrase: etat.phrase, etatDetail: etat.detail,
        apercu, avertissement: apercu ? AVERTISSEMENT_APERCU : null,
      };
    });
    const apercus = liens.filter((l) => l.apercu).length;

    // Même événement que la fonction Edge, même nom : un lien vers le mur d'abonnement est un échec,
    // y compris quand tout a répondu 200. Celui-là, personne ne le signalera jamais spontanément.
    if (apercus > 0) journal('warn', 'apercu_seulement', { adresses: liens.filter((l) => l.apercu).map((l) => l.adresse) });
    if (refuses.length > 0) journal('warn', 'lot_partiel', { obtenus: liens.length, refuses: refuses.length });

    return json({
      client: typeof charge.client === 'string' ? charge.client : null,
      liens, refuses,
      resume: { demandes: adresses.length, obtenus: liens.length, apercus, refuses: refuses.length },
    });
  };
}
