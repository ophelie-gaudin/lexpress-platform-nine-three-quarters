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
- existant EUR=en, FR=fr ; NOT NULL et valeurs en/fr/pl (FR ne peut être que fr) ;
- défaut dépendant de l’édition via trigger BEFORE INSERT/UPDATE si valeur absente,
  car un DEFAULT PostgreSQL ne peut pas lire la colonne edition ;
- cache_articles reçoit language, conserve la langue existante quand un ancien
  appelant omet ce champ, et ne dégrade toujours pas les corps ;
- nouvelle RPC `get_gift_article_for_edition_v2` : même contrôle/lecture que l’ancienne,
  une seule journalisation, colonne language supplémentaire. RPC historiques inchangées.
  Les refus renvoient une langue NULL, pas une métadonnée d’un autre token/édition.

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

Le lien vers l’accueil et celui de l’aperçu utilisent le domaine comme libellé
neutre : aucun libellé polonais supplémentaire inventé. La table simple est dans
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
revenir au lecteur et à la fonction précédents, puis appliquer
`gift-links/supabase/rollback/017-article-language.sql` via le même endpoint.
Ce rollback restaure cache_articles 015, supprime v2/trigger/colonne, garde les tokens,
corps et expirations. Il perd les langues : conserver la sauvegarde privée pour
restauration ultérieure. Ne pas réappliquer un défaut en sur d’anciens PL/FR sans
restaurer les langues sauvegardées. Aucun CASCADE, aucune suppression d’article/lien.

### 2. Fonction de création

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

### 3. Lovable

Faire appliquer le prompt/patch dans le brouillon par le circuit Lovable existant,
réaliser la recette TEST prévue, puis publier uniquement après accord écrit.
Le domaine reste articles.lexpress.eu pour EN/FR/PL. Aucun besoin de changer le DNS.
Ne pas exposer la génération PL/FR avant que ce lecteur accepte leur canonique et
leur langue. Les tests locaux ne remplacent pas cette recette de brouillon.

Retour arrière Lovable : restaurer la publication capturée avant intervention,
sans réécrire son historique Git. Attention : le lecteur ancien refuse PL/FR ; si
des liens PL/FR ont déjà été diffusés, un retour arrière complet casserait leur lecture.
Dans ce cas conserver la correction du lecteur et la migration additive, suspendre
seulement la nouvelle génération, puis faire décider la reprise par Ophélie.

### 4. Interface

Faire publier le commit validé de cette PR par le circuit Vercel existant, après
confirmation du lecteur et de la fonction. Aucun déploiement déclenché manuellement ici.
La génération transmet toujours URLs et durée ; aucune langue saisissable à ajouter.
La fusion n’est pas autorisée ici et peut déclencher une publication automatique :
la coordonner seulement après les étapes 1–3 et accord écrit.

Retour arrière interface : restaurer le déploiement PROD Vercel capturé avant
publication par le circuit existant, sans modifier les domaines ni migrer l’hébergement.
Un rollback complet se coordonne en sens inverse : interface, lecteur, fonction,
SQL seulement si nécessaire et après sauvegarde des langues. Ne supprimer aucun lien.
