# Une offre ne s’affiche que par son lien — 24 novembre 2026

Préparation locale et TEST uniquement. **Aucune écriture PROD, aucune fonction déployée en PROD,
aucune fusion vers `main`, aucune publication Lovable.** Chaque geste PROD ci-dessous attend
l’accord écrit d’Ophélie. Ce document complète
[offres-abonnement-20261123.md](offres-abonnement-20261123.md) (018, 019, fonction v1, déjà en PROD
le 24/11) et en remplace le § « Gestes proposés » pour la suite.

## Décisions d’Ophélie (24/11) et choix proposés

| # | Quoi | Statut |
| --- | --- | --- |
| D1 | Un jeton **créé** a le droit de gérer les offres (`manage_offers` vrai par défaut). Les jetons existants ne sont **pas** modifiés : décision jeton par jeton (liste ci-dessous) | décidé |
| D2 | Une offre ne s’affiche que si l’URL de l’article offert la désigne. Sans paramètre : toujours le bouton par défaut. Avec paramètre : l’offre si elle existe, vise le site de l’article et que la date du jour est dans sa période ; sinon (expirée, pas commencée, terminée en avance, inconnue, autre site) le bouton par défaut. Plus d’offre « globale » | décidé |
| P1 | Nom du paramètre : **`offre`** — `…/a/<jeton>?offre=black-friday-2026&at_medium=Email&s=…`. Il ne sert qu’à choisir l’offre et **n’est pas recopié** sur le bouton ; la liste blanche `at_*` + `s` ne change pas | proposé |
| P2 | Identifiant public de l’offre **`code`** : 3 à 40 caractères `a-z0-9-`, unique parmi toutes les offres enregistrées (jamais réattribué, même après la fin), choisi à la création ; absent, l’API en tire un (16 hexadécimaux, 64 bits, non devinable). Rendu par la création et la liste | proposé |
| P3 | Plusieurs offres coexistent, chacune activée par son lien. La règle de 018 « la plus récemment commencée gagne » et `displayed_now` sont **supprimées** | proposé |
| P4 | RPC publique `get_subscription_offer(p_site, p_code)` : libellé, URL, date de fin, et seulement si l’offre est valable **maintenant** pour ce site ; sinon rien. `STABLE` (aucune écriture possible), aucune lecture d’article comptée | proposé |
| P5 | Page : sans `offre` (ou code mal formé), **aucun appel** et bouton par défaut dès le premier affichage ; relecture de **cette** offre toutes les 5 minutes et à sa date de fin (proposé, optionnel : `OFFER_REFRESH_MS`) | proposé |

Exemple :

```text
https://articles.lexpress.fr/a/<jeton>?offre=black-friday-2026&at_medium=Email&at_campaign=bf&s=123456789012
→ bouton « Black Friday : -50 % » vers
  https://abonnements-digitaux.lexpress.fr/offres?refTarif=BF&at_medium=Email&at_campaign=bf&s=123456789012
https://articles.lexpress.fr/a/<jeton>?at_medium=Email&at_campaign=bf&s=123456789012
→ bouton « S'abonner à L'Express » vers
  https://abonnements-digitaux.lexpress.fr/offres?at_medium=Email&at_campaign=bf&s=123456789012
```

Le code n’est pas un secret : un lien transféré montre l’offre à qui le reçoit, comme il montre
l’article. Ce n’est pas un contrôle d’accès.

## Jetons existants en PROD (relevé en lecture seule du 24/11/2026, ~11 h 50)

Aucun n’a `manage_offers` ; 020 ne les modifie pas. À décider un par un (accorder =
`UPDATE public.api_clients SET manage_offers = true WHERE name = '<nom>';`) :

| Jeton | Actif |
| --- | --- |
| `demo` | oui |
| `europe-catalogue-prod` | oui |
| `growth` | oui |
| `hubspot-emails` | oui — à trancher en premier : le module « Article offert » des e-mails HubSpot |
| `moteur-test` | oui |
| `n8n-agent-whatsapp` | oui |
| `regwall` | oui |
| `revocation-throwaway` | non (révoqué) |
| `sharing-trial` | non (révoqué) |
| `test` | non (révoqué) |

Un jeton révoqué ne peut rien faire, droit ou pas (`verify_api_client` le refuse).

## Ce que contient la PR

- `gift-links/supabase/020-offre-par-parametre.sql` : colonne `subscription_offers.code` (contrainte,
  index unique, défaut tiré au hasard), `get_subscription_offer(text, text)` à la place de
  `get_subscription_offer(text)` et `current_subscription_offer_id(text)` (supprimées),
  `create_subscription_offer` avec `p_code` (facultatif, en dernier), `list_subscription_offers` sans
  `displayed_now`, `end_subscription_offer_by_code`, `manage_offers` vrai par défaut. Garde : refuse
  sans 018. Rejouable.
- `gift-links/supabase/rollback/020-offre-par-parametre.sql` : remet **exactement** 018 (définitions
  recopiées à l’identique, droits, défaut faux). **Gardé** : refuse tant qu’une offre est en cours ou
  à venir (en 018, elle deviendrait visible sur tous les articles de ses sites).
- `gift-links/supabase/rollback/018-offres-abonnement.sql` : refuse désormais de s’exécuter tant que
  020 est en place (ses fonctions survivraient à la table).
- `gift-links/supabase/sauvegarde/codes-020.mjs` : sauvegarde, vérification (sans écriture), retour
  arrière gardé par la sauvegarde (égalité complète sous verrou, revue GPT du 24/11) et restauration des
  codes (codes provisoires tirés au hasard), pour qu’un lien déjà envoyé ne désigne jamais une autre offre après un
  retour arrière puis une ré-application.
- Fonction `subscription-offers` v2 : champ `code` (409 s’il est pris), `link_parameter` dans les
  réponses, `DELETE ?code=` ou `?id=` (un seul), liste avec `code`.
- `gift-links/fixtures/subscription-offers-v1.bundle.ts.txt` : la v1 déployée en PROD, pour prouver
  qu’elle marche après 020 et pour le retour arrière de la fonction.
- Tests (`npm test`) : `validate-subscription-offers.mjs` (règle site + code, 195 contrôles),
  `validate-offre-par-parametre.mjs` (empreintes protégées, v1 après 020, rejouable, retour arrière
  exact, codes, 54 contrôles) ; `validate-offres-retour-arriere.mjs` reste sur le schéma 018.
- Lecteur : demande de fusion GitLab !1, commit `652077f` (« show an offer only when the gift link
  names it »), reporté sur `recette/offres-test` (`6496128`).

## Recette TEST du 24/11 (`gsvvcrhagatwjwyyjkli`)

Preuves : [`docs/evidence/offre-par-parametre-test-20261124.json`](../evidence/offre-par-parametre-test-20261124.json).
Le code de la page (branche `recette/offres-test`) a été exécuté contre la vraie RPC TEST ; aucune
page n’a été publiée.

| # | Cas | Résultat TEST |
| --- | --- | --- |
| 1 | sans paramètre | bouton par défaut, **0** lecture d’offre |
| 2 | `offre=recette-020-valide` | « Recette 020 valide », URL de l’offre |
| 3 | offre expirée | défaut |
| 4 | offre pas encore commencée | défaut |
| 5 | offre terminée en avance (`DELETE ?code=`) | défaut |
| 6 | code inconnu | défaut |
| 7 | offre PL sur un article FR ; offre FR sur un article PL | défaut FR ; défaut polonais (« Subskrypcja ») |
| 8 | deux offres en cours sur www.lexpress.fr | chacune par son lien ; sans paramètre, défaut |
| 9 | jeton créé par `create_api_client` | `manage_offers = true` (jeton `recette-020-defaut-105716`, révoqué aussitôt) |
| 10 | `at_*` et `s` sur le bouton | ajoutés à l’URL de l’offre et au lien par défaut ; `offre`, `utm_source`, `foo` écartés |
| 11 | lectures d’article comptées | `gift_link_opens` : 65 lignes, dernier id 77, avant et après ~45 lectures d’offre |

Aussi vérifié sur TEST : empreintes de la lecture d’article (v1, v2, `_for_edition`, v3), de
`create_gift_links*` et des fonctions des jetons **identiques** avant et après 020 ; fonction **v1**
après 020 : création 201 (code tiré), liste 200, fin par id 200 ; fonction **v2** déployée (version 2, puis version 3 après la revue : commentaire seulement) :
409 sur code pris, 400 sur code mal formé et sur `?id=…&code=…`, 404 sur code inconnu ; ancienne RPC
`get_subscription_offer({p_site})` → 404 ; table → 401 pour la clé publique ; retour arrière brut → refusé
(7 offres vivantes) ; cycle complet « fin des offres → retour arrière → ré-application → restauration des
codes » joué dans une transaction **annulée** : après retour arrière, empreintes et droits des fonctions
des offres **égaux à ceux de la PROD actuelle** (`get_subscription_offer(text)` `66659a5e…`,
`current_subscription_offer_id` `a4c708d2…`, `create_subscription_offer` (8) `f1568d03…`,
`list_subscription_offers` `2c738da5…`), défaut `manage_offers` faux, colonne `code` absente ; après
restauration, 14 codes sur 14 remis ; rien n’a persisté (relevé suivant identique).

Après la revue GPT du 24/11 (NO-GO, deux constats majeurs sur la sauvegarde des codes), deux essais de
plus sur TEST, chacun dans une transaction annulée : (A) une offre créée puis terminée après la
sauvegarde → le retour arrière gardé refuse (« offres et codes différents de la sauvegarde ») ; (B) le
cycle complet avec le retour arrière gardé → mêmes empreintes de 018 que la PROD, 14 codes restaurés ;
vérification d’égalité complète passée ensuite sur la base, inchangée.

Nettoyage TEST (facultatif) : les offres de recette se terminent seules le 26/11 et le 27/11 (à venir).
Pour les effacer : `DELETE FROM public.subscription_offers WHERE request_id LIKE 'recette-%';`.

## Gestes PROD proposés — après accord écrit uniquement

Ordre : **1. migration 020 → 2. fonction v2 → 3. fusion de !1 → 4. Lovable sur `main` → 5. Publish.**
Puis, quand Ophélie le décide, les jetons (§ 6). Retour arrière dans l’ordre inverse (§ 7).

Pourquoi cet ordre : la page de !1 appelle `get_subscription_offer(p_site, p_code)`, qui n’existe
qu’après 020 (sans elle, la page afficherait le bouton par défaut — elle ne casse pas — mais chaque
lien `?offre=` serait sans effet). La fonction v1 reste compatible avec 020 (vérifié sur TEST) : entre
les étapes 1 et 2, rien ne casse. La page publiée aujourd’hui (20/10) n’appelle aucune RPC d’offre :
1 et 2 ne changent rien pour les lecteurs.

Toutes les requêtes de contrôle PROD sont en lecture seule : les préfixer de
`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;`. Même endpoint et même fichier privé
d’en-tête Authorization que dans [offres-abonnement-20261123.md](offres-abonnement-20261123.md) § 1.

**Relevé des empreintes** (sert avant et après chaque étape SQL) :

```sql
SELECT p.oid::regprocedure::text AS f, md5(pg_get_functiondef(p.oid)) AS h, coalesce(p.proacl::text, '') AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'
   AND (p.proname LIKE 'get_gift_article%' OR p.proname LIKE '%api_client%' OR p.proname LIKE 'create_gift_link%'
        OR p.proname LIKE '%subscription_offer%' OR p.proname LIKE 'offer\_%' OR p.proname IN ('assert_offer_manager', 'count_client_links', 'new_offer_code'))
UNION ALL SELECT 'défaut manage_offers', column_default, '' FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'api_clients' AND column_name = 'manage_offers'
UNION ALL SELECT 'offres', count(*)::text, '' FROM public.subscription_offers
ORDER BY 1;
```

Empreintes qui ne doivent **jamais** changer (PROD et TEST du 24/11, identiques) :

| Fonction | md5 |
| --- | --- |
| `get_gift_article(text×6)` | `abd4415db6201b4bb88f7f11091fe76d` |
| `get_gift_article_for_edition(text×7)` | `254b463cfdba9db7bdc326f40d38d788` |
| `get_gift_article_for_edition_v2(text×7)` | `dc85109961ed63757792da869fbace7d` |
| `get_gift_article_for_edition_v3(text×7)` | `2b384d83e5d38190b3d91b1eaf4d25dc` |
| `create_gift_links(text[],timestamptz,uuid)` | `f497243d6b332c8770f27e9c61b0f42f` |
| `create_gift_links_for_edition(text,text[],timestamptz,uuid)` | `cc3f4617c2d79ec40e04f781784d9a00` |
| `create_api_client(text,text,text)` | `aa4bc4ba3fbd76f73887b2bae9d4093a` |
| `verify_api_client(text)` | `6ed8b1fdb28f70f02ebba4df9451e312` |
| `revoke_api_client(text)` | `bcdfb33ef237966ebb6590405f78def9` |
| `count_client_links(uuid,integer)` | `6e0e12d3386a1717fd066353814e6882` |
| `end_subscription_offer(uuid,uuid)` | `43b7135823932c8543f335c28a8a9476` |
| `assert_offer_manager(uuid)` | `b6bdfd79e6a6045aaa05f50a18f2ea15` |
| `offer_site_family`, `offer_site_language`, `offer_url_family`, `offer_sites_valid` | `37b2af1a…`, `22d0319e…`, `c86a596d…`, `cfa8bf5a…` |

### 1. Migration 020 (PROD `ovifzentveeehhtlnugk`)

Avant (si un point échoue, ne pas commencer) :
- [ ] `npm ci && npm test` vert sur la tête de la PR.
- [ ] Relevé des empreintes : les 16 valeurs ci-dessus, plus `get_subscription_offer(text)` `66659a5e6ac52ba6278f13ff70a7acef`, `current_subscription_offer_id(text)` `a4c708d282fc50c9252cee10a34c1631`, `create_subscription_offer` (8 paramètres) `f1568d03480d69d5adc63668a141ec3f`, `list_subscription_offers(uuid)` `2c738da530a0ba3e9591045173838ce8` ; défaut `manage_offers` = `false` ; `offres` = 0 (sinon : voir les offres et décider avant, car 020 leur donnerait un code tiré et elles cesseraient de s’afficher pour tous).
- [ ] Relevé des jetons (pour comparer après) : `SELECT name, active, manage_offers FROM public.api_clients ORDER BY name;`.

Après accord, même préparation et même `curl` que dans le runbook du 23/11 § 1, avec
`gift-links/supabase/020-offre-par-parametre.sql` (fichier JSON `/tmp/platform934-020.json`).

Après (si un point échoue : § 7, retour arrière de 020) :
- [ ] Relevé des empreintes : les 16 valeurs protégées **inchangées** ; `get_subscription_offer(text)` et `current_subscription_offer_id(text)` **absentes** ; nouvelles : `get_subscription_offer(text,text)` `b2a632748013bc1396796f8cb6b64ca6` (droits `anon`, `authenticated`, `service_role`), `create_subscription_offer` (9 paramètres) `c7a805ea422efbdb026e30b4f39cefa6`, `list_subscription_offers(uuid)` `6dc6c993b5d3827607efeb2f186ab6d0`, `end_subscription_offer_by_code(uuid,text)` `29afa44bc0c3d152fa64ea7927abb976`, `offer_code_valid(text)` `9738a02406cb7d9316630b455434de75`, `new_offer_code()` `4711f6742f8959fbf9b3a2c77faffaae` (sans `anon`) ; défaut `manage_offers` = `true` (valeurs relevées sur TEST après 020).
- [ ] Relevé des jetons **identique** à l’avant (aucun n’a reçu le droit).
- [ ] Clé publique : `POST /rest/v1/rpc/get_subscription_offer` avec `{"p_site":"www.lexpress.fr","p_code":"inconnu-000"}` → 200 `[]` ; avec `{"p_site":"www.lexpress.fr"}` → 404 (lecture par site seul retirée) ; `GET /rest/v1/subscription_offers` → 401. Aucune écriture (fonction `STABLE`).
- [ ] Relevé des droits du runbook du 23/11 (§ 1, « Relevé des droits ») → toujours aucune ligne.

### 2. Fonction `subscription-offers` v2

Avant :
- [ ] Étape 1 faite et vérifiée.
- [ ] `npm run build` puis `git status` propre ; `shasum -a 256 gift-links/functions/subscription-offers/index.bundle.ts` = `08eb8fda6343e7b1ef89d9572b873dfb7102bf9e58587b6c25172e9018d7f729` (bundle déployé sur TEST).
- [ ] `GET /v1/projects/ovifzentveeehhtlnugk/functions` : `subscription-offers` version 1, `ezbr_sha256` commençant par `cc6977b4bc48`.

Après accord, même POST multipart que pour `create-gift-links` (runbook du 23/11 § 2), slug
`subscription-offers`, `verify_jwt:false`, entrypoint `index.ts`, fichier
`gift-links/functions/subscription-offers/index.bundle.ts`.

Après :
- [ ] `subscription-offers` version 2, `ezbr_sha256` commençant par `ff91ab444d99` (valeur TEST du même bundle, version 3 sur TEST) ; `create-gift-links` inchangée (version et `ezbr_sha256` d’avant).
- [ ] Sans en-tête → 401 (aucune écriture). Avec un jeton : voir l’écriture annoncée au runbook du 23/11 § 2 (`calls`, `last_used_at`).

Retour arrière : redéployer `gift-links/fixtures/subscription-offers-v1.bundle.ts.txt` (la v1, compatible
avec 020) par le même POST ; il remplace la v2 sans toucher aux offres.

### 3. Fusion de !1 (GitLab), après accord

Avant :
- [ ] Étapes 1 et 2 faites et vérifiées.
- [ ] Tête de `feat/barre-abonnement-offres` = `652077f5f1f6394697c092fbfee52e4a1a6200a6` (ou la tête relue par la revue) : `git ls-remote <dépôt> refs/heads/feat/barre-abonnement-offres`.
- [ ] Dans un clone propre de la branche : `bun install --frozen-lockfile && bun test && bun run build` et `npx tsc --noEmit -p .` verts ; `tests/deployment.test.ts` vert (les domaines publics lisent la PROD).

Après : tête de `main` relevée (`git ls-remote <dépôt> refs/heads/main`), et `git show <SHA>:src/lib/deployment.ts`
sélectionne la base selon `context.environment`. **`recette/offres-test` n’est jamais fusionnée.**

### 4. Lovable sur `main`

- [ ] Réglages du projet → GitLab → branche **`main`** (ni `recette/offres-test`, ni `feat/…`).
- [ ] Dernier commit synchronisé dans Lovable = tête de `main` après fusion (SHA complet).
- [ ] Capture de la publication actuelle (pour le retour arrière). **Aucun message dans le chat Lovable.**

### 5. Publish, après accord écrit

Après Publish (ne compte aucune lecture) :
- [ ] Le contrôle du runbook du 23/11 § 5 (jeton inconnu `0000…0000` : page « Ce lien n’existe pas », appel `get_gift_article_for_edition_v3` vers `ovifzentveeehhtlnugk`, sur articles.lexpress.fr et articles.lexpress.eu).
- [ ] Sur une page d’article déjà offert, ouverte par l’équipe **sans** `offre` : onglet Réseau, **aucun** appel `get_subscription_offer` ; bouton par défaut.
- [ ] La même page avec `&offre=inconnu-000` : un appel `get_subscription_offer` vers `ovifzentveeehhtlnugk`, corps `{"p_site":"www.lexpress.fr","p_code":"inconnu-000"}`, réponse `[]`, bouton par défaut.
- [ ] Un appel vers `gsvvcrhagatwjwyyjkli` depuis un domaine public = mauvaise branche publiée : restaurer immédiatement la publication capturée.

Première vraie offre : la créer avec un `code` (README, « Créer une offre »), ajouter `offre=<code>` aux
liens d’un envoi de test interne, ouvrir un de ces liens : bouton de l’offre, `at_*` et `s` repris.

### 6. Jetons (décision d’Ophélie, jeton par jeton)

- Nouveau jeton marketing : `create_api_client` (procédure README) → il a le droit d’office ; contrôle
  `SELECT name, manage_offers FROM public.api_clients WHERE name = '<nom>';` → `true`.
- Jeton existant (par exemple `hubspot-emails`), sur décision :
  `UPDATE public.api_clients SET manage_offers = true WHERE name = 'hubspot-emails';` ; contrôle :
  `GET` de l’API avec ce jeton → 200.
- Retirer : même requête avec `false`.

### 7. Retour arrière (du plus doux au plus fort)

- **Lecteur** : restaurer la publication Lovable capturée. Avant 020 ou après, l’ancienne page
  n’appelle aucune RPC d’offre.
- **Couper une offre** : `DELETE ?code=<code>` (README), ou en SQL
  `UPDATE public.subscription_offers SET ended_at = now() WHERE code = '<code>' AND ended_at IS NULL;`
  Les pages ouvertes la quittent à leur relecture réussie suivante : normalement sous 5 minutes dans un
  onglet actif ; pendant une panne de lecture, la dernière réponse valide reste, au plus jusqu’à la date
  de fin de l’offre.
- **Interrupteur réversible (toutes les offres d’un coup)**, sans rien supprimer :

  ```sql
  REVOKE EXECUTE ON FUNCTION public.get_subscription_offer(text, text) FROM anon, authenticated;
  -- remettre :
  GRANT EXECUTE ON FUNCTION public.get_subscription_offer(text, text) TO anon, authenticated;
  ```

  Contrôle : l’appel public `{"p_site":"www.lexpress.fr","p_code":"inconnu-000"}` → 401 après coupure,
  200 après remise ; droits identiques à l’avant (contenu de `proacl`, pas son ordre).
- **Fonction** : redéployer la v1 (§ 2, retour arrière).
- **SQL de 020**, seulement après le retour arrière du lecteur ou l’interrupteur :

  Avant :
  - [ ] Aucune offre en cours ni à venir : `SELECT code FROM public.subscription_offers WHERE ended_at IS NULL AND ends_at > now();` → aucune ligne. Sinon, décider : les terminer (`DELETE ?code=` ou l’`UPDATE` ci-dessus). Le script refuse de toute façon tant qu’il en reste (elles deviendraient visibles sur tous les articles de leurs sites).
  - [ ] Sauvegarde des codes, prouvée :

    ```sh
    node gift-links/supabase/sauvegarde/codes-020.mjs sql-sauvegarde > /tmp/p934-codes.sql
    # même curl, réponse dans un fichier privé (umask 077) :
    F=~/.config/lexpress/sauvegardes/codes-020-prod-<date>.json
    node gift-links/supabase/sauvegarde/codes-020.mjs sql-verification "$F" > /tmp/p934-codes-verif.sql
    node gift-links/supabase/sauvegarde/codes-020.mjs sql-restauration "$F" > /tmp/p934-codes-restau.sql
    ```

    Passer `/tmp/p934-codes-verif.sql` : n’écrit rien (ROLLBACK), échoue si la sauvegarde est altérée,
    si un code a changé ou si une offre a été créée depuis (égalité complète).

  Puis générer et appliquer le retour arrière **gardé par la sauvegarde** (et non le fichier brut) :

  ```sh
  node gift-links/supabase/sauvegarde/codes-020.mjs sql-retour-arriere "$F" > /tmp/p934-retour-020.sql
  ```

  Sous verrou, il vérifie que la table contient **exactement** les couples (offre, code) de la
  sauvegarde — une offre créée depuis, même terminée, l’arrête sans rien supprimer : reprendre la
  sauvegarde — puis exécute le corps de `rollback/020-offre-par-parametre.sql` (qui refuse aussi tant
  qu’une offre vit). Les définitions de 018 y sont reprises sans altération (test).

  Après :
  - [ ] Relevé des empreintes : les quatre valeurs de 018 de l’étape 1 « Avant » retrouvées
        (`66659a5e…`, `a4c708d2…`, `f1568d03…`, `2c738da5…`), les 16 protégées inchangées, défaut
        `manage_offers` = `false`, colonne `code` absente (vérifié sur TEST le 24/11 par un essai annulé).
  - [ ] Jetons créés sous 020 : ils **gardent** leur droit ; les relever (`SELECT name FROM public.api_clients WHERE manage_offers;`) et décider.

  **Ré-application** : 020 (étape 1), puis `/tmp/p934-codes-restau.sql` : chaque offre retrouve son
  code ; refus sans rien écrire si une offre manque ou si un code sauvegardé a été pris entre-temps.
  Rejouable.

- **SQL de 018**, dernier recours : après le retour arrière de 020 seulement (le fichier
  `rollback/018-offres-abonnement.sql` refuse sinon), procédure gardée du runbook du 23/11 § 6.
