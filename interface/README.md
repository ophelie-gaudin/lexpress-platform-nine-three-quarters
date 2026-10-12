# L'interface web — offrir un article sans terminal

Une page, un champ, un bouton. On y colle l'adresse d'un article de lexpress.fr, on obtient un lien à
diffuser. Aucune commande, aucun jeton à manipuler, aucun `curl`.

Elle s'adresse aux personnes pour qui la Partie I du README principal est déjà trop technique : la
Partie I suppose qu'on sache ranger un jeton dans un gestionnaire de secrets et composer une requête
HTTP. Ici, on colle son jeton une fois, et on n'y repense pas pendant une semaine.

```
navigateur ──► /api/creer (Vercel) ──► POST /functions/v1/create-gift-links (Supabase)
   le jeton est saisi       il est descellé du cookie      en-tête x-gift-service-token
   une fois, puis oublié    le temps de la requête
```

## Deux barrières, et elles ne protègent pas la même chose

| | Ce que c'est | Ce que ça ouvre | Ce que ça n'ouvre pas |
| --- | --- | --- | --- |
| **La clé d'accès** | partagée par l'équipe | la page | rien d'autre : aucun lien ne se crée avec |
| **Le jeton personnel** | un par personne, celui de son client `api_clients` | la création de liens, à son nom | — |

**La clé d'accès est un rideau, pas une serrure.** Elle ne donne aucun pouvoir, ne nomme personne, et
ne protège pas le service : qui détient un jeton personnel peut de toute façon appeler l'API Supabase
directement, sans passer par cette page. Ce qu'elle apporte réellement : plus de robot qui sonde
`/api/session` et `/api/creer`, et une faille future dans ces routes qui n'est plus atteignable par un
anonyme. Elle réduit la surface, elle ne remplace pas le jeton.

**Elle ne cache pas la page, et il ne faut pas le croire.** Le HTML est statique et public : n'importe
qui peut demander `GET /`, lire le code de l'écran du jeton, et retirer l'attribut `hidden` dans son
navigateur. Le dépôt lui-même est public. Ce qui est gardé, ce sont les ROUTES — ce que l'écran permet
de faire, pas le fait de le voir. Relevé par une revue adverse le 12 octobre 2026, parce que ce
document promettait l'inverse.

**Ce n'est pas un second facteur.** Deux secrets qu'on connaît ne font pas deux facteurs
indépendants : quelqu'un qui obtient le jeton d'une personne obtient souvent la clé d'équipe par le
même chemin. C'est de la défense en profondeur, pas de l'authentification forte.

**Elle garde l'API, pas seulement l'affichage.** `/api/session` et `/api/creer` la vérifient en
premier : un cookie de session parfaitement valide sans le rideau est refusé. Une barrière qui ne vit
que dans l'apparence de la page se contournerait en appelant `/api/creer` à la main.

**Elle est obligatoire.** Sans `INTERFACE_CLE_ACCES`, l'interface refuse tout le monde et le dit. Une
couche de sécurité qu'on saute en silence quand sa variable manque est le genre de repli qui se
découvre après coup.

**Deviner la clé coûte cher, par construction.** Un jeton de 64 hexadécimaux est hors de portée d'une
recherche exhaustive ; une clé choisie par un humain, non. Sur une plateforme sans état comme Vercel,
on ne peut pas compter les tentatives de façon fiable — chaque requête peut tomber sur une instance
neuve. Alors on ne compte pas : on fait payer. Chaque essai coûte un `scrypt` d'environ un quart de
seconde, soit sept heures de machine pour cent mille essais. **Ça ne dispense pas d'une clé longue** :
prenez-la générée, pas inventée.

> **Et ce coût est payé par NOTRE serveur.** La revue du 12 octobre l'a relevé : la défense contre la
> devinette était aussi un amplificateur de déni de service — n'importe qui pouvait déclencher le
> calcul en boucle. Deux garde-fous depuis : une valeur hors des longueurs admises est refusée **sans
> calculer**, et au-delà de deux calculs simultanés dans une instance, la route rend `429` au lieu de
> saturer. Ça borne le processeur d'une instance, **pas la facture** : si la charge fait démarrer
> d'autres instances, c'est au pare-feu de Vercel de répondre, pas à ce code. Activez-le si vous voyez
> des rafales de `cle_acces_refusee`.

## Chacun son jeton

**Le déploiement ne détient aucun jeton de service.** Chaque personne entre le sien ; l'interface le
scelle dans un cookie chiffré et le ressort à chaque demande.

C'est ce qui fait tenir trois choses que le service a construites et qu'un jeton partagé aurait
perdues :

| | Avec un jeton partagé | Avec un jeton par personne |
| --- | --- | --- |
| `gift_links_by_client` | `interface-web` pour tout le monde | le nom de la personne |
| couper quelqu'un | impossible sans couper tout le monde | `revoke_api_client('interface-claire')` |
| un départ | changer le secret, prévenir toute l'équipe | révoquer une ligne, personne d'autre n'est touché |

Et une quatrième : **les variables de Vercel ne suffisent plus à fabriquer un lien.** Qui les
obtiendrait n'aurait aucun jeton de service.

> **Nuance apportée par la revue du 12 octobre, et elle compte.** Ce paragraphe a d'abord dit que ces
> variables « ne valaient plus grand-chose ». C'est faux : `INTERFACE_SECRET_SESSION` descelle les
> cookies. Qui l'obtient **et** intercepte le cookie d'une personne connectée en retire son jeton
> personnel en clair. Les variables valent donc encore beaucoup — simplement, il faut deux choses au
> lieu d'une.

### Comment le jeton est gardé

**Scellé par chiffrement, pas seulement signé.** Un cookie signé est lisible : le jeton s'y promènerait
en clair dans chaque requête et dans les journaux du moindre mandataire. Ici, AES-256-GCM avec une clé
dérivée de `INTERFACE_SECRET_SESSION` ; le sceau rend toute retouche détectable.

**`HttpOnly`, `Secure`, `SameSite=Strict`, sept jours.** Le script de la page ne peut pas lire le
cookie, donc une faille XSS ne l'emporte pas. La page ne range le jeton nulle part — ni `localStorage`,
ni `sessionStorage` — et vide le champ de saisie dès qu'il est posté. Un test l'impose.

Sept jours plutôt que douze heures : un jeton de 64 caractères ne se retape pas de mémoire, et une
session trop courte le ferait recopier tous les matins, donc traîner dans un fichier ouvert. Le bouton
« Fermer la session » est là pour le poste partagé.

### Comment un jeton est vérifié à l'entrée

L'interface envoie au service une demande **vide** — `{"urls": []}`. Le service authentifie d'abord :
un jeton refusé rend `401` avant d'avoir rien lu, un jeton reconnu passe puis bute sur « aucune URL
exploitable », un `400`. Donc **401 = refusé, autre chose = reconnu**.

Cette sonde n'écrit rien, ne charge aucun article, ne crée aucun lien. Elle laisse deux traces qu'il
faut connaître : le compteur `appels` du client avance d'une unité, et le journal de la fonction Edge
reçoit une ligne `aucune_url_exploitable` à chaque ouverture de session.

**Un service injoignable n'est pas un jeton refusé.** Confondre les deux enverrait quelqu'un chercher
une faute dans un jeton parfaitement valide pendant que la base est en panne : réseau coupé, délai
dépassé ou `503` donnent « revenez », jamais « votre jeton est faux ».

## Ce qu'elle fait, et ce qu'elle ne fait pas

| Elle fait | Elle ne fait pas |
| --- | --- |
| créer un lien pour un article, jusqu'à 10 à la fois | retirer un lien (`withdrawn_at`) — c'est une décision éditoriale, délibérément hors d'une interface |
| prolonger un lien existant — il suffit de redemander l'article avec une durée plus longue | lister les liens déjà créés — cela demanderait d'ouvrir une table volontairement fermée |
| dire en français pourquoi une adresse est refusée | poser un corps de démonstration (`fake_body`), réservé à la recette |
| **avertir en rouge quand un lien ne mènera qu'au mur d'abonnement** | rien faire sans jeton : elle n'en détient aucun |

Le dernier point de la première colonne est le plus utile. Un lien en `preview` est un succès pour
l'API — 200, un lien valide — et un échec pour la personne qui le diffuse : le destinataire verra le
mur d'abonnement, c'est-à-dire exactement ce que ce service existe pour éviter. Et rien n'a l'air
anormal : la page reçue est belle, elle porte le titre et l'image. **Personne ne signale jamais ce
problème**, ni le destinataire, ni l'expéditeur. L'interface, elle, le dit.

## La regarder tout de suite, sans rien créer

```sh
node interface/serveur-local.mjs
```

Puis <http://localhost:3000>. La clé d'accès et le jeton à coller sont affichés au démarrage.

**Le mode démonstration est le défaut, et c'est délibéré.** Le service est remplacé par une réponse
fabriquée sur place : aucune requête ne sort de la machine, aucun lien réel n'est créé. Lancer un
serveur pour « juste voir la page » ne doit pas pouvoir fabriquer des accès à des articles payants par
distraction. Il rend les trois cas qui comptent : un lien complet, un lien en aperçu (le bandeau
rouge), un article retiré. Pour viser le vrai service : `GIFT_API_REEL=1 node interface/serveur-local.mjs`.

Taper une adresse contenant `retire` donne un refus du service ; une adresse d'ancien format
(`…_1302698.html`) donne un refus de l'interface, sans appel.

## Déployer sur Vercel

Le dépôt se déploie **tel quel** : pas de framework, pas de construction, aucune dépendance de
production. `public/` est servi en statique, `api/*.mjs` devient deux fonctions Node.

### 1. Une seule variable

Dans Vercel → le projet → **Settings → Environment Variables** :

| Variable | Valeur | Comment l'obtenir |
| --- | --- | --- |
| `INTERFACE_SECRET_SESSION` | la clé qui scelle les cookies | `openssl rand -hex 32` |
| `INTERFACE_CLE_ACCES` | la clé d'accès partagée de l'équipe | `openssl rand -base64 18` — **16 caractères au minimum**, et une clé tirée au hasard plutôt qu'inventée |

À marquer **Sensitive** : une variable marquée ainsi ne peut plus être relue depuis le tableau de bord.
`GIFT_API_URL` est facultative — sans elle, l'interface appelle la fonction de production.

Aucun jeton de service dans Vercel : chaque personne apporte le sien.

**Une configuration incomplète ferme la porte, elle ne l'ouvre pas.** S'il manque l'une des deux, la
page répond « cette interface n'est pas configurée » et refuse tout le monde.

### 2. Un jeton par personne

Pour chacun, suivre **« Créer un jeton (administration) »** dans le README principal — les cinq étapes,
sans en sauter. Nommer le client d'après la personne : `interface-claire`, `interface-paul`.

> Le README principal conseille ailleurs de nommer le service plutôt que la personne, « pour que le nom
> survive à un départ ». **Ici c'est l'inverse qu'on veut** : ce nom doit mourir avec le départ, parce
> qu'il désigne un accès individuel et non un système.

Transmettre le jeton par un canal sûr. Il n'est montré qu'une fois ; perdu, il ne se retrouve pas, on en
crée un autre.

L'étape 5 du README (la vérification par `curl`) **crée un vrai lien** : soit on la fait avec un article
qu'on accepte d'offrir, soit on s'en passe et on laisse la personne vérifier en se connectant — un jeton
refusé est refusé à l'entrée, avec son message.

### 3. Déployer depuis `production`, pas depuis `main`

Connecter le dépôt à Vercel. Aucun réglage de framework : `vercel.json` dit déjà qu'il n'y a rien à
construire.

**Puis changer la branche suivie** : *Project Settings → Environments → Production → Branch Tracking*,
remplacer `main` par `production`, enregistrer.

| Branche | Ce qu'elle est | Ce que Vercel en fait |
| --- | --- | --- |
| `main` | le travail en cours, les tests, les revues | un déploiement de **préversion**, à une URL à part |
| `production` | ce que les utilisateurs ont sous les yeux | **le** déploiement, à l'URL qu'ils connaissent |

Mettre en ligne devient alors un geste explicite, et réversible :

```sh
git switch production && git merge --ff-only main && git push origin production
```

`--ff-only` est volontaire : il refuse d'avancer si `production` a divergé. Mieux vaut un refus qu'une
fusion silencieuse de deux histoires sur la branche que les gens utilisent.

Revenir en arrière ne passe pas forcément par Git : dans Vercel, *Deployments* → le déploiement
précédent → **Promote to Production** remet l'ancienne version en ligne en quelques secondes, sans
toucher au dépôt.

**Les variables d'environnement sont à poser sur `Production` seulement.** Une préversion sans
`INTERFACE_SECRET_SESSION` refuse alors tout le monde en disant « cette interface n'est pas
configurée » — c'est le comportement voulu : une branche en cours de travail ne doit pas pouvoir
fabriquer des accès à des articles payants. Pour éprouver une préversion, lui donner une valeur
`Preview` distincte, jamais la même.

> **Le dépôt est public.** Par défaut, Vercel construit les préversions des *pull requests* venues de
> dépôts forkés, et ce code-là peut lire les variables d'environnement. Activer **Git fork protection**
> dans *Project Settings → Security*. C'est le réglage le plus important de cette page après le choix
> de la branche.

Vérifier ensuite, dans l'ordre :

1. la page demande la clé d'accès, et une clé fausse est refusée ;
2. la bonne clé fait apparaître l'écran du jeton ;
3. une valeur de travers — « bonjour » — est refusée sur sa forme, immédiatement ;
4. un jeton bien formé mais inconnu (64 `0`, par exemple) est refusé par le service, avec un message
   qui parle de révocation ;
5. votre jeton ouvre le formulaire ;
6. `https://www.lexpress.fr/politique/un-vieil-article_1302698.html` est refusé **avec sa phrase
   d'explication**, sans appeler le service ;
7. un vrai article rend un lien — **et ce lien est un vrai accès**. Mettre **1 jour** plutôt que 15 :
   assez pour vérifier, et peu à laisser ouvert derrière soi.

### 4. Couper un accès

| Problème | Geste | Effet |
| --- | --- | --- |
| une personne s'en va, ou son jeton a fuité | `SELECT public.revoke_api_client('interface-claire');` | elle ne crée plus rien, **à la demande suivante**, et personne d'autre n'est touché |
| la clé d'accès a circulé trop largement | changer `INTERFACE_CLE_ACCES`, redéployer | **tous les rideaux déjà ouverts se referment sur-le-champ** : la signature du cookie est liée à la clé en vigueur. Retirer la variable ferme aussi |
| il faut fermer toutes les sessions d'un coup | changer `INTERFACE_SECRET_SESSION`, redéployer | tous les cookies en cours deviennent indéchiffrables ; chacun recolle son jeton |
| il faut tout arrêter | révoquer chaque client `interface-*` | plus aucun lien créé depuis l'interface |

**Révoquer ferme la porte, ça ne rappelle pas ce qui est sorti.** Les liens déjà créés restent valables
jusqu'à leur date de fin — c'est voulu : quelqu'un les a reçus.

Une révocation prend effet à la demande suivante, pas pendant la session : le service refuse alors
l'appel, l'interface le voit, efface la session et renvoie à l'écran du jeton. Pour une coupure
immédiate, révoquer **et** changer la clé de scellement.

**La page elle-même reste publique** : qui connaît l'URL voit l'écran du jeton, et rien d'autre. Si
cela gêne, activer la *Deployment Protection* de Vercel par-dessus ; les deux se cumulent sans
conflit.

## Ce qui reste ouvert, et qui ne dépend pas de cette interface

Une revue adverse indépendante (GPT-6.1, 12 octobre 2026) n'a trouvé **aucun moyen pour un anonyme de
créer un lien sans jeton valide**, ni de lire les tables fermées. Elle a relevé quatre points qui
vivent ailleurs que dans ce dossier, et qui demandent une décision plutôt qu'un correctif :

| Point | Où | Pourquoi ça compte |
| --- | --- | --- |
| **Aucun plafond de création** | fonction Edge | un jeton volé fabrique autant d'accès qu'il veut, jusqu'à 365 jours, et les révoquer ne rappelle pas les liens déjà produits. Le plafond de dix adresses est celui de l'interface, pas celui de l'API |
| **`fake_body` ouvert à tous les jetons** | fonction Edge | un appel direct peut publier un texte de démonstration sous le domaine de lecture. La bannière limite la tromperie, pas le fait |
| **Le filtre de redirection arrive après la requête** | `_shared/arc.mjs` | `fetch` suit la redirection, puis on vérifie où l'on a atterri : la requête sortante a déjà eu lieu. Aucune URL exploitable identifiée |
| **L'assainissement ne décode pas les entités** | `_shared/arc.mjs` | `java&#x73;cript:` traverse le filtre — vérifié. Il faudrait maîtriser le contenu Arc, et la page de lecture a sa propre liste blanche. Mais le principe de cette fonction est justement de ne pas s'y fier |

## Quand ça casse

Les deux fonctions écrivent une ligne JSON par incident, visible dans Vercel → **Logs**. Même principe
que la fonction Edge, et **ni jeton de personne, ni jeton de lien n'y figurent jamais** :
le jeton d'un lien EST l'accès à l'article premium. On nomme les adresses, qui sont publiques.

| `evenement` | Ce qui s'est passé |
| --- | --- |
| `cle_acces_refusee` | quelqu'un s'est trompé de clé — ou cherche. Une rafale ici est le signal à surveiller |
| `verification_cle_saturee` | trop de vérifications simultanées : la route rend 429. Une rafale signale une tentative de saturation |
| `jeton_mal_forme` | une valeur collée de travers ; refusée sans appeler le service |
| `jeton_refuse` | le service ne reconnaît pas ce jeton, ou il est révoqué |
| `jeton_revoque_en_session` | un jeton valide à l'entrée a été révoqué depuis ; la session est effacée |
| `verification_indisponible` | le service n'a pas répondu à la sonde : on ne peut pas conclure, et on ne conclut pas |
| `origine_refusee` | une requête venue d'un autre site : refusée |
| `configuration_incomplete` | les variables ne sont pas posées ; la page refuse tout le monde |
| `service_injoignable` | Supabase n'a pas répondu, ou pas à temps |
| `aucun_lien_obtenu` | le service a refusé le lot entier ; son motif est joint |
| `lot_partiel` | une partie est passée, le reste non |
| `apercu_seulement` | **un lien qui mène au mur d'abonnement** — un 200, et pourtant un échec |

Côté service, les mêmes événements se retrouvent dans Supabase → *Logs → Edge Functions* (sept jours de
rétention, plan Pro). Voir « Diagnostiquer une panne » dans le README principal.

## Les tests

```sh
npm test        # inclut validate-interface.mjs
```

Les contrôles qui comptent, et qu'on peut casser exprès pour les voir échouer :

- **changer la clé d'accès referme les rideaux ouverts**, et la retirer ferme la porte ;
- **au-delà de deux calculs simultanés, la route refuse sans calculer** ;
- **une déconnexion qui échoue est dite**, et la page ne bascule pas ;
- **seul un `400` du service vaut reconnaissance d'un jeton** — un `502` de passerelle dit « revenez » ;

- **sans session, le service n'est pas appelé** — pas « l'appel échoue » : pas appelé. Le test compte
  les appels sortants et exige zéro ;
- **la clé d'accès garde l'API** : un cookie de session valide sans le rideau est refusé ;
- **et elle n'autorise rien** : le rideau seul ne crée aucun lien ;
- **le jeton n'est pas en clair dans le cookie**, et le serveur le retrouve pourtant intact ;
- **c'est le jeton de la personne qui part au service** : le test pose un jeton leurre dans
  l'environnement et vérifie qu'il n'est jamais employé ;
- deux sessions ouvertes avec deux jetons appellent le service avec deux jetons ;
- un service injoignable rend 503, jamais 401 ;
- le jeton n'apparaît ni dans une réponse, ni dans une ligne de journal, et la page ne le range nulle
  part — ni `localStorage`, ni `sessionStorage` ;
- le corps envoyé au service n'emploie que les clés qu'il accepte ;
- une panne de transport donne un message qui dit « revenez », jamais « votre article est refusé » ;
- la page n'insère aucun HTML : les libellés viennent de ce que la personne a collé.

Les handlers sont écrits en `fetch(Request) → Response` pour cette raison précise : Node 22 sait les
exécuter sans Vercel, donc les tests exercent le vrai code. Les adaptateurs `api/*.mjs` ne contiennent
aucune logique — un test l'impose, sinon la plateforme exécuterait du code que rien ne vérifie.
