# L’Express — liens d’articles offerts

Service interne qui transforme des URLs L’Express en liens temporaires donnant accès à une copie du contenu premium. Un autre canal peut appeler ce service sans dépendre de l’agent WhatsApp.

Ce dépôt est une extraction autonome du backend et de ses tests. La page de lecture est hébergée dans Lovable ; ses sources ne sont pas incluses. Partager ce dépôt en privé avec les intervenants techniques de L’Express : la fixture Arc contient un exemple réel de contenu éditorial.

## Démarrage local

Prérequis : Node.js 22 ou supérieur et npm. Depuis la racine du dépôt :

```sh
npm ci
npm test
npm run build
```

Les tests exécutent le SQL dans une base PostgreSQL embarquée (PGlite) et simulent les appels Arc et les pages publiques. Ils ne nécessitent aucun secret, n’appellent aucun service de production et n’envoient aucun message. Ils comptent actuellement 50 vérifications du schéma et 58 vérifications du traitement des articles.

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

## État connu au 5 octobre 2026

Le README du projet source rapporte le schéma appliqué, la fonction déployée, la page publiée et la lecture de corps Arc réels vérifiée en ligne. Il rapporte également la vérification des cinq statuts et du cas d’erreur technique avec réessai. L’extraction de ce dépôt ne constitue pas une nouvelle vérification de la production.

Restent à faire : archivage des données, intégration Piano et raccordement des liens offerts dans la chaîne WhatsApp de production. Le raccordement WhatsApp est documenté comme présent en test uniquement. Les compteurs d’ouverture en base existent déjà.

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
| `GIFT_SERVICE_TOKEN` | Secret partagé exigé dans `x-gift-service-token` ; vide = tout refusé |
| `ARC_BASE` | URL de l’API Arc, par exemple `https://api.lexpress.arcpublishing.com` |
| `ARC_TOKEN` | Jeton de lecture Arc, côté serveur |
| `ARC_SITE` | Site Arc, `lexpress` par défaut |
| `GIFT_LINK_BASE` | Origine des URLs rendues, `https://articles.lexpress.fr` par défaut |

`.env.example` inventorie ces variables ; la fonction lit les variables du runtime Supabase, pas un fichier local automatiquement. La page Lovable reçoit uniquement l’URL Supabase et la clé publique du projet. Le secret de création de liens appartient aux appelants serveur.

## Contrat de création

`POST /functions/v1/create-gift-links`, JSON, en-tête `x-gift-service-token` obligatoire. Voici un corps de requête ; remplacer l’URL par un article à offrir :

```json
{
  "urls": ["https://www.lexpress.fr/rubrique/titre-LQBW5JK75BDOBJHRA76NRFPJFY"],
  "expires_in_days": 15,
  "channel": "whatsapp",
  "campaign": "prospects"
}
```

`urls` est obligatoire ; la durée vaut 15 jours par défaut. Une URL doit appartenir au domaine accepté et porter un identifiant Arc de 26 caractères. L’ancien format `…_1302698.html` est rejeté avec un motif.

La réponse contient deux listes :

- `links` : `url`, `arc_id`, `token`, `link`, `expires_at`, `content`, `source`, `state`.
- `rejected` : `url` et `erreur` pour chaque refus.

`content` vaut `full` ou `preview`. `source` vaut `arc` ou `page-publique`. `state` vaut `created`, `extended` ou `unchanged`. Une réponse HTTP 200 peut contenir des refus, voire aucun lien si tous les articles sont retirés : contrôler les deux listes. Pour promettre un article complet, vérifier `content: "full"` avant de diffuser.

| HTTP | Sens |
| --- | --- |
| 401 | Secret absent, faux ou non configuré |
| 400 | JSON illisible ou aucune URL exploitable |
| 405 | Méthode autre que POST/OPTIONS |
| 500 | Échec de mise en cache ou de création en base |
| 502 | Aucun article exploitable après chargement |

Le repli Arc → page publique fournit un aperçu, pas le corps premium. Certains échecs réseau non gérés peuvent aussi produire une erreur du runtime ; la liste ci-dessus décrit les réponses explicites du code.

## Règles importantes pour les intégrateurs

- **Un seul lien par article**, commun à tous les destinataires. Il n’est pas personnel et peut être transféré.
- Redemander un article conserve son token et prolonge sa durée si nécessaire. Une prolongation profite aussi aux anciens destinataires. Une demande plus courte ne raccourcit jamais la durée.
- Un lien expiré peut être rouvert par une nouvelle demande ; un lien retiré manuellement reste retiré.
- `channel` et `campaign` sont enregistrés sur le lien commun et peuvent être remplacés lors d’un nouvel appel. Le modèle actuel ne garantit pas une attribution indépendante par destinataire ou par campagne.
- La page sert une copie. Les corrections ou dépublications du CMS ne s’y répercutent pas automatiquement. Un nouvel appel peut rafraîchir le cache ; un retrait urgent demande une action explicite.
- Les tables sont fermées aux rôles publics. La lecture passe uniquement par `get_gift_article` ; la création requiert les droits serveur.
- `fake_body: true` est réservé aux essais et produit un texte clairement marqué démonstration quand aucun vrai corps n’est disponible.

## Installer dans un autre environnement

Utiliser un projet Supabase dédié. Appliquer `001-schema.sql`, `002-author.sql`, puis `003-un-lien-par-article.sql` dans cet ordre sur une base neuve. Ce sont les scripts d’origine, pas un historique géré automatiquement par une CLI. Ne pas rejouer le schéma initial à l’aveugle sur une base existante.

Configurer les variables serveur, exécuter les tests et générer le bundle. Déployer ce bundle comme fonction `create-gift-links` avec le mécanisme Supabase retenu par l’équipe. Ce dépôt ne contient pas encore de script de déploiement ni de configuration de passerelle versionnée : vérifier notamment que la passerelle laisse atteindre le contrôle `x-gift-service-token`, puis qu’un appel sans secret est refusé. Il ne faut pas présenter cette extraction comme une installation en une commande.

Brancher et publier la page Lovable conformément à [son contrat](docs/frontend.md). Pour un autre environnement, adapter l’origine de lecture via `GIFT_LINK_BASE`, la connexion Supabase du frontend et les paramètres du bouton d’abonnement.

Après déploiement, vérifier séparément les droits publics, une création avec du contenu réel, les cinq états de lecture et une panne réseau avec réessai. Les tests locaux ne valident ni la configuration distante ni le frontend publié. Pour les tests externes, utiliser un environnement isolé, des articles fictifs et des envois simulés.

## Exploitation

Retrait immédiat, depuis une session SQL autorisée, en ciblant le token concerné :

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
- Tests HTTP de la fonction et tests du frontend publié à compléter : les 108 vérifications actuelles couvrent le SQL, les modules de contenu et certaines propriétés du bundle.

## Provenance

Extraction locale préparée le 5 octobre 2026 à partir du projet L’Express, commit de référence `8dced80c02e62222144e7b891ae9f1c046f8e325`, avec le README du service dans l’état du dossier de travail. Les sources du backend et les tests ont été copiés sans modification fonctionnelle. Les scripts restent à la racine afin de conserver les chemins déjà testés. Les workflows et données de l’agent WhatsApp ne sont pas inclus.
