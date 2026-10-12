# L'interface web — offrir un article sans terminal

Une page, un champ, un bouton. On y colle l'adresse d'un article de lexpress.fr, on obtient un lien à
diffuser. Aucune commande, aucun jeton à manipuler, aucun `curl`.

Elle s'adresse aux personnes pour qui la Partie I du README principal est déjà trop technique : la
Partie I suppose qu'on sache obtenir un jeton, le ranger dans un gestionnaire de secrets et composer
une requête HTTP. Ici, le jeton est **côté serveur** et personne ne le voit.

```
navigateur ──► /api/creer (Vercel, côté serveur, porte le jeton)
                  └──► POST /functions/v1/create-gift-links (Supabase)
```

**Le jeton de service ne descend jamais dans le navigateur.** C'est toute la raison d'être des deux
fonctions serveur : la page ne connaît que `/api/creer`, et `/api/creer` seul connaît le jeton. Le
mettre dans la page reviendrait à le publier — le code d'une page est lisible par qui l'affiche.

## Ce qu'elle fait, et ce qu'elle ne fait pas

| Elle fait | Elle ne fait pas |
| --- | --- |
| créer un lien pour un article, jusqu'à 10 à la fois | retirer un lien (`withdrawn_at`) — c'est une décision éditoriale, délibérément hors d'une interface |
| prolonger un lien existant — il suffit de redemander l'article avec une durée plus longue | lister les liens déjà créés — cela demanderait d'ouvrir une table volontairement fermée |
| dire en français pourquoi une adresse est refusée | poser un corps de démonstration (`fake_body`), réservé à la recette |
| **avertir en rouge quand un lien ne mènera qu'au mur d'abonnement** | nommer QUI a créé un lien : tout le monde partage le même mot de passe (voir plus bas) |

Le dernier point de la première colonne est le plus utile. Un lien en `preview` est un succès pour
l'API — 200, un lien valide — et un échec pour la personne qui le diffuse : le destinataire verra le
mur d'abonnement, c'est-à-dire exactement ce que ce service existe pour éviter. Et rien n'a l'air
anormal : la page reçue est belle, elle porte le titre et l'image. **Personne ne signale jamais ce
problème**, ni le destinataire, ni l'expéditeur. L'interface, elle, le dit.

## La regarder tout de suite, sans rien créer

```sh
node interface/serveur-local.mjs
```

Puis <http://localhost:3000>, mot de passe `demonstration-locale`.

**Sans `GIFT_SERVICE_TOKEN` dans l'environnement, le service est remplacé par une réponse fabriquée sur
place : aucune requête ne sort de la machine, aucun lien réel n'est créé.** Le mode démonstration est le
défaut, et c'est délibéré — lancer un serveur pour « juste voir la page » ne doit pas pouvoir fabriquer
des accès à des articles payants par distraction. Il rend les trois cas qui comptent : un lien complet,
un lien en aperçu (le bandeau rouge), un article retiré.

Taper une adresse contenant `retire` donne un refus du service ; une adresse d'ancien format
(`…_1302698.html`) donne un refus de l'interface, sans appel.

## Déployer sur Vercel

Le dépôt se déploie **tel quel** : pas de framework, pas de construction, aucune dépendance de
production. `public/` est servi en statique, `api/*.mjs` devient deux fonctions Node.

### 1. Le jeton de service

Créer un client API nommé `interface-web`, en suivant **« Créer un jeton (administration) »** dans le
README principal — les cinq étapes, sans en sauter. Un client distinct, et pas celui de `growth` ou de
l'agent WhatsApp : c'est ce qui permet de voir dans `gift_links_by_client` ce que l'interface a produit,
et de la couper seule si besoin.

### 2. Les trois variables

Dans Vercel → le projet → **Settings → Environment Variables**. Les trois sont à marquer
**Sensitive** : une variable marquée ainsi ne peut plus être relue depuis le tableau de bord.

| Variable | Valeur | Comment l'obtenir |
| --- | --- | --- |
| `GIFT_SERVICE_TOKEN` | le jeton du client `interface-web` | étape 1 — il n'est montré qu'une fois |
| `INTERFACE_MOT_DE_PASSE` | le mot de passe partagé de l'équipe | choisi par vous, **12 caractères au moins** |
| `INTERFACE_SECRET_SESSION` | la clé qui signe les cookies | `openssl rand -hex 32` |

`GIFT_API_URL` est facultative : sans elle, l'interface appelle la fonction de production.

**Une configuration incomplète ferme la porte, elle ne l'ouvre pas.** Si le mot de passe ou le secret
manquent, la page répond « cette interface n'est pas configurée » et refuse tout le monde. Le repli
inverse — pas de mot de passe configuré, donc pas de contrôle — publierait l'interface au premier
déploiement mal réglé.

### 3. Déployer

Connecter le dépôt à Vercel et déployer. Aucun réglage de framework : `vercel.json` dit déjà qu'il n'y
a rien à construire. Vérifier ensuite, dans l'ordre :

1. la page demande le mot de passe ;
2. un mauvais mot de passe est refusé ;
3. le bon mot de passe ouvre le formulaire ;
4. une adresse d'ancien format est refusée **avec sa phrase d'explication** ;
5. un vrai article rend un lien — et **ce lien crée un vrai accès**, donc choisir un article qu'on
   accepte d'avoir offert quinze jours.

### 4. Fermer l'accès autrement qu'avec le mot de passe

Un mot de passe partagé protège d'un passant, pas d'une fuite : il ne nomme personne, il ne s'annule
pas pour une seule personne, et il circule. **Si l'équipe dépasse quelques personnes, activer en plus la
protection de déploiement de Vercel** (*Deployment Protection*), qui exige une identification
individuelle. Les deux se cumulent sans conflit.

Trois gestes utiles le jour où ça tourne mal :

| Problème | Geste |
| --- | --- |
| le mot de passe a fuité | changer `INTERFACE_MOT_DE_PASSE`, redéployer — toutes les sessions ouvertes survivent |
| il a fuité et il faut couper tout de suite | changer aussi `INTERFACE_SECRET_SESSION` : tous les cookies en cours deviennent invalides |
| l'interface elle-même doit être coupée | `SELECT public.revoke_api_client('interface-web');` — l'interface ne crée plus rien, **les liens déjà créés continuent de fonctionner** |

Cette dernière ligne compte : révoquer un jeton ferme la porte, elle ne rappelle pas ce qui est sorti.
Un lien déjà diffusé reste valable jusqu'à sa date de fin.

## Quand ça casse

Les deux fonctions écrivent une ligne JSON par incident, visible dans Vercel → **Logs**. Même principe
que la fonction Edge, et **ni mot de passe, ni jeton de service, ni jeton de lien n'y figurent jamais** :
le jeton d'un lien EST l'accès à l'article premium. On nomme les adresses, qui sont publiques.

| `evenement` | Ce qui s'est passé |
| --- | --- |
| `mot_de_passe_refuse` | quelqu'un s'est trompé — ou cherche |
| `origine_refusee` | une requête venue d'un autre site : refusée |
| `configuration_incomplete` | les variables ne sont pas posées ; la page refuse tout le monde |
| `jeton_de_service_absent` | `GIFT_SERVICE_TOKEN` manque : l'interface ne peut rien créer |
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

- **sans session, le service n'est pas appelé** — pas « l'appel échoue » : pas appelé. Le test compte
  les appels sortants et exige zéro ;
- le jeton de service n'apparaît ni dans une réponse, ni dans une ligne de journal ;
- le corps envoyé au service n'emploie que les clés qu'il accepte ;
- une panne de transport donne un message qui dit « revenez », jamais « votre article est refusé » ;
- la page n'insère aucun HTML : les libellés viennent de ce que la personne a collé.

Les handlers sont écrits en `fetch(Request) → Response` pour cette raison précise : Node 22 sait les
exécuter sans Vercel, donc les tests exercent le vrai code. Les adaptateurs `api/*.mjs` ne contiennent
aucune logique — un test l'impose, sinon la plateforme exécuterait du code que rien ne vérifie.
