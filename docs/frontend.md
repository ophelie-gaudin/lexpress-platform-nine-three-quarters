# Contrat de la page Lovable

La page publiée se trouve sur `https://articles.lexpress.fr/a/:token`. Ses sources et son historique ne sont pas inclus dans ce dépôt : obtenir l’accès au projet Lovable pour la maintenir. Ce document remplace les anciennes consignes qui décrivaient encore un branchement incomplet et omettaient le traitement des erreurs techniques.

## Lecture

Appeler uniquement `get_gift_article` avec la clé publique du projet Supabase et les paramètres `p_token`, `p_utm_source`, `p_utm_campaign`, `p_referrer`, `p_send_id`, `p_campaign_group`. Tous sauf `p_token` peuvent être nuls. `p_send_id` reçoit le `?s=` de l'URL : il rattache une lecture à un envoi précis, là où le token est commun à tous les destinataires. Une valeur hors forme devient `NULL` sans faire tomber la page — une query string bricolée ne doit jamais rendre un article illisible. La réponse SQL contient une ligne ; les échecs de transport ou du service restent possibles et doivent être traités séparément.

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

Le corps comporte du HTML issu d’Arc. Appliquer un assainissement avec les seules balises `b`, `strong`, `i`, `em`, `a`, `br`, `p`, des attributs autorisés explicitement et des URLs de liens sûres. Ouvrir les liens éditoriaux dans un nouvel onglet avec les protections correspondantes. L’implémentation de cet assainissement reste à vérifier dans les sources Lovable.

## Abonnement et attribution

Le bouton est présent dans les cinq statuts SQL. Configuration actuelle :

- Origine : `https://abonnements-digitaux.lexpress.fr/inscription`.
- `refTarif=1329`, `at_medium=Whatsapp`, `at_campaign=prospects`.
- `at_campaign_group` : valeur `campaign` rendue par la RPC, omise si nulle, encodée comme paramètre URL.

Ces valeurs sont propres à la campagne actuelle. Elles sont à adapter pour un usage email ou une autre campagne ; le frontend actuel ne constitue pas une interface générique multicanal.

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
