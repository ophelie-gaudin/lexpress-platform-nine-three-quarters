# Barre d’abonnement et offres du moment — 23 novembre 2026

Préparation locale et TEST uniquement. Aucune écriture PROD, aucune fonction déployée en PROD,
aucune publication Lovable. Chaque geste PROD ci-dessous attend l’accord écrit d’Ophélie.

**Revue adverse du 24/11 (GPT 6.1 Sol) : NO-GO, cinq constats, corrigés le 24/11** — détail au
§ « Corrections après la revue du 24/11 » ; les gestes PROD (§ « Gestes proposés ») sont réécrits
en conséquence, avec une check-list avant/après par étape.

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
- Lecteur : **la source de vérité est la demande de fusion GitLab !1** du dépôt Lovable
  (`groupelexpress/software/ia/pixel-perfect-render-5344`, branche `feat/barre-abonnement-offres`).
  `docs/patches/reader-subscription-bar.patch`, `docs/reader-reference/src/` et
  `lovable-subscription-bar-prompt.md` sont l’état du 23/11, **historique** : ne pas les coller
  dans Lovable (ils n’ont ni la règle `s` seul, ni la relecture de l’offre).
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

- `gift-links/supabase/019-identifiant-envoi-elargi.sql` (**réécrite après la seconde revue du
  24/11**) : **ajoute** `get_gift_article_for_edition_v3`, même contrat que v2 (paramètres, colonnes,
  journalisation), mais `s` accepte `^[A-Za-z0-9_-]{1,64}$`. Les fonctions existantes
  (`get_gift_article`, `_for_edition`, `_v2`) **ne changent pas** et restent à 32 hexadécimaux : la
  page publiée le 20/10, qui préfère `at_recipient_id` (identifiant de contact possible), ne peut rien
  faire entrer, même depuis un onglet resté ouvert ou après un retour arrière du lecteur. Une garde
  refuse la migration si la fonction de 015 n’est pas stricte. Pas de `CHECK`. Rejouable.
- `gift-links/supabase/rollback/019-identifiant-envoi-elargi.sql` : supprime v3, remet la définition
  exacte de 015 (répare une base où l’ancienne 019 avait été posée) et le commentaire de colonne. Les
  identifiants déjà enregistrés restent (purge à 90 jours).
- `validate-send-id.mjs` (dans `npm test`) : anciennes RPC inchangées et strictes après 019, v3 =
  corps de 015 à trois écarts près, v3 = v2 dans tous les états, valeurs bricolées, purge, retour
  arrière, rejeu, réparation.
- Lecteur (!1) : appelle v3 et ne prend l’identifiant d’envoi que dans `s` (`sendIdFrom`). Liste
  blanche des paramètres recopiés sur le bouton inchangée.

Fait le 24/11/2026 sur TEST (`gsvvcrhagatwjwyyjkli`) : première version de 019 appliquée le matin,
puis retirée (retour arrière) et remplacée par la nouvelle. État relevé ensuite : `_for_edition`
`254b463c…`, `_v2` `dc851099…`, `get_gift_article` `abd4415d…`, **identiques à la PROD**, plus v3
`2b384d83…`. Preuves : `docs/evidence/revue-20261124-corrections-test.json`.

**Ordre de déploiement PROD** : 019 **avant** la publication du lecteur de !1 (étape 4 puis 5) ; seule,
elle ne change rien pour personne. Avant le premier e-mail HubSpot qui porte `s` ; un e-mail parti
avant reste lisible, seule son attribution est perdue. Retour arrière dans l’ordre inverse.

Historique (première version de 019, remplacée) :

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

## Corrections après la revue du 24/11

Revue adverse GPT 6.1 Sol du 24/11 : NO-GO. Constats et corrections. Preuves TEST :
`docs/evidence/revue-20261124-corrections-test.json`.

| # | Constat | Correction | Où |
| --- | --- | --- | --- |
| 1 | `?s=123456789012&at_recipient_id=987654321` enregistrait l’identifiant du contact (la page prend `at_recipient_id` en priorité, 019 l’accepte) | La page ne prend que `s`. `at_recipient_id` n’est repris que s’il a exactement 32 hexadécimaux minuscules (seule forme que la base gardait avant 019) **et** que `s` est absent ou vide. Seconde revue : 019 n’élargit plus les RPC existantes ; elle ajoute v3, appelée par la seule nouvelle page | lecteur `src/lib/giftArticle.ts` (`sendIdFrom`), tests `tests/giftArticleV2.test.ts` ; en-tête de 019 ; README, `docs/frontend.md` |
| 2 | Une offre terminée en avance restait sur les pages ouvertes ; à sa date de fin, bouton par défaut au lieu de l’offre longue qu’elle recouvrait | La barre relit l’offre toutes les 5 minutes (**proposé, optionnel** : `OFFER_REFRESH_MS`) et une seconde après la fin de l’offre affichée. Échec passager (réseau, délai, 5xx, 408, 429, coupure pendant la lecture du corps) : la dernière offre valide reste, et disparaît quand même à sa date de fin ; refus (4xx) : bouton par défaut. Jamais de bouton cassé | lecteur `src/components/SubscribeButton.tsx`, `src/lib/subscriptionOffer.ts`, test monté `tests/subscribeBar.test.tsx` |
| 3 | Retour arrière de 018 = perte des offres et des droits | Interrupteur réversible préféré ; sauvegarde contrôlée ligne à ligne, essai de restauration à blanc, retour arrière **gardé** (verrou, puis égalité exacte avec la sauvegarde, sinon refus) ; DROP en dernier recours | `gift-links/supabase/sauvegarde/offres.mjs`, `validate-offres-retour-arriere.mjs`, § 6 |
| 4 | Rien n’empêchait un Publish depuis la branche de recette (tout en base TEST) | Étape obligatoire avant Publish (§ 4) et test automatique : `tests/deployment.test.ts` échoue si un domaine public lit la base TEST | lecteur, § 4 |
| 5 | Base TEST : `anon`/`authenticated` avaient TRUNCATE (et REFERENCES, TRIGGER, MAINTAIN) sur 4 tables et 2 vues ; la PROD ne leur donne rien | Retirés sur TEST seulement ; droits TEST et PROD comparés | `gift-links/supabase/test-seulement/droits-alignes-prod-20261124.sql` |

Constat 1, liens existants : aucun code interne n’émet `at_recipient_id` (agent WhatsApp, `origin/main`
du 24/11 : seuls `s` et le `recipient_id` des statuts Meta, un téléphone, sans lien avec la page). Mais
la page PROD le prend en priorité depuis le 20/10 (commit Lovable `2be6d47`), c’est le nom
AT Internet/Piano de l’identifiant destinataire, et un outil d’envoi externe peut l’émettre : la
compatibilité stricte ci-dessus est gardée par prudence. Limite : 32 chiffres sont aussi 32
hexadécimaux, donc acceptés, comme avant 019.

Constat 2, coût : une requête par page ouverte toutes les 5 minutes (suspendue dans un onglet
masqué, rattrapée au retour), sur `get_subscription_offer`, fonction SQL `STABLE` : PostgreSQL y
interdit toute écriture, aucune lecture d’article n’est comptée (test monté : seules des requêtes
`get_subscription_offer` partent).

Constat 5, écarts restants entre TEST et PROD (relevé du 24/11, PROD en lecture seule) :
- les objets de 018 (table `subscription_offers`, 10 fonctions), présents en TEST seulement : attendu ;
- droits par défaut du schéma `supabase_functions` (extension webhooks), en TEST seulement, hors schéma
  `public` ;
- communs aux deux bases, non corrigés (hors périmètre, à décider) : `anon` et `authenticated` ont
  `USAGE, SELECT, UPDATE` sur la séquence `gift_link_opens_id_seq` (non exposée par l’API REST) ; les
  droits par défaut du schéma `public` donnent tous les droits à `anon` sur toute future table, que
  chaque migration doit donc retirer, comme 018 le fait.

## Gestes proposés — après accord écrit uniquement

Ordre : 1 migration 018, 2 fonction, 3 droit du jeton marketing, 4 migration 019, 5 lecteur (fusion
de !1 puis Publish). Le lecteur de !1 appelle `get_subscription_offer` (018) et
`get_gift_article_for_edition_v3` (019) : publié avant 019, **chaque article afficherait l’écran
technique**. 018 et 019 seules ne changent rien pour la page publiée. Retour arrière dans l’ordre
inverse : le lecteur d’abord.

Chaque étape : check-list **avant** (si un point échoue, ne pas commencer) et **après** (si un point
échoue, retour arrière de l’étape, § 6). Toutes les requêtes de contrôle PROD sont en lecture seule :
les préfixer de `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;`.

### 0. TEST d’abord

La base TEST est la branche Supabase persistante `test-europe` du projet, ref
`gsvvcrhagatwjwyyjkli` (URL `https://gsvvcrhagatwjwyyjkli.supabase.co`). Mêmes gestes que
ci-dessous en remplaçant la ref PROD par celle-ci.

Fait le 23/11/2026 : 018, fonction v1 et jeton `marketing-offres-test` en place sur TEST ;
54 contrôles HTTP sur 54 et retour arrière vérifiés. Le 24/11 : 019, droits alignés sur la PROD,
interrupteur, sauvegarde et restauration vérifiés (preuves ci-dessus).

Nettoyage d’une recette : l’API ne supprime pas une offre, elle la termine (`DELETE`). Pour
effacer les offres de recette sur TEST, après les avoir terminées :
`DELETE FROM public.subscription_offers WHERE request_id LIKE 'recette-%';`

### 1. Migration 018 (PROD `ovifzentveeehhtlnugk`)

Avant :
- [ ] `npm ci && npm test` vert sur la tête de la PR.
- [ ] `SELECT to_regclass('public.subscription_offers');` → NULL.
- [ ] `SELECT column_name FROM information_schema.columns WHERE table_name = 'api_clients' AND column_name = 'manage_offers';` → aucune ligne.
- [ ] Droits publics actuels relevés (pour comparer après) : requête du § « Relevé des droits » ci-dessous → aucune ligne attendue.

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

Après :
- [ ] `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subscription_offers'::regclass;` → true.
- [ ] `SELECT count(*) FROM pg_policies WHERE tablename = 'subscription_offers';` → 0.
- [ ] Relevé des droits → toujours aucune ligne (la table n’ajoute aucun droit public).
- [ ] `SELECT count(*) FROM public.api_clients WHERE manage_offers;` → 0.
- [ ] Clé publique du lecteur : `POST /rest/v1/rpc/get_subscription_offer` avec `{"p_site":"www.lexpress.fr"}` → HTTP 200, `[]` ; `GET /rest/v1/subscription_offers` → refus (401 ou 403), jamais une liste.

**Relevé des droits** (TEST et PROD doivent rendre aucune ligne) :

```sql
SELECT c.relname, r, p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN unnest(ARRAY['anon','authenticated']) r
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege(r, c.oid, p);
```

### 2. Fonction `subscription-offers`

Avant :
- [ ] Étape 1 faite et vérifiée.
- [ ] `npm run build` ; le bundle `gift-links/functions/subscription-offers/index.bundle.ts` est celui de la tête de la PR (`git status` propre).

Après accord, même POST multipart que pour `create-gift-links`, vers
`/v1/projects/ovifzentveeehhtlnugk/functions/deploy?slug=subscription-offers`, avec
`verify_jwt:false` (l’authentification est le jeton de service, comme `create-gift-links`),
entrypoint `index.ts`, fichier `gift-links/functions/subscription-offers/index.bundle.ts`.

Après :
- [ ] Sans en-tête → 401 ; avec un jeton existant sans le droit → 403 sur `GET`.
- [ ] `create-gift-links` répond comme avant (un appel de contrôle sans jeton → 401).
- [ ] Aucune offre de recette en PROD.

### 3. Jeton du marketing

Avant :
- [ ] Étape 2 faite et vérifiée.

Créer un jeton dédié (`marketing-offres`, procédure « Créer un jeton » du README), puis lui
accorder le droit, dans l’éditeur SQL :

```sql
UPDATE public.api_clients SET manage_offers = true WHERE name = 'marketing-offres';
```

Après :
- [ ] `SELECT name FROM public.api_clients WHERE manage_offers;` → `marketing-offres` seul.
- [ ] `GET` (README, « Lister les offres ») → HTTP 200, `"offers": []`.

### 4. Migration 019 (PROD `ovifzentveeehhtlnugk`) — avant le lecteur

Avant :
- [ ] Étape 3 faite et vérifiée.
- [ ] La fonction de 015 est stricte (la migration le vérifie aussi, et refuse sinon) :

```sql
SELECT md5(pg_get_functiondef('public.get_gift_article_for_edition(text,text,text,text,text,text,text)'::regprocedure));
-- attendu : 254b463cfdba9db7bdc326f40d38d788 (relevé PROD et TEST du 24/11). Autre valeur : s’arrêter.
```

Après accord, même préparation et même `curl` qu’au § 1, avec
`gift-links/supabase/019-identifiant-envoi-elargi.sql` (fichier JSON
`/tmp/platform934-envoi-migration.json`).

Après :

```sql
SELECT p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), proacl::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'get_gift_article%' ORDER BY 1;
-- attendu (relevé TEST du 24/11) : get_gift_article abd4415db6201b4bb88f7f11091fe76d,
--   _for_edition 254b463cfdba9db7bdc326f40d38d788, _v2 dc85109961ed63757792da869fbace7d (INCHANGÉES),
--   _v3 2b384d83e5d38190b3d91b1eaf4d25dc ; droits {postgres=X,anon=X,authenticated=X,service_role=X}.
```

- [ ] Les trois anciennes empreintes sont celles d’avant : rien n’a changé pour la page publiée.

Pas de lecture d’essai en PROD : elle compterait une ouverture fictive. La première lecture d’un
e-mail HubSpot se vérifie ensuite par
`SELECT send_id, opened_at FROM public.gift_link_opens WHERE utm_source = '<at_medium des e-mails>' ORDER BY id DESC LIMIT 5;`.

Retour arrière : appliquer `gift-links/supabase/rollback/019-identifiant-envoi-elargi.sql` par le
même endpoint, **seulement après le retour arrière du lecteur** (étape 5) : le lecteur de !1 appelle v3.

### 5. Lecteur (Lovable) — fusion de !1, puis Publish

Le lecteur se livre par la demande de fusion GitLab !1 (`feat/barre-abonnement-offres` vers
`main`), que Lovable synchronise. **Aucun message dans le chat Lovable.** La branche
`recette/offres-test` lit la base TEST partout, domaines publics compris : elle ne doit **jamais**
être fusionnée ni publiée.

Avant la fusion :
- [ ] Étapes 1 et 4 faites et vérifiées en PROD : `get_subscription_offer` et `get_gift_article_for_edition_v3` existent (sinon chaque article afficherait l’écran technique).
- [ ] Dans un clone propre de !1 : `bun install --frozen-lockfile && bun test && bun run build` et `npx tsc --noEmit -p .` verts.
- [ ] `tests/deployment.test.ts` vert : les domaines publics (`articles.lexpress.fr`, `articles.lexpress.eu`, `pixel-perfect-render-5344.lovable.app`) lisent la PROD. Ce test échoue, volontairement, sur `recette/offres-test`.

**Étape obligatoire avant Publish** (constat 4) :
- [ ] Lovable est branché sur **`main`** (réglages du projet → GitLab → branche) et non sur `recette/offres-test` ni `feat/…`.
- [ ] Le dernier commit synchronisé dans Lovable est **la tête de `main` après fusion** : comparer avec `git ls-remote <dépôt> refs/heads/main` (SHA complet).
- [ ] `git show <ce SHA>:src/lib/deployment.ts` sélectionne la base selon `context.environment` (et non `databases.TEST` en dur), et `bun test tests/deployment.test.ts` est vert à ce SHA.
- [ ] Capture de la publication actuelle (pour le retour arrière).

Publish sur accord écrit seulement.

Après Publish (ne compte aucune lecture) :
- [ ] Ouvrir `https://articles.lexpress.fr/a/` suivi de 32 hexadécimaux qui ne sont pas un lien (par exemple `0000…0000`) : page « Ce lien n’existe pas » ; dans l’onglet Réseau du navigateur, l’appel `get_gift_article_for_edition_v3` part vers **`ovifzentveeehhtlnugk`** (un jeton inconnu ne crée pas de lecture). Idem sur `articles.lexpress.eu`.
- [ ] Sur une page d’article déjà offert, ouverte par l’équipe, l’appel `get_subscription_offer` part vers `ovifzentveeehhtlnugk` et la barre affiche le bouton par défaut (aucune offre en PROD).
- [ ] Un appel vers `gsvvcrhagatwjwyyjkli` depuis un domaine public = mauvaise branche publiée : restaurer immédiatement la publication capturée.

### 6. Retour arrière

Du plus doux au plus fort. Toujours commencer par le premier geste qui suffit.

- **Lecteur** : restaurer la publication Lovable capturée avant intervention. Sans risque
  pour les données : l’ancienne page appelle `_v2`, qui reste stricte même avec 019 en place (un
  `at_recipient_id` ne peut pas entrer). À faire **avant** tout retour arrière de 019 ou de 018.
- **Couper une offre** sans rien retirer : `DELETE` de l’API (README), ou en SQL, que l’offre soit
  en cours ou à venir :
  `UPDATE public.subscription_offers SET ended_at = now() WHERE id = '<id>' AND ended_at IS NULL;`
  Les pages ouvertes la quittent à leur relecture suivante (5 minutes au plus).
- **Couper le marketing** : `UPDATE public.api_clients SET manage_offers = false WHERE name = 'marketing-offres';`
- **Interrupteur réversible : couper toutes les offres d’un coup** (préféré au DROP) — aucune donnée
  touchée, droits rendus à l’identique :

  ```sql
  REVOKE EXECUTE ON FUNCTION public.get_subscription_offer(text) FROM anon, authenticated;
  -- remettre :
  GRANT EXECUTE ON FUNCTION public.get_subscription_offer(text) TO anon, authenticated;
  ```

  Effet : la RPC est refusée (HTTP 401/403) ; la page affiche le bouton par défaut au chargement, et
  les pages ouvertes à leur relecture suivante (5 minutes au plus). Contrôle après coupure : appel
  `get_subscription_offer` avec la clé publique → refus. Contrôle après remise : `{"p_site":"www.lexpress.fr"}`
  → HTTP 200, et l’ensemble des droits de la fonction est le même qu’avant (l’ordre d’affichage de
  `proacl` peut changer, pas son contenu). Variante plus lente : terminer chaque offre en cours par
  l’API (`DELETE`), puis la recréer pour revenir en arrière.
- **Fonction** : la supprimer dans le tableau de bord (Edge Functions → `subscription-offers`
  → Delete). Aucune autre fonction n’en dépend.
- **SQL de 018 — dernier recours, avec perte évitée par la sauvegarde.** Seulement après le retour
  arrière du lecteur ou l’interrupteur.

  Avant :
  - [ ] Écritures du marketing suspendues pendant l’opération (proposé, optionnel : le retour arrière
        gardé refuse de toute façon si la base change) :
        `REVOKE EXECUTE ON FUNCTION public.create_subscription_offer(uuid,text[],timestamptz,timestamptz,text,text,text,text), public.end_subscription_offer(uuid,uuid) FROM service_role;`
        (remettre par `GRANT … TO service_role` si l’on renonce au retour arrière).
  - [ ] Sauvegarde prise, contrôlée et prouvée restaurable :

    ```sh
    node gift-links/supabase/sauvegarde/offres.mjs sql-sauvegarde > /tmp/p934-sauvegarde.sql
    # même curl qu'au § 1 avec ce fichier, réponse écrite dans un fichier privé (umask 077), par exemple
    # ~/.config/lexpress/sauvegardes/offres-<date>.json
    F=~/.config/lexpress/sauvegardes/offres-<date>.json
    node gift-links/supabase/sauvegarde/offres.mjs sql-restauration "$F" > /tmp/p934-restauration.sql
    node gift-links/supabase/sauvegarde/offres.mjs sql-retour-arriere "$F" > /tmp/p934-retour-arriere.sql
    ```

    Les deux commandes contrôlent chaque ligne (champs, types, dates) et refusent une sauvegarde
    incomplète. Puis **essai à blanc** : passer `/tmp/p934-restauration.sql` sur la base encore intacte ;
    il doit répondre sans erreur (il ne change rien et prouve empreinte, contenu et restaurabilité).

  Puis appliquer **`/tmp/p934-retour-arriere.sql`** (et non le fichier brut
  `rollback/018-offres-abonnement.sql`) par le même endpoint. Il verrouille les tables des offres et des
  jetons, vérifie que offres et droits sont **encore exactement** ceux de la sauvegarde, et seulement
  alors supprime la table, ses fonctions et la colonne `manage_offers` ; liens, articles, lectures et
  jetons restent. Une offre créée, terminée ou modifiée depuis la sauvegarde l’arrête sans rien
  supprimer : reprendre la sauvegarde.

  Après :
  - [ ] `SELECT to_regclass('public.subscription_offers');` → NULL ; relevé des droits → aucune ligne.

  **Restauration** : ré-appliquer 018 (§ 1), puis `/tmp/p934-restauration.sql` par le même endpoint.
  Le script vérifie, avant de valider, que les offres (dates à la microseconde) et les jetons qui ont
  le droit sont exactement ceux de la sauvegarde ; sinon il annule tout. Il refuse une sauvegarde
  altérée et une base sans 018. Rejouable. Testé (`validate-offres-retour-arriere.mjs`, PGlite :
  sauvegarde, retour arrière gardé, ré-application, restauration, puis offres, droits, réponses de la
  page et liste du marketing identiques ; refus d’une offre terminée après la sauvegarde, d’une
  sauvegarde altérée à nombre de lignes égal ou incomplète). Refait sur TEST le 24/11 (preuves).
