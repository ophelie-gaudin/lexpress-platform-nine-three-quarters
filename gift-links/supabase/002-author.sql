-- Gift links — 002 : la signature de l'article, et l'attribution de la campagne (1er oct. 2026).
--
-- DEUX MANQUES RELEVÉS AU BRANCHEMENT DE LA PAGE :
--
-- 1. L'AUTEUR. La page n'affichait que la date. Le nom est disponible dès maintenant dans le JSON-LD de
--    la page publique ("author":[{"@type":"Person","name":"…"}]), et viendra de credits.by[] côté Arc.
--
-- 2. L'ATTRIBUTION. Le bouton d'abonnement porte at_medium et at_campaign, mais pas at_campaign_group,
--    qui distingue prospects_chauds de prospects_paid. La page ne pouvait pas le deviner : la campagne
--    est connue du LIEN, pas de l'article. get_gift_article la rend donc désormais, et la conversion
--    reste attribuée à la campagne d'origine.

BEGIN;

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS author text;

COMMENT ON COLUMN public.articles.author IS
  'Signature. NULL = inconnue : la page affiche alors la date seule, elle n''invente pas de nom.';

-- Le type de retour change : CREATE OR REPLACE ne suffit pas, il faut supprimer puis recréer.
DROP FUNCTION IF EXISTS public.get_gift_article(text, text, text, text);

CREATE FUNCTION public.get_gift_article(
  p_token        text,
  p_utm_source   text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_referrer     text DEFAULT NULL
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
DECLARE v_link public.gift_links%ROWTYPE;
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

  INSERT INTO public.gift_link_opens (token, utm_source, utm_campaign, referrer)
  VALUES (p_token, p_utm_source, p_utm_campaign, p_referrer);
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

REVOKE ALL ON FUNCTION public.get_gift_article(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_gift_article(text, text, text, text) TO anon, authenticated, service_role;

COMMIT;
