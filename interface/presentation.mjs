// Mettre en français ce que l'API rend en vocabulaire de machine.
//
// POURQUOI LE SERVEUR S'EN CHARGE. Le navigateur affiche ce qu'on lui donne et ne connaît aucune règle :
// une seule copie des phrases, et rien à resynchroniser le jour où l'API gagne un état. La page reste
// un afficheur.

// ── LES LIBELLÉS QUI DÉCRIVENT L'OUTIL VIVENT ICI, PAS DANS LA PAGE.
//
// `public/index.html` est servi à qui demande l'adresse, clé ou pas : tout ce qu'on y écrit est public.
// Les placer derrière un attribut `hidden` n'aurait rien caché — il suffit de lire le source. Le
// serveur ne les rend donc qu'une fois la barrière franchie.
//
// CE N'EST PAS UNE MESURE DE SÉCURITÉ, et il ne faut pas le croire : le dépôt est public, ces phrases
// y sont lisibles par qui le cherche. C'est une mesure de DISCRÉTION — ne pas présenter à un robot qui
// passe un formulaire qui annonce « ici, on fabrique des accès gratuits à des articles payants ».

/** Montré sur l'écran du jeton, après la clé d'accès. */
export const INVITE_JETON =
  "Deuxième et dernière étape. Chaque personne a son propre jeton : ce que vous créez est enregistré à votre nom, et votre accès se coupe sans couper celui des autres.";

/** Montré une fois la session ouverte. Rendu par le serveur, affiché tel quel. */
export const GUIDE = {
  titre: 'Offrir un article',
  chapeau: "Collez l'adresse d'un article de lexpress.fr. Vous recevez en retour un lien qui ouvre l'article en entier, sans abonnement, pendant la durée que vous choisissez.",
  exemple: 'https://www.lexpress.fr/politique/…',
  attente: 'Création en cours… Les articles sont chargés un par un : comptez une vingtaine de secondes.',
  conseils: [
    'Une adresse par ligne. Dix articles au maximum à la fois.',
    "Un article n'a qu'un seul lien. Si vous redemandez un article déjà offert, vous recevez le même lien, avec sa date de fin repoussée si vous demandez plus long. C'est normal, et c'est voulu : le lien que quelqu'un a déjà reçu continue de marcher.",
    "On ne raccourcit jamais une durée. Demander 7 jours sur un lien valable encore 20 ne le ramène pas à 7 : quelqu'un l'a peut-être reçu avec la promesse des 20.",
    "Lisez les avertissements en rouge. Un lien peut être créé et ne pas ouvrir l'article. La page le dit ; sans elle, personne ne s'en apercevrait.",
  ],
  pied: "Les liens créés ici sont des accès réels à des articles payants, enregistrés à votre nom. Une adresse de lien se transfère : ne la diffusez que là où vous l'avez décidé. Votre jeton reste ouvert sept jours sur ce navigateur ; sur un poste partagé, fermez la session.",
};

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
