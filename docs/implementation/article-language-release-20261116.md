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
  une seule journalisation, colonne language supplémentaire. RPC historiques inchangées.
  Les refus renvoient une langue NULL, pas une métadonnée d’un autre token/édition ;
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

Le lien vers l’accueil (édition Europe seulement, le lecteur France ne change pas)
utilise le domaine comme libellé neutre : aucun libellé polonais inventé. En aperçu,
le libellé existant est conservé pour lexpress.fr et pour l’anglais ; pour fr.lexpress.eu
et pl.lexpress.eu, le domaine source sert de libellé. Un article de fr.lexpress.eu
reprend les textes français existants du lecteur et la date fr-FR. L’attribut lang ne
couvre que le contenu (rubrique, titre, chapô, corps). Changement visible en anglais :
le bouton d’article passe de « Subscribe to L'Express Europe » à « Subscribe ». La table simple est dans
`docs/reader-reference/src/lib/articleLanguage.ts`. L’abonnement France historique
reste inchangé. Les autres textes PL du lecteur (états, réessai, explication, etc.)
restent une décision de traduction à prendre ; cette demande ne fournit pas ces textes.

## Lovable

Message prêt à coller : `lovable-article-language-prompt.md` dans ce dossier.
Patch de référence : `docs/patches/reader-europe-hosts.patch` ; sources après patch :
`docs/reader-reference/src/`. Rien n’a été envoyé et le projet externe reste intact.
`git apply --check` a réussi sur le source lecteur retrouvé. Les tests appliquent
le patch à une copie, compilent ses vrais composants et vérifient les boutons,
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

### 1. Migration 017

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
Ne pas appeler une RPC de lecture PROD pour vérifier : elle compte les lectures.

Retour arrière SQL : préférer conserver l’ajout compatible et revenir aux anciens
appelants. Si suppression explicitement décidée, sauvegarder d’abord les langues,
revenir à la fonction puis au lecteur précédents (dans cet ordre), puis appliquer
`gift-links/supabase/rollback/017-article-language.sql` via le même endpoint.
Ce rollback restaure cache_articles 015, supprime v2/trigger/colonne/règle, garde les
tokens, corps, expirations et adresses canoniques. Rejouer 017 ensuite retrouve les
langues PL/FR par l’hôte canonique (testé). Aucun CASCADE, aucune suppression d’article/lien.

### 2. Lovable (lecteur) — avant la fonction

Faire appliquer le prompt/patch dans le brouillon par le circuit Lovable existant,
réaliser la recette TEST prévue, puis publier uniquement après accord écrit.
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
- lien d’accueil ajouté au lecteur France sans demande : limité à l’édition Europe ;
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

## Décisions pour Ophélie

1. Textes polonais manquants. Un article polonais affiche l’habillage anglais existant
   (« By », « Published on », phrase d’offre, écrans d’erreur) car seul « Subskrypcja »
   est attesté. A : valider cet état provisoire. B : fournir les traductions polonaises.
   Recommandation : A maintenant, B ensuite.
2. Phrase d’offre des articles fr.lexpress.eu : elle reprend celle de la France (« Cet
   article vous a été offert. Pour lire L'Express sans limite, abonnez-vous. ») alors que
   le bouton mène à fr.lexpress.eu/abonnement/. A : la garder. B : fournir une phrase
   propre à l’édition Europe. Recommandation : A.
3. Bouton anglais : « Subscribe » (en-tête du site) remplace « Subscribe to L'Express
   Europe » sous les articles anglais. A : accepter. B : garder l’ancien libellé pour
   l’anglais. Recommandation : A, conforme à la consigne « libellé de l’en-tête ».
