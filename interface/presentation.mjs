// Mettre en français ce que l'API rend en vocabulaire de machine.
//
// POURQUOI LE SERVEUR S'EN CHARGE. Le navigateur affiche ce qu'on lui donne et ne connaît aucune règle :
// une seule copie des phrases, et rien à resynchroniser le jour où l'API gagne un état. La page reste
// un afficheur.

/**
 * UN TITRE LISIBLE, TIRÉ DE L'ADRESSE. L'API ne rend pas le titre de l'article — elle n'a pas à le
 * faire, ses appelants sont des machines. Mais une liste de dix adresses de 120 caractères est
 * illisible pour quelqu'un qui veut juste vérifier qu'il a les bons articles.
 *
 * Le libellé est tiré du « slug » de l'adresse : c'est une APPROXIMATION du titre, pas le titre. On ne
 * va pas chercher le vrai titre : il est déjà en base, et l'exposer ici demanderait une lecture de plus
 * sur une table volontairement fermée.
 */
export function titreDepuisAdresse(adresse) {
  try {
    const chemin = new URL(adresse).pathname.replace(/\/+$/, '');
    const dernier = chemin.split('/').pop() ?? '';
    const sansId = dernier.replace(/-[A-Z0-9]{26}$/, '').replace(/_\d+\.html?$/i, '');
    const mots = sansId.split('-').filter(Boolean).join(' ').trim();
    if (mots === '') return adresse;
    return mots.charAt(0).toUpperCase() + mots.slice(1);
  } catch { return adresse; }
}

/** La rubrique, elle aussi lisible dans l'adresse : /politique/elections/… */
export function rubriqueDepuisAdresse(adresse) {
  try {
    const parties = new URL(adresse).pathname.split('/').filter(Boolean);
    return parties.length > 1 ? parties.slice(0, -1).join(' › ') : null;
  } catch { return null; }
}

// `created`, `extended`, `unchanged` : trois situations qui n'appellent pas le même geste.
const ETATS = {
  created: { phrase: 'Nouveau lien', detail: "Cet article n'avait jamais été offert. Le lien est neuf." },
  extended: { phrase: 'Durée prolongée', detail: "Cet article avait déjà un lien : c'est le MÊME lien, avec une date de fin repoussée. Les personnes qui l'ont déjà reçu en profitent aussi." },
  unchanged: { phrase: 'Déjà valable plus longtemps', detail: "Le lien existait déjà et reste valable plus longtemps que la durée demandée. On ne le raccourcit jamais : quelqu'un l'a peut-être reçu avec la promesse de l'ancienne date." },
};

export function decrireEtat(etat) {
  return ETATS[etat] ?? { phrase: 'Lien disponible', detail: null };
}

const JOUR = 86400000;

/** « jusqu'au mardi 27 octobre 2026 », heure de Paris — pas UTC, que personne ne lit. */
export function formaterEcheance(iso, maintenant = Date.now()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { texte: null, jours: null };
  const texte = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris',
  }).format(date);
  // Arrondi vers le haut : un lien qui expire dans six heures « reste valable aujourd'hui », il ne
  // reste pas « zéro jour ». Un compte à rebours faux-ami pousse à recréer un lien qui marche encore.
  return { texte, jours: Math.max(0, Math.ceil((date.getTime() - maintenant) / JOUR)) };
}

/**
 * LE SEUL AVERTISSEMENT QUI COMPTE VRAIMENT.
 *
 * `content: "preview"` est un succès pour l'API — 200, un lien valide — et un échec pour la personne
 * qui le diffuse : le destinataire tombera sur le mur d'abonnement, c'est-à-dire exactement ce que ce
 * service existe pour éviter. Et il n'a RIEN d'anormal à l'œil : la page est belle, elle porte le titre
 * et l'image. Personne ne signalera le problème, ni le destinataire, ni celui qui a envoyé.
 */
export const AVERTISSEMENT_APERCU =
  "Ce lien n'ouvre PAS l'article. Le contenu n'a pas pu être récupéré : la personne qui le reçoit verra le titre, l'image, et le mur d'abonnement. Ne le diffusez pas — réessayez dans quelques minutes, et signalez-le si cela persiste.";
