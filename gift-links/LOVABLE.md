# Consigne pour Lovable — page `/a/:token`

À coller dans Lovable. Le reste du design est déjà fait ; il s'agit de **brancher la page sur la base**
et de traiter les cinq états.

## 1. Connexion

```
URL      https://ovifzentveeehhtlnugk.supabase.co
clé anon eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92aWZ6ZW50dmVlZWhodGxudWdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NTQ2OTUsImV4cCI6MjEwNjQzMDY5NX0.t3h2cV1RPYvODX68o4_celDfJjNWHmHyn2TiH2GKSMI
```

Cette clé est publique par construction : elle ne donne accès à **rien** d'autre qu'à la fonction
ci-dessous. Les tables sont fermées — un `select` sur `articles` répond 401. C'est ce qui protège les
articles premium : si la page pouvait lire la table, il suffirait de l'énumérer.

## 2. L'appel, et lui seul

```js
const p = new URLSearchParams(location.search);

const { data, error } = await supabase.rpc('get_gift_article', {
  p_token: token,
  p_utm_source:     p.get('at_medium'),          // Whatsapp — ou Whatsapp_test
  p_utm_campaign:   p.get('at_campaign'),        // prospects — ou prospects_test
  p_referrer:       document.referrer || null,
  p_send_id:        p.get('s'),                  // l'identifiant d'ENVOI
  p_campaign_group: p.get('at_campaign_group'),  // prospects_chauds, prospects_paid…
});
const article = data?.[0];   // toujours UNE ligne, jamais une erreur
```

**Ce qui change (5 oct. 2026)** — trois paramètres de plus, tous lus dans la query string :

- **`s` → `p_send_id`.** C'est le changement important. Le token est **partagé par article** : plusieurs
  personnes reçoivent le même lien, donc le compteur d'ouvertures ne désigne personne. `s` identifie
  l'ENVOI, et rend la lecture attribuable. Sans lui, l'agent ne peut pas savoir qui a lu, et sa relance
  part à l'aveugle.
- **`at_medium` et `at_campaign`** remplacent `utm_source` et `utm_campaign` : c'est le vocabulaire des
  liens de lexpress.fr, et celui que Piano lira.
- **`at_campaign_group`** porte le segment du prospect.

**Ne rien inventer quand un paramètre manque.** Passer `null`, jamais une valeur par défaut : une absence
est une information. Un lien ouvert sans `s` est une visite directe ou un lien transféré — pas une lecture
attribuable, et c'est très bien ainsi.

**Ne jamais afficher ces valeurs ni les faire apparaître dans l'interface.** Elles servent la mesure, pas
le lecteur.

**L'ordre de déploiement est sûr.** Les nouveaux paramètres de la fonction portent tous une valeur par
défaut : la version actuelle de la page, qui n'en nomme que quatre, continue de fonctionner. Rien ne casse
entre la migration et cette mise à jour.

`get_gift_article` rend toujours une ligne. Il n'y a pas de cas « erreur » à gérer : le champ `status`
porte le résultat. Ne pas appeler l'API `create-gift-links` depuis la page — elle lui est interdite.

## 3. Les cinq états

| `status` | Ce qu'on affiche |
| --- | --- |
| `ok` | l'article complet : image, rubrique, titre, chapeau, **`author`**, date, `body` |
| `preview` | image, rubrique, titre, chapeau, date — **pas de corps** — puis « Lire la suite sur lexpress.fr » vers `canonical_url`, et le bouton d'abonnement |
| `expired` | « Ce lien a expiré. » + bouton d'abonnement |
| `withdrawn` | « Cet article n'est plus disponible. » + bouton d'abonnement |
| `unknown` | « Ce lien n'existe pas. » + bouton d'abonnement |

**`expired` et `withdrawn` ne disent pas la même chose au lecteur** : l'un a laissé passer le temps,
l'autre n'a plus rien à lire. Deux messages distincts, jamais un message générique pour les deux.

**`preview` n'est pas une erreur.** C'est l'état normal tant que l'accès au contenu n'est pas rétabli :
la page doit être belle et complète dans cet état, pas dégradée ni accompagnée d'un message d'excuse.
C'est ce que verront les prospects au lancement.

**Ne jamais afficher `body` quand il est nul**, et ne jamais fabriquer de texte de remplacement.

## 4. La signature

`author` est désormais rendu par la fonction : « Laureline Dupont », ou « Erwan Bruckert, Béatrice
Mathieu » quand l'article est cosigné. **`null` quand la signature est inconnue** : afficher alors la
date seule, et ne jamais inventer de nom.

## 5. Le bouton d'abonnement

Présent dans les cinq états, y compris sur un refus.

Destination : `https://abonnements-digitaux.lexpress.fr/offres`

**La page ne fabrique aucun paramètre de suivi : elle recopie ceux du visiteur.**

```js
const p = new URLSearchParams(location.search);
const abo = new URL('https://abonnements-digitaux.lexpress.fr/offres');

// LISTE BLANCHE. Tout `at_*` passe, plus `s`. Rien d'autre.
for (const [cle, valeur] of p)
  if (valeur && (cle.startsWith('at_') || cle === 's')) abo.searchParams.set(cle, valeur);

// href = abo.toString()
```

**Ce qui change (8 oct. 2026)** — avant, la page posait `refTarif=1329`, codait en dur
`at_medium=Whatsapp` et `at_campaign=prospects`, et lisait `at_campaign_group` dans le champ `campaign`
rendu par la base. Les trois étaient faux pour des raisons différentes.

- **Le canal codé en dur.** Il était vrai quand WhatsApp était le seul appelant. Le service s'ouvre à
  d'autres : une newsletter qui diffuse un lien offert verrait ses abonnements attribués à WhatsApp.
- **La campagne relue de la base.** Un lien est COMMUN à tous ses destinataires. Offert en
  `prospects_chauds` lundi puis en `prospects_abandon` jeudi, il n'a qu'une ligne, et le dernier appel
  écrase la campagne du premier : les conversions de lundi partaient sur `prospects_abandon`. Le lecteur
  de lundi arrivait pourtant avec `at_campaign_group=prospects_chauds` dans sa propre URL.
- **`refTarif=1329`** désignait un tarif sur le formulaire d'inscription. `/offres` laisse choisir, ce
  qui convient à quelqu'un qui vient de lire un article offert et n'a rien demandé.

**POURQUOI UNE LISTE BLANCHE ET PAS UNE RECOPIE ENTIÈRE.** L'URL d'un lien offert est publique et se
transfère. Tout recopier laisserait n'importe qui y glisser les paramètres de son choix, qui
atterriraient dans Piano et pourraient écraser de vraies dimensions. `at_*` et `s`, rien d'autre.

**`set`, JAMAIS `append`.** Un paramètre présent deux fois dans l'URL d'arrivée donnerait deux valeurs
à la même dimension, et Piano garderait celle qu'il veut.

**Un paramètre absent reste absent.** Pas de valeur par défaut, pas de repli sur la base : c'est la même
règle que pour la lecture. Une absence est une information — un lien ouvert sans `at_medium` est un lien
transféré ou une visite directe, et le dire est plus utile que de l'attribuer au hasard.

Le bouton reste affiché **dans les cinq états**, refus compris. Les paramètres venant de l'URL, ils sont
présents même sur un lien expiré ou retiré : la conversion reste attribuée à ce qui a amené la personne
jusque-là.

### Ce que ça donne bout en bout

```
sollicitation    bouton WhatsApp → /a/<token>?s=<envoi>&at_medium=Whatsapp
                                   &at_campaign=prospects&at_campaign_group=prospects_chauds
lecture          gift_link_opens : une ligne, avec ce segment et cet envoi
abonnement       /offres?s=<envoi>&at_medium=Whatsapp&at_campaign=prospects
                 &at_campaign_group=prospects_chauds
```

Même vocabulaire des deux côtés : la base sait qui a lu, Piano sait qui s'est abonné, et `s` relie les
deux. C'est le seul maillon qui survit au départ vers lexpress.fr.

## 5 bis. Le corps contient du HTML

Relevé le 2 octobre sur une vraie réponse Arc : `body` porte des balises — `<b>`, `<i>`, `<a href>`,
parfois `<br>`. Dans un entretien, les questions du journaliste sont en gras : les afficher en texte
brut ferait apparaître les balises et perdrait la structure.

**Afficher le corps en HTML, mais en n'autorisant qu'une liste fermée de balises** : `b`, `strong`,
`i`, `em`, `a`, `br`, `p`. Tout le reste doit être échappé, pas interprété. Le contenu vient de notre
CMS, mais la page est publique et la règle ne coûte rien.

Les liens du corps pointent vers lexpress.fr : les laisser, et les ouvrir dans un nouvel onglet.

## 5 ter. Le corps porte désormais des citations et des images (7 oct. 2026)

Jusqu'ici le corps ne contenait que des paragraphes : l'extraction ne retenait que le texte, et les
citations comme les images tombaient en chemin. C'est corrigé côté service. **La liste fermée de balises
de la page doit s'ouvrir à six balises de plus**, sans quoi le travail reste invisible.

| Balise | Ce qu'elle porte |
| --- | --- |
| `<blockquote>` | une citation de l'article |
| `<cite>` | l'attribution de la citation, quand elle existe |
| `<figure>` | une image avec sa légende |
| `<img>` | l'image elle-même — attributs `src`, `alt`, `loading` |
| `<figcaption>` | la légende, qui peut contenir du gras et des liens |

**L'URL d'une image est toujours en `https://`** : le service écarte toute autre forme avant de
l'enregistrer. La page n'a donc pas à s'en défendre une seconde fois, mais elle ne doit pas non plus
accepter d'autres schémas si elle filtre déjà.

**Ce qui n'arrivera jamais, et qu'il ne faut pas prévoir** : `<script>`, `<iframe>`, `<style>`, les
attributs `on*`. Le service ne laisse passer que du texte, des citations et des images ; tout autre type
d'élément Arc est écarté à l'extraction.

**Les « à lire aussi » sont volontairement absents.** Ils mènent au paywall : les afficher dans un article
offert reviendrait à promettre une lecture libre, puis à buter le lecteur trois paragraphes plus loin.

**Mise en page suggérée** — une image en pleine largeur de colonne, sa légende en plus petit et en gris ;
une citation détachée, en retrait, dans un corps plus grand que le texte courant. Rien d'obligatoire :
c'est le sens qui compte, l'habillage est à vous.

## 6. Jeu d'essai — un lien par état

| État | Token |
| --- | --- |
| `ok` | `00000000000000000000000000000001` |
| `preview` | `00000000000000000000000000000002` |
| `expired` | `00000000000000000000000000000003` |
| `withdrawn` | `00000000000000000000000000000004` |
| `unknown` | `tk-demo-0001` |

Ces quatre articles sont factices et leurs identifiants n'existent pas chez Arc : aucun appel d'API ne
peut les modifier. Le jeu reste donc stable, contrairement au précédent, détruit deux fois par des appels
légitimes. Les cas `expired` et `withdrawn` portent un corps en base **exprès** : s'il s'affiche, c'est
que la page sert le contenu sans vérifier la date ni le retrait.

## 7. Deux points relevés sur le site publié (1er oct., 15 h 45)

> **Le premier est réglé** : publié à 16 h 50. Les cinq états rendent cinq pages distinctes sur
> `articles.lexpress.fr`, vérifié. Le second reste ouvert.


**Le branchement n'est pas en ligne.** Les bundles servis par `articles.lexpress.fr` ne contiennent
aucune trace du projet Supabase : ni la référence du projet, ni `get_gift_article`, ni même le mot
`rpc`. La page affiche donc « Cet article n'est plus disponible » pour les cinq liens, y compris ceux
qui sont valides. Le travail décrit existe sans doute dans l'aperçu, mais il reste à **publier**.

**Un échec technique ne doit pas se déguiser en décision éditoriale.** Quand la page ne parvient pas à
joindre le service, elle affiche aujourd'hui « Cet article n'est plus disponible » — une phrase qui
affirme au lecteur que l'article a été retiré. C'est faux, et c'est le genre de message qui empêche de
diagnostiquer. Il faut un sixième cas, distinct des cinq statuts : une erreur de chargement, avec un
message neutre (« Impossible d'afficher cet article pour le moment. ») et la possibilité de réessayer.
