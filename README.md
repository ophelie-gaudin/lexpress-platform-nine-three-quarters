# L’Express - Platform 9¾

**Offrir un article payant de L’Express à qui vous voulez, pour le temps que vous voulez.**

Vous donnez l’URL d’un article, le service rend un lien. Qui ouvre ce lien lit l’article en entier,
gratuitement, jusqu’à la date de fin — sans compte, sans abonnement, sans mur. Un passage dérobé vers
un article payant, ouvert à qui reçoit le lien et fermé à la date dite.

N’importe quel service peut l’appeler : l’agent WhatsApp le fait déjà, une newsletter ou une campagne
le peuvent tout autant.

## Deux lecteurs, deux parcours

| Vous voulez… | Allez à |
| --- | --- |
| **offrir des articles** — fabriquer des liens et les diffuser dans vos messages, vos newsletters, vos campagnes | **Partie I**, ci-dessous |
| **reprendre le service** — l’installer ailleurs, le corriger, le déployer, administrer les jetons | **Partie II**, plus bas |

La Partie I se lit en dix minutes et ne demande aucun accès technique : un jeton, une requête, un lien à
diffuser. La Partie II suppose les accès au projet Supabase et à la page de lecture.

Le code est là pour qui veut regarder : le SQL dans `gift-links/supabase/`, la fonction d’API dans
`gift-links/functions/`, et les tests à la racine. Ils tournent sans réseau ni secret — `npm ci && npm
test` suffit à les voir passer.

# Partie I — Utiliser l’outil

Vous avez un article payant de lexpress.fr, et vous voulez qu’une personne précise puisse le lire en
entier, gratuitement, pendant un temps limité. Le service transforme l’URL de l’article en un lien qui
ouvre une copie lisible. Trois gestes : demander un jeton une fois, appeler l’API, diffuser le lien
qu’elle rend.

## Obtenir un jeton de service

**Chaque service appelant a son propre jeton**, et un seul. C’est lui qui identifie l’appelant, lui attribue les liens qu’il fabrique, et permet de le couper sans couper personne d’autre. Le secret partagé unique qui ouvrait l’API jusqu’au 7 octobre 2026 a été supprimé : il ne nommait personne, et le révoquer aurait coupé tout le monde d’un coup.

### Demander un accès

Écrire à la personne en charge du service — à ce jour **Ophélie Gaudin** — ou à toute personne ayant les
droits sur le projet Supabase `ovifzentveeehhtlnugk` (*L'Express - Article Premium Offert*). Donner
**le nom du service appelant** plutôt que le vôtre. Ce nom apparaîtra dans chaque réponse de l’API et dans le journal d’attribution des liens : `newsletter-quotidienne` se lit mieux que `jean`, et survit à un départ.

Le jeton est montré **une seule fois**, à sa création. Il n’est jamais retrouvable ensuite : la base n’en garde que l’empreinte SHA-256. Le ranger tout de suite dans le gestionnaire de secrets du service appelant.

### Utiliser le jeton

Le passer dans l'en-tête `x-gift-service-token` à chaque appel. La fonction en calcule l'empreinte et la
compare à la base ; le jeton en clair ne quitte jamais l'appelant et la fonction.

#### macOS et Linux

**Une seule ligne, à copier d'un bloc.** C'est la forme la plus sûre : sans retour à la ligne, rien ne
peut la casser.

```sh
curl --silent -X POST 'https://ovifzentveeehhtlnugk.supabase.co/functions/v1/create-gift-links' -H "x-gift-service-token: $GIFT_TOKEN" -H 'Content-Type: application/json' -d '{"urls":["https://www.lexpress.fr/…-ULRPQWYZ5JCKTBM3LE7MJBVNAQ"],"expires_in_days":15}' | python3 -m json.tool
```

La version sur plusieurs lignes se lit mieux, mais elle a un piège :

```sh
curl --silent -X POST \
  'https://ovifzentveeehhtlnugk.supabase.co/functions/v1/create-gift-links' \
  -H "x-gift-service-token: $GIFT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://www.lexpress.fr/…-ULRPQWYZ5JCKTBM3LE7MJBVNAQ"],"expires_in_days":15}' \
  | python3 -m json.tool
```

> **Le `\` ne protège que le retour à la ligne IMMÉDIAT.** Un seul espace après lui et tout se défait :
> le shell prend la ligne suivante pour une commande et répond
> `no such file or directory: https://…`. Un copier-coller suffit à introduire cet espace invisible.
> En cas de doute, reprendre la version sur une ligne.

#### Windows, dans PowerShell

**N'utilisez pas `curl` sous Windows PowerShell :** c'est un alias d'`Invoke-WebRequest`, qui n'accepte
pas les mêmes options et rend des erreurs incompréhensibles. `Invoke-RestMethod` fait mieux — il
**comprend déjà le JSON**, donc aucun outil de mise en forme n'est nécessaire.

Chaque ligne se suffit à elle-même : aucun caractère de continuation, donc aucun piège d'espace.

```powershell
$uri    = 'https://ovifzentveeehhtlnugk.supabase.co/functions/v1/create-gift-links'
$entete = @{ 'x-gift-service-token' = 'VOTRE_JETON' }
$corps  = '{"urls":["https://www.lexpress.fr/…-ULRPQWYZ5JCKTBM3LE7MJBVNAQ"],"expires_in_days":15}'

$r = Invoke-RestMethod -Method Post -Uri $uri -Headers $entete -ContentType 'application/json' -Body $corps

$r.links | Format-Table link, expires_at, content, state
$r.rejected | Format-Table url, erreur
```

`Format-Table` affiche un tableau, une ligne par article. **`link`** est l'adresse à diffuser.

> **Un refus n'affiche pas de texte, mais une erreur rouge.** `Invoke-RestMethod` s'arrête sur un code
> HTTP 4xx au lieu de montrer la réponse. Un `401` signifie que le jeton est absent, inconnu ou révoqué.

La réponse nomme le service reconnu dans son champ `client`. C'est le moyen le plus simple de vérifier
qu'on appelle avec le bon jeton :

```json
{ "links": [ … ], "rejected": [], "client": "newsletter-quotidienne" }
```

**Un jeton absent, inconnu ou révoqué reçoit un `401` nu**, sans motif. La base sait distinguer les
trois cas et les journalise ; l'appelant ne l'apprend pas. Le lui dire renseignerait qui cherche à
deviner.

## Contrat de création

`POST /functions/v1/create-gift-links`, JSON, en-tête `x-gift-service-token` obligatoire — le jeton du service appelant, voir la section précédente. Voici un corps de requête ; remplacer l’URL par un article à offrir :

```json
{
  "urls": ["https://www.lexpress.fr/rubrique/titre-LQBW5JK75BDOBJHRA76NRFPJFY"],
  "expires_in_days": 15
}
```

`urls` est obligatoire ; la durée vaut 15 jours par défaut. **Seules `urls`, `expires_in_days` et
`fake_body` sont acceptées** : toute autre clé reçoit un `400` qui la nomme, plutôt qu'un silence qui
laisserait croire qu'elle a servi. Une URL doit appartenir au domaine accepté et porter un identifiant Arc de 26 caractères. L’ancien format `…_1302698.html` est rejeté avec un motif.

La réponse contient deux listes :

- `links` : `url`, `arc_id`, `token`, `link`, `expires_at`, `content`, `source`, `state`.
- `rejected` : `url` et `erreur` pour chaque refus.
- `client` : le nom du service reconnu par son jeton.

`content` vaut `full` ou `preview`. `source` vaut `arc` ou `page-publique`. `state` vaut `created`, `extended` ou `unchanged`. Une réponse HTTP 200 peut contenir des refus, voire aucun lien si tous les articles sont retirés : contrôler les deux listes. Pour promettre un article complet, vérifier `content: "full"` avant de diffuser.

> **Cette réponse arrive sur une seule ligne**, qui déborde de l'écran. La section
> [« Lire la réponse sans lunettes »](#lire-la-réponse-sans-lunettes) montre deux façons de la rendre
> lisible, sans rien installer ni télécharger.

### Exemple : prolonger un lien et en créer un autre dans la même requête

Scénario illustratif : l’appel est effectué le **5 octobre 2026 à 13 h UTC**, pour offrir deux articles pendant **15 jours à partir de cet appel**. Les tokens et les dates ci-dessous sont fictifs ; cet exemple ne décrit pas l’état actuel de la base.

Avant l’appel :

| Article | État en base |
| --- | --- |
| « La DGSE investit dans l’IA… » | Lien existant avec le token `11111111111111111111111111111111`, valable jusqu’au 10 octobre 2026 à 13 h UTC |
| « En 2027, faut-il mentir pour survivre… » | Aucun lien existant |

Renseigner `GIFT_TOKEN` dans l’environnement de l’appelant serveur avec le jeton de service obtenu, puis envoyer :

```sh
curl --silent --request POST \
  'https://ovifzentveeehhtlnugk.supabase.co/functions/v1/create-gift-links' \
  --header "x-gift-service-token: ${GIFT_TOKEN}" \
  --header 'Content-Type: application/json' \
  --data '{
    "urls": [
      "https://www.lexpress.fr/secret-defense/la-dgse-investit-dans-lia-les-maitres-espions-francais-se-confessent-LQBW5JK75BDOBJHRA76NRFPJFY",
      "https://www.lexpress.fr/politique/elections/en-2027-faut-il-mentir-pour-survivre-le-dilemme-des-candidats-a-la-presidentielle-RQOLMEM5NZE3BNTWPJEEGC5B5Y"
    ],
    "expires_in_days": 15
  }'
```

Si Arc fournit le contenu complet des deux articles et que la mise en cache et la création réussissent, la réponse **HTTP 200** a cette forme :

```json
{
  "links": [
    {
      "url": "https://www.lexpress.fr/secret-defense/la-dgse-investit-dans-lia-les-maitres-espions-francais-se-confessent-LQBW5JK75BDOBJHRA76NRFPJFY",
      "arc_id": "LQBW5JK75BDOBJHRA76NRFPJFY",
      "token": "11111111111111111111111111111111",
      "link": "https://articles.lexpress.fr/a/11111111111111111111111111111111",
      "expires_at": "2026-10-20T13:00:00+00:00",
      "content": "full",
      "source": "arc",
      "state": "extended"
    },
    {
      "url": "https://www.lexpress.fr/politique/elections/en-2027-faut-il-mentir-pour-survivre-le-dilemme-des-candidats-a-la-presidentielle-RQOLMEM5NZE3BNTWPJEEGC5B5Y",
      "arc_id": "RQOLMEM5NZE3BNTWPJEEGC5B5Y",
      "token": "22222222222222222222222222222222",
      "link": "https://articles.lexpress.fr/a/22222222222222222222222222222222",
      "expires_at": "2026-10-20T13:00:00+00:00",
      "content": "full",
      "source": "arc",
      "state": "created"
    }
  ],
  "rejected": [],
  "client": "newsletter-quotidienne"
}
```

Comment lire cette réponse :

- **Premier article — `extended`** : le token et l’URL restent identiques. L’expiration passe du 10 au 20 octobre ; les personnes ayant déjà reçu ce lien bénéficient aussi de la prolongation. Les 15 jours sont calculés depuis l’appel, pas ajoutés à l’ancienne date de fin.
- **Second article — `created`** : le service crée un nouveau token et son lien, valable jusqu’au 20 octobre.
- **`content: "full"`** : les deux liens donnent accès au corps de l’article. Si Arc ne fournit pas le corps et que le repli public fonctionne, vérifier `content: "preview"` avant de promettre un accès complet.
- **`rejected: []`** : aucun article n’a été refusé. Toujours vérifier cette liste, même avec HTTP 200.
- **`client`** : le service que le jeton a identifié. Les deux liens lui sont attribués en base.

Diffuser la valeur de **`link`** pour chaque article, et non l’URL originale `url`, qui reste soumise au mur d’abonnement du site. Si le lien existant était déjà valable au-delà du 20 octobre, il conserverait sa date plus lointaine et serait rendu avec `state: "unchanged"`.

| HTTP | Sens |
| --- | --- |
| 401 | Jeton absent, inconnu ou révoqué — sans distinction, volontairement |
| 400 | JSON illisible, clé non reconnue, ou aucune URL exploitable |
| 405 | Méthode autre que POST/OPTIONS |
| 500 | Échec de mise en cache ou de création en base |
| 502 | Aucun article exploitable après chargement |

Le repli Arc → page publique fournit un aperçu, pas le corps premium. Certains échecs réseau non gérés peuvent aussi produire une erreur du runtime ; la liste ci-dessus décrit les réponses explicites du code.

## Lire la réponse sans lunettes

La réponse arrive sur **une seule ligne**, qui déborde de l'écran :

```
{"links":[{"url":"https://www.lexpress.fr/politique/affaire-bardella-les-jours-dapres-au-rassemblement-national-ULRPQWYZ5JCKTBM3LE7MJBVNAQ/","arc_id":"ULRPQWYZ5JCKTBM3LE7MJBVNAQ","token":"d30067cd211a4cdbb59c8ddc7c5ceeaf","link":"https://articles.lexpress.fr/a/d30067cd…
```

Les liens y sont — chaque `"link":"https://articles.lexpress.fr/a/…"` — mais il faut les pêcher. Deux
façons de la rendre lisible, **sans rien installer et sans rien télécharger**.

> **Sous Windows, cette section est sans objet.** `Invoke-RestMethod` comprend déjà le JSON, et
> `Format-Table` en fait un tableau — voir « Utiliser le jeton » plus haut.

### Dans le terminal : ajouter sept caractères

`python3` est livré avec macOS et avec Linux. Ajouter **` | python3 -m json.tool`** à la fin de la
commande suffit :

```sh
curl --silent --request POST \
  'https://ovifzentveeehhtlnugk.supabase.co/functions/v1/create-gift-links' \
  --header "x-gift-service-token: ${GIFT_TOKEN}" \
  --header 'Content-Type: application/json' \
  --data '{"urls": ["https://www.lexpress.fr/…-ULRPQWYZ5JCKTBM3LE7MJBVNAQ"]}' \
  | python3 -m json.tool
```

```json
{
    "links": [
        {
            "url": "https://www.lexpress.fr/politique/affaire-bardella-…",
            "arc_id": "ULRPQWYZ5JCKTBM3LE7MJBVNAQ",
            "token": "d30067cd211a4cdbb59c8ddc7c5ceeaf",
            "link": "https://articles.lexpress.fr/a/d30067cd211a4cdbb59c8ddc7c5ceeaf",
            "expires_at": "2026-10-09T12:57:49.699+00:00",
            "content": "full",
            "source": "arc",
            "state": "created"
        }
    ],
    "rejected": [],
    "client": "test"
}
```

**`link`** est l'adresse à diffuser. **`url`** est l'article d'origine, toujours derrière son mur.

### Dans le navigateur : un tableau

Pour plusieurs liens d'un coup, un tableau se lit mieux qu'une liste imbriquée.

1. Copier la réponse entière, telle qu'elle apparaît dans le terminal.
2. Ouvrir n'importe quelle page dans le navigateur, puis la **console** : `Cmd ⌥ J` sur Chrome
   (macOS), `Ctrl ⇧ J` sur Windows, ou `F12` puis l'onglet *Console*.
3. Taper la ligne ci-dessous, **sélectionner `COLLEZ_ICI` et coller la réponse par-dessus**, puis
   `Entrée`.

```js
console.table(JSON.parse(`COLLEZ_ICI`).links)
```

Un tableau s'affiche, une ligne par article, avec `link`, `expires_at`, `content` et `state` en
colonnes. Les accents graves autour de `COLLEZ_ICI` ne sont pas décoratifs : la réponse contient des
guillemets droits, et seuls les accents graves les laissent passer.

**Chrome bloque le collage dans la console la première fois** et demande d'écrire `allow pasting` puis
`Entrée`. C'est une protection, elle ne se présente qu'une fois par navigateur.

Rien n'est installé, et **rien ne sort de votre machine** : la console exécute le code chez vous.

> **À éviter : les sites de mise en forme JSON en ligne.** Y coller la réponse envoie vos liens sur le
> serveur de quelqu'un d'autre. Les deux méthodes ci-dessus ne demandent pas plus d'effort.

### « J'ai demandé 1 jour et la réponse dit un mois »

C'est normal, et c'est voulu. **On ne raccourcit jamais un lien déjà diffusé.** Si cet article avait
déjà un lien valable jusqu'au 7 novembre, quelqu'un l'a peut-être reçu avec cette promesse : le ramener
à demain la trahirait. La réponse l'annonce avec `"state": "unchanged"`.

## Règles importantes pour les intégrateurs

- **Un seul lien par article**, commun à tous les destinataires. Il n’est pas personnel et peut être transféré.
- Redemander un article conserve son token et prolonge sa durée si nécessaire. Une prolongation profite aussi aux anciens destinataires. Une demande plus courte ne raccourcit jamais la durée.
- Un lien expiré peut être rouvert par une nouvelle demande ; un lien retiré manuellement reste retiré.
- **L’attribution se met dans l’URL du lien diffusé, pas dans la requête de création.** Un lien est commun à tous ses destinataires ; lui coller une campagne attribuerait toutes ses lectures à la dernière déclarée. Diffuser `…/a/<token>?s=<identifiant d’envoi>&at_medium=…&at_campaign=…&at_campaign_group=…` : chaque lecture est enregistrée avec SON contexte, et un même lien diffusé dans trois campagnes donne trois séries distinctes.
- La page sert une copie. Les corrections ou dépublications du CMS ne s’y répercutent pas automatiquement. Un nouvel appel peut rafraîchir le cache ; un retrait urgent demande une action explicite.
- Les tables sont fermées aux rôles publics. La lecture passe uniquement par `get_gift_article` ; la création requiert les droits serveur.
- `fake_body: true` est réservé aux essais et produit un texte clairement marqué démonstration quand aucun vrai corps n’est disponible.

**Vous ne voyez pas vos liens en base** : la lecture des tables demande les accès du service. Pour
savoir combien de fois vos liens ont été lus, ou lesquels vous avez créés, demandez-le à la personne
responsable du service — les deux vues existent, elles sont décrites en Partie II.

# Partie II — Reprendre le service

Cette partie suppose les accès au projet Supabase, au projet Lovable qui héberge la page de lecture,
et au jeton de lecture Arc. Elle n’est pas nécessaire pour créer des liens.

## Démarrage local

Prérequis : Node.js 22 ou supérieur et npm. Depuis la racine du dépôt :

```sh
npm ci
npm test
npm run build
```

Les tests exécutent le SQL dans une base PostgreSQL embarquée (PGlite) et simulent les appels Arc et les pages publiques. Ils ne nécessitent aucun secret, n’appellent aucun service de production et n’envoient aucun message. Ils comptent actuellement 88 vérifications du schéma et 91 vérifications du traitement des articles.

Le test API importe le générateur, qui régénère aussi le bundle local. `npm run build` produit `gift-links/functions/create-gift-links/index.bundle.ts`, le fichier déployable. Ne pas le modifier à la main. Aucun de ces scripts ne déploie.

## Architecture et périmètre

```text
Canal serveur (WhatsApp, email, outil interne…)
  → POST /functions/v1/create-gift-links, secret serveur
  → Arc XP : chargement du contenu
  → Supabase dédié : cache articles + liens + ouvertures
  → URL /a/<token>
  → page Lovable : RPC get_gift_article avec clé publique
```

Il existe une seule page dynamique de lecture, pas une page à générer par article. La création d’un lien ne nécessite pas de publication Lovable.

| Fichier | Rôle |
| --- | --- |
| `gift-links/supabase/001-schema.sql` | Tables, droits et fonctions initiales |
| `gift-links/supabase/002-author.sql` | Signature et campagne rendues au frontend |
| `gift-links/supabase/003-un-lien-par-article.sql` | Token stable et prolongation |
| `gift-links/supabase/004-jeu-d-essai.sql` | Quatre articles fictifs pour vérifier la page |
| `gift-links/functions/_shared/` | Lecture Arc, extraction de l’identifiant, aperçu public |
| `gift-links/functions/create-gift-links/index.ts` | Point d’entrée HTTP |
| `build-gift-links-function.mjs` | Assemblage de la fonction déployable |
| `validate-gift-links-*.mjs` | Tests locaux |
| `docs/frontend.md` | Contrat à respecter par la page Lovable |

## État connu au 8 octobre 2026

Schéma appliqué, fonction déployée, page publiée, lecture de corps Arc réels vérifiée en ligne. Les cinq statuts de lecture et le cas d’erreur technique avec réessai sont vérifiés. L’extraction de ce dépôt ne constitue pas une nouvelle vérification de la production ; ces faits viennent du journal du projet source.

Depuis le 5 octobre : les images et les citations du corps sont rendues, chaque service appelant a son propre jeton, chaque lien sait qui l’a créé et qui l’a prolongé, et le schéma est entièrement en anglais. Le secret partagé unique a été supprimé le 7 octobre au soir, après que la bascule du job nocturne a été prouvée.

Restent à faire : archivage des données, intégration Piano et raccordement des liens offerts dans la chaîne WhatsApp de production. Ce raccordement est présent en test seulement : la production envoie encore l’URL nue du site, c’est-à-dire le mur d’abonnement que le lien offert existe pour éviter. Les compteurs d’ouverture en base existent déjà.

## Accès et configuration

Pour reprendre le service existant, obtenir les accès au projet Supabase dédié, au projet Lovable et au jeton de lecture Arc auprès de la personne responsable du service. Ophélie est le point de contact indiqué dans le projet source. Le lien et l’identifiant du projet Lovable restent à transmettre lors de la passation.

Service existant :

- Page : `https://articles.lexpress.fr/a/<token>`.
- Supabase : projet `L’Express - Article Premium Offert`, référence `ovifzentveeehhtlnugk`.
- API : `https://ovifzentveeehhtlnugk.supabase.co/functions/v1/create-gift-links`.

| Variable du runtime | Usage |
| --- | --- |
| `SUPABASE_URL` | URL du projet backend |
| `SUPABASE_SERVICE_ROLE_KEY` | Accès serveur à la base ; jamais dans le frontend |
| `ARC_BASE` | URL de l’API Arc, par exemple `https://api.lexpress.arcpublishing.com` |
| `ARC_TOKEN` | Jeton de lecture Arc, côté serveur |
| `ARC_SITE` | Site Arc, `lexpress` par défaut |
| `GIFT_LINK_BASE` | Origine des URLs rendues, `https://articles.lexpress.fr` par défaut |

`.env.example` inventorie ces variables ; la fonction lit les variables du runtime Supabase, pas un fichier local automatiquement. La page Lovable reçoit uniquement l’URL Supabase et la clé publique du projet — celle de rôle `anon`, faite pour être publiée.

**Aucune variable d’environnement ne porte plus de secret d’appel.** L’authentification se fait par un jeton par service, stocké en base sous forme d’empreinte. Voir la section suivante.

## Administrer les jetons

Toutes les requêtes SQL de cette partie s'exécutent dans l'**éditeur SQL de Supabase** :
[supabase.com/dashboard](https://supabase.com/dashboard) → projet **L'Express - Article Premium
Offert** (`ovifzentveeehhtlnugk`) → **SQL Editor** → **New query**.

### Créer un jeton (administration)

**Ce n'est pas la base qui engendre le jeton.** Elle n'en voit jamais la valeur : on la fabrique sur sa
propre machine, et on ne confie à PostgreSQL que son empreinte SHA-256 — exactement comme pour un mot
de passe. `create_api_client` n'invente donc rien : elle **enregistre** un jeton né ailleurs.

> **ATTENTION — deux valeurs, 64 caractères hexadécimaux chacune.** Le jeton et son empreinte se
> ressemblent trait pour trait ; rien ne permet de les distinguer à l'œil. Les confondre est l'erreur
> la plus facile de toute cette page.
>
> | Valeur | Où elle va | Où elle ne va JAMAIS |
> | --- | --- | --- |
> | **Le jeton** | au service appelant, par un canal sûr | en base, ni dans un ticket, ni dans un dépôt |
> | **L'empreinte** | dans Supabase, par `create_api_client` | chez le service appelant |

#### 1. Engendrer le jeton, sur votre machine

```sh
JETON=$(openssl rand -hex 32)
```

Il n'est pas affiché : c'est voulu, il ne doit traîner ni à l'écran ni dans l'historique du terminal.

#### 2. Afficher l'EMPREINTE, celle qui va dans Supabase

```sh
printf '%s' "$JETON" | shasum -a 256 | cut -d' ' -f1
```

La ligne affichée est **l'empreinte**. C'est elle, et elle seule, qu'on colle à l'étape 3.

#### 3. Enregistrer l'empreinte dans l'éditeur SQL de Supabase

Ouvrir [supabase.com/dashboard](https://supabase.com/dashboard) → projet **L'Express - Article Premium
Offert** (`ovifzentveeehhtlnugk`) → **SQL Editor** dans la barre latérale → **New query**. Coller, puis
**Run**.

```sql
SELECT public.create_api_client(
  'newsletter-quotidienne',                     -- nom du service appelant, pas d'une personne
  'collez ici la ligne affichée à l''étape 2',  -- L'EMPREINTE, jamais le jeton
  'Contact : equipe-newsletter. Ouvert le 8 octobre 2026.'   -- note libre, facultative
);
```

La requête rend l'identifiant du client créé. Si vous collez autre chose qu'une empreinte bien formée —
64 caractères hexadécimaux minuscules — la contrainte la refusera. Mais **si vous collez le jeton, elle
l'acceptera** : il a exactement la même forme. L'étape 5 est là pour attraper cette confusion.

#### 4. Transmettre le JETON au service appelant

```sh
printf '%s' "$JETON" | pbcopy                            # macOS
# printf '%s' "$JETON" | xclip -selection clipboard      # Linux
```

Le jeton part dans le presse-papiers sans s'afficher. Le coller dans le gestionnaire de secrets du
service appelant, puis fermer le terminal. Il n'est plus retrouvable ensuite : la base n'en garde que
l'empreinte, et c'est tout l'intérêt.

#### 5. Vérifier, avant de considérer que c'est fait

Le seul contrôle qui prouve que les deux valeurs sont à leur place :

```sh
curl --silent --request POST \
  'https://ovifzentveeehhtlnugk.supabase.co/functions/v1/create-gift-links' \
  --header "x-gift-service-token: ${JETON}" \
  --header 'Content-Type: application/json' \
  --data '{"urls": ["https://www.lexpress.fr/…-LQBW5JK75BDOBJHRA76NRFPJFY"]}'
```

La réponse doit porter `"client": "newsletter-quotidienne"`. Un `401` signifie que l'empreinte
enregistrée ne correspond pas au jeton transmis — le plus souvent parce que l'une des deux valeurs a
été collée à la place de l'autre. Reprendre à l'étape 1 et révoquer la ligne fautive.

### Révoquer

```sql
SELECT public.revoke_api_client('newsletter-quotidienne');  -- rend true, ou false si déjà révoqué
```

La ligne **reste en base** : on garde la trace de ce que ce service a créé, et les liens qu’il a fabriqués continuent de fonctionner. Révoquer ferme la porte, cela n’efface pas l’histoire. Les autres services ne sont pas affectés — c’est tout l’intérêt d’un jeton par appelant.

### Savoir qui a fait quoi

Chaque lien porte le service qui l’a créé et le dernier qui en a repoussé la date de fin.

```sql
SELECT title, created_by, updated_by, updated_at, expires_at, opens
FROM public.gift_links_by_client
ORDER BY created_at DESC;
```

`created_by` ne change plus jamais. `updated_by` ne bouge qu’à une **vraie** modification : redemander un lien déjà valable plus longtemps ne fait pas de vous le dernier intervenant, sinon la colonne dirait « dernier à avoir demandé » au lieu de « dernier à avoir modifié ». Les liens créés avant le 7 octobre 2026 portent `NULL` : l’historique commence là, il ne se reconstruit pas.

Les compteurs par service vivent dans `api_clients` : `calls`, `links_created`, `last_used_at`. Aucun plafond n’est imposé aujourd’hui, mais les chiffres sont là le jour où il en faudra un.

## Lire l’attribution

Qui a fabriqué chaque lien, et qui en a repoussé la date :

```sql
SELECT title, created_by, updated_by, updated_at, expires_at, opens
FROM public.gift_links_by_client ORDER BY created_at DESC;
```

Combien de lectures par campagne — une ligne par lecture, avec le segment que **ce** visiteur portait :

```sql
SELECT campaign_group, reads, sends, articles, last_read
FROM public.gift_link_reads_by_campaign ORDER BY reads DESC;
```

`sends` compte les identifiants d’envoi distincts : un même lien diffusé à trois reprises donne trois
envois, et des lectures attribuables à chacun. C’est ce que le champ `campaign` d’autrefois ne pouvait
pas faire, étant commun au lien.

## Installer dans un autre environnement

Utiliser un projet Supabase dédié. Appliquer **les dix fichiers de `gift-links/supabase/` dans l’ordre de leur numéro** sur une base neuve. Ce sont les scripts d’origine, pas un historique géré automatiquement par une CLI. Ne pas rejouer le schéma initial à l’aveugle sur une base existante.

| Fichier | Ce qu’il apporte |
| --- | --- |
| `001-schema.sql` | tables `articles`, `gift_links`, `gift_link_opens` ; création et lecture |
| `002-author.sql` | la signature de l’auteur, rendue jusqu’à la page |
| `003-un-lien-par-article.sql` | un seul lien par article, prolongé plutôt que recréé |
| `004-jeu-d-essai.sql` | jeu fictif, **facultatif** : un lien par état pour la recette |
| `005-identifiant-envoi.sql` | l’identifiant d’envoi `?s=` et le groupe de campagne |
| `006-clients-api.sql` | **un jeton par service** — sans lui, aucun appel n’est authentifiable |
| `007-attribution-liens.sql` | qui a créé chaque lien, qui l’a prolongé |
| `008-noms-anglais.sql` | tout le schéma en anglais, par renommage |
| `009-attribution-par-envoi.sql` | la campagne quitte le lien : elle appartient à l’envoi |
| `010-vues-security-invoker.sql` | les vues lisent avec les droits de qui les interroge |

Sauter `006` laisse la fonction sans moyen de reconnaître un appelant : elle refusera tout avec un `401`. Sauter `007` ou `008` la fait échouer à la première création, le corps de `create_gift_links` référençant des colonnes absentes.

Créer ensuite au moins un jeton de service, sans quoi l’API est installée mais inutilisable.

Configurer les variables serveur, exécuter les tests et générer le bundle. Déployer ce bundle comme fonction `create-gift-links` avec le mécanisme Supabase retenu par l’équipe. Ce dépôt ne contient pas encore de script de déploiement ni de configuration de passerelle versionnée : vérifier notamment que la passerelle laisse atteindre le contrôle `x-gift-service-token`, puis qu’un appel sans secret est refusé. Il ne faut pas présenter cette extraction comme une installation en une commande.

Brancher et publier la page Lovable conformément à [son contrat](docs/frontend.md). Pour un autre environnement, adapter l’origine de lecture via `GIFT_LINK_BASE`, la connexion Supabase du frontend et les paramètres du bouton d’abonnement.

Après déploiement, vérifier séparément les droits publics, une création avec du contenu réel, les cinq états de lecture et une panne réseau avec réessai. Les tests locaux ne valident ni la configuration distante ni le frontend publié. Pour les tests externes, utiliser un environnement isolé, des articles fictifs et des envois simulés.

## Exploitation

Retrait immédiat, depuis l'éditeur SQL de Supabase (voir « Administrer les jetons » plus haut pour le
chemin exact), en ciblant le token concerné :

```sql
UPDATE public.gift_links SET withdrawn_at = now() WHERE token = '<token>';
```

Prolongation manuelle sans raccourcir une durée déjà plus longue :

```sql
UPDATE public.gift_links
SET expires_at = greatest(expires_at, now() + interval '15 days'), extended_at = now()
WHERE token = '<token>' AND withdrawn_at IS NULL;
```

Ne pas supprimer un lien diffusé : poser `withdrawn_at` conserve la ligne et donne une réponse explicite au lecteur. Pour réouvrir un retrait, faire valider la décision éditoriale avant d’effacer ce champ. Le script `004-jeu-d-essai.sql` remet uniquement ses propres articles fictifs à l’état attendu ; conserver les liens diffusés lors de tout nettoyage.

## Limites et prochaines étapes

- Sources et historique du frontend Lovable à rattacher pour une reprise complète.
- Déploiement et configuration distante à rendre reproductibles ; CI à ajouter selon l’hébergement Git retenu.
- Aucun écran d’administration inclus : création via API, retrait et prolongation possibles en SQL.
- Archivage/rétention, Piano et attribution entre campagnes à compléter.
- Tests HTTP de la fonction et tests du frontend publié à compléter : les 179 vérifications actuelles couvrent le SQL, les modules de contenu et certaines propriétés du bundle.

## Provenance

Extraction locale préparée le 5 octobre 2026 à partir du projet L’Express, puis réalignée le 8 octobre 2026 sur le commit `6f9516d` (« un jeton par service, et chaque lien sait qui l’a demandé »). Les sources du backend et les tests ont été copiés sans modification fonctionnelle. Les scripts restent à la racine afin de conserver les chemins déjà testés. Les workflows et données de l’agent WhatsApp ne sont pas inclus.
