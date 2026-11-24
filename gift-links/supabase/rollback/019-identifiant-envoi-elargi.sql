-- Retour arrière de 019 : `s` redevient « 32 hexadécimaux ou NULL », la définition exacte de 015.
-- Aucune page à toucher avant ni après : la page transmet `s` tel quel dans les deux cas. Un e-mail HubSpot
-- qui porte un identifiant numérique continue d'afficher l'article ; seule sa lecture n'est plus attribuée
-- (send_id NULL).
-- Les identifiants déjà enregistrés au nouveau format sont GARDÉS : ce sont des lectures réelles, et la
-- purge nocturne les efface à 90 jours comme les autres (012). Les effacer tout de suite, si besoin :
--   UPDATE public.gift_link_opens SET send_id = NULL WHERE send_id !~ '^[0-9a-f]{32}$';
-- Liens, articles, lectures et jetons ne sont pas touchés. Rejouer 019 ensuite est possible (testé).
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
  v_send  := CASE WHEN p_send_id ~ '^[0-9a-f]{32}$' THEN p_send_id ELSE NULL END;
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

REVOKE ALL ON FUNCTION public.get_gift_article_for_edition(text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gift_article_for_edition(text,text,text,text,text,text,text) TO anon,authenticated,service_role;

COMMENT ON COLUMN public.gift_link_opens.send_id IS
  'Identifiant de l''ENVOI (?s=…), 32 hexa, tiré au hasard par l''agent. NULL pour une visite directe ou une ouverture antérieure au 5 oct. 2026. C''est lui — et non le token, partagé par article — qui rend une lecture attribuable.';

COMMIT;
