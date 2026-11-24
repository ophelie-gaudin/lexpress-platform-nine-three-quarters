# Contrat de la page Lovable

La page publiée se trouve sur `https://articles.lexpress.fr/a/:token`. Ses sources et son historique ne sont pas inclus dans ce dépôt : obtenir l’accès au projet Lovable pour la maintenir. Ce document remplace les anciennes consignes qui décrivaient encore un branchement incomplet et omettaient le traitement des erreurs techniques.

## Lecture

Appeler uniquement `get_gift_article` avec la clé publique du projet Supabase et les paramètres `p_token`, `p_utm_source`, `p_utm_campaign`, `p_referrer`, `p_send_id`, `p_campaign_group`. Tous sauf `p_token` peuvent être nuls. `p_send_id` reçoit le `?s=` de l'URL : il rattache une lecture à un envoi précis, là où le token est commun à tous les destinataires. Une valeur hors forme devient `NULL` sans faire tomber la page — une query string bricolée ne doit jamais rendre un article illisible. Depuis 019, la page de lecture appelle `get_gift_article_for_edition_v3` (même contrat que v2, `p_send_id` de 1 à 64 caractères `[A-Za-z0-9_-]`) ; les autres RPC restent à 32 hexadécimaux. Seul `s` alimente `p_send_id` (page du 24/11) : `at_recipient_id` ne le remplace jamais ; il n'est transmis que s'il a exactement 32 hexadécimaux minuscules et que `s` est absent ou vide, pour les liens antérieurs qui s'y fiaient (`sendIdFrom`, `src/lib/giftArticle.ts` du lecteur). La réponse SQL contient une ligne ; les échecs de transport ou du service restent possibles et doivent être traités séparément.

Le frontend ne doit jamais recevoir de jeton de service, `ARC_TOKEN` ou une clé `service_role`, ni appeler l’API de création. Il ne connaît que la clé publique `anon` et `get_gift_article`.

## États

| Résultat | Affichage |
| --- | --- |
| `ok` | Image, rubrique, titre, chapeau, signature si connue, date et corps |
| `preview` | Métadonnées sans corps, lien vers `canonical_url` et abonnement |
| `expired` | « Ce lien a expiré. » et abonnement |
| `withdrawn` | « Cet article n’est plus disponible. » et abonnement |
| `unknown` | « Ce lien n’existe pas. » et abonnement |
| Erreur technique | « Impossible d’afficher cet article pour le moment. », explication neutre et bouton Réessayer |

Un réessai relance réellement la requête. Ne pas transformer une erreur technique en retrait éditorial. Ne pas inventer de signature ou de corps manquant.

Le corps comporte du HTML issu d’Arc. Appliquer un assainissement, avec une liste blanche qui doit **inclure ce que le service produit réellement** :

| Balise | D’où elle vient |
| --- | --- |
| `b`, `strong`, `i`, `em`, `a`, `br`, `p` | le corps d’article |
| `blockquote`, `cite` | les citations (`quote`) |
| `figure`, `img`, `figcaption` | les images du corps |

**Omettre les cinq dernières vide les articles.** Un article composé d’une seule photo légendée est annoncé « corps complet » par le service, et une page conforme à une liste trop étroite afficherait une page blanche. Le défaut existait dans ce document jusqu’au 8 octobre 2026.

Ouvrir les liens éditoriaux dans un nouvel onglet avec les protections correspondantes.

**Le service assainit déjà à la source** — `<script>`, `<iframe>`, `<style>`, `<object>`, `<embed>`, `<form>`, les attributs `on*` et les URLs `javascript:` / `data:` / `vbscript:` sont retirés avant d’être servis. Gardez votre liste blanche quand même : jusqu’au 8 octobre 2026 ce document promettait cette protection sans que le service la tienne. Deux barrières valent mieux qu’une.

## Abonnement et attribution

**Une seule action d'abonnement par page (23 novembre 2026)** : une barre collée en bas de l'écran (`sticky bottom-0`, dernier élément de la page), présente dans les cinq statuts SQL, absente pendant le chargement et sur la panne technique. Aucun autre bouton d'abonnement, ni dans l'en-tête, ni dans le contenu. Destination par défaut : `https://abonnements-digitaux.lexpress.fr/offres` (France ; les sites Europe ont la leur, voir le README).

**Offre désignée par le lien (migration 020, 24/11/2026)** : la page n'appelle `get_subscription_offer({ p_site, p_code })` avec la clé `anon` que si le lien porte `?offre=<code>` (3 à 40 caractères `a-z0-9-`) ; sans ce paramètre, aucune lecture et le bouton par défaut dès le premier affichage. La RPC rend au plus une ligne `label`, `url`, `ends_at`, et seulement si l'offre de ce code vise ce site et est valable maintenant ; `null` = valeur par défaut. Toute réponse vide ou hors règle, erreur ou délai (4 s) → bouton par défaut. Relecture de cette offre toutes les 5 minutes et à sa date de fin. `offre` n'est jamais recopié sur le bouton. Source de vérité : la demande de fusion GitLab !1 (`src/lib/subscriptionOffer.ts`, `src/components/SubscribeButton.tsx`).

**Corps d'article** : les liens vers `lexpress.fr` / `lexpress.eu` (et sous-domaines), relatifs ou illisibles sont retirés en gardant leur texte ; seuls les liens `http(s)` absolus vers un autre site restent.

**La page ne fabrique aucun paramètre de suivi : elle recopie ceux du visiteur.** Liste blanche — tout `at_*`, plus `s`, rien d'autre. `set` et non `append`, pour qu'une dimension ne reçoive jamais deux valeurs. Un paramètre absent de l'URL d'arrivée reste absent : pas de valeur par défaut, pas de repli sur la base.

```js
const abo = new URL('https://abonnements-digitaux.lexpress.fr/offres');
for (const [cle, valeur] of new URLSearchParams(location.search))
  if (valeur && (cle.startsWith('at_') || cle === 's')) abo.searchParams.set(cle, valeur);
```

| Paramètre | Rôle | Journalisé en base |
| --- | --- | --- |
| `s` | identifiant d'ENVOI : 1 à 64 caractères parmi `A-Z a-z 0-9 _ -` (depuis 019 ; 32 hexadécimaux avant). Le token est commun à l'article ; `s` désigne l'envoi | oui, `gift_link_opens.send_id` |
| `at_medium` | le canal — `Whatsapp`, `Newsletter`… | oui, `utm_source` |
| `at_campaign` | la campagne | oui, `utm_campaign` |
| `at_campaign_group` | le segment du prospect | oui, `campaign_group` |
| `at_*` à venir | toute dimension AT Internet future | **non** — transmise au site, pas stockée |

**Ce que vaut `s`, pour un appelant comme les e-mails (24 novembre 2026, migration 019).** Une valeur par
envoi ou par e-mail, de 1 à 64 caractères parmi `A-Z`, `a-z`, `0-9`, `_` et `-`. L'agent WhatsApp tire
32 hexadécimaux au hasard par envoi ; les e-mails HubSpot mettent l'identifiant de l'e-mail, par exemple
`?s=123456789012`. **Jamais** d'adresse e-mail, de numéro de téléphone ni d'identifiant de contact : `s`
est recopié sur le bouton d'abonnement et part vers lexpress.fr et Piano, et il est conservé 90 jours.
Toute autre valeur (espace, `@`, `<`, accent, plus de 64 caractères) est enregistrée `NULL` ; l'article
s'affiche quand même et le bouton recopie `s` tel quel. La page n'a rien à changer pour ce format.

Avec une offre, la même règle s'applique à l'URL de l'offre : ses propres paramètres restent, ceux du visiteur s'y ajoutent et l'emportent en cas de doublon.

La règle est un **préfixe**, pas une liste figée : ajouter une dimension de suivi ne demande aucune modification de la page. En revanche, la conserver en base demanderait une colonne, donc une migration.

Tout le reste est écarté — `refTarif`, `utm_source`, `id` et les autres. L'URL d'un lien offert est publique et se transfère ; sans cette barrière, n'importe qui glisserait ses propres paramètres dans une URL de lexpress.fr.

Le frontend devient ainsi **agnostique du canal** : il ne sait pas s'il sert WhatsApp, une newsletter ou un autre service, et c'est exactement ce qu'il doit faire. Jusqu'au 8 octobre 2026 il codait en dur `at_medium=Whatsapp` et lisait `at_campaign_group` dans le champ `campaign` rendu par la RPC — ce champ a disparu, et l'attribution appartient à l'envoi, pas au lien.

La chaîne est alors complète et dans le même vocabulaire des deux côtés : la sollicitation pose les paramètres sur le lien diffusé, `gift_link_opens` enregistre la lecture avec son segment et son identifiant d'envoi, et Piano reçoit les mêmes sur la conversion. `s` est le seul maillon qui survit au départ vers lexpress.fr.

## Recette avec le jeu fictif

Appliquer `gift-links/supabase/004-jeu-d-essai.sql` dans l’environnement isolé de recette. Ouvrir `/a/` suivi des tokens ci-dessous :

| Token | Attendu |
| --- | --- |
| `00000000000000000000000000000001` | `ok`, corps marqué démonstration |
| `00000000000000000000000000000002` | `preview`, sans corps |
| `00000000000000000000000000000003` | `expired`, aucun corps exposé |
| `00000000000000000000000000000004` | `withdrawn`, aucun corps exposé |
| `tk-demo-0001` | `unknown` |

Simuler aussi l’échec de l’appel RPC, vérifier le message technique et le bouton, puis rétablir le réseau et vérifier que le réessai affiche l’article. Comparer l’aperçu Lovable et le site publié séparément.

L’aperçu Open Graph des URLs copiées ailleurs est actuellement générique. Le parcours WhatsApp prévu diffuse le lien dans un bouton, sans aperçu d’article. Le raccordement Piano reste à faire selon l’état documenté au 5 octobre 2026.
