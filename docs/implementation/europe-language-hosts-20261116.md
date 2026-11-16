# Domaines Europe — diagnostic et préparation, 16 novembre 2026

Aucune écriture PROD, aucun lien créé, aucun déploiement. Migration d'hébergement hors périmètre.

## Preuves vivantes (GET seulement)

L'API Management Supabase retourne `create-gift-links` ACTIVE v24, empreinte ESZIP
`4ef778d402bcf20a8860d509e389105972506fe3c88d47e6939a6e81fa9a8a42`.
`gift-link-status` est en v3, `europe-catalogue` en v1. Métadonnées archivées dans
`docs/evidence/europe-functions-before-20261116.json`.
Le GET `/v1/projects/ovifzentveeehhtlnugk/functions/create-gift-links/body` a fourni
l'ESZIP déployé ; son module `source/index.ts` a été extrait (36 451 octets).
Il n'accepte que lexpress.fr, www.lexpress.fr, lexpress.eu et www.lexpress.eu.
Il charge Arc `/content/v4/?_id=…&website=…`, corps compris ; à défaut, aperçu public.

Le backend Europe non publié sur Git est retrouvé dans
`/Users/ophelie/Desktop/dev/L'Express/.worktrees/lexpress-gift-links/europe-backend`,
branche `feat/europe-backend`, avec modifications non commitées. Rien n'y est modifié.
Les modules de création v24 sont rapatriés dans cette PR pour ne pas redéployer
accidentellement la version France seule de main. Pas de migration SQL à appliquer :
la création v24 utilise déjà `cache_articles` avec édition et `create_gift_links_for_edition`.
Cette PR conserve cette dépendance au schéma Europe déjà en PROD ; elle ne constitue
pas une reconstruction complète de tous les services du projet.

L'interface transmet `urls` et `expires_in_days`, sans champ édition ; le backend
la déduit de l'hôte. Son filtre local partage `arc-id.mjs` et bloquait aussi PL/FR Europe.

## Routage explicite

| Hôtes source | Langue du contenu | Site Arc | Édition de stockage | Domaine de lecture | Textes du lecteur actuel |
| --- | --- | --- | --- | --- | --- |
| lexpress.fr, www.lexpress.fr | français | lexpress | FR | articles.lexpress.fr | français |
| lexpress.eu, www.lexpress.eu | anglais | lexpress-europe | EUR | articles.lexpress.eu | anglais |
| pl.lexpress.eu | polonais | lexpress-europe-pl | EUR | articles.lexpress.eu | anglais, après correction du filtre du lecteur |
| fr.lexpress.eu | français | lexpress-europe-fr | EUR | articles.lexpress.eu | anglais, après correction du filtre du lecteur |

`lexpress.eu` redirige vers `www.lexpress.eu:443/`. Le port explicite reste refusé
par le service (y compris :443) ; la forme sans port www est directement accessible.
Les GET d'articles HTTP 200, leur URL avec identifiant Arc, `html lang` et
`Fusion.arcSite` figurent dans `docs/evidence/europe-public-articles-20261116.json`.
L'URL polonaise signalée répond elle aussi HTTP 200. Aucun autre sous-domaine autorisé.

## Dépendance lecteur : publication fonction seule insuffisante

GET avec User-Agent navigateur de `https://articles.lexpress.eu/` : HTTP 404 attendu
pour l'accueil absent, HTML anglais et script `/assets/index-Q5wRbKtn.js`.
GET de ce script : HTTP 200 ; il confirme que le lecteur `EUR` utilise des textes
anglais ET refuse une `canonical_url` autre que lexpress.eu/www.lexpress.eu.
Donc PL/FR seraient actuellement refusés par le lecteur, même après création réussie.
Ne pas annoncer la résolution utilisateur complète par cette PR seule.

Le fichier source correspondant est `reader/src/lib/giftArticle.ts` dans le worktree
Europe retrouvé. Avant publication, porter la liste blanche explicite des quatre
hôtes Europe dans cette validation, avec tests de refus http/ports/identifiants.
Aucun code du lecteur externe n'est modifié ici, aucun hébergement touché.
Le lecteur manque d'une traduction polonaise et d'une sélection de langue française
pour les contenus fr.lexpress.eu. Décision métier à prendre : accepter temporairement
l'habillage anglais ou prévoir le choix de langue et des traductions validées.
Ne pas inventer de traductions, ni promettre une interface polonaise.
Le domaine des liens Europe reste articles.lexpress.eu, aucun nouveau domaine nécessaire.

## Validation

Rouge observé : `node validate-europe-hosts.mjs` échoue sur pl.lexpress.eu (`undefined !== EUR`).
Vert : tests FR/EN/PL, exemple signalé, site Arc par hôte, corps, canonique, redirections
refusées avant requête sortante, ports dont :443, credentials, sous-domaines arbitraires.
Le bundle réel est exécuté avec Arc et base simulés pour contrôler cache et RPC par
édition ainsi que le domaine renvoyé. Le proxy est testé sur EN/PL/FR Europe.
`npm test` couvre aussi les 170 contrôles SQL historiques, 198 API, 217 interface
historiques (plus six assertions Europe). Ces tests ne constituent pas une recette PROD.
Pas de workflow GitHub Actions trouvé sur main ; consulter aussi les checks de la PR.

## Geste PROD proposé — seulement après accord écrit d'Ophélie

Prérequis : correction du filtre du lecteur prête et revue, décision sur les langues
explicite. Vérifier à nouveau la version active et les origines de lecture de la base
(SELECT uniquement). Ne pas exécuter les anciens scripts de première migration Europe.

Sauvegarde privée locale déjà préparée :
`~/.config/lexpress/backups/platform934-europe-hosts-20261116/` : métadonnées, ESZIP
et source v24 exacte. SHA-256 de `create-gift-links-v24.ts` :
`864167422fd7f78a6b9f48fe4197f2ca866107d701c1a7c57214e755324af807`.

Depuis le worktree de la PR, régénérer avec `npm run build`, exécuter `npm test`.
La commande suivante est proposée, NON exécutée. Le fichier d'en-tête évite
l'exposition du jeton dans les arguments du processus :

```sh
umask 077
header_file=$(mktemp)
python3 - "$header_file" <<'PY'
import pathlib,sys
secret=pathlib.Path.home().joinpath('.config/lexpress/supabase-access-token').read_text().strip()
pathlib.Path(sys.argv[1]).write_text('Authorization: Bearer '+secret+'\n')
PY
curl --fail-with-body --silent --show-error \
  --header "@$header_file" \
  'https://api.supabase.com/v1/projects/ovifzentveeehhtlnugk/functions/deploy?slug=create-gift-links' \
  --form 'metadata={"name":"create-gift-links","entrypoint_path":"index.ts","verify_jwt":false}' \
  --form 'file=@gift-links/functions/create-gift-links/index.bundle.ts;filename=index.ts;type=application/typescript'
```

Avant : v24. Après attendu : v25 si aucune publication concurrente ; relever la version
réelle retournée par l'API, jamais supposer ce numéro. La publication de l'interface
reste une opération distincte, à autoriser séparément, avec le circuit existant ;
aucune commande d'hébergement n'est exécutée ni modifiée par cette PR.

Fumée sans création : GET des métadonnées et du body, comparaison de l'allowlist/site
Arc, OPTIONS de la fonction (204), POST sans jeton (401, refus avant toute écriture).
Ne pas ouvrir un lien cadeau existant : cela peut incrémenter les lectures.
La preuve de lecture intégrale PL/FR reste à faire en TEST, pas en créant un lien PROD.

Retour arrière fonction : même curl et mêmes métadonnées, remplacer uniquement le
fichier par `@/Users/ophelie/.config/lexpress/backups/platform934-europe-hosts-20261116/create-gift-links-v24.ts;filename=index.ts;type=application/typescript`.
Supabase crée une nouvelle version (v26 attendue si le déploiement était v25), avec
le comportement v24. Ne pas rétrograder vers le bundle France seul de main.
Retour arrière interface : republier son déploiement précédent par le circuit existant,
après accord. Aucune restauration SQL, aucun token supprimé. Refaire la fumée.

## Revue adverse et suites

Claude Opus 5.5, premier passage : CHANGES ; aucune faille SSRF trouvée.
S2 corrigé : migrations historiques 014/015 réintégrées, contrats de trois fonctions
relevés via SELECT pg_get_functiondef en PROD, puis comparés au schéma reconstruit
avec PGlite. Le test exécute réellement cache_articles et create_gift_links_for_edition,
contrôle les colonnes et les origines FR/EUR. Les 170 assertions historiques seules
ne couvraient pas Europe ; le test Europe SQL s'y ajoute désormais.
S4 corrigé : README actualisé, ARC_SITE et GIFT_LINK_BASE obsolètes indiqués.
S3 : risque multisite plausible, non observé. Le chargement Arc refuse maintenant
un document présent sur plusieurs sites EUR avant cache ; test ajouté.
N1 corrigé : alias sans www normalisé vers publicOrigin pour l'aperçu.
N4 : redirection relative et borne de cinq appels couvertes.
N2/N5 : démonstration et serveur local restent historiques ; pas une traduction
polonaise, ne pas les employer comme preuve de langue du lecteur publié.
N3 : les créations multiéditions ne sont pas transactionnelles entre éditions ;
un échec tardif peut suivre une création FR réussie (comportement v24 conservé).

S1 : la dépendance lecteur est confirmée et la publication reste interdite sans
accord. Ajouter un drapeau désactivant les langues est une proposition optionnelle
du reviewer, non retenue : cela n'implémenterait pas l'acceptation demandée et
ajouterait une configuration aux deux runtimes. Aucun merge autorisé ici.
La correction externe est rendue concrète par `docs/patches/reader-europe-hosts.patch`.
Elle étend seulement la liste blanche du lecteur à PL/FR ; aucun déploiement.
`validate-reader-patch.mjs` applique ce patch à une copie du source retrouvé et
exécute son vrai getGiftArticle en simulation pour EN/PL/FR et les refus croisés.
Commande préparatoire, dans le projet lecteur et après contrôle de sa révision :
`git apply --check /chemin/Platform/docs/patches/reader-europe-hosts.patch`, puis
`git apply /chemin/Platform/docs/patches/reader-europe-hosts.patch`.
Le parent doit faire revoir/publier ce lecteur dans son circuit existant après
accord ; la présente PR ne publie ni n'édite ce projet externe.

Origines relues en PROD par SELECT (réponse API 201) :
EUR https://articles.lexpress.eu ; FR https://articles.lexpress.fr.
Avant déploiement, vérifier aussi `pg_get_function_result` de
create_gift_links_for_edition : arc_id text, token text, expires_at timestamptz,
state text, link text. Ne pas appliquer les migrations historiques en PROD.
