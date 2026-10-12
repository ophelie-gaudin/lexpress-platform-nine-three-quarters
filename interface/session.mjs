// La porte de l'interface : CHACUN ENTRE SON PROPRE JETON.
//
// POURQUOI PAS UN MOT DE PASSE PARTAGÉ. La première version en posait un, et le jeton de service vivait
// dans Vercel, le même pour tout le monde. Ça marchait, et ça perdait exactement ce que le service s'est
// donné la peine de construire : un appelant = un jeton = une ligne dans `api_clients`. Avec un jeton
// commun, `gift_links_by_client` nomme « interface-web » pour tout le monde, on ne peut couper personne
// en particulier, et un départ oblige à changer le secret de toute l'équipe.
//
// CE QUE ÇA CHANGE AUSSI : VERCEL NE DÉTIENT PLUS AUCUN JETON DE SERVICE. Le projet déployé ne porte
// qu'une clé de chiffrement. Quelqu'un qui obtiendrait les variables d'environnement n'obtiendrait pas
// de quoi fabriquer un seul lien.
//
// LE JETON NE DESCEND JAMAIS DANS LE NAVIGATEUR APRÈS AVOIR ÉTÉ SAISI. Il est scellé dans un cookie
// CHIFFRÉ — pas seulement signé. Un cookie signé serait lisible : le jeton s'y promènerait en clair
// dans chaque requête et dans les journaux du moindre mandataire. `HttpOnly` met de surcroît le cookie
// hors de portée d'un script de la page, donc hors de portée d'une faille XSS.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Sept jours. Un jeton de 64 caractères ne se retape pas de mémoire : une session de douze heures
 * ferait recopier le jeton tous les matins, donc le laisser traîner dans un fichier ouvert. Sept jours,
 * et un bouton « Fermer la session » pour le poste partagé ou l'ordinateur prêté.
 */
export const DUREE_SESSION_S = 7 * 24 * 3600;

/**
 * La clé de chiffrement, dérivée du secret de déploiement.
 *
 * PAS D'ÉTIREMENT DE CLÉ, ET C'EST ASSUMÉ : `INTERFACE_SECRET_SESSION` n'est pas un mot de passe humain
 * mais 32 octets tirés au hasard (`openssl rand -hex 32`). Un scrypt ne protégerait de rien ici — il
 * sert à ralentir la recherche exhaustive d'un secret devinable, et celui-ci ne l'est pas.
 */
const cle = (secret) => createHash('sha256').update(`scellement-jeton:${secret}`).digest();

/** iv.chiffre.sceau — AES-256-GCM : le sceau rend toute retouche du cookie détectable. */
export function scellerJeton(secret, jeton, expireLe) {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv('aes-256-gcm', cle(secret), iv);
  const chiffre = Buffer.concat([
    chiffreur.update(JSON.stringify({ jeton, exp: expireLe }), 'utf8'),
    chiffreur.final(),
  ]);
  return [iv, chiffre, chiffreur.getAuthTag()].map((b) => b.toString('base64url')).join('.');
}

/**
 * Rend le jeton, ou `null`. Jamais d'exception : un cookie bricolé, périmé ou chiffré avec une autre
 * clé est un refus ordinaire, pas une panne du serveur.
 */
export function ouvrirJeton(secret, valeur, maintenant = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32) return null;
  if (typeof valeur !== 'string') return null;
  const morceaux = valeur.split('.');
  if (morceaux.length !== 3) return null;
  try {
    const [iv, chiffre, sceau] = morceaux.map((m) => Buffer.from(m, 'base64url'));
    const dechiffreur = createDecipheriv('aes-256-gcm', cle(secret), iv);
    dechiffreur.setAuthTag(sceau);
    const clair = Buffer.concat([dechiffreur.update(chiffre), dechiffreur.final()]).toString('utf8');
    const { jeton, exp } = JSON.parse(clair);
    if (typeof jeton !== 'string' || jeton === '') return null;
    if (typeof exp !== 'number' || exp <= maintenant) return null;
    return jeton;
  } catch { return null; }
}

/** `HttpOnly` : le script de la page ne peut pas lire le cookie, donc une faille XSS ne l'emporte pas. */
export function enteteSession(valeur, dureeS = DUREE_SESSION_S) {
  return `session=${valeur}; ${['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', `Max-Age=${dureeS}`].join('; ')}`;
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
 * La forme d'un jeton de service : 64 caractères hexadécimaux (`openssl rand -hex 32`).
 *
 * VÉRIFIER LA FORME N'EST PAS VÉRIFIER LE JETON. Ça évite d'envoyer au service une ligne collée de
 * travers — un espace, un retour à la ligne, la moitié de la valeur. La seule vérification qui prouve
 * quelque chose est l'appel au service, et c'est lui qui tranche.
 */
export const FORME_JETON = /^[0-9a-f]{64}$/;

/**
 * DEUXIÈME BARRIÈRE CONTRE LA REQUÊTE VENUE D'AILLEURS. `SameSite=Strict` suffit sur un navigateur à
 * jour ; l'origine vérifiée côté serveur ne coûte rien et ne dépend pas du navigateur. Une requête sans
 * `Origin` (un appel en ligne de commande, par exemple) est acceptée : elle n'a pas de cookie à voler.
 */
export function origineAcceptable(origine, hote) {
  if (!origine) return true;
  try { return new URL(origine).host === hote; } catch { return false; }
}
