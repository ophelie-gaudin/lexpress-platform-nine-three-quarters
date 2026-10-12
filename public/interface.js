// La page n'a AUCUNE règle. Elle demande, elle affiche. Les motifs de refus, les durées autorisées, les
// phrases d'état : tout vient du serveur. Une règle recopiée dans le navigateur finit par diverger de
// celle du service, et c'est l'utilisateur qui paie la différence.
//
// RIEN N'EST INSÉRÉ EN HTML. Les adresses affichées viennent de ce que la personne a collé : passer par
// `innerHTML` donnerait à n'importe qui collant du balisage le moyen de réécrire la page. On construit
// des nœuds et on remplit `textContent`.

const $ = (id) => document.getElementById(id);
const ecranAcces = $('ecran-acces');
const ecranJeton = $('ecran-jeton');
const ecranDemande = $('ecran-demande');
const resultats = $('resultats');

const montrer = (element, visible) => { element.hidden = !visible; };

/**
 * ── LES LIBELLÉS VIENNENT DU SERVEUR, PAS DE CE FICHIER.
 *
 * `index.html` est servi à qui demande l'adresse, clé ou pas. Tout ce qu'on y écrirait serait public —
 * les cacher derrière un `hidden` n'aurait rien caché, il suffit de lire le source. Le serveur ne les
 * rend donc qu'une fois la barrière franchie, et la page les pose en `textContent`.
 */
function poserGuide(guide) {
  if (!guide) return;
  $('titre').textContent = guide.titre;
  $('chapeau').textContent = guide.chapeau;
  montrer($('chapeau'), true);
  $('adresses').placeholder = guide.exemple ?? '';
  $('attente').textContent = guide.attente ?? '';
  $('pied').textContent = guide.pied ?? '';
  montrer($('pied'), true);
  const points = $('aide-points');
  points.replaceChildren();
  for (const c of guide.conseils ?? []) points.appendChild(texte('li', c));
  montrer($('aide'), (guide.conseils ?? []).length > 0);
}

const poserInvite = (invite) => { if (invite) $('invite-jeton').textContent = invite; };

function texte(balise, contenu, classe) {
  const n = document.createElement(balise);
  if (contenu !== undefined && contenu !== null) n.textContent = contenu;
  if (classe) n.className = classe;
  return n;
}

function afficherErreur(cible, message) {
  cible.textContent = message ?? '';
  montrer(cible, Boolean(message));
}

// ── La porte.

async function etat() {
  try {
    const r = await fetch('/api/session', { headers: { accept: 'application/json' } });
    const d = await r.json();
    return { acces: d?.acces === true, ouverte: d?.ouverte === true, invite: d?.invite, guide: d?.guide };
  } catch { return { acces: false, ouverte: false }; }
}

/**
 * Trois écrans, un seul visible. `etape` vaut 'acces', 'jeton' ou 'demande' — et c'est le SERVEUR qui
 * la dit : la page ne décide jamais toute seule qu'une barrière est franchie.
 */
function afficherEtape(etape, message) {
  montrer(ecranAcces, etape === 'acces');
  montrer(ecranJeton, etape === 'jeton');
  montrer(ecranDemande, etape === 'demande');
  // « Fermer la session » n'a aucun sens tant qu'aucune session n'est ouverte.
  montrer($('ligne-sortie'), etape === 'demande');
  // Hors session, le titre et le pied de page ne disent rien de l'outil.
  if (etape !== 'demande') {
    $('titre').textContent = 'Accès réservé';
    montrer($('chapeau'), false);
    montrer($('pied'), false);
  }
  if (etape === 'acces') { afficherErreur($('erreur-acces'), message); $('cle').value = ''; $('cle').focus(); }
  if (etape === 'jeton') {
    afficherErreur($('erreur-jeton'), message);
    // Le champ est vidé dans tous les cas : un jeton ne doit pas rester affiché dans une page ouverte.
    $('jeton').value = '';
    $('jeton').focus();
  }
}

$('form-acces').addEventListener('submit', async (e) => {
  e.preventDefault();
  afficherErreur($('erreur-acces'), null);
  // La vérification est VOLONTAIREMENT lente — une fraction de seconde de calcul par essai, pour que
  // deviner la clé coûte cher. Sans ce mot, l'attente passerait pour une page bloquée.
  montrer($('attente-acces'), true);
  try {
    const r = await fetch('/api/acces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cle: $('cle').value }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.acces) { $('cle').value = ''; poserInvite(d.invite); afficherEtape('jeton'); return; }
    afficherErreur($('erreur-acces'), d.erreur ?? 'Accès impossible.');
  } catch {
    afficherErreur($('erreur-acces'), "La page n'a pas pu joindre le serveur. Réessayez dans un instant.");
  } finally {
    montrer($('attente-acces'), false);
  }
});

$('form-jeton').addEventListener('submit', async (e) => {
  e.preventDefault();
  afficherErreur($('erreur-jeton'), null);
  // La vérification demande au service si le jeton est reconnu : ça prend une seconde ou deux, et
  // sans ce mot la personne reclique en croyant que rien ne s'est passé.
  montrer($('attente-jeton'), true);
  try {
    const r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jeton: $('jeton').value.trim() }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ouverte) { $('jeton').value = ''; poserGuide(d.guide); afficherEtape('demande'); $('adresses').focus(); return; }
    if (r.status === 403 && d.etape === 'acces') { afficherEtape('acces', 'La clé d’accès a expiré. Entrez-la de nouveau.'); return; }
    afficherErreur($('erreur-jeton'), d.erreur ?? 'Connexion impossible.');
  } catch {
    // Un échec de réseau n'est pas un jeton refusé : le dire autrement enverrait chercher une faute
    // de frappe dans un jeton parfaitement valide.
    afficherErreur($('erreur-jeton'), "La page n'a pas pu joindre le serveur. Réessayez dans un instant.");
  } finally {
    montrer($('attente-jeton'), false);
  }
});

$('bouton-sortie').addEventListener('click', async () => {
  // On ferme les DEUX : sur un poste partagé, laisser le rideau ouvert dispenserait le suivant de la
  // clé, et « fermer la session » ne fermerait qu'à moitié.
  //
  // ET ON VÉRIFIE QUE C'EST FAIT. Relevé par une revue adverse (12 oct. 2026) : la première version
  // avalait les erreurs et affichait l'écran de la clé quoi qu'il arrive. Réseau coupé, les cookies
  // restaient en place — la personne suivante rechargeait la page et reprenait la session de la
  // précédente, à son nom. Une déconnexion qu'on affiche sans l'avoir obtenue est pire que pas de
  // bouton du tout : elle fait partir quelqu'un rassuré à tort.
  const ferme = async (chemin) => {
    try { return (await fetch(chemin, { method: 'DELETE' })).ok; } catch { return false; }
  };
  const [session, rideau] = await Promise.all([ferme('/api/session'), ferme('/api/acces')]);
  if (!session || !rideau) {
    afficherErreur($('erreur-demande'),
      "La session N'A PAS pu être fermée : le serveur n'a pas répondu. Vous êtes toujours connecté. Réessayez, et si vous êtes sur un poste partagé, fermez le navigateur avant de le laisser.");
    return;
  }
  resultats.replaceChildren();
  afficherEtape('acces');
});

// ── La demande.

function boutonCopier(valeur, libelle) {
  const b = texte('button', libelle, 'copier');
  b.type = 'button';
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(valeur);
      const avant = b.textContent;
      b.textContent = '✓ Copié';
      b.classList.add('copie-faite');
      setTimeout(() => { b.textContent = avant; b.classList.remove('copie-faite'); }, 2000);
    } catch {
      // Le presse-papiers peut être refusé par le navigateur. Plutôt que de laisser croire que c'est
      // copié, on sélectionne le texte : la personne fait Cmd+C elle-même.
      const champ = b.previousElementSibling;
      if (champ) { const s = getSelection(); const r = document.createRange(); r.selectNodeContents(champ); s.removeAllRanges(); s.addRange(r); }
      b.textContent = 'Sélectionné : faites Cmd+C';
    }
  });
  return b;
}

function carteLien(l) {
  const carte = texte('article', null, l.apercu ? 'lien apercu' : 'lien');
  carte.appendChild(texte('h3', l.titre));
  if (l.rubrique) carte.appendChild(texte('p', l.rubrique, 'rubrique'));

  const bloc = texte('div', null, 'adresse-lien');
  bloc.appendChild(texte('code', l.lien));
  bloc.appendChild(boutonCopier(l.lien, l.apercu ? 'Copier quand même' : 'Copier le lien'));
  carte.appendChild(bloc);

  if (l.valableJusquau) {
    const m = texte('p', null, 'meta');
    m.appendChild(texte('span', 'Valable '));
    m.appendChild(texte('strong', `jusqu'au ${l.valableJusquau}`));
    if (typeof l.joursRestants === 'number') m.appendChild(texte('span', ` — soit ${l.joursRestants} jour${l.joursRestants > 1 ? 's' : ''}.`));
    carte.appendChild(m);
  }
  if (l.etatPhrase) {
    carte.appendChild(texte('span', l.etatPhrase, 'etat'));
    if (l.etatDetail) carte.appendChild(texte('p', l.etatDetail, 'meta'));
  }
  if (l.avertissement) carte.appendChild(texte('p', `⚠️ ${l.avertissement}`, 'avertissement'));
  return carte;
}

function carteRefus(r) {
  const carte = texte('article', null, 'refus');
  carte.appendChild(texte('h3', r.titre || r.adresse));
  carte.appendChild(texte('p', r.explication ?? "Cette adresse a été refusée par le service."));
  const d = document.createElement('details');
  d.appendChild(texte('summary', 'Adresse et motif exact'));
  d.appendChild(texte('p', r.adresse));
  // LE MOTIF BRUT RESTE VISIBLE. Une traduction qui avale l'original rend le diagnostic impossible le
  // jour où le service renvoie un motif que l'interface ne connaît pas encore.
  if (r.motif) d.appendChild(texte('code', r.motif));
  carte.appendChild(d);
  return carte;
}

function afficherResultats(d) {
  resultats.replaceChildren();
  const liens = d.liens ?? [];
  const refuses = d.refuses ?? [];
  const r = d.resume ?? {};

  if (d.panne) resultats.appendChild(texte('p', d.panne, 'erreur'));

  if (liens.length > 0) {
    const parties = [`${liens.length} lien${liens.length > 1 ? 's' : ''} sur ${r.demandes ?? liens.length} adresse${(r.demandes ?? 1) > 1 ? 's' : ''}`];
    if (r.apercus > 0) parties.push(`${r.apercus} à NE PAS diffuser`);
    if (refuses.length > 0) parties.push(`${refuses.length} refusée${refuses.length > 1 ? 's' : ''}`);
    resultats.appendChild(texte('p', parties.join(' · '), 'resume'));

    const diffusables = liens.filter((l) => !l.apercu);
    if (diffusables.length > 1) {
      const bloc = texte('div', null, 'adresse-lien');
      bloc.appendChild(texte('span', `Les ${diffusables.length} liens diffusables, titre et adresse`));
      bloc.appendChild(boutonCopier(diffusables.map((l) => `${l.titre}\n${l.lien}`).join('\n\n'), 'Tout copier'));
      resultats.appendChild(bloc);
      // Les aperçus sont volontairement exclus du « tout copier » : la commodité ne doit pas rendre
      // plus facile de diffuser le lien qu'on vient d'avertir de ne pas diffuser.
      if (r.apercus > 0) resultats.appendChild(texte('p', r.apercus > 1
        ? `Les ${r.apercus} liens signalés en rouge ne sont pas inclus.`
        : 'Le lien signalé en rouge n\u2019est pas inclus.', 'precision'));
    }
    for (const l of liens) resultats.appendChild(carteLien(l));
  }

  if (refuses.length > 0) {
    resultats.appendChild(texte('p', `${refuses.length} adresse${refuses.length > 1 ? 's' : ''} refusée${refuses.length > 1 ? 's' : ''}`, 'resume'));
    for (const x of refuses) resultats.appendChild(carteRefus(x));
  }
}

$('form-demande').addEventListener('submit', async (e) => {
  e.preventDefault();
  afficherErreur($('erreur-demande'), null);
  resultats.replaceChildren();
  const bouton = $('bouton-creer');
  bouton.disabled = true;
  montrer($('attente'), true);
  try {
    const r = await fetch('/api/creer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adresses: $('adresses').value, jours: Number($('jours').value) }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 403) {
      afficherEtape(d.etape === 'acces' ? 'acces' : 'jeton', d.erreur ?? 'Session expirée. Entrez de nouveau votre jeton.');
      return;
    }
    if (d.liens || d.refuses || d.panne) {
      afficherResultats(d);
      // Les résultats s'écrivent sous le formulaire : sur un petit écran, ils sont hors de vue et la
      // personne croit qu'il ne s'est rien passé — puis reclique.
      resultats.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    afficherErreur($('erreur-demande'), d.erreur ?? 'Le service a répondu une erreur inattendue.');
  } catch {
    afficherErreur($('erreur-demande'), "La page n'a pas pu joindre le serveur. Aucun lien n'a été créé : réessayez dans un instant.");
  } finally {
    bouton.disabled = false;
    montrer($('attente'), false);
  }
});

// LE RIDEAU D'ABORD, MÊME SI LA SESSION EST ENCORE OUVERTE. Les deux cookies ne vivent pas la même
// durée — sept jours pour la session, trente pour le rideau, et on peut fermer l'un sans l'autre. Sans
// cette priorité, la page afficherait le formulaire à quelqu'un dont chaque demande sera refusée.
const depart = await etat();
poserInvite(depart.invite);
poserGuide(depart.guide);
afficherEtape(!depart.acces ? 'acces' : depart.ouverte ? 'demande' : 'jeton');
