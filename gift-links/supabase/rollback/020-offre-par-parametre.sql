-- Retour arrière de 020 : remet EXACTEMENT l'état de 018 (définitions des fonctions recopiées de 018 à
-- l'identique, droits, valeur par défaut `manage_offers` fausse). Vérifié par empreintes
-- (validate-offre-par-parametre.mjs : md5(pg_get_functiondef) égal à 018 seule).
--
-- ORDRE : d'abord le lecteur (restaurer la publication précédente) ; une page qui appelle encore
-- get_subscription_offer(site, code) retombe sur son bouton par défaut (404), sans casser.
--
-- GARDE. En 018, toute offre en cours s'affiche sur TOUS les articles de ses sites. Une offre créée sous
-- 020 pour un seul lien deviendrait donc globale : le script REFUSE tant qu'une offre est en cours ou à
-- venir. La terminer d'abord (API, DELETE ?code=…), ou en SQL, après décision :
--   UPDATE public.subscription_offers SET ended_at = now() WHERE ended_at IS NULL AND ends_at > now();
--
-- CE QUI EST PERDU : le code des offres (colonne supprimée ; une ré-application de 020 en engendre de
-- nouveaux, et les liens déjà envoyés retombent sur le bouton par défaut). CE QUI RESTE : les offres
-- (terminées), les jetons et leur droit `manage_offers` tel quel — un jeton créé sous 020 garde son droit
-- (le lister : SELECT name FROM public.api_clients WHERE manage_offers;). Liens, articles, lectures :
-- non touchés.
BEGIN;
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.subscription_offers IN EXCLUSIVE MODE;
DO $garde$
DECLARE v integer;
BEGIN
  SELECT count(*) INTO v FROM public.subscription_offers WHERE ended_at IS NULL AND ends_at > now();
  IF v > 0 THEN
    RAISE EXCEPTION 'retour arrière de 020 refusé : % offre(s) en cours ou à venir deviendraient visibles sur tous les articles de leurs sites ; les terminer d''abord', v;
  END IF;
END $garde$;

DROP FUNCTION IF EXISTS public.end_subscription_offer_by_code(uuid, text);
DROP FUNCTION IF EXISTS public.get_subscription_offer(text, text);
DROP FUNCTION IF EXISTS public.create_subscription_offer(uuid, text[], timestamptz, timestamptz, text, text, text, text, text);
DROP INDEX IF EXISTS public.subscription_offers_code_key;
ALTER TABLE public.subscription_offers DROP COLUMN IF EXISTS code;
DROP FUNCTION IF EXISTS public.new_offer_code();
DROP FUNCTION IF EXISTS public.offer_code_valid(text);

ALTER TABLE public.api_clients ALTER COLUMN manage_offers SET DEFAULT false;

-- ── Définitions de 018, recopiées à l'identique.
COMMENT ON COLUMN public.api_clients.manage_offers IS
  'Vrai si ce service peut créer, lister et terminer les offres d''abonnement (018). Faux par défaut.';
COMMENT ON TABLE public.subscription_offers IS
  'Offres d''abonnement affichées dans la barre de la page de lecture. Écriture par la fonction subscription-offers seulement ; lecture publique par get_subscription_offer, trois champs.';

CREATE OR REPLACE FUNCTION public.current_subscription_offer_id(p_site text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT o.id
    FROM public.subscription_offers o
   WHERE p_site = ANY (o.sites)
     AND o.starts_at <= now() AND o.ends_at > now() AND o.ended_at IS NULL
   ORDER BY o.starts_at DESC, o.created_at DESC, o.id DESC
   LIMIT 1
$f$;

CREATE OR REPLACE FUNCTION public.get_subscription_offer(p_site text)
RETURNS TABLE (label text, url text, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT o.label, o.url, o.ends_at
    FROM public.subscription_offers o
   WHERE o.id = public.current_subscription_offer_id(p_site)
$f$;

CREATE OR REPLACE FUNCTION public.create_subscription_offer(
  p_client_id uuid, p_sites text[], p_ends_at timestamptz,
  p_starts_at timestamptz DEFAULT NULL, p_url text DEFAULT NULL, p_label text DEFAULT NULL, p_name text DEFAULT NULL,
  p_request_id text DEFAULT NULL)
RETURNS public.subscription_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v public.subscription_offers;
BEGIN
  PERFORM public.assert_offer_manager(p_client_id);
  -- Rejeu : même clé, même demande → l'offre déjà créée, telle quelle. Même clé, autre demande → refus.
  IF p_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('subscription-offer:' || p_client_id || ':' || p_request_id, 0));
    SELECT * INTO v FROM public.subscription_offers WHERE created_by = p_client_id AND request_id = p_request_id;
    IF FOUND THEN
      IF v.sites = p_sites AND v.ends_at = p_ends_at AND (p_starts_at IS NULL OR v.starts_at = p_starts_at)
         AND v.url IS NOT DISTINCT FROM p_url AND v.label IS NOT DISTINCT FROM p_label
         AND v.name IS NOT DISTINCT FROM NULLIF(btrim(p_name), '') THEN
        RETURN v;
      END IF;
      RAISE EXCEPTION 'offres : request_id déjà utilisé pour une autre offre' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_ends_at IS NULL OR p_ends_at <= now() THEN
    RAISE EXCEPTION 'offres : la date de fin doit être à venir' USING ERRCODE = '22023';
  END IF;
  -- Une URL sert une seule famille de domaines : celle de chacun des sites visés.
  IF p_url IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_sites) s WHERE public.offer_site_family(s) IS DISTINCT FROM public.offer_url_family(p_url)) THEN
    RAISE EXCEPTION 'offres : l''URL doit appartenir au domaine de chaque site visé' USING ERRCODE = '22023';
  END IF;
  -- Un libellé est écrit dans une langue : il ne vise que des sites de cette langue.
  IF p_label IS NOT NULL AND (SELECT count(DISTINCT public.offer_site_language(s)) FROM unnest(p_sites) s) > 1 THEN
    RAISE EXCEPTION 'offres : un libellé ne peut viser que des sites d''une même langue' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.subscription_offers (name, sites, starts_at, ends_at, url, label, created_by, request_id)
  VALUES (NULLIF(btrim(p_name), ''), p_sites, COALESCE(p_starts_at, now()), p_ends_at, p_url, p_label, p_client_id, p_request_id)
  RETURNING * INTO v;
  RETURN v;
END $f$;

CREATE OR REPLACE FUNCTION public.list_subscription_offers(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_displayed jsonb; v_offers jsonb; v_total integer;
BEGIN
  PERFORM public.assert_offer_manager(p_client_id);
  SELECT jsonb_object_agg(s.site, public.current_subscription_offer_id(s.site))
    INTO v_displayed
    FROM unnest(ARRAY['www.lexpress.fr','www.lexpress.eu','fr.lexpress.eu','pl.lexpress.eu']) AS s(site);
  SELECT count(*) INTO v_total FROM public.subscription_offers WHERE COALESCE(ended_at, ends_at) > now() - interval '30 days';
  SELECT COALESCE(jsonb_agg(x.offer ORDER BY x.rank), '[]'::jsonb) INTO v_offers FROM (
    SELECT jsonb_build_object(
             'id', o.id, 'name', o.name, 'sites', to_jsonb(o.sites), 'starts_at', o.starts_at, 'ends_at', o.ends_at,
             'url', o.url, 'label', o.label, 'ended_at', o.ended_at,
             'status', CASE WHEN o.ended_at IS NOT NULL OR o.ends_at <= now() THEN 'ended'
                            WHEN o.starts_at > now() THEN 'scheduled' ELSE 'active' END) AS offer,
           row_number() OVER (ORDER BY
             -- COALESCE : un site sans offre donne NULL, et NULL passerait devant en tri décroissant.
             COALESCE(o.id IN (SELECT e.value::uuid FROM jsonb_each_text(v_displayed) e WHERE e.value IS NOT NULL), false) DESC,
             (o.ended_at IS NULL AND o.starts_at <= now() AND o.ends_at > now()) DESC,
             (o.ended_at IS NULL AND o.ends_at > now()) DESC,
             o.starts_at DESC, o.created_at DESC, o.id DESC) AS rank
      FROM public.subscription_offers o
     WHERE COALESCE(o.ended_at, o.ends_at) > now() - interval '30 days'
  ) x WHERE x.rank <= 500;
  RETURN jsonb_build_object('offers', v_offers, 'displayed_now', v_displayed, 'truncated', v_total > 500);
END $f$;

REVOKE ALL ON FUNCTION public.get_subscription_offer(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_subscription_offer_id(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_subscription_offer(uuid, text[], timestamptz, timestamptz, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_subscription_offers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_subscription_offer(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_subscription_offer(uuid, text[], timestamptz, timestamptz, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_subscription_offers(uuid) TO service_role;

COMMIT;
