// La page n'a AUCUNE règle. Elle demande, elle affiche. Les motifs de refus, les durées autorisées, les
// phrases d'état : tout vient du serveur. Une règle recopiée dans le navigateur finit par diverger de
// celle du service, et c'est l'utilisateur qui paie la différence.
//
// RIEN N'EST INSÉRÉ EN HTML. Les adresses affichées viennent de ce que la personne a collé : passer par
// `innerHTML` donnerait à n'importe qui collant du balisage le moyen de réécrire la page. On construit
// des nœuds et on remplit `textContent`.

const $ = (id) => document.getElementById(id);
const ecranMotDePasse = $('ecran-mot-de-passe');
const ecranDemande = $('ecran-demande');
const resultats = $('resultats');

const montrer = (element, visible) => { element.hidden = !visible; };
const pied = document.querySelector('footer');

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

async function etatSession() {
  try {
    const r = await fetch('/api/session', { headers: { accept: 'application/json' } });
    const d = await r.json();
    return d?.ouverte === true;
  } catch { return false; }
}

function basculerVers(ouverte, message) {
  montrer(ecranMotDePasse, !ouverte);
  montrer(ecranDemande, ouverte);
  // « Fermer la session » n'a aucun sens tant qu'aucune session n'est ouverte.
  montrer($('bouton-sortie').parentElement, ouverte);
  if (!ouverte) {
    afficherErreur($('erreur-mot-de-passe'), message);
    $('mot-de-passe').value = '';
    $('mot-de-passe').focus();
  }
}

$('form-mot-de-passe').addEventListener('submit', async (e) => {
  e.preventDefault();
  afficherErreur($('erreur-mot-de-passe'), null);
  try {
    const r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motDePasse: $('mot-de-passe').value }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ouverte) { basculerVers(true); $('adresses').focus(); return; }
    afficherErreur($('erreur-mot-de-passe'), d.erreur ?? 'Connexion impossible.');
  } catch {
    // Un échec de réseau n'est pas un mot de passe refusé : le dire autrement éviterait de chercher
    // pendant dix minutes une faute de frappe dans un mot de passe correct.
    afficherErreur($('erreur-mot-de-passe'), "La page n'a pas pu joindre le serveur. Réessayez dans un instant.");
  }
});

$('bouton-sortie').addEventListener('click', async () => {
  await fetch('/api/session', { method: 'DELETE' }).catch(() => {});
  resultats.replaceChildren();
  basculerVers(false);
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
    if (r.status === 403) { basculerVers(false, d.erreur ?? 'Session expirée. Entrez de nouveau le mot de passe.'); return; }
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

basculerVers(await etatSession());
