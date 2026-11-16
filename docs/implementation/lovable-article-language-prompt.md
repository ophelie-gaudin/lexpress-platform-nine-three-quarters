# Message à coller dans Lovable — ne pas envoyer automatiquement

Prépare cette modification dans le brouillon du lecteur L’Express, sans publier.
Ne change ni l’hébergement ni les domaines, ni Piano, ni le suivi des lectures.

## Source de la langue

Le domaine articles.lexpress.eu reste commun aux articles anglais, français et polonais.
La langue ne vient donc ni du domaine du lecteur ni du navigateur ni du jeton. Elle vient
de la RPC Supabase `get_gift_article_for_edition_v2`, qui accepte les mêmes paramètres que
get_gift_article_for_edition et renvoie en plus `language` : `"en" | "fr" | "pl"` pour un
article lu (`ok`, `preview`) et pour un lien expiré ou retiré (`expired`, `withdrawn`) ;
`null` pour un lien inconnu (`unknown`).
Utilise cette RPC pour les deux contextes FR et EUR, avec p_edition explicite.
Cette RPC est créée par une migration de base appliquée par l’équipe, pas par toi : elle doit
exister sur la base visée avant toute publication de ce lecteur.
Les RPC historiques restent disponibles ; ne les appelle ni en parallèle ni en repli,
car chaque lecture réussie est comptée. Aucun appel PROD de recette : utilise TEST.

Deux langues d’un même sujet ont des identifiants Arc distincts et des liens distincts.
Ne déduplique jamais par titre, traduction ou sujet ; garde les jetons et les IDs.

## Contrôles avant affichage

Article lu : EUR accepte lexpress.eu / www.lexpress.eu = en, fr.lexpress.eu = fr,
pl.lexpress.eu = pl. FR accepte lexpress.fr / www.lexpress.fr = fr.
Refuse (écran « indisponible ») les autres hôtes, HTTP, tout port explicite (même :443),
les identifiants dans l’URL, et une langue différente de celle de l’hôte source.
Lien expiré ou retiré : ne retiens la langue que si elle vaut exactement en, fr ou pl ;
sinon affiche l’écran de refus sans langue. Le lecteur France ignore toujours cette langue.
Ne prends aucune URL de bouton ou d’accueil depuis la query string, le contenu Arc ou une
valeur de la RPC : uniquement la table ci-dessous.

## Table de traductions (édition Europe, articles.lexpress.eu)

Cibles fixes par langue :

| | en | fr | pl |
| --- | --- | --- | --- |
| Abonnement | https://www.lexpress.eu/subscribe/ | https://fr.lexpress.eu/abonnement/ | https://pl.lexpress.eu/subskrypcja/ |
| Accueil | https://www.lexpress.eu/ | https://fr.lexpress.eu/ | https://pl.lexpress.eu/ |
| Format de date | en-GB | fr-FR | pl-PL |

Textes fixes selon la langue de l’article, à recopier caractère pour caractère (ne
retraduis rien) :

| Clé | en | fr | pl |
| --- | --- | --- | --- |
| title | Gift article — L'Express Europe | Article offert — L'Express | Artykuł w prezencie – L'Express Polska |
| description | An article from L'Express Europe has been shared with you. Enjoy your read. | Un article de L'Express vous a été offert. Bonne lecture. | Otrzymujesz w prezencie artykuł L'Express. Miłej lektury. |
| giftedBy | Article shared by | Article offert par | Artykuł w prezencie od |
| bouton d’abonnement | Subscribe | S'abonner | Subskrypcja |
| by | By | Par | Autor: |
| published | Published on | Publié le | Opublikowano |
| continueReading | Continue reading on lexpress.eu | Lire la suite sur fr.lexpress.eu | Czytaj dalej na pl.lexpress.eu |
| gifted | This article has been shared with you. Subscribe for unlimited access to L'Express Europe. | Cet article vous a été offert. Pour lire L'Express sans limite, abonnez-vous. | Ten artykuł otrzymujesz w prezencie. Zapisz się do L'Express i odblokuj nieograniczony dostęp do wszystkich naszych artykułów. |
| lien d’accueil sous le bouton | Go to the homepage | Retour à l'accueil | Przejdź na stronę główną |
| expired | This link has expired. | Ce lien a expiré. | Ten link wygasł. |
| withdrawn | This article is no longer available. | Cet article n'est plus disponible. | Ten artykuł nie jest już dostępny. |
| limited | Gift articles are available for a limited time. | Les articles offerts sont accessibles pendant une durée limitée. | Artykuły w prezencie są dostępne przez ograniczony czas. |

La colonne en est le texte actuel du lecteur Europe, sauf le bouton (« Subscribe » au
lieu de « Subscribe to L'Express Europe ») et le nouveau lien d’accueil. La colonne fr
est le texte actuel du lecteur France, sauf le bouton et « Lire la suite sur
fr.lexpress.eu » : un article de fr.lexpress.eu ne doit jamais afficher « lexpress.fr ».
La colonne pl est validée par Ophélie : les articles polonais arrivent déjà traduits,
seuls ces mots fixes sont traduits, une fois.

Tous les autres textes du lecteur (chargement, panne technique et réessai, lien inconnu,
page introuvable, erreur de page) s’affichent sans langue connue : ne les traduis pas, ne
les modifie pas.

## Où appliquer la langue

- Article lu (complet ou aperçu) sur articles.lexpress.eu : tout l’habillage suit la
  langue de l’article : signature (`by` + auteur, donc « Autor: Nom » en polonais), date
  (`published` + date au format de la langue, ex. « Opublikowano 16 listopada 2026 »),
  phrase d’offre, bouton et sa cible, lien « continueReading » de l’aperçu vers l’article
  source, et sous le bouton un lien vers l’accueil de l’édition avec le libellé de la table.
- `giftedBy` (en-tête) : dans la langue de l’article une fois celui-ci chargé ; texte
  actuel avant.
- `title` et `description` : mets à jour `document.title` (et la balise meta description)
  dans le navigateur, après la réponse de la RPC, à partir de la réponse déjà reçue.
  N’ajoute aucun appel, ni côté serveur ni côté navigateur : chaque appel compte une
  lecture. Le titre servi dans le HTML initial (aperçus de lien WhatsApp, etc.) reste donc
  celui d’aujourd’hui ; c’est accepté.
- Lien expiré ou retiré avec une langue : titre du refus, phrase `limited`, bouton et cible
  dans cette langue.
- Sans langue connue (chargement, panne technique, lien inconnu, page introuvable, erreur
  de page) : garde exactement l’affichage actuel du contexte, FR français / EUR anglais,
  avec le bouton actuel « Subscribe to L'Express Europe ». Ne déduis rien du jeton ni du
  navigateur.
- articles.lexpress.fr ne change pas : mêmes textes, même abonnement
  (https://abonnements-digitaux.lexpress.fr/offres), pas de lien d’accueil ajouté.
- Conserve strictement la transmission de `s` et des paramètres `at_*` vers l’abonnement,
  sans recopier d’autres paramètres.
- Pose l’attribut `lang` (valeur validée de la RPC) sur le contenu de l’article : rubrique,
  titre, chapô, corps.

## Référence

Ce message suffit à lui seul. Si un patch de référence est collé à sa suite (fichiers
`src/lib/articleLanguage.ts`, `src/lib/giftArticle.ts`, `src/lib/subscriptionLink.ts`,
`src/components/SubscribeButton.tsx`, `src/routes/a.$token.tsx`), il montre une mise en
œuvre validée par tests et par un contrôle de types strict. Il a été préparé contre une
copie du lecteur qui peut être plus ancienne que ton brouillon : inspecte les écarts, ne
remplace pas un fichier entier si des changements plus récents existent. Il ne couvre ni
l’en-tête ni le titre de page : applique-leur les règles ci-dessus.

## Recette TEST obligatoire avant proposition de publication

L’équipe fournit les liens de recette sur la base TEST (articles en, fr, pl, un lien polonais
expiré, un retiré). S’ils manquent ou si la RPC v2 est absente de TEST, arrête-toi et
demande-les : ne crée rien toi-même.

1. Articles EN/FR/PL lus sur articles.lexpress.eu : boutons et cibles exacts de la table.
2. Cas polonais : un article de pl.lexpress.eu affiche « Autor: », « Opublikowano » suivi
   d’une date polonaise (mois en toutes lettres), la phrase d’offre polonaise, le bouton
   « Subskrypcja » vers https://pl.lexpress.eu/subskrypcja/ et le lien « Przejdź na stronę
   główną » vers https://pl.lexpress.eu/. Aucun mot anglais ni français dans l’habillage.
   En aperçu : « Czytaj dalej na pl.lexpress.eu » vers l’article source.
3. Cas polonais expiré puis retiré : « Ten link wygasł. » / « Ten artykuł nie jest już
   dostępny. », phrase « Artykuły w prezencie są dostępne przez ograniczony czas. »,
   bouton « Subskrypcja ». Lien inconnu : écran anglais actuel.
4. Article de fr.lexpress.eu : « Par », « Publié le », phrase d’offre France, « S'abonner »
   vers https://fr.lexpress.eu/abonnement/, « Retour à l'accueil » vers
   https://fr.lexpress.eu/ ; « lexpress.fr » n’apparaît nulle part.
5. Pour FR …5IZJUWHEXBCELAV4FGFPXU3LTQ et PL …4DHUZG3CTFFJFLSPBD3XJ2O4TU,
   deux tokens distincts, bons corps, langues et liens conservés.
6. Anciens articles Europe = en, France = fr ; ancien lien France inchangé à l’écran.
7. Refus des hôtes arbitraires, mauvais protocole/port/identifiants, mauvaise édition,
   langue inconnue ou incohérente. Pas de repli vers une RPC moins précise.
8. Paramètres `at_*` et `s` conservés, paramètre `redirect` ignoré ; pas d’URL injectée.
9. Un seul appel de lecture par tentative ; états aperçu, expiré, retiré et réessai préservés.
10. Vérification visuelle ordinateur et mobile à proposer dans le brouillon, sans publier :
    les textes polonais, plus longs, ne débordent ni du bouton ni de l’en-tête.

Rends le diff et les résultats de tests. Attends l’accord écrit d’Ophélie avant
publication. N’applique aucune migration et ne déploie aucune fonction Supabase.
