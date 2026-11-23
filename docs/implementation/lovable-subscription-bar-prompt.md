# Message à coller dans Lovable — ne pas envoyer automatiquement

Prépare cette modification dans le brouillon du lecteur L’Express, sans publier.
Ne change ni l’hébergement ni les domaines, ni Piano, ni le suivi des lectures, ni les textes
traduits (en, fr, pl) déjà en place. Ne crée aucune table, migration ou fonction Supabase :
la base est préparée par l’équipe.

## 1. Une seule barre « S'abonner », collée en bas de l’écran

Supprime tous les autres boutons et liens d’abonnement de la page : en-tête, milieu de
l’article, fin de l’article, écrans « expiré », « retiré » et « lien inconnu ». Il n’en
reste qu’un, dans une barre collée en bas de l’écran, identique sur mobile et sur ordinateur.

- La barre est le **dernier élément** de la page, après `<main>`, avec `position: sticky;
  bottom: 0` (classes `sticky bottom-0`), **pas** `fixed`. Arrivée en bas de la page, elle
  reprend sa place sous le contenu : elle ne recouvre jamais la fin de l’article.
- Le conteneur racine de la page devient `flex min-h-screen flex-col` et `<main>` prend
  `flex-1` : sur un écran court (lien expiré), la barre reste en bas de l’écran.
- Aucun ancêtre de la barre ne doit avoir `overflow: hidden`, `auto` ou `scroll` : cela
  désactive `sticky`. Vérifie le layout racine.
- Fond opaque, fine bordure en haut, marge basse `env(safe-area-inset-bottom)` pour les
  téléphones à geste d’accueil. Le bouton occupe la largeur de la colonne de lecture.
- La barre s’affiche sur l’article (complet ou aperçu) et sur les écrans « expiré »,
  « retiré » et « lien inconnu ». Pas pendant le chargement, ni sur l’écran de panne
  technique (bouton « Réessayer ») : il n’y a encore rien à proposer.
- La phrase d’offre en fin d’article (« Cet article vous a été offert… ») reste, sans
  bouton sous elle. La phrase « Les articles offerts sont accessibles pendant une durée
  limitée » des écrans de refus reste aussi.
- Le lien « Lire la suite sur … » de l’aperçu ne change pas.

## 2. L’offre du moment

Le marketing peut déclarer une offre (libellé, lien, date de fin) pour un ou plusieurs sites.
La page la lit par une RPC publique dédiée, avec la clé `anon` déjà utilisée :

```
POST {url Supabase}/rest/v1/rpc/get_subscription_offer
corps : { "p_site": "<site>" }
réponse : [] ou [{ "label": text|null, "url": text|null, "ends_at": timestamptz }]
```

Le site se déduit de l’édition et de la langue de l’article déjà rendues par la lecture :

| Lecteur | Langue de l’article | `p_site` |
| --- | --- | --- |
| articles.lexpress.fr | (ignorée) | `www.lexpress.fr` |
| articles.lexpress.eu | en, ou inconnue (lien inconnu) | `www.lexpress.eu` |
| articles.lexpress.eu | fr | `fr.lexpress.eu` |
| articles.lexpress.eu | pl | `pl.lexpress.eu` |

Règles :

- **Un seul appel par affichage**, une fois la réponse de lecture reçue, avec un délai de
  4 secondes au plus. Pas de réessai. Cet appel ne compte aucune lecture. Ne réutilise pas
  la réponse obtenue pour un autre article (clé de cache : environnement, site **et jeton**) :
  un article ouvert après le début d’une offre doit la voir, et un article rouvert ne montre pas
  l’ancienne réponse pendant la nouvelle lecture (rien gardé en cache après l’affichage). Hors
  ligne, l’appel est tenté quand même : son échec rend le bouton par défaut.
- Tant que l’appel n’a pas répondu (4 s au plus), n’affiche pas encore la barre : pas de
  libellé qui change sous les yeux du lecteur.
- **Vérifie la réponse avant de l’utiliser**, sinon ignore l’offre entière : exactement une
  ligne ; `ends_at` lisible et dans le futur ; `label` nul, ou texte sans espace en début ni
  en fin, de 1 à 40 caractères, sans caractère de contrôle ni `<` `>` ; `url` nulle, ou
  `https://` sur un hôte de la liste ci-dessous, du même domaine que le site, sans port, sans
  identifiants, sans espace, 500 caractères au plus.
  - site `www.lexpress.fr` : `abonnements-digitaux.lexpress.fr`, `lexpress.fr`, `www.lexpress.fr` ;
  - sites `*.lexpress.eu` : `lexpress.eu`, `www.lexpress.eu`, `fr.lexpress.eu`, `pl.lexpress.eu`.
- `label` nul → texte actuel du bouton ; `url` nulle → lien actuel du bouton (tableau du §4).
- **Sans offre, en cas d’erreur HTTP (y compris 404 si la RPC n’existe pas encore), de
  réseau, de délai ou de réponse invalide : le bouton actuel, exactement.** Jamais de bouton
  vide, cassé ou absent sur un article.
- Une offre qui se termine pendant la lecture ne s’affiche plus au rendu suivant.

## 3. Suivi des clics : les UTM du visiteur s’ajoutent à l’URL de l’offre

Garde strictement la règle actuelle (tout paramètre `at_*`, plus `s`, rien d’autre, `set` et
jamais `append`), et applique-la aussi à l’URL de l’offre : ses propres paramètres (code
promo…) sont gardés, ceux du visiteur s’y ajoutent et l’emportent en cas de doublon.
Exemple : offre `https://abonnements-digitaux.lexpress.fr/offres?refTarif=1329`, lien offert
ouvert avec `?s=…&at_medium=Newsletter&utm_source=x` → bouton
`https://abonnements-digitaux.lexpress.fr/offres?refTarif=1329&s=…&at_medium=Newsletter`.

## 4. Textes et liens par défaut (inchangés)

| Cas | Texte | Lien |
| --- | --- | --- |
| articles.lexpress.fr | S'abonner à L'Express | https://abonnements-digitaux.lexpress.fr/offres |
| articles.lexpress.eu, article en | Subscribe | https://www.lexpress.eu/subscribe/ |
| articles.lexpress.eu, article fr | S'abonner | https://fr.lexpress.eu/abonnement/ |
| articles.lexpress.eu, article pl | Subskrypcja | https://pl.lexpress.eu/subskrypcja/ |
| articles.lexpress.eu, langue inconnue | Subscribe to L'Express Europe | https://www.lexpress.eu/subscribe/ |

## 5. Aucune navigation interne dans le corps de l’article

Dans le corps de l’article, après l’assainissement HTML existant (garde-le tel quel), retire
les liens qui mènent vers L’Express **en gardant leur texte** (et son gras, son italique) :
tout lien vers `lexpress.fr`, `lexpress.eu` ou l’un de leurs sous-domaines, quelle que soit la
casse, ainsi que les liens relatifs, les ancres `#…`, les liens `//…` sans protocole et tout
ce qui n’est pas une adresse `http(s)://` absolue lisible. Lis la vraie valeur de l’attribut
`href` (le premier, comme le navigateur), jamais un texte qui lui ressemble dans un autre
attribut (`title="… href=…"`) ; une balise illisible (guillemet non fermé) est retirée aussi. N’ajoute aucun bloc « Pour aller
plus loin ». Les liens vers d’autres sites (rapport, PDF officiel…) restent cliquables, comme
aujourd’hui. Le lien « Lire la suite » de l’aperçu n’est pas dans le corps : il reste.

## Référence

Ce message suffit à lui seul. Si un patch de référence est collé à sa suite (fichiers
`src/components/SubscribeButton.tsx`, `src/lib/subscriptionLink.ts`,
`src/lib/subscriptionOffer.ts`, `src/lib/internalLinks.ts`, `src/routes/a.$token.tsx`), il
montre une mise en œuvre validée par tests et par un contrôle de types strict. Il a été
préparé contre une copie du lecteur qui peut être plus ancienne que ton brouillon : inspecte
les écarts, ne remplace pas un fichier entier si des changements plus récents existent. Il ne
couvre ni l’en-tête ni le layout racine : applique-leur les règles du §1.

## Recette TEST obligatoire avant proposition de publication

L’équipe fournit des liens de recette sur la base TEST (un article France, un article de
chacun des trois sites Europe, un lien expiré) et y crée les offres de recette. Si la RPC
`get_subscription_offer` est absente de TEST, arrête-toi et demande-la : ne crée rien toi-même.

1. Sans offre : sur chaque lien, une seule barre en bas, texte et lien du tableau du §4,
   aucun autre bouton d’abonnement sur la page (en-tête, milieu, fin, écrans de refus).
2. Mobile (largeur 375 px) et ordinateur : la barre reste visible pendant le défilement ; tout
   en bas, la dernière ligne de l’article et la phrase d’offre sont entièrement visibles
   au-dessus de la barre. Sur iPhone, la barre ne passe pas sous la zone du geste d’accueil.
3. Offre France en cours : texte et lien de l’offre sur articles.lexpress.fr ; les articles
   Europe gardent leur bouton. Offre polonaise : seulement sur un article pl.lexpress.eu.
4. Lien ouvert avec `?s=…&at_medium=Test&utm_source=x` : le bouton de l’offre garde ses
   propres paramètres, reçoit `s` et `at_medium`, pas `utm_source`.
5. RPC coupée (réseau bloqué dans les outils du navigateur) : bouton par défaut après 4 s au
   plus, article lisible.
6. Article dont le corps contient un lien vers lexpress.fr et un lien externe : le premier est
   du texte simple, le second reste cliquable.
7. Lien expiré, retiré, inconnu : une barre, aucun autre bouton. Écran de panne technique :
   pas de barre, bouton « Réessayer » inchangé.
8. Un seul appel de lecture par tentative, inchangé ; un seul appel d’offre par affichage.

Rends le diff et les résultats de tests. Attends l’accord écrit d’Ophélie avant
publication. N’applique aucune migration et ne déploie aucune fonction Supabase.
