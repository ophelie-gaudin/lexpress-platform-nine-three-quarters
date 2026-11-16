# Message à coller dans Lovable — ne pas envoyer automatiquement

Prépare cette modification dans le brouillon du lecteur L’Express, sans publier.
Ne change ni l’hébergement ni les domaines, ni Piano, ni le suivi des lectures.

Le domaine articles.lexpress.eu reste commun aux articles anglais, français et polonais.
La langue ne vient donc ni du domaine du lecteur ni du navigateur. Elle vient de la
RPC Supabase `get_gift_article_for_edition_v2`, qui accepte les mêmes paramètres que
get_gift_article_for_edition et renvoie en plus `language: "en" | "fr" | "pl"`.
Utilise cette RPC pour les deux contextes FR et EUR, avec p_edition explicite.
La migration 017 doit être appliquée avant toute publication de ce lecteur.
Les RPC historiques restent disponibles ; ne les appeler ni en parallèle ni en repli,
car chaque lecture réussie est comptée. Aucun appel PROD de recette : utiliser TEST.

La langue appartient à articles.language : anciens articles EUR=en, France=fr.
Deux langues d’un même sujet ont des identifiants Arc distincts et des liens distincts.
Ne déduplique jamais par titre, traduction ou sujet ; garde les jetons et les IDs.

Valide la réponse avant affichage. EUR : lexpress.eu/www.lexpress.eu=en,
fr.lexpress.eu=fr, pl.lexpress.eu=pl. FR : lexpress.fr/www.lexpress.fr=fr.
Refuse les autres hôtes, HTTP, tout port explicite (même :443), les identifiants URL,
et une langue incompatible avec l’hôte source. Ne prends aucune URL de bouton
ou d’accueil depuis la query string, le contenu Arc ou une valeur arbitraire de la RPC.

Crée une table de traductions simple, uniquement avec ces libellés relevés par GET :
- en : bouton « Subscribe », abonnement https://www.lexpress.eu/subscribe/,
  accueil https://www.lexpress.eu/ ;
- fr Europe : bouton « S'abonner », abonnement https://fr.lexpress.eu/abonnement/,
  accueil https://fr.lexpress.eu/ ;
- pl : bouton « Subskrypcja », abonnement https://pl.lexpress.eu/subskrypcja/,
  accueil https://pl.lexpress.eu/.
Les trois pages d’abonnement et les accueils ont répondu HTTP 200 le 16/11/2026.

En bas d’un article résolu, utilise sa langue pour le bouton d’abonnement et sa
cible. Ajoute un lien vers l’accueil de cette édition ; affiche le nom de domaine
comme libellé neutre (fr.lexpress.eu, pl.lexpress.eu, www.lexpress.eu), sans inventer
un « Retour à l’accueil » polonais. En aperçu, conserve le lien canonique vers
l’article source et utilise également son domaine comme libellé neutre.
Conserve strictement la transmission de s et des paramètres at_* vers l’abonnement,
sans recopier d’autres paramètres. Un article français de lexpress.fr conserve
son abonnement France actuel et son domaine de lecture articles.lexpress.fr.
Pose lang sur l’élément article selon la valeur validée de la RPC.

Ne traduis pas librement les autres textes polonais : titre « article offert »,
explications, chargement, expiration, réessai, date et signature sont hors de la
collecte de libellés ci-dessus. Conserve le comportement existant pour ces textes
et présente à Ophélie la liste des traductions à valider. Sur erreur/expiration,
sans article résolu et sans langue attestée, conserve le repli existant du contexte
(FR français / EUR anglais) ; ne déduis rien du token ni du navigateur.

Le patch de référence de la PR #1 est `docs/patches/reader-europe-hosts.patch`.
Les sources après patch sont dans `docs/reader-reference/src/`. Le patch est préparé
contre le source lecteur retrouvé ; inspecte les écarts de ton brouillon avant
application, ne remplace pas un fichier entier si des changements plus récents existent.

Recette TEST obligatoire avant proposition de publication :
1. Articles EN/FR/PL lus sur articles.lexpress.eu, boutons et cibles exacts ci-dessus.
2. Pour FR …5IZJUWHEXBCELAV4FGFPXU3LTQ et PL …4DHUZG3CTFFJFLSPBD3XJ2O4TU,
   deux tokens distincts, bons corps, langues et liens conservés.
3. Anciens articles Europe=en, France=fr ; ancien lien France inchangé.
4. Refus des hôtes arbitraires, mauvais protocole/port/credentials, mauvaise édition,
   langue inconnue ou incohérente. Pas de repli vers une RPC moins précise.
5. Paramètres at_* et s conservés, paramètre redirect ignoré ; pas d’URL injectée.
6. Un seul appel de lecture par tentative, états aperçu/expiré/retiré et réessai préservés.
7. Vérification visuelle ordinateur/mobile à proposer dans le brouillon, sans publier.

Rends le diff et les résultats de tests. Attends l’accord écrit d’Ophélie avant
publication. N’applique aucune migration et ne déploie aucune fonction Supabase.
