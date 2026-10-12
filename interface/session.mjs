// La porte de l'interface : un mot de passe partagé, puis un cookie signé.
//
// POURQUOI UNE PORTE DU TOUT. Derrière cette page, un bouton fabrique des accès complets à des articles
// payants. Une URL Vercel est publique et devinable ; sans mot de passe, n'importe qui tombant sur
// l'adresse pourrait ouvrir le catalogue premium de L'Express à qui il veut. C'est la porte la plus
// sensible du service — le même raisonnement que le jeton par appelant côté API.
//
// LE JETON DE SERVICE NE DESCEND JAMAIS DANS LE NAVIGATEUR. C'est la raison d'être de ces fonctions
// serveur : la page parle à `/api/creer`, et `/api/creer` seul connaît le jeton. Mettre le jeton dans
// la page reviendrait à le publier — le code d'une page est lisible par celui qui l'affiche.
//
// CE QUE CETTE PORTE NE PRÉTEND PAS ÊTRE. Un mot de passe partagé ne nomme personne : les liens créés
// ici seront tous attribués au même client API. Pour savoir QUI a créé un lien, il faudrait une
// identification par personne (Vercel + fournisseur d'identité). Pour une petite équipe qui se partage
// un service interne, le mot de passe suffit ; ce n'est pas vrai à vingt personnes, et ce fichier ne
// prétendra pas le contraire.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

/** Douze heures : une journée de travail, pas une session éternelle sur un poste partagé. */
export const DUREE_SESSION_S = 12 * 3600;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const empreinte = (valeur) => createHash('sha256').update(String(valeur), 'utf8').digest();

/**
 * COMPARAISON À TEMPS CONSTANT, SUR DES EMPREINTES.
 *
 * `===` sur deux chaînes s'arrête au premier caractère différent : le temps de réponse renseigne sur le
 * préfixe trouvé. On compare donc des empreintes SHA-256 — toujours 32 octets, donc `timingSafeEqual`
 * ne lève pas sur des longueurs différentes, ce qui serait une fuite de plus.
 *
 * UN MOT DE PASSE ABSENT N'OUVRE PAS LA PORTE. Si la variable n'est pas configurée, tout refuser : le
 * repli le plus naturel — « pas de mot de passe configuré, donc pas de contrôle » — publierait
 * l'interface au premier déploiement mal réglé.
 */
export function motDePasseValide(fourni, attendu) {
  if (typeof attendu !== 'string' || attendu.length < 12) return false;
  if (typeof fourni !== 'string' || fourni === '') return false;
  return timingSafeEqual(empreinte(fourni), empreinte(attendu));
}

/** Le cookie porte sa date de fin et sa signature, rien d'autre. Aucun nom, aucun secret. */
export function signerSession(secret, expireLe) {
  const charge = b64url(JSON.stringify({ exp: expireLe }));
  const signature = createHmac('sha256', secret).update(charge).digest('base64url');
  return `${charge}.${signature}`;
}

/**
 * Vérifie la signature PUIS la date. Rend `true` ou `false`, jamais une exception : un cookie bricolé
 * est un refus ordinaire, pas une panne du serveur.
 */
export function sessionValide(secret, valeur, maintenant = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  if (typeof valeur !== 'string' || !valeur.includes('.')) return false;
  const [charge, signature] = valeur.split('.', 2);
  const attendue = createHmac('sha256', secret).update(charge).digest('base64url');
  // Même raison qu'au-dessus : on compare des empreintes de longueur fixe.
  if (!timingSafeEqual(empreinte(signature), empreinte(attendue))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > maintenant;
  } catch { return false; }
}

/** `HttpOnly` : le script de la page ne peut pas lire le cookie, donc une faille XSS ne l'emporte pas. */
export function enteteSession(valeur, dureeS = DUREE_SESSION_S) {
  const attributs = ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', `Max-Age=${dureeS}`];
  return `session=${valeur}; ${attributs.join('; ')}`;
}

export const enteteDeconnexion = () =>
  'session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';

export function lireCookie(entete, nom = 'session') {
  if (typeof entete !== 'string') return null;
  for (const morceau of entete.split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0 && morceau.slice(0, i).trim() === nom) return morceau.slice(i + 1).trim();
  }
  return null;
}

/**
 * DEUXIÈME BARRIÈRE CONTRE LA REQUÊTE VENUE D'AILLEURS. `SameSite=Strict` suffit sur un navigateur à
 * jour ; l'origine vérifiée côté serveur ne coûte rien et ne dépend pas du navigateur. Une requête sans
 * `Origin` (un appel en ligne de commande, par exemple) est acceptée : elle n'a pas de cookie à voler.
 */
export function origineAcceptable(origine, hote) {
  if (!origine) return true;
  try { return new URL(origine).host === hote; } catch { return false; }
}
