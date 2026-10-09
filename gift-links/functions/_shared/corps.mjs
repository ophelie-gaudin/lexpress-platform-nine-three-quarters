// Ce que le service accepte dans le corps d'une requête, et ce qu'il en refuse.
//
// POURQUOI UN MODULE À PART. Ces règles vivaient dans la fonction Edge, qui ne tourne que sous Deno :
// aucun test Node ne pouvait les EXÉCUTER. Les contrôles se contentaient de chercher des chaînes dans
// le fichier déployable — une revue adverse a montré qu'on pouvait désactiver le refus
// d'authentification sans qu'une seule assertion bronche. Ici, les cas appellent le vrai code et
// regardent le vrai résultat.

/** Les seules clés que l'appelant peut poser. Toute autre est un refus nommé. */
export const CLES_ACCEPTEES = ['urls', 'expires_in_days', 'fake_body'];

/**
 * UNE CLÉ INCONNUE EST UN REFUS, PAS UN HAUSSEMENT D'ÉPAULES.
 *
 * `channel` et `campaign` ont été acceptées puis ignorées en silence. Un appelant qui les envoyait
 * croyait attribuer ses liens ; il ne faisait rien, et rien ne le lui disait. Une faute de frappe sur
 * `expires_in_days` se payait pareil : quinze jours au lieu de trente, sans un mot.
 */
export function clesInconnues(corps) {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return [];
  return Object.keys(corps).filter((c) => !CLES_ACCEPTEES.includes(c));
}

/**
 * LA DURÉE, VALIDÉE AVANT TOUTE ÉCRITURE.
 *
 * `-1`, `0`, `false` et `"abc"` devenaient quinze jours en silence ; `1e300` levait une exception une
 * fois le contenu partagé déjà modifié. Rend `{ jours }` ou `{ erreur }`.
 */
export function dureeDemandee(valeur) {
  // ON EXIGE UN NOMBRE, PAS QUELQUE CHOSE QUI S'Y CONVERTIT. `Number(true)` vaut 1 : `expires_in_days:
  // true` serait devenu un jour, en silence. `"30"` passerait aussi, et le jour où quelqu'un écrit
  // `"30 jours"` il recevrait quinze. Trouvé par un cas écrit pour cette révision.
  if (valeur !== undefined && typeof valeur !== 'number') {
    return { erreur: `expires_in_days doit être un nombre (reçu : ${JSON.stringify(valeur)})` };
  }
  const jours = valeur === undefined ? 15 : valeur;
  if (!Number.isFinite(jours) || !Number.isInteger(jours) || jours < 1 || jours > 365) {
    return { erreur: `expires_in_days doit être un entier entre 1 et 365 (reçu : ${JSON.stringify(valeur)})` };
  }
  return { jours };
}

/** Un corps JSON doit être un objet. `null` et `[]` sont du JSON valide, et n'ont rien à faire ici. */
export function corpsUtilisable(brut) {
  return brut !== null && typeof brut === 'object' && !Array.isArray(brut);
}
