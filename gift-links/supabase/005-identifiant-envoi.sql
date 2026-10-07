-- Gift links — 005 : savoir QUI a ouvert le lien (5 oct. 2026).
--
-- LE PROBLÈME. La migration 003 a rendu le token stable PAR ARTICLE (UNIQUE (arc_id)) : un lien déjà
-- diffusé reste valable. Conséquence voulue, mais `gift_links.opens` compte dès lors les lectures de
-- l'ARTICLE, jamais celles d'une personne. La relance à J+2 ne peut donc pas distinguer « le lien n'a
-- jamais été ouvert » de « il a lu et ne s'est pas abonné ».
--
-- LA SOLUTION. L'agent suffixe le lien qu'il envoie d'un identifiant d'ENVOI tiré au hasard (?s=…), et la
-- page le transmet. L'ouverture devient attribuable sans toucher au token, donc sans invalider un seul
-- lien déjà diffusé.
--
-- ON EN PROFITE pour recueillir les paramètres de suivi AT Internet (at_medium, at_campaign,
-- at_campaign_group), les mêmes que les liens d'offres du site. Piano les lira côté page ; les garder ici
-- permet de compter par segment sans dépendre de lui.

BEGIN;

-- ── CE QU'ON ENREGISTRE EN PLUS À CHAQUE OUVERTURE.
ALTER TABLE public.gift_link_opens
  ADD COLUMN IF NOT EXISTS send_id        text,
  ADD COLUMN IF NOT EXISTS campaign_group text;

COMMENT ON COLUMN public.gift_link_opens.send_id IS
  'Identifiant de l''ENVOI (?s=…), 32 hexa, tiré au hasard par l''agent. NULL pour une visite directe ou une ouverture antérieure au 5 oct. 2026. C''est lui — et non le token, partagé par article — qui rend une lecture attribuable.';
COMMENT ON COLUMN public.gift_link_opens.campaign_group IS
  'at_campaign_group : segment du prospect (prospects_abandon / prospects_chauds / prospects_paid). NULL = parcours par défaut, segment non renseigné.';

-- Index pour la recopie nocturne vers la base de l'agent, qui agrège par envoi.
CREATE INDEX IF NOT EXISTS gift_link_opens_send_id ON public.gift_link_opens (send_id) WHERE send_id IS NOT NULL;

-- ── PAS DE CONTRAINTE CHECK SUR send_id, DÉLIBÉRÉMENT.
-- La page est publique et l'URL se modifie à la main. Une contrainte ferait échouer l'INSERT, donc la
-- fonction, donc l'affichage de l'article : n'importe qui ferait tomber la page en bricolant la query
-- string. On assainit dans la fonction et on range NULL si la valeur ne convient pas.

-- ── LA FONCTION. DROP puis CREATE : on ne peut pas changer une signature avec CREATE OR REPLACE —
-- ajouter un paramètre créerait une SECONDE fonction, et PostgREST ne saurait plus laquelle appeler.
--
-- L'ORDRE DE DÉPLOIEMENT EST SÛR. Les nouveaux paramètres portent DEFAULT NULL et il n'existe qu'une
-- fonction de ce nom : l'appel actuel de la page, qui ne nomme que quatre arguments, continue de
-- fonctionner tel quel. On peut donc appliquer cette migration AVANT la mise à jour de Lovable, sans
-- fenêtre de casse.
--
-- ON REPART DE LA DÉFINITION COURANTE, c'est-à-dire celle de 002 : elle rend `author` et `campaign` en
-- plus de 001. Reconstruire à partir de 001 les effacerait, et la page perdrait la signature de l'article
-- et l'attribution du bouton d'abonnement. (Erreur commise puis rattrapée le 5 oct. : le validateur l'a
-- vue — « la signature remonte jusqu'à la page ».)
--
-- UN DROP EMPORTE LES DROITS : les GRANT sont refaits plus bas. Sans eux, `anon` perd l'accès et la page
-- affiche son erreur de chargement à tout le monde.
DROP FUNCTION IF EXISTS public.get_gift_article(text, text, text, text);

CREATE FUNCTION public.get_gift_article(
  p_token          text,
  p_utm_source     text DEFAULT NULL,   -- at_medium
  p_utm_campaign   text DEFAULT NULL,   -- at_campaign
  p_referrer       text DEFAULT NULL,
  p_send_id        text DEFAULT NULL,   -- ?s=… , l'identifiant d'envoi
  p_campaign_group text DEFAULT NULL    -- at_campaign_group
) RETURNS TABLE (
  status        text,
  canonical_url text,
  title         text,
  standfirst    text,
  image_url     text,
  body          text,
  section       text,
  author        text,
  published_at  timestamptz,
  campaign      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link  public.gift_links%ROWTYPE;
  v_send  text;
  v_group text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_link FROM public.gift_links WHERE gift_links.token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  -- Retiré d'abord : une coupure manuelle prime sur une date encore valide.
  -- La campagne est rendue MÊME sur un refus : le bouton d'abonnement reste affiché, et sa conversion
  -- doit rester attribuée à la campagne qui a amené la personne jusqu'ici.
  IF v_link.withdrawn_at IS NOT NULL THEN
    RETURN QUERY SELECT 'withdrawn'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, v_link.campaign;
    RETURN;
  END IF;

  IF v_link.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, v_link.campaign;
    RETURN;
  END IF;

  -- ASSAINISSEMENT. Une query string bricolée ne doit jamais faire tomber la page : ce qui ne convient
  -- pas devient NULL, et l'article s'affiche quand même.
  v_send  := CASE WHEN p_send_id ~ '^[0-9a-f]{32}$' THEN p_send_id ELSE NULL END;
  v_group := CASE WHEN p_campaign_group ~ '^[a-z0-9_]{1,40}$' THEN p_campaign_group ELSE NULL END;

  INSERT INTO public.gift_link_opens (token, utm_source, utm_campaign, referrer, send_id, campaign_group)
  VALUES (p_token, p_utm_source, p_utm_campaign, p_referrer, v_send, v_group);
  UPDATE public.gift_links
     SET opens = gift_links.opens + 1, last_opened_at = now()
   WHERE gift_links.token = p_token;

  RETURN QUERY
  SELECT CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN 'preview' ELSE 'ok' END,
         a.canonical_url, a.title, a.standfirst, a.image_url,
         CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN NULL ELSE a.body END,
         a.section, a.author, a.published_at, v_link.campaign
  FROM public.articles a WHERE a.arc_id = v_link.arc_id;
END $$;

-- ── LES DROITS, REFAITS. Le DROP ci-dessus les avait emportés.
REVOKE ALL ON FUNCTION public.get_gift_article(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_gift_article(text, text, text, text, text, text) TO anon, authenticated, service_role;

COMMIT;
