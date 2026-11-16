# Langue des articles — évolution de la PR #1, 16 novembre 2026

Préparation locale uniquement. Aucun déploiement PROD, aucun message envoyé à Lovable.
Cette note remplace les hypothèses « habillage Europe anglais sans métadonnée » du
premier diagnostic pour le comportement cible. L’existant PROD reste inchangé.

## Schéma retenu

`articles.language text NOT NULL` décrit le contenu ; pas le lien, qui a une durée
et un jeton pouvant être prolongés. Dupliquer la langue dans gift_links créerait
une divergence possible entre un article et son lien. La clé `(edition, arc_id)`
et l’unicité des liens par article restent inchangées. FR et PL fournis par Ophélie
ont des IDs Arc distincts : `5IZJUWHEXBCELAV4FGFPXU3LTQ` et
`4DHUZG3CTFFJFLSPBD3XJ2O4TU` ; aucun regroupement par titre/sujet/langue.

Migration additive `gift-links/supabase/017-article-language.sql` :
- une seule règle SQL, `article_language(edition, canonical_url)` : pl.lexpress.eu=pl,
  fr.lexpress.eu=fr, reste de l’Europe=en, France=fr. Elle sert au remplissage de
  l’existant, au défaut d’insertion et à la contrainte ;
- existant PROD relevé en lecture seule le 16/11 (SELECT, réponse 201) : 49 articles EUR,
  tous sur www.lexpress.eu → en ; 171 articles FR sur www.lexpress.fr → fr ; colonne absente ;
- contrainte `language = article_language(edition, canonical_url)` : la langue et l’adresse
  canonique ne peuvent pas diverger, la langue ne peut être ni effacée ni inventée ;
- défaut par trigger BEFORE INSERT seulement (un DEFAULT PostgreSQL ne lit pas une autre
  colonne) : la fonction v24 actuelle, qui n’envoie pas de langue, reste compatible ;
- cache_articles reçoit language et refuse qu’un article existant change de langue
  (« la langue d’un article existant ne change pas ») ; il ne dégrade toujours pas les corps ;
- nouvelle RPC `get_gift_article_for_edition_v2` : même contrôle/lecture que l’ancienne,
  une seule journalisation, colonne language supplémentaire. RPC historiques inchangées ;
- `gift_link_status_v107` (disponibilité d’un lien, appelée sous service_role) accepte les
  adresses pl.lexpress.eu et fr.lexpress.eu, rattachées à l’édition Europe. Avant, une seule
  de ces adresses faisait échouer tout le lot (« URLs invalides »). Seules les deux
  expressions d’hôte changent ; le retour arrière remet la définition 015.
  Un lien expiré ou retiré rend la langue de son article (et rien d’autre), pour traduire
  l’écran de refus ; un jeton inconnu ou d’une autre édition rend une langue NULL ;
- `lock_timeout` de 3 s (proposé, optionnel) : la migration échoue vite au lieu de bloquer
  les lectures derrière un verrou ; elle est rejouable, y compris après le retour arrière,
  puisque la langue se retrouve par l’hôte canonique.

Un même identifiant Arc demandé sous deux langues dans un lot (ex. pl. et www.) est
refusé pour les deux adresses, avec motif ; le reste du lot passe. Limite connue : si
la demande arrive dans un autre appel, pour un article déjà en cache sous une autre
langue, la base refuse et tout ce lot échoue (HTTP 500, « la langue d’un article existant
ne change pas »). Cas attendu seulement pour un article publié sur deux sites Europe,
qu’Arc refuse déjà quand il répond ; échec visible plutôt que langue fausse.
`article_language` est une fonction pure exécutable par tous : la contrainte l’évalue
avec les droits du rôle qui écrit, la restreindre bloquerait purge et corrections.

La fonction déduit language de l’hôte, pas d’un champ fourni par l’appelant.
Le bundle et sa source sont synchronisés. L’interface ne doit pas envoyer une langue
librement choisie ; elle transmet les URL, le backend détermine en/fr/pl.

## Libellés attestés

Source vivante : GET des accueils, extraction du texte des liens d’abonnement,
puis GET de chaque cible. Preuve `docs/evidence/europe-subscription-labels-20261116.json`.

| Langue | Bouton réel | Abonnement HTTP 200 | Accueil HTTP 200 |
| --- | --- | --- | --- |
| en | Subscribe | https://www.lexpress.eu/subscribe/ | https://www.lexpress.eu/ |
| fr Europe | S'abonner | https://fr.lexpress.eu/abonnement/ | https://fr.lexpress.eu/ |
| pl | Subskrypcja | https://pl.lexpress.eu/subskrypcja/ | https://pl.lexpress.eu/ |

## Textes fixes de la page de lecture (décision d’Ophélie du 16/11)

Les articles de pl.lexpress.eu sont déjà traduits. Seuls les mots fixes du lecteur sont
traduits, une fois, et utilisés quand la langue de l’article est `pl`. Pour chaque texte,
le libellé réel du site a été cherché d’abord par GET public (article, accueil, abonnement,
page d’erreur) ; sinon traduction. Preuve et origine de chaque texte, clé par clé :
`docs/evidence/europe-reader-labels-20261116.json` (`relevé` avec URL, `traduit`, ou
`lecteur` = texte existant du lecteur). Table : `docs/reader-reference/src/lib/articleLanguage.ts`.

Relevés en polonais : « Subskrypcja » (accueil), « Autor: » (article), « Przejdź na stronę
główną » (page d’erreur du site, gardé pour la seule page d’erreur du lecteur), et les fragments « Zapisz się do L'Express » et « Odblokuj
nieograniczony dostęp do wszystkich naszych artykułów » (menu), assemblés dans la phrase
d’offre. Le site affiche la date seule (16.11.2026 09:45) : « Opublikowano » est traduit.
Le ton suit le site (tutoiement, « Twój klucz do informacji »). Tout le reste est traduit.

Français (fr.lexpress.eu) : « Par » et « S'abonner » relevés ; le reste reprend le lecteur
France, phrase d’offre comprise. Seul écart : « Lire la suite sur fr.lexpress.eu », pour ne
jamais afficher lexpress.fr.

Anglais : textes existants du lecteur, sauf le bouton « Subscribe » (décision du 16/11).

Recette visuelle d’Ophélie du 16/11 sur le brouillon Lovable : tout est bon, sauf deux
points, qu’elle a envoyés elle-même à Lovable et que ce dépôt reprend.
1. L’en-tête (« Article shared by » / « Article offert par » / « Artykuł w prezencie od »)
   suit la langue de l’article aussi sur les écrans « expiré » et « retiré ». Il restait en
   anglais sur un lien polonais expiré ou retiré.
2. Le lien d’accueil sous le bouton d’abonnement (« Go to the homepage » / « Retour à
   l'accueil » / « Przejdź na stronę główną ») est supprimé partout : il était jugé bizarre.
   L’adresse `home` et le libellé `homeLabel` des cibles par langue (`EUROPE_ACTIONS`) sont
   retirés de la table, du patch et du message Lovable ; `homeLabel` est retiré du relevé
   JSON. Le bouton de la page d’erreur du lecteur (clé `home` des textes) reste inchangé.

Règles d’affichage : article lu → tout l’habillage dans la langue de l’article, date au
format de la langue (en-GB, fr-FR, pl-PL). Lien expiré ou retiré → écran de refus et bouton
dans la langue rendue par la RPC v2. Sans langue connue (chargement, panne, lien inconnu,
page introuvable) → repli du contexte : anglais sur articles.lexpress.eu, avec l’ancien
bouton « Subscribe to L'Express Europe ». Le lecteur France ne change pas. Aucun lien
d’accueil, sur aucun écran. L’attribut lang couvre le contenu (rubrique, titre, chapô, corps).
Limite : l’en-tête (« Article offert par ») et les pages « introuvable » / « erreur » ne sont
pas dans le source lecteur retrouvé ; le patch ne les couvre pas, le message Lovable si
(règle d’en-tête des écrans « expiré » et « retiré » comprise, vérifiée dans le message par
`validate-reader-patch.mjs`, pas dans un rendu).

## Lovable

Message prêt à coller : `lovable-article-language-prompt.md` dans ce dossier.
Patch de référence : `docs/patches/reader-europe-hosts.patch` ; sources après patch :
`docs/reader-reference/src/`. Rien n’a été envoyé et le projet externe reste intact.
`git apply --check` a réussi sur le source lecteur retrouvé. Les tests appliquent
le patch à une copie, contrôlent ses types (`tsc` strict, modules Lovable absents
déclarés au plus juste), exécutent ses vrais composants et vérifient les boutons,
URL, attributions et RPC en simulation. Pas de recette navigateur ni de publication.

## Tests

Rouge SQL observé avant migration : colonne language absente (42703).
Rouge fonction observé avec l’ancien bundle : undefined !== pl.
Verts ensuite : lot FR/PL et déduplication par Arc ID, vrais cache/RPC sur PGlite,
backfill/défauts, conservation langue quand omise, refus langues invalides,
lecture v2 anonyme sans accès direct à articles, une seule lecture comptée,
refus croisés, migration rejouable et rollback sans perte des tokens/corps.
`npm test` exécute aussi les tests historiques et le patch lecteur.

## Gestes PROD proposés — après accord écrit uniquement

Avant tout geste : relever les versions actives et capturer une sauvegarde privée
fraîche de la fonction, des définitions SQL concernées, du déploiement Vercel PROD
et de la publication Lovable. Les migrations historiques 014/015 sont déjà en PROD :
ne pas les réappliquer. Vérifier absence de dérive depuis le diagnostic v24.
Enregistrer aussi les couples (edition, arc_id, language) si la colonne existe.

Ordre obligatoire : 1 migration, 2 lecteur, 3 fonction, 4 interface. La fonction est le
point d’exposition : dès qu’elle est publiée, tout client de l’API peut créer un lien
PL/FR. Publiée avant le lecteur, ces liens afficheraient « This article cannot be
displayed right now ». Le nouveau lecteur, lui, fonctionne avec les articles existants.

### 0. Préparer TEST (avant de coller le message Lovable)

La recette Lovable lit la base TEST du lecteur (référence à relever dans le projet Lovable :
elle n’est pas dans ce dépôt). Sans la RPC v2 sur TEST, chaque cas de recette afficherait
« indisponible ». Après accord : appliquer 017 sur TEST, y publier la fonction de cette PR,
créer un lien en, un fr.lexpress.eu, deux pl.lexpress.eu, puis faire expirer l’un des
polonais et retirer l’autre lien de test au choix (UPDATE sur ces seules lignes de TEST).
Transmettre ces liens avec le message. Retour arrière : aucun nécessaire, TEST seulement.

### 1. Migration 017

Contrôles préalables en lecture seule (SELECT), à joindre à la demande d’accord :

```sql
-- a. Adresses canoniques que le nouveau lecteur, plus strict, refuserait. Attendu : 0.
SELECT edition, count(*) FROM articles
 WHERE canonical_url !~ '^https://((www\.)?lexpress\.(fr|eu)|(pl|fr)\.lexpress\.eu)(/|$)'
    OR (edition = 'FR') <> (canonical_url ~ '^https://(www\.)?lexpress\.fr(/|$)')
 GROUP BY edition;
-- b. Définition PROD de la RPC de disponibilité, que 017 remplace : elle doit être celle de
--    015-editions.sql (elle n’était pas dans le relevé de contrats du 16/11). Sinon, arrêt.
SELECT pg_get_functiondef('public.gift_link_status_v107(text,text[])'::regprocedure);
```

Si a rend des lignes : les corriger (espaces, port) ou assouplir le lecteur avant l’étape 2,
sinon ces articles deviendraient illisibles à la publication du lecteur.

Depuis le worktree de PR validé, préparer le JSON sans l’exécuter :

```sh
python3 - <<'PY'
import json,pathlib
sql=pathlib.Path('gift-links/supabase/017-article-language.sql').read_text()
pathlib.Path('/tmp/platform934-language-migration.json').write_text(json.dumps({'query':sql}))
PY
```

Après accord, utiliser le fichier privé d’en-tête Authorization décrit dans le
premier runbook (token lu hors dépôt, jamais dans les arguments) :

```sh
curl --fail-with-body --silent --show-error \
  --header "@$header_file" --header 'Content-Type: application/json' \
  'https://api.supabase.com/v1/projects/ovifzentveeehhtlnugk/database/query' \
  --data-binary @/tmp/platform934-language-migration.json
```

Contrôles en SELECT seulement : schéma de language, répartition par édition/langue,
présence et type de retour de la RPC v2, tokens et expirations inchangés.
Ne pas appeler une RPC de lecture PROD avec un vrai jeton : elle compte les lectures.
Contrôle d’exposition obligatoire avant l’étape 2, sans effet sur les données (testé : un
jeton inconnu ne compte aucune lecture) : appeler la v2 par l’API REST avec la clé anonyme
publique du lecteur et le jeton inexistant `00000000000000000000000000000000`, pour
`p_edition` FR puis EUR. Attendu : HTTP 200, `status: "unknown"`, `language: null`. Une
autre réponse (404, cache de schéma, droits) interdit de publier le lecteur : il rendrait
tous les liens, France comprise, « indisponibles ».

Retour arrière SQL : préférer conserver l’ajout compatible et revenir aux anciens
appelants. Garde : ne jamais l’appliquer tant que le lecteur publié appelle la v2
(vérifier que la publication Lovable restaurée est bien l’ancienne) ; sinon tous les
liens deviennent « indisponibles ». Si suppression explicitement décidée, sauvegarder d’abord les langues,
revenir à la fonction puis au lecteur précédents (dans cet ordre), puis appliquer
`gift-links/supabase/rollback/017-article-language.sql` via le même endpoint.
Ce rollback restaure cache_articles 015, supprime v2/trigger/colonne/règle, garde les
tokens, corps, expirations et adresses canoniques. Rejouer 017 ensuite retrouve les
langues PL/FR par l’hôte canonique (testé). Aucun CASCADE, aucune suppression d’article/lien.

### 2. Lovable (lecteur) — avant la fonction

Coller le message `lovable-article-language-prompt.md` (à partir de « Prépare cette
modification »), suivi du contenu de `docs/patches/reader-europe-hosts.patch` et des liens
TEST de l’étape 0. Réaliser la recette TEST prévue, vérifier que le build Lovable passe,
puis publier uniquement après accord écrit et après le contrôle d’exposition de l’étape 1.
Le domaine reste articles.lexpress.eu pour EN/FR/PL. Aucun besoin de changer le DNS.
Ne pas publier la fonction (étape 3) avant que ce lecteur accepte leur canonique et
leur langue. Les tests locaux ne remplacent pas cette recette de brouillon.

Retour arrière Lovable : restaurer la publication capturée avant intervention,
sans réécrire son historique Git. Attention : le lecteur ancien refuse PL/FR ; si
des liens PL/FR ont déjà été diffusés, un retour arrière complet casserait leur lecture.
Dans ce cas conserver la correction du lecteur et la migration additive, suspendre
seulement la nouvelle génération, puis faire décider la reprise par Ophélie.

### 3. Fonction de création

`npm test`, puis `npm run build`. Après accord, même POST multipart que dans le
premier runbook vers `/v1/projects/ovifzentveeehhtlnugk/functions/deploy?slug=create-gift-links`,
avec `verify_jwt:false`, entrypoint `index.ts`, fichier
`gift-links/functions/create-gift-links/index.bundle.ts`.
Avant : v24 observée ; après : v25 attendue si aucune publication concurrente.
Relever le numéro réel et l’empreinte retournés, vérifier par GET des métadonnées/body.
OPTIONS doit rendre 204, une demande sans jeton 401 avant écriture. Aucun lien PROD de recette.

Retour arrière fonction : republier la source v24 exacte sauvegardée dans
`~/.config/lexpress/backups/platform934-europe-hosts-20261116/create-gift-links-v24.ts`,
après comparaison avec la capture fraîche. Empreinte source connue :
`864167422fd7f78a6b9f48fe4197f2ca866107d701c1a7c57214e755324af807`.
Cela crée une nouvelle version, ne remet pas le compteur Supabase à 24.
Laisser 017 en place reste compatible avec v24 (défauts et RPC historiques).

### 4. Interface

Faire publier le commit validé de cette PR par le circuit Vercel existant, après
confirmation du lecteur et de la fonction. Aucun déploiement déclenché manuellement ici.
La génération transmet toujours URLs et durée ; aucune langue saisissable à ajouter.
La fusion n’est pas autorisée ici et peut déclencher une publication automatique :
la coordonner seulement après les étapes 1–3 et accord écrit.

Retour arrière interface : restaurer le déploiement PROD Vercel capturé avant
publication par le circuit existant, sans modifier les domaines ni migrer l’hébergement.
Un rollback complet se coordonne en sens inverse : interface, fonction, lecteur,
SQL seulement si nécessaire. La fonction revient en arrière AVANT le lecteur, sinon de
nouveaux liens PL/FR seraient créés pour un lecteur qui les refuse. Ne supprimer aucun lien.

## Revue adverse du 16/11 (second palier)

Relecteur : Claude Opus, mandat « casser », sécurité incluse. Limite : même famille de
modèle que l’auteur de la reprise ; Codex (autre famille) indisponible jusqu’au 17/11 21:10.
Verdict initial CHANGES, constats traités :
- ordre du runbook (fonction avant lecteur) : corrigé, lecteur avant fonction, inverse au retour ;
- 017 rejouée après retour arrière remettait PL/FR en « en » : remplissage par hôte canonique ;
- langue modifiable et dissociable de la canonique : contrainte + refus dans cache_articles ;
- même identifiant sous deux langues dans un lot : refus des deux adresses ;
- lien d’accueil ajouté au lecteur France sans demande : limité à l’édition Europe (puis
  supprimé partout après la recette visuelle du 16/11) ;
- verrou sans délai : lock_timeout 3 s ; langue effacée remplacée en silence : trigger INSERT seul ;
- lang="pl" englobant l’habillage anglais : lang posé sur le contenu seulement ;
- tests comparés à la table testée : désormais comparés à la preuve JSON relevée par GET.
Seconde passe (même relecteur) : aucun bloquant. Corrigés : adresse canonique de la
page publique normalisée avant stockage (un espace en tête faisait échouer le lot) ;
droits de `article_language` ouverts et testés sous service_role et sous un rôle tiers ;
rejeu de 017 réparant une ancienne valeur fausse ; ordre du retour arrière aligné dans
le fichier SQL ; tests aux erreurs précises. Documenté, non corrigé : l’échec de lot
entre deux appels décrit plus haut.
Non corrigé, assumé : entre la lecture interne et la jointure de la RPC v2, un jeton créé
dans la même milliseconde rendrait une langue NULL ; le lecteur refuse alors l’affichage
(« unavailable ») et un nouvel essai réussit. Aucune donnée exposée.

## Revue Claude Fable 5.2 du 16/11 (troisième palier)

Relecteur distinct, mandat « casser », sécurité incluse, sur toute la PR et la procédure.
Verdict : CHANGES, 1 bloquant, 5 importants, mineurs. Aucune fuite ni SSRF trouvée ; langue
non contrôlable par l’appelant ; une seule lecture comptée ; lien expiré ou retiré : seule
la langue sort. Corrigé :
- types : `RefusalView` recevait « unavailable » (erreur TS2322 en strict) ; branches
  réordonnées, et un vrai contrôle `tsc` strict ajouté au test (rouge observé, puis vert) ;
- lecteur plus strict que l’ancien sur les adresses déjà en base : contrôle SELECT a ci-dessus ;
- lecteur publié sans que la v2 ait jamais répondu en PROD : contrôle d’exposition sans effet ;
- recette Lovable impossible sans base TEST préparée : étape 0 ;
- message Lovable : rendu autonome (plus de renvoi au dépôt), textes sans langue retirés de
  la table, titre de page limité au navigateur sans appel supplémentaire ;
- `gift_link_status_v107` refusait pl. et fr. : étendue dans 017, restaurée au retour arrière ;
- recherche d’hôte par `Map` (compatible options TS strictes) ; quatre motifs de refus sans
  phrase dans l’interface, et mentions « lexpress.fr » montrées pour un article Europe.
Non corrigé, assumé : « Autor: » reste au singulier pour plusieurs auteurs (forme relevée sur
le site ; le lecteur ne reçoit qu’une chaîne) ; texte alternatif de repli des images non
traduit ; un lot multi-éditions peut répondre 500 après création partielle (rejouable).
Non vérifiable ici : configuration de build du projet Lovable, appelants de la RPC de
disponibilité, rendu visuel des textes polonais, avis d’un locuteur natif.
Aperçus de lien (WhatsApp, etc.) : le titre servi reste celui du contexte, pas traduit.

## Décisions d’Ophélie du 16/11 (prises)

1. Textes polonais : traduire une fois les mots fixes de la page de lecture (fait, ci-dessus).
2. Phrase d’offre des articles fr.lexpress.eu : celle de la France est conservée.
3. Bouton anglais : « Subscribe ».
4. Publication sans attendre Codex, après une revue par un modèle Claude Fable.
