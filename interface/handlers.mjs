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
  DUREE_SESSION_S, enteteDeconnexion, enteteSession, lireCookie,
  motDePasseValide, origineAcceptable, sessionValide, signerSession,
} from './session.mjs';

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

// ── /api/session — ouvrir, vérifier, fermer.
export function handlerSession({ env, maintenant = () => Date.now() }) {
  return async (request) => {
    const url = new URL(request.url);
    const secret = env.INTERFACE_SECRET_SESSION ?? '';
    const cookie = lireCookie(request.headers.get('cookie'));

    if (request.method === 'GET') {
      return json({ ouverte: sessionValide(secret, cookie, maintenant()) });
    }
    if (request.method === 'DELETE') {
      return json({ ouverte: false }, 200, { 'set-cookie': enteteDeconnexion() });
    }
    if (request.method !== 'POST') return json({ erreur: 'méthode non autorisée' }, 405);
    if (!origineAcceptable(request.headers.get('origin'), url.host)) {
      journal('warn', 'origine_refusee', { chemin: url.pathname });
      return json({ erreur: 'origine refusée' }, 403);
    }

    // CONFIGURATION INCOMPLÈTE = PORTE FERMÉE, et le dire. Le repli « pas de mot de passe configuré,
    // donc pas de contrôle » publierait l'interface au premier déploiement mal réglé.
    if (secret.length < 32 || (env.INTERFACE_MOT_DE_PASSE ?? '').length < 12) {
      journal('error', 'configuration_incomplete', {
        secret_session: secret.length >= 32, mot_de_passe: (env.INTERFACE_MOT_DE_PASSE ?? '').length >= 12,
      });
      return json({ erreur: "Cette interface n'est pas configurée : prévenez la personne qui l'administre." }, 503);
    }

    let corps;
    try { corps = await request.json(); } catch { corps = null; }
    const fourni = corps && typeof corps === 'object' ? corps.motDePasse : null;
    if (!motDePasseValide(fourni, env.INTERFACE_MOT_DE_PASSE)) {
      journal('warn', 'mot_de_passe_refuse', {});
      return json({ erreur: 'Mot de passe incorrect.' }, 401);
    }
    const valeur = signerSession(secret, maintenant() + DUREE_SESSION_S * 1000);
    return json({ ouverte: true }, 200, { 'set-cookie': enteteSession(valeur) });
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
    // 403 ET NON 401 : l'interface distingue « votre session est finie, remettez le mot de passe » de
    // « le service a refusé NOTRE accès », qui n'appelle pas du tout le même geste.
    if (!sessionValide(env.INTERFACE_SECRET_SESSION ?? '', lireCookie(request.headers.get('cookie')), maintenant())) {
      return json({ erreur: expliquerPanne(403) }, 403);
    }
    const jeton = env.GIFT_SERVICE_TOKEN ?? '';
    if (jeton === '') {
      journal('error', 'jeton_de_service_absent', {});
      return json({ erreur: "Cette interface n'est pas configurée pour appeler le service : prévenez la personne qui l'administre." }, 503);
    }

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
