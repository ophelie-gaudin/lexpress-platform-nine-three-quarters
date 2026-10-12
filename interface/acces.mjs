// LA PREMIÈRE BARRIÈRE : une clé partagée pour voir l'interface. La seconde est le jeton personnel,
// dans `session.mjs`.
//
// CE QUE CETTE CLÉ EST, ET CE QU'ELLE N'EST PAS. Elle ne donne aucun pouvoir : qui la connaît voit
// l'écran du jeton, et rien d'autre. Elle n'autorise pas à créer un lien, ne nomme personne, et ne
// protège pas le service — qui détient un jeton personnel peut de toute façon appeler l'API Supabase
// directement, sans passer par cette page. C'est un RIDEAU, pas une serrure.
//
// CE QU'ELLE APPORTE QUAND MÊME. Elle retire de l'internet public un formulaire dont le bouton
// fabrique des accès à des articles payants : plus de robot qui sonde `/api/session`, plus de page
// trouvable par hasard, et une faille future dans la page n'est plus atteignable par un anonyme.
// Elle réduit la surface, elle ne remplace pas le jeton.
//
// ELLE EST OBLIGATOIRE, PAS OPTIONNELLE. Une couche de sécurité qu'on saute en silence quand sa
// variable manque est le genre de repli qui se découvre après coup : sans clé configurée, l'interface
// refuse tout le monde et le dit.
import { createHmac, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * Le coût, en clair. `N` double le travail à chaque cran ; 2^17 coûte environ un dixième de seconde
 * par essai sur une machine d'aujourd'hui. Baisser ce chiffre rend la clé devinable, le monter rend
 * l'ouverture de session lente — elle n'arrive qu'une fois par mois et par navigateur, donc on peut
 * se permettre d'être généreux.
 */
const COUT = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

// L'empreinte de la clé ATTENDUE ne change pas d'une requête à l'autre : la calculer une fois par
// processus évite de payer deux fois le prix à chaque ouverture. Celle qu'on reçoit, elle, est
// toujours recalculée — c'est là qu'est le coût qui protège.
const attendues = new Map();

/** Trente jours : on ne redemande pas un rideau tous les matins, ce serait le faire écrire partout. */
export const DUREE_ACCES_S = 30 * 24 * 3600;

/** Une clé choisie par un humain est courte et devinable. Seize caractères est un plancher, pas un but. */
export const LONGUEUR_MIN_CLE = 16;

/** Au-delà, ce n'est plus une clé : on refuse sans calculer. */
export const LONGUEUR_MAX_CLE = 256;

/**
 * ── LE COÛT PROTÈGE DE LA DEVINETTE, ET IL OUVRE UNE AUTRE PORTE.
 *
 * Relevé par une revue adverse (12 oct. 2026) : n'importe qui peut envoyer `POST /api/acces` avec une
 * chaîne quelconque et déclencher un quart de seconde de calcul — payé par NOTRE serveur, pas par lui.
 * La défense contre la recherche exhaustive était aussi un amplificateur de déni de service.
 *
 * CE QU'ON PROTÈGE EST LE PROCESSEUR D'UNE INSTANCE, et il est justement par instance : plafonner le
 * nombre de calculs SIMULTANÉS dans ce processus borne exactement la ressource en jeu, sans rien
 * partager entre instances. Au-delà du plafond, on refuse tout de suite — on ne met pas en file, une
 * file ne ferait que différer la saturation.
 *
 * CE QUE CE PLAFOND NE FAIT PAS : il n'empêche pas Vercel de démarrer d'autres instances sous la
 * charge, donc il ne borne pas la facture. Ce niveau-là relève du pare-feu de la plateforme, pas de ce
 * fichier, et `interface/README.md` le dit.
 */
export const CALCULS_SIMULTANES = 2;
let enCours = 0;

export class TropDeCalculs extends Error {}

/**
 * COMPARAISON LENTE, ET C'EST LE BUT.
 *
 * Le jeton personnel fait 64 hexadécimaux tirés au hasard : le deviner est hors de question, une
 * comparaison rapide suffit. La clé d'accès, elle, est choisie par un humain, donc devinable, et elle
 * est partagée par toute l'équipe donc rarement changée. Sur une plateforme sans état comme Vercel, on
 * ne peut pas compter les tentatives de façon fiable — chaque requête peut tomber sur une instance
 * neuve, et un compteur en mémoire ne voit rien.
 *
 * `scrypt` fait payer environ un dixième de seconde de calcul à CHAQUE essai, sans rien partager entre
 * instances. Cent mille essais deviennent trois heures de machine au lieu de quelques secondes. Ce
 * n'est pas une limite de débit, c'est un coût — et c'est ce qui marche quand on ne peut pas compter.
 *
 * Le sel est dérivé du déploiement : deux installations ne calculent pas les mêmes empreintes.
 */
export async function cleValide(fournie, attendue, sel) {
  if (typeof attendue !== 'string' || attendue.length < LONGUEUR_MIN_CLE) return false;
  // CE QUI SE REFUSE SANS CALCULER se refuse sans calculer. La longueur minimale est publique — elle
  // est écrite dans ce dépôt — donc la filtrer ne renseigne personne.
  if (typeof fournie !== 'string') return false;
  if (fournie.length < LONGUEUR_MIN_CLE || fournie.length > LONGUEUR_MAX_CLE) return false;

  if (enCours >= CALCULS_SIMULTANES) throw new TropDeCalculs();
  enCours += 1;
  try {
    const graine = createHash('sha256').update(`sel-cle-acces:${sel}`).digest();
    const memo = `${sel}\u0000${attendue}`;
    if (!attendues.has(memo)) attendues.set(memo, await scryptAsync(attendue, graine, 32, COUT));
    const essai = await scryptAsync(fournie, graine, 32, COUT);
    return timingSafeEqual(essai, attendues.get(memo));
  } finally { enCours -= 1; }
}

/**
 * ── LA SIGNATURE EST LIÉE À LA CLÉ EN VIGUEUR, PAS SEULEMENT AU SECRET DU DÉPLOIEMENT.
 *
 * Relevé par une revue adverse (12 oct. 2026). La première version signait avec le seul secret de
 * session : changer la clé d'accès n'invalidait AUCUN cookie déjà posé — ils vivaient leurs trente
 * jours — et SUPPRIMER la variable ne fermait rien du tout, puisque la vérification ne regardait que
 * la signature. Une rotation ressemblait à une coupure sans en être une.
 *
 * En mêlant l'empreinte de la clé à la sienne, changer la clé rend tous les cookies illisibles
 * SUR-LE-CHAMP, et la retirer ferme la porte. C'est ce qu'on croyait déjà faire.
 */
const cleSignature = (secret, cle) =>
  `acces:${secret}:${createHash('sha256').update(String(cle)).digest('hex')}`;

/**
 * Le cookie du rideau ne porte QUE sa date de fin. Pas de secret dedans : il n'ouvre rien tout seul,
 * donc une signature suffit, là où le cookie du jeton doit être chiffré.
 */
export function signerAcces(secret, cle, expireLe) {
  const charge = Buffer.from(JSON.stringify({ exp: expireLe }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', cleSignature(secret, cle)).update(charge).digest('base64url');
  return `${charge}.${signature}`;
}

export function accesValide(secret, cle, valeur, maintenant = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  // CLÉ RETIRÉE = RIDEAU FERMÉ, y compris pour qui l'avait déjà franchi.
  if (typeof cle !== 'string' || cle.length < LONGUEUR_MIN_CLE) return false;
  if (typeof valeur !== 'string' || !valeur.includes('.')) return false;
  const [charge, signature] = valeur.split('.', 2);
  const attendue = createHmac('sha256', cleSignature(secret, cle)).update(charge).digest('base64url');
  const empreinte = (v) => createHash('sha256').update(String(v)).digest();
  if (!timingSafeEqual(empreinte(signature), empreinte(attendue))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > maintenant;
  } catch { return false; }
}

export function enteteAcces(valeur, dureeS = DUREE_ACCES_S) {
  return `acces=${valeur}; ${['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', `Max-Age=${dureeS}`].join('; ')}`;
}

export const enteteFinAcces = () => 'acces=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';

/**
 * Un peu de hasard sur le temps de réponse d'un refus. Sans lui, la durée d'un `scrypt` est stable au
 * dixième de milliseconde près et distingue « clé fausse » (deux scrypt) de « pas configurée » (zéro).
 */
export const attenteBrouillage = () => new Promise((fini) => setTimeout(fini, 40 + randomBytes(1)[0] / 4));
