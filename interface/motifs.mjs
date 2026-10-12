// Traduire ce que le service répond en français lisible par quelqu'un qui n'a pas écrit l'API.
//
// POURQUOI UNE TRADUCTION, ET PAS UN MESSAGE UNIQUE. Les motifs rendus par le service sont précis — et
// c'est tout leur intérêt : « ancien format sans identifiant Arc » et « lien retiré » demandent deux
// gestes complètement différents. Les fondre dans « cette adresse ne marche pas » ferait perdre
// exactement l'information pour laquelle le service se donne la peine de nommer ses refus.
//
// LE MOTIF BRUT N'EST JAMAIS REMPLACÉ, SEULEMENT DOUBLÉ. L'interface affiche la phrase en clair et garde
// le motif d'origine sous un détail repliable. Une traduction qui avale l'original rend le diagnostic
// impossible le jour où le service renvoie un motif que ce fichier ne connaît pas encore.
//
// CÔTÉ SERVEUR, PAS CÔTÉ NAVIGATEUR. Une seule copie de ces phrases, et le navigateur n'a qu'à afficher
// ce qu'on lui donne. Deux copies de la même règle, c'est la panne qu'on a déjà payée avec le
// validateur embarqué du workflow n8n : source corrigée, copie déployée inchangée.

/** Motif du service → phrase pour l'utilisateur. Le premier motif qui correspond gagne. */
export const TRADUCTIONS = [
  [/^ancien format sans identifiant Arc/,
    "Article trop ancien : il est publié sous l'ancienne adresse du site, qui ne porte pas d'identifiant. Il ne peut pas être offert."],
  [/^aucun identifiant Arc dans l/,
    "Cette adresse n'est pas celle d'un article : c'est une page de rubrique, l'accueil, ou une adresse tronquée. Ouvrez l'article et recopiez l'adresse complète."],
  [/^domaine inattendu/,
    "Cette adresse n'est pas sur lexpress.fr. Le service n'offre que des articles de L'Express."],
  [/^protocole refusé/,
    "Adresse en « http » ou d'une autre forme inhabituelle. Recopiez l'adresse depuis la barre du navigateur, elle commence par « https:// »."],
  [/^port refusé/,
    "Adresse inhabituelle, refusée par sécurité. Recopiez l'adresse depuis la barre du navigateur."],
  [/^url illisible/,
    "Adresse incompréhensible : il manque peut-être le début, ou un morceau s'est collé à un autre."],
  [/^url vide/, "Ligne vide."],
  [/^lien retiré/,
    "Cet article a été retiré de la diffusion, volontairement. Le rouvrir est une décision éditoriale : demandez-la, elle ne se fait pas depuis cette page."],
  [/^page injoignable/,
    "L'article n'a pas pu être chargé : il a peut-être été dépublié ou déplacé. Vérifiez qu'il s'ouvre encore sur lexpress.fr, puis réessayez."],
  [/^redirection hors domaine/,
    "L'article renvoie vers un autre site. Vérifiez l'adresse sur lexpress.fr."],
  [/^page vide/, "La page de l'article est revenue vide. Réessayez dans quelques instants."],
  [/^aucun titre dans la page/,
    "La page de l'article n'a pas pu être lue. Réessayez ; si cela persiste, signalez-le."],
];

/** Rend la phrase en clair, ou `null` quand ce motif n'est pas (encore) connu d'ici. */
export function expliquer(motif) {
  if (typeof motif !== 'string') return null;
  for (const [forme, phrase] of TRADUCTIONS) if (forme.test(motif)) return phrase;
  return null;
}

// ── CE QUE LE SERVICE RÉPOND QUAND L'APPEL ENTIER ÉCHOUE.
//
// UN ÉCHEC TECHNIQUE NE DOIT PAS SE DÉGUISER EN DÉCISION ÉDITORIALE. La page de lecture a affiché
// « cet article n'est plus disponible » pendant des jours alors qu'elle n'arrivait simplement pas à
// joindre la base — un mensonge au lecteur, et un diagnostic rendu impossible. Même règle ici : un 503
// dit « revenez », pas « votre article est refusé ».
export const PANNES = {
  401: "Le service a refusé l'accès de cette interface. Ce n'est pas votre adresse qui est en cause : prévenez la personne qui administre le service.",
  403: "Session expirée. Entrez de nouveau le mot de passe.",
  500: "Le service n'a pas pu enregistrer les liens. Rien n'a été diffusé. Réessayez ; si cela persiste, signalez-le.",
  502: "Aucun des articles demandés n'a pu être chargé. Le détail est donné article par article ci-dessous.",
  503: "Le service est momentanément indisponible. Ce n'est pas votre demande qui est en cause : réessayez dans un instant.",
  504: "Le service a mis trop de temps à répondre. Réessayez avec moins d'adresses à la fois.",
};

export function expliquerPanne(status) {
  return PANNES[status] ?? "Le service a répondu une erreur inattendue. Réessayez ; si cela persiste, signalez-le.";
}
