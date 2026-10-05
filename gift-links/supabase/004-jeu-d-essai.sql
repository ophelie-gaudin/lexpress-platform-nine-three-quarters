-- Gift links — 004 : le jeu d'essai, rejouable à volonté (2 oct. 2026).
--
-- POURQUOI DES ARTICLES DÉDIÉS. Le premier jeu d'essai reposait sur de vrais articles. Il a été détruit
-- deux fois en une après-midi : un appel d'API sur le même article réécrit son contenu (le corps de
-- démonstration disparaît) et repousse sa date de fin (le cas « expiré » devient valide). Ces quatre
-- articles-ci portent des identifiants qui n'existent pas chez Arc : aucun appel réel ne peut les toucher.
--
-- CE SCRIPT SE REJOUE. Le relancer remet les quatre cas dans l'état attendu, sans rien casser d'autre :
-- il ne connaît que ses propres lignes. Sans danger, même en production.
--
-- LES TOKENS SONT VOLONTAIREMENT RECONNAISSABLES (…0001 à …0004). Ailleurs, un token doit être
-- imprévisible — c'est la seule protection d'un article premium. Ici le contenu est factice, et la
-- mémorisation vaut mieux que le secret : on relit ces liens dix fois par jour.

BEGIN;

INSERT INTO public.articles (arc_id, canonical_url, title, standfirst, image_url, section, author, published_at, body) VALUES

  ('DEMO000000000000000000OK01',
   'https://www.lexpress.fr/monde/europe/kristina-kallas-ministre-de-leducation-en-estonie-chez-nous-la-societe-est-toujours-du-cote-des-BFTKNQJ3VZCA3O44JQYQFK3YKE/',
   'Kristina Kallas, ministre de l''Education en Estonie : "Chez nous, la société est toujours du côté des enseignants"',
   'L''Estonienne dirige l''un des systèmes scolaires les plus performants au monde : le pays se classe une nouvelle fois dans le top 10 mondial du classement Pisa, dans toutes les catégories. Récit d''un succès inspirant.',
   'https://www.lexpress.fr/resizer/v2/MN5RZZH2JNAUXLAF5AJNQEGMHE.jpg?auth=fb14279bf205eb6e61a9bf53af3eb61fbee54f5af10ac1a565d446d55ec2a918&width=1200&height=630&quality=85&focal=1349%2C707',
   'Europe', 'Corentin Pennarguear', '2026-09-09 15:00:00+00',
   E'⚠️ TEXTE DE DÉMONSTRATION — ce n''est pas l''article réel.\n\nLe contenu éditorial n''est pas encore accessible ; ce texte sert uniquement à vérifier la mise en page.\n\nPremier paragraphe de remplissage. Il n''a aucune valeur informative et ne doit jamais être diffusé.\n\nDeuxième paragraphe de remplissage, pour juger de l''interligne et de la longueur de ligne.\n\nTroisième paragraphe de remplissage, pour voir le bas de page et le bouton d''abonnement.'),

  ('DEMO000000000000000000PV01',
   'https://www.lexpress.fr/societe/religion/a-lyon-lecole-des-chartreux-dans-la-tourmente-apres-la-plainte-pour-viols-contre-lex-directeur-XGLQ6NY6CJD6LLBLBBMEF7A2V4/',
   'A Lyon, l''école des Chartreux dans la tourmente après la plainte pour viols contre l''ex-directeur',
   'Dans l''établissement privé catholique, les Chartreux à Lyon, une élève accuse le directeur, le prêtre Jean-Bernard Plessy, de l''avoir violée et maintenue sous emprise. Ce qu''il conteste.',
   'https://www.lexpress.fr/resizer/v2/4J3BNFVO6JCB3FRHVNWSMUC564.jpg?auth=f338de5e017b8c8e3726c1740a67c869a86a2bb3bd34d0521da2bdf6732a98f4&width=1200&height=630&quality=85&focal=1969%2C1705',
   'Religion et laïcité', 'Emilie Lanez', '2026-09-16 15:00:00+00',
   NULL),   -- pas de corps : c'est tout l'objet de ce cas

  ('DEMO000000000000000000EX01',
   'https://www.lexpress.fr/politique/candidats-think-tanks-avant-la-presidentielle-le-bloc-modere-face-a-une-crise-des-idees-GUZU5XDLT5BIJJWT2BVOXCU2NY/',
   'Candidats, think tanks : avant la présidentielle, le bloc modéré face à une crise des idées',
   'Comment être modéré tout en étant radical ? Raisonnable tout en étant créatif ?',
   'https://www.lexpress.fr/resizer/v2/KKDRKAPGBNF2VDUR55FQC22FOE.jpg?auth=85ba3fc1e35cbf2c2da8c75ca7a882fcd6bcbf3f9e163791809f04f3d26f8890&width=1200&height=630&quality=85&focal=1342%2C903',
   'Politique', 'Erwan Bruckert, Béatrice Mathieu', '2026-09-08 16:00:00+00',
   'Corps présent : il ne doit JAMAIS s''afficher, puisque le lien est expiré. S''il apparaît, la page sert du contenu sans vérifier la date.'),

  ('DEMO000000000000000000WD01',
   'https://www.lexpress.fr/idees-et-debats/faire-barrage-courage-politique-ou-conformisme-par-julia-de-funes-KP3P2LTNABA6ZDTABV6AI22ZTA/',
   '"Faire barrage" : courage politique ou conformisme ? Par Julia de Funès',
   'Cet appel, devenu un refrain à chaque élection, charrie l''idée d''engagement, de devoir supérieur, de posture morale.',
   'https://www.lexpress.fr/resizer/v2/4R36XSTK7VAMJD3KVLMWS6NDLI.jpg?auth=f4e771a4cb3c497aa7bdfea9674caf8c6109d4d36347102c03ec24e7173230fc&width=1200&height=630&quality=85&focal=2017%2C1669',
   'Idées et débats', 'Julia de Funès', '2026-09-28 09:45:00+00',
   'Corps présent : il ne doit JAMAIS s''afficher, puisque le lien est retiré. Un retrait prime sur tout le reste.')

ON CONFLICT (arc_id) DO UPDATE SET
  canonical_url = EXCLUDED.canonical_url, title = EXCLUDED.title, standfirst = EXCLUDED.standfirst,
  image_url = EXCLUDED.image_url, section = EXCLUDED.section, author = EXCLUDED.author,
  published_at = EXCLUDED.published_at, body = EXCLUDED.body, fetched_at = now();

-- Les deux derniers cas portent un corps EXPRÈS : si la page affichait l'article d'un lien expiré ou
-- retiré, le test le montrerait. Un cas de test qui ne peut pas échouer ne teste rien.

INSERT INTO public.gift_links (token, arc_id, channel, campaign, expires_at, withdrawn_at) VALUES
  ('00000000000000000000000000000001', 'DEMO000000000000000000OK01', 'demo', 'prospects_chauds', now() + interval '365 days', NULL),
  ('00000000000000000000000000000002', 'DEMO000000000000000000PV01', 'demo', 'prospects_paid',   now() + interval '365 days', NULL),
  ('00000000000000000000000000000003', 'DEMO000000000000000000EX01', 'demo', 'prospects',        now() - interval '2 days',   NULL),
  ('00000000000000000000000000000004', 'DEMO000000000000000000WD01', 'demo', 'prospects_abandon', now() + interval '365 days', now())
ON CONFLICT (arc_id) DO UPDATE SET
  token = EXCLUDED.token, channel = EXCLUDED.channel, campaign = EXCLUDED.campaign,
  expires_at = EXCLUDED.expires_at, withdrawn_at = EXCLUDED.withdrawn_at, extended_at = NULL;

-- Un an de validité pour les cas valides : le jeu d'essai ne doit pas expirer tout seul un matin et
-- faire croire à une panne.

COMMIT;
