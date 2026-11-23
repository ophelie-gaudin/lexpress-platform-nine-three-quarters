// Offres d'abonnement (018) : validation de ce que le marketing envoie, avant toute écriture.
//
// LA BASE VÉRIFIE AUSSI (contraintes et fonctions de 018). Ici, le but est de rendre un refus qui
// s'explique, champ par champ, au lieu d'une erreur PostgreSQL. Les deux règles disent la même chose ;
// le test les confronte sur les mêmes cas.

export const OFFRE_CLES = Object.freeze(['sites', 'ends_at', 'starts_at', 'url', 'label', 'name']);
export const OFFRE_SITES = Object.freeze({
  'www.lexpress.fr': Object.freeze({ famille: 'fr', langue: 'fr' }),
  'www.lexpress.eu': Object.freeze({ famille: 'eu', langue: 'en' }),
  'fr.lexpress.eu': Object.freeze({ famille: 'eu', langue: 'fr' }),
  'pl.lexpress.eu': Object.freeze({ famille: 'eu', langue: 'pl' }),
});
export const LIBELLE_MAX = 40;
export const URL_MAX = 500;
export const NOM_MAX = 80;

// Même règle que offer_url_family() en SQL. https, hôte exact de la liste, rien entre l'hôte et le
// chemin (ni port, ni identifiants, ni fragment), aucun espace ni caractère de contrôle.
export function familleUrl(url) {
  if (typeof url !== 'string' || url.length > URL_MAX || /[\s\u0000-\u001f\u007f\\"<>`]/.test(url)) return null;
  if (/^https:\/\/(abonnements-digitaux\.lexpress\.fr|(www\.)?lexpress\.fr)([/?]|$)/.test(url)) return 'fr';
  if (/^https:\/\/((www|fr|pl)\.)?lexpress\.eu([/?]|$)/.test(url)) return 'eu';
  return null;
}

// ISO 8601 avec fuseau explicite : « 2026-11-30T23:59:00+01:00 » ou « …Z ». Sans fuseau, la même
// chaîne désigne deux instants selon la machine qui la lit ; on préfère refuser que deviner.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
function date(valeur, champ) {
  if (typeof valeur !== 'string' || !ISO.test(valeur)) {
    return { erreur: `${champ} doit être une date ISO 8601 avec fuseau, par exemple 2026-11-30T23:59:00+01:00 (reçu : ${JSON.stringify(valeur)})` };
  }
  const t = Date.parse(valeur);
  if (!Number.isFinite(t)) return { erreur: `${champ} n'est pas une date valide (reçu : ${JSON.stringify(valeur)})` };
  return { date: new Date(t) };
}

/**
 * Valide le corps d'une création. Rend { offre } prête pour create_subscription_offer, ou { erreur }.
 * `maintenant` est injectable pour les tests.
 */
export function validerOffre(corps, maintenant = new Date()) {
  if (corps === null || typeof corps !== 'object' || Array.isArray(corps)) return { erreur: 'le corps doit être un objet JSON' };
  const inconnues = Object.keys(corps).filter((c) => !OFFRE_CLES.includes(c));
  if (inconnues.length > 0) return { erreur: `clé(s) non reconnue(s) : ${inconnues.join(', ')}`, accepted_keys: OFFRE_CLES };

  const sites = corps.sites;
  if (!Array.isArray(sites) || sites.length === 0) {
    return { erreur: `sites est obligatoire : une liste parmi ${Object.keys(OFFRE_SITES).join(', ')}` };
  }
  const inconnus = sites.filter((s) => typeof s !== 'string' || !Object.hasOwn(OFFRE_SITES, s));
  if (inconnus.length > 0) {
    return { erreur: `site(s) inconnu(s) : ${inconnus.map((s) => JSON.stringify(s)).join(', ')} — valeurs possibles : ${Object.keys(OFFRE_SITES).join(', ')}` };
  }
  if (new Set(sites).size !== sites.length) return { erreur: 'sites contient un doublon' };

  if (corps.ends_at === undefined) return { erreur: 'ends_at (date de fin) est obligatoire' };
  const fin = date(corps.ends_at, 'ends_at');
  if (fin.erreur) return fin;
  let debut = { date: null };
  if (corps.starts_at !== undefined && corps.starts_at !== null) {
    debut = date(corps.starts_at, 'starts_at');
    if (debut.erreur) return debut;
  }
  if (fin.date.getTime() <= maintenant.getTime()) return { erreur: 'ends_at doit être dans le futur' };
  if (debut.date && fin.date.getTime() <= debut.date.getTime()) return { erreur: 'ends_at doit être après starts_at' };

  let url = null;
  if (corps.url !== undefined && corps.url !== null) {
    const famille = familleUrl(corps.url);
    if (!famille) {
      return { erreur: `url refusée : https uniquement, sur abonnements-digitaux.lexpress.fr, (www.)lexpress.fr ou (www.|fr.|pl.)lexpress.eu, sans port ni espace, ${URL_MAX} caractères au plus` };
    }
    const autres = sites.filter((s) => OFFRE_SITES[s].famille !== famille);
    if (autres.length > 0) {
      return { erreur: `url sur un domaine ${famille === 'fr' ? 'lexpress.fr' : 'lexpress.eu'} : elle ne peut pas servir ${autres.join(', ')}. Créer une offre par domaine.` };
    }
    url = corps.url;
  }

  let label = null;
  if (corps.label !== undefined && corps.label !== null) {
    if (typeof corps.label !== 'string') return { erreur: 'label doit être un texte' };
    label = corps.label.trim();
    const longueur = [...label].length;
    if (longueur < 1 || longueur > LIBELLE_MAX) return { erreur: `label doit faire entre 1 et ${LIBELLE_MAX} caractères (reçu : ${longueur})` };
    if (/[\u0000-\u001f\u007f<>]/.test(label)) return { erreur: 'label ne doit contenir ni retour à la ligne, ni caractère de contrôle, ni < >' };
    if (new Set(sites.map((s) => OFFRE_SITES[s].langue)).size > 1) {
      return { erreur: 'un libellé est écrit dans une langue : il ne peut viser que des sites de cette langue. Créer une offre par langue.' };
    }
  }

  let name = null;
  if (corps.name !== undefined && corps.name !== null) {
    if (typeof corps.name !== 'string' || corps.name.trim() === '' || [...corps.name.trim()].length > NOM_MAX || /[\u0000-\u001f\u007f]/.test(corps.name)) {
      return { erreur: `name doit être un texte d'une ligne, ${NOM_MAX} caractères au plus` };
    }
    name = corps.name.trim();
  }

  return {
    offre: {
      p_sites: [...sites],
      p_ends_at: fin.date.toISOString(),
      p_starts_at: debut.date ? debut.date.toISOString() : null,
      p_url: url,
      p_label: label,
      p_name: name,
    },
  };
}

// Identifiant d'offre dans l'URL d'une fin anticipée.
export const estUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Ce que la réponse montre d'une offre : tout sauf les identifiants internes des services.
export function offrePublique(ligne, maintenant = new Date()) {
  const t = maintenant.getTime();
  const debut = Date.parse(ligne.starts_at), fin = Date.parse(ligne.ends_at);
  return {
    id: ligne.id, name: ligne.name ?? null, sites: ligne.sites,
    starts_at: ligne.starts_at, ends_at: ligne.ends_at,
    url: ligne.url ?? null, label: ligne.label ?? null,
    status: fin <= t ? 'ended' : debut > t ? 'scheduled' : 'active',
  };
}

// Pour chaque site, l'offre affichée en ce moment selon la règle de 018 (début le plus récent, puis
// création la plus récente, puis identifiant). Sert la réponse de la liste ; la page, elle, demande à la base.
export function offresAffichees(lignes, maintenant = new Date()) {
  const t = maintenant.getTime();
  const enCours = lignes
    .filter((l) => Date.parse(l.starts_at) <= t && Date.parse(l.ends_at) > t)
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at)
      || Date.parse(b.created_at) - Date.parse(a.created_at)
      || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return Object.fromEntries(Object.keys(OFFRE_SITES).map((site) => [site, enCours.find((l) => l.sites.includes(site))?.id ?? null]));
}
