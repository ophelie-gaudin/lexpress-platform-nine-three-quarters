-- Gift links — 019 : un identifiant d'envoi au format élargi (24 nov. 2026).
--
-- LE BESOIN. Le CRM branche un module « Article offert » dans les e-mails HubSpot (jeton de service
-- `hubspot-emails`). Il veut rattacher chaque lecture à l'e-mail qui l'a amenée, par le paramètre `s` du
-- lien diffusé — `at_campaign` sert déjà à autre chose. Or l'identifiant d'un e-mail HubSpot est un
-- nombre (`123456789012`), et la lecture ne gardait que 32 hexadécimaux, la forme tirée au hasard par
-- l'agent WhatsApp : tout le reste devenait NULL. Décision d'Ophélie du 24/11 (choix 1B).
--
-- CE QUI CHANGE : UNE SEULE LIGNE, l'assainissement de `p_send_id`. Désormais accepté :
--   ^[A-Za-z0-9_-]{1,64}$   lettres ASCII, chiffres, « _ » et « - », 1 à 64 caractères.
-- Ce motif contient les 32 hexadécimaux : les liens WhatsApp déjà diffusés s'enregistrent à l'identique.
-- Toute autre valeur (espace, « @ », « < », accent, plus de 64 caractères, chaîne vide) reste NULL, sans
-- erreur : l'article s'affiche quand même. Le motif exclut « @ », « + », « . » et l'espace, donc une
-- adresse e-mail ou un numéro au format international ; il ne peut pas exclure un identifiant de contact
-- numérique. Ne jamais y mettre l'identifiant d'une personne : c'est une règle d'appelant (README, Partie I).
--
-- PAS DE CONTRAINTE CHECK, TOUJOURS (voir 005) : la page est publique, l'URL se modifie à la main, une
-- contrainte ferait échouer l'INSERT donc l'affichage. On assainit dans la fonction.
--
-- ON REPART DE LA DÉFINITION COURANTE : celle de 015 (`get_gift_article_for_edition`), seule fonction qui
-- écrit `gift_link_opens`. 017 et 018 ne la touchent pas ; `get_gift_article` (015) et
-- `get_gift_article_for_edition_v2` (017) l'appellent avec `p_send_id` tel quel, et profitent donc du
-- changement sans être recréées. Définition comparée le 24/11 à celle de TEST et de PROD (pg_get_functiondef,
-- même empreinte) avant écriture de ce fichier : seule la ligne `v_send` diffère.
--
-- MÊME SIGNATURE, MÊME TYPE DE RETOUR : CREATE OR REPLACE, sans DROP. Les fonctions qui l'appellent et les
-- droits restent en place ; ceux-ci sont tout de même réaffirmés plus bas, pour que le fichier se suffise.
-- Rejouable. Retour arrière : rollback/019-identifiant-envoi-elargi.sql.
--
-- ORDRE DE DÉPLOIEMENT (revue adverse du 24/11, constat 1) : APRÈS la publication de la page qui ne prend
-- l'identifiant d'envoi que dans `s`. La page publiée avant elle préfère `at_recipient_id` à `s` ; avec ce
-- motif élargi, `?s=123456789012&at_recipient_id=987654321` enregistrerait l'identifiant du CONTACT, alors
-- qu'avec 015 il devenait NULL. La base ne peut pas savoir de quel paramètre vient la valeur : la règle
-- est dans la page (`sendIdFrom`). Appliquer ensuite avant le premier e-mail HubSpot qui porte `s`.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.get_gift_article_for_edition(p_edition text, p_token text, p_utm_source text DEFAULT NULL::text, p_utm_campaign text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text, p_send_id text DEFAULT NULL::text, p_campaign_group text DEFAULT NULL::text)
 RETURNS TABLE(status text, canonical_url text, title text, standfirst text, image_url text, body text, section text, author text, published_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_link  public.gift_links%ROWTYPE;
  v_send  text;
  v_group text;
BEGIN
  IF p_edition IS NULL OR p_edition NOT IN ('FR','EUR') OR p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO v_link FROM public.gift_links WHERE gift_links.token = p_token AND gift_links.edition = p_edition;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  -- Retiré d'abord : une coupure manuelle prime sur une date encore valide.
  IF v_link.withdrawn_at IS NOT NULL THEN
    RETURN QUERY SELECT 'withdrawn'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_link.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  -- ASSAINISSEMENT. Une query string bricolée ne doit jamais faire tomber la page : ce qui ne convient
  -- pas devient NULL, et l'article s'affiche quand même.
  -- 019 : `s` accepte tout identifiant d'envoi de 1 à 64 caractères [A-Za-z0-9_-] (les 32 hexadécimaux
  -- de WhatsApp comme l'identifiant numérique d'un e-mail HubSpot). Intervalles en points de code :
  -- aucun caractère accentué ni non latin ne passe.
  v_send  := CASE WHEN p_send_id ~ '^[A-Za-z0-9_-]{1,64}$' THEN p_send_id ELSE NULL END;
  v_group := CASE WHEN p_campaign_group ~ '^[a-z0-9_]{1,40}$' THEN p_campaign_group ELSE NULL END;

  -- LA JOURNALISATION NE CHANGE PAS. C'est elle qui porte l'attribution juste : un segment PAR LECTURE,
  -- celui que ce visiteur-là portait dans son URL.
  INSERT INTO public.gift_link_opens (token, utm_source, utm_campaign, referrer, send_id, campaign_group)
  VALUES (p_token, p_utm_source, p_utm_campaign, p_referrer, v_send, v_group);
  UPDATE public.gift_links
     SET opens = gift_links.opens + 1, last_opened_at = now()
   WHERE gift_links.token = p_token AND gift_links.edition = p_edition;

  RETURN QUERY
  SELECT CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN 'preview' ELSE 'ok' END,
         a.canonical_url, a.title, a.standfirst, a.image_url,
         CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN NULL ELSE a.body END,
         a.section, a.author, a.published_at
  FROM public.articles a WHERE a.edition = v_link.edition AND a.arc_id = v_link.arc_id;
END $function$
;

-- Les droits, réaffirmés à l'identique de 015 (CREATE OR REPLACE les a gardés).
REVOKE ALL ON FUNCTION public.get_gift_article_for_edition(text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gift_article_for_edition(text,text,text,text,text,text,text) TO anon,authenticated,service_role;

COMMENT ON COLUMN public.gift_link_opens.send_id IS
  'Identifiant de l''ENVOI (?s=…) : 1 à 64 caractères [A-Za-z0-9_-] depuis le 24 nov. 2026 (019), 32 hexadécimaux tirés au hasard avant. Une valeur par envoi ou par e-mail (WhatsApp : tirage au hasard ; HubSpot : identifiant de l''e-mail), jamais une adresse, un téléphone ni un identifiant de contact. NULL pour une visite directe, une valeur hors forme ou une ouverture antérieure au 5 oct. 2026. Effacé à 90 jours (012).';

COMMIT;
