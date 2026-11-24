# Barre d’abonnement et offres du moment — 23 novembre 2026

Préparation locale uniquement. Aucune migration appliquée, aucune fonction déployée, aucun
message envoyé à Lovable, aucune publication. Chaque geste ci-dessous attend l’accord écrit
d’Ophélie.

## Origine : retours d’Enzo du 20/11 (ClickUp `124hhvu7c9d`), arbitrés par Ophélie le 23/11

| Point | Demande | Décision | Où |
| --- | --- | --- | --- |
| 1, 2 | boutons en haut et au milieu | **une seule barre « S'abonner » collée en bas**, toujours visible, qui ne recouvre jamais la fin de l’article | lecteur |
| 3 | offre du moment | **table « offres »**, remplie par API par le marketing | base, fonction, lecteur |
| 4 | newsletter ou compte gratuit | plus tard, hors périmètre | — |
| 5 | suivi des clics | déjà en place (`at_*` et `s` repris) ; documenté ; conservé avec les offres | README, lecteur |
| 6 | liens internes du corps | **retirés, texte gardé**, pas de « Pour aller plus loin » | lecteur |
| 7 | articles sur les côtés | refusé | — |

## Ce que contient la PR

- `gift-links/supabase/018-offres-abonnement.sql` : table `subscription_offers`, droit
  `api_clients.manage_offers` (faux par défaut), RPC publique `get_subscription_offer`, RPC de
  gestion `create_/list_/end_subscription_offer` (rôle `service_role` seulement). Additive.
- `gift-links/supabase/rollback/018-offres-abonnement.sql` : retour arrière.
- `gift-links/functions/subscription-offers/` : fonction Edge de gestion (`index.ts`, bundle
  engendré par `npm run build`) ; validation partagée dans `gift-links/functions/_shared/offres.mjs`.
- Lecteur : `docs/patches/reader-subscription-bar.patch`, sources après patch dans
  `docs/reader-reference/src/`, message Lovable `lovable-subscription-bar-prompt.md`.
- Tests : `validate-subscription-offers.mjs` (base PGlite, fonction exécutée contre elle),
  `validate-reader-offers.mjs` (patch, types stricts, rendu simulé). `npm test` les lance.

## Choix et raisons

- **Un site, pas une édition.** L’édition EUR couvre trois sites en trois langues. Une offre
  vise un ou plusieurs de `www.lexpress.fr`, `www.lexpress.eu`, `fr.lexpress.eu`,
  `pl.lexpress.eu` ; le lecteur déduit le site de l’édition et de la langue de l’article.
- **Règle de chevauchement** : la plus récemment commencée gagne ; à égalité, la plus
  récemment créée ; puis l’identifiant. Une offre flash posée sur une offre longue s’affiche
  pendant sa durée, puis l’autre reprend. La liste de l’API dit, site par site, laquelle est
  affichée (`displayed_now`).
- **Validation doublée** : la fonction refuse champ par champ avec un message ; la base
  refuse les mêmes cas par contraintes et dans `create_subscription_offer`. Les deux règles
  d’URL sont confrontées sur les mêmes cas dans le test.
  - date de fin obligatoire, dans le futur, après le début ; dates ISO 8601 avec fuseau ;
  - URL : `https://`, hôte de la liste fermée (`abonnements-digitaux.lexpress.fr`,
    `(www.)lexpress.fr`, `(www.|fr.|pl.)lexpress.eu`), sans port, identifiants, fragment
    collé à l’hôte ni espace, 500 caractères au plus, **du domaine de chaque site visé** ;
  - libellé : 1 à 40 caractères, une ligne, sans `<` `>`, **une seule langue de sites** (un
    libellé français ne peut pas viser pl.lexpress.eu).
- **Droit séparé `manage_offers`** (proposé, optionnel). Le même modèle de jeton par service,
  mais un jeton existant (agent WhatsApp, newsletter…) ne peut pas changer le bouton de
  toutes les pages. Le droit s’accorde à la main, jeton par jeton.
- **Une seule fonction de sélection** (`current_subscription_offer_id`) sert la page et la liste
  du marketing (`displayed_now`), à la microseconde : jamais deux réponses différentes.
- **Rejeu sans doublon** : `request_id` (recommandé) rend l’offre déjà créée si une requête est
  renvoyée après une réponse perdue ; réutilisé pour une autre demande, il est refusé.
- **Fin anticipée** : rien n’est supprimé ni redaté. La ligne est marquée `ended_at` (et
  `ended_by`) et n’est plus affichée ; `cancelled` si elle n’avait pas commencé, `ended` sinon.
  Un rejeu de sa création la retrouve telle quelle, au lieu de la recréer.
- **Liste du marketing en un appel SQL** (une photographie, une horloge) : offres, offre
  affichée par site et statuts ; 500 au plus, les offres affichées en tête, `truncated` sinon.
- **Index GIN sur `sites`** : chaque page lit l’offre de son site sans parcourir les autres.
- **Exposition publique minimale** : `get_subscription_offer(p_site)` ne rend que `label`,
  `url`, `ends_at`, au plus une ligne. Table en RLS sans politique, aucun droit `anon` ni
  `authenticated`, ni lecture ni écriture. Les offres futures, noms internes et auteurs ne
  sont pas lisibles par la clé publique.
- **Le lecteur ne casse jamais** : réponse vide, erreur, 404 (RPC absente), délai de 4 s,
  ou valeur hors règle → bouton actuel, exactement. La barre attend la réponse (4 s au plus)
  pour ne pas changer de libellé sous les yeux du lecteur.
- **Barre `sticky`, pas `fixed`** : dernier élément de la page, elle reprend sa place sous le
  contenu une fois en bas ; la fin de l’article ne peut donc pas être recouverte, sans
  hauteur devinée.
- **Liens internes retirés côté lecteur**, pas à l’extraction : cela couvre aussi les
  articles déjà en cache. Seuls les liens `http(s)` absolus vers un autre site restent.
  Le lien « Lire la suite » de l’aperçu n’est pas dans le corps : inchangé.
- **UTM** : la règle existante (tout `at_*`, plus `s`, `set`) s’applique à l’URL de l’offre ;
  ses propres paramètres sont gardés, ceux du visiteur l’emportent en cas de doublon.

Limites connues :
- L’en-tête (`GiftHeader`) et le layout racine ne sont pas dans le source lecteur retrouvé :
  le message Lovable porte leurs règles (aucun bouton dans l’en-tête, pas d’`overflow` qui
  casserait `sticky`), le patch ne les couvre pas.
- Le rendu réel (navigateur, mobile, iPhone) n’est pas testé ici : recette TEST du message
  Lovable.
- Pas de plafond de durée d’offre ni de nombre d’offres.

## Ajout du 24/11 : `s` accepte l’identifiant d’un e-mail HubSpot (019)

Décision d’Ophélie du 24/11 (choix 1B). Le responsable CRM branche un module « Article offert » dans
les e-mails HubSpot (jeton `hubspot-emails`) et veut l’identifiant de l’e-mail dans `s`, `at_campaign`
servant déjà à autre chose. Jusqu’ici, la lecture ne gardait que 32 hexadécimaux : un identifiant
numérique était enregistré vide.

- `gift-links/supabase/019-identifiant-envoi-elargi.sql` : seule la ligne d’assainissement de
  `get_gift_article_for_edition` change, en `^[A-Za-z0-9_-]{1,64}$`. Même signature, `CREATE OR
  REPLACE` sans `DROP` : `get_gift_article` et `get_gift_article_for_edition_v2` en profitent sans
  être recréées, droits réaffirmés à l’identique. Pas de `CHECK` : une valeur hors forme reste
  `NULL`, l’article s’affiche. Rejouable.
- `gift-links/supabase/rollback/019-identifiant-envoi-elargi.sql` : remet la définition exacte de 015
  et le commentaire de colonne. Les identifiants déjà enregistrés restent (purge à 90 jours).
- `validate-send-id.mjs` (dans `npm test`) : 32 hexa, identifiant numérique, valeurs bricolées,
  refus inchangés, purge, retour arrière et rejeu.
- Lecteur : **rien à changer, rien à publier** — il transmet `s` tel quel à la RPC et le recopie sur
  le bouton. Liste blanche des paramètres inchangée.

Fait le 24/11/2026 sur TEST (`gsvvcrhagatwjwyyjkli`) : 019 appliquée, trois cas vérifiés par la RPC
publique et en base, retour arrière puis ré-application vérifiés. Preuves : § « Recette 019 » du
compte rendu de PR.

**Ordre de déploiement PROD** : indépendant de 018 et du lecteur. L’appliquer après 018 (ordre des
numéros) et **avant le premier e-mail HubSpot qui porte `s`** ; un e-mail parti avant reste lisible,
seule son attribution est perdue. Étape 1 bis ci-dessous.

Recette TEST du 24/11 (`docs/evidence/send-id-019-test-20261124.json`), lien FR
`7c363606…c5a4`, RPC `get_gift_article_for_edition_v2` appelée avec la clé `anon`, lectures marquées
`at_medium=Recette019` (ids 55 à 65 de `gift_link_opens`) :

| Cas | Réponse | `send_id` enregistré |
| --- | --- | --- |
| avant 019, `123456789012` | 200, `ok`, corps | NULL |
| 32 hexadécimaux | 200, `ok`, corps | la valeur |
| `123456789012` | 200, `ok`, corps | la valeur |
| espace, `@`, `<`, 65 caractères, accent | 200, `ok`, corps | NULL |
| après retour arrière : `123456789012` / 32 hexa | 200, `ok`, corps | NULL / la valeur |
| après ré-application : `123456789012` | 200, `ok`, corps | la valeur |

Empreinte de la fonction : `254b463c…` avant, `49b03243…` après, `254b463c…` après retour arrière ;
droits identiques à chaque étape. Effacer ces lectures de recette si besoin :
`DELETE FROM public.gift_link_opens WHERE utm_source = 'Recette019';`

## Gestes proposés — après accord écrit uniquement

Ordre : 1 migration, 2 fonction, 3 droit du jeton marketing, 4 lecteur. Le lecteur est
inoffensif sans offre, mais publié avant la migration il ferait un appel en 404 par page.

### 0. TEST d’abord

La base TEST est la branche Supabase persistante `test-europe` du projet, ref
`gsvvcrhagatwjwyyjkli` (URL `https://gsvvcrhagatwjwyyjkli.supabase.co`). Mêmes gestes que
ci-dessous en remplaçant la ref PROD par celle-ci : appliquer 018, déployer la fonction, créer
un jeton de recette avec le droit, puis une offre France et une offre polonaise de recette
(§ « Créer une offre » du README). Les transmettre avec le message Lovable.

Fait le 23/11/2026 : 018, fonction v1 et jeton `marketing-offres-test` en place sur TEST ;
54 contrôles HTTP sur 54 et retour arrière vérifiés.

Nettoyage d’une recette : l’API ne supprime pas une offre, elle la termine (`DELETE`). Pour
effacer les offres de recette sur TEST, après les avoir terminées :
`DELETE FROM public.subscription_offers WHERE request_id LIKE 'recette-%';`

### 1. Migration 018 (PROD `ovifzentveeehhtlnugk`)

Contrôles préalables en lecture seule :

```sql
SELECT to_regclass('public.subscription_offers');                 -- attendu : NULL
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'api_clients' AND column_name = 'manage_offers'; -- attendu : aucune ligne
```

Préparer le corps de requête sans l’exécuter, depuis le worktree de la PR :

```sh
python3 - <<'PY'
import json,pathlib
sql=pathlib.Path('gift-links/supabase/018-offres-abonnement.sql').read_text()
pathlib.Path('/tmp/platform934-offres-migration.json').write_text(json.dumps({'query':sql}))
PY
```

Après accord, avec le fichier privé d’en-tête Authorization du premier runbook (jeton lu hors
dépôt, jamais dans les arguments) :

```sh
curl --fail-with-body --silent --show-error \
  --header "@$header_file" --header 'Content-Type: application/json' \
  'https://api.supabase.com/v1/projects/ovifzentveeehhtlnugk/database/query' \
  --data-binary @/tmp/platform934-offres-migration.json
```

Contrôles après, en lecture seule :

```sql
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subscription_offers'::regclass;  -- true
SELECT count(*) FROM pg_policies WHERE tablename = 'subscription_offers';               -- 0
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_name = 'subscription_offers' AND grantee IN ('anon','authenticated');      -- aucune ligne
SELECT count(*) FROM public.api_clients WHERE manage_offers;                            -- 0
```

Contrôle d’exposition par l’API REST avec la clé publique du lecteur : `POST
/rest/v1/rpc/get_subscription_offer` avec `{"p_site":"www.lexpress.fr"}` → HTTP 200, `[]`.
Puis `GET /rest/v1/subscription_offers` avec la même clé → refus (401 ou 403), jamais une liste.

Retour arrière : voir § 5.

### 1 bis. Migration 019 (PROD `ovifzentveeehhtlnugk`)

Contrôle préalable en lecture seule — la définition doit être celle de 015, dont 019 repart :

```sql
SELECT md5(pg_get_functiondef('public.get_gift_article_for_edition(text,text,text,text,text,text,text)'::regprocedure));
-- attendu : 254b463cfdba9db7bdc326f40d38d788 (relevé PROD et TEST du 24/11). Autre valeur : s’arrêter.
```

Après accord, même préparation et même `curl` qu’au § 1, avec
`gift-links/supabase/019-identifiant-envoi-elargi.sql` (fichier JSON
`/tmp/platform934-envoi-migration.json`).

Contrôles après, en lecture seule :

```sql
SELECT md5(pg_get_functiondef(oid)), prosrc LIKE '%^[A-Za-z0-9_-]{1,64}$%' AS elargi, proacl::text
  FROM pg_proc WHERE oid = 'public.get_gift_article_for_edition(text,text,text,text,text,text,text)'::regprocedure;
-- attendu : 49b03243c26cf98b4586a074ddcb0a91 (TEST après 019), true,
--           {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
SELECT count(*) FROM pg_proc WHERE proname = 'get_gift_article_for_edition';  -- 1
```

Pas de lecture d’essai en PROD : elle compterait une ouverture fictive. La première lecture d’un
e-mail HubSpot se vérifie ensuite par
`SELECT send_id, opened_at FROM public.gift_link_opens WHERE utm_source = '<at_medium des e-mails>' ORDER BY id DESC LIMIT 5;`.

Retour arrière : appliquer `gift-links/supabase/rollback/019-identifiant-envoi-elargi.sql` par le
même endpoint. Aucun ordre à respecter avec le lecteur.

### 2. Fonction `subscription-offers`

`npm ci && npm test`, puis `npm run build`. Après accord, même POST multipart que pour
`create-gift-links`, vers
`/v1/projects/ovifzentveeehhtlnugk/functions/deploy?slug=subscription-offers`, avec
`verify_jwt:false` (l’authentification est le jeton de service, comme `create-gift-links`),
entrypoint `index.ts`, fichier `gift-links/functions/subscription-offers/index.bundle.ts`.
Contrôles : sans en-tête → 401 ; avec un jeton existant sans le droit → 403 sur `GET`.
Aucune offre de recette en PROD.

### 3. Jeton du marketing

Créer un jeton dédié (`marketing-offres`, procédure « Créer un jeton » du README), puis lui
accorder le droit, dans l’éditeur SQL :

```sql
UPDATE public.api_clients SET manage_offers = true WHERE name = 'marketing-offres';
```

Vérifier par `GET` (README, « Lister les offres ») : HTTP 200, `"offers": []`.

### 4. Lecteur (Lovable)

Coller `docs/implementation/lovable-subscription-bar-prompt.md` (à partir de « Prépare cette
modification »), suivi du contenu de `docs/patches/reader-subscription-bar.patch` et des liens
TEST de l’étape 0. Recette TEST du message, build Lovable vert, puis publication sur accord
écrit seulement.

Le patch s’applique au lecteur issu du patch Europe (`reader-europe-hosts.patch`). Si ce
dernier n’est pas encore publié, le message suffit : il décrit le comportement attendu sans
dépendre du patch.

### 5. Retour arrière

- **Lecteur** : restaurer la publication Lovable capturée avant intervention. Sans risque
  pour les données.
- **Couper une offre** sans rien retirer : `DELETE` de l’API (README), ou
  en SQL, que l’offre soit en cours ou à venir :
  `UPDATE public.subscription_offers SET ended_at = now() WHERE id = '<id>' AND ended_at IS NULL;`
- **Couper le marketing** : `UPDATE public.api_clients SET manage_offers = false WHERE name = 'marketing-offres';`
- **Fonction** : la supprimer dans le tableau de bord (Edge Functions → `subscription-offers`
  → Delete). Aucune autre fonction n’en dépend.
- **SQL** : seulement après le retour arrière du lecteur. Sauvegarder d’abord
  `SELECT * FROM public.subscription_offers;` (copie privée), puis appliquer
  `gift-links/supabase/rollback/018-offres-abonnement.sql` par le même endpoint. Supprime la
  table, ses fonctions et la colonne `manage_offers` ; liens, articles, lectures et jetons
  restent. Rejouer 018 ensuite est possible (testé), le droit repart à faux : **réaccorder ensuite
  `manage_offers` au jeton marketing** (`UPDATE … SET manage_offers = true WHERE name = 'marketing-offres';`).
