-- Gift links — 020 : une offre ne s'affiche que par son lien (24 nov. 2026).
--
-- CE QUI CHANGE (décisions d'Ophélie du 24/11).
-- 1. Une offre ne s'affiche plus pour tous les lecteurs d'un site. Elle s'affiche seulement quand l'URL de
--    l'article offert la désigne, par son identifiant public `code` (paramètre `offre`, proposé :
--    …/a/<jeton>?offre=black-friday-2026). Sans paramètre, ou si l'offre désignée n'existe pas, vise un
--    autre site, n'a pas commencé, est expirée ou a été terminée en avance : le bouton par défaut de
--    l'édition. Il n'existe plus d'offre « globale ».
-- 2. Un jeton créé à partir de maintenant a le droit de gérer les offres (`manage_offers` vrai par
--    défaut). Les jetons existants GARDENT leur valeur : aucune ligne de `api_clients` n'est modifiée.
--
-- CONSÉQUENCES (proposé) : plusieurs offres peuvent coexister, chacune activée par son propre lien. La
-- règle de chevauchement de 018 (« la plus récemment commencée gagne ») et `displayed_now` disparaissent :
-- la lecture publique prend (site, code) et rend au plus une ligne, l'unicité du code suffit.
--
-- COMPATIBLE AVEC LA PROD DU 24/11 (018 et 019 en place, table vide, fonction subscription-offers v1) :
-- - la fonction v1 continue de créer (code généré), lister et terminer par id ;
-- - aucune page publiée n'appelle get_subscription_offer (le lecteur de !1 n'est pas publié) ;
-- - lecture d'article (v1, v2, _for_edition, v3), create_gift_links et les fonctions des jetons
--   (create_/verify_/revoke_api_client, count_client_links) ne sont PAS touchées.
-- Rejouable. Retour arrière : rollback/020-offre-par-parametre.sql (remet exactement l'état de 018).
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $garde$
BEGIN
  IF to_regclass('public.subscription_offers') IS NULL THEN
    RAISE EXCEPTION '020 : appliquer 018 d''abord';
  END IF;
END $garde$;

-- ── 1. LE DROIT PAR DÉFAUT. Seule la valeur par défaut change : `create_api_client` n'écrit pas la
-- colonne, chaque jeton qu'elle crée désormais a donc le droit. Pour un jeton qui ne doit pas l'avoir :
-- UPDATE public.api_clients SET manage_offers = false WHERE name = '<nom>';
ALTER TABLE public.api_clients ALTER COLUMN manage_offers SET DEFAULT true;
COMMENT ON COLUMN public.api_clients.manage_offers IS
  'Vrai si ce service peut créer, lister et terminer les offres d''abonnement (018). Vrai par défaut pour les jetons créés depuis 020 (24/11/2026) ; les jetons antérieurs gardent leur valeur.';

-- ── 2. L'IDENTIFIANT PUBLIC DE L'OFFRE. Un slug de 3 à 40 caractères a-z0-9-, unique parmi toutes les
-- offres enregistrées (une offre terminée garde le sien : un lien déjà envoyé ne peut pas désigner plus
-- tard une autre offre). Il n'est PAS un secret : qui a le lien voit l'offre, comme qui a l'article.
CREATE OR REPLACE FUNCTION public.offer_code_valid(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$
  SELECT p_code IS NOT NULL AND p_code ~ '^[a-z0-9-]{3,40}$'
$f$;
GRANT EXECUTE ON FUNCTION public.offer_code_valid(text) TO PUBLIC;

-- Code engendré quand le marketing n'en donne pas : 16 caractères hexadécimaux tirés de gen_random_uuid
-- (aléa du système), 64 bits, non devinable.
CREATE OR REPLACE FUNCTION public.new_offer_code() RETURNS text
LANGUAGE sql VOLATILE SET search_path = pg_catalog AS $f$
  SELECT substr(md5(gen_random_uuid()::text), 1, 16)
$f$;
REVOKE ALL ON FUNCTION public.new_offer_code() FROM PUBLIC, anon, authenticated;

-- Défaut volatil : chaque offre déjà enregistrée reçoit son propre code (aucune en PROD le 24/11).
ALTER TABLE public.subscription_offers ADD COLUMN IF NOT EXISTS code text NOT NULL DEFAULT public.new_offer_code();
DO $contrainte$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.subscription_offers'::regclass AND conname = 'subscription_offers_code') THEN
    ALTER TABLE public.subscription_offers ADD CONSTRAINT subscription_offers_code CHECK (public.offer_code_valid(code));
  END IF;
END $contrainte$;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_offers_code_key ON public.subscription_offers (code);
COMMENT ON COLUMN public.subscription_offers.code IS
  'Identifiant public de l''offre (020), dans le paramètre `offre` de l''URL de l''article offert. Unique, jamais réattribué.';

-- ── 3. PLUS D'OFFRE GLOBALE. La lecture par site seul et sa règle de sélection disparaissent.
DROP FUNCTION IF EXISTS public.get_subscription_offer(text);
DROP FUNCTION IF EXISTS public.current_subscription_offer_id(text);

-- ── 4. LECTURE PUBLIQUE : (site, code). Libellé, URL, date de fin, et seulement si l'offre est valable
-- MAINTENANT pour ce site ; sinon rien, et la page garde son bouton par défaut. Lecture seule (STABLE :
-- PostgreSQL y interdit toute écriture) ; elle ne compte aucune lecture d'article. Au plus une ligne
-- (code unique).
CREATE OR REPLACE FUNCTION public.get_subscription_offer(p_site text, p_code text)
RETURNS TABLE (label text, url text, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT o.label, o.url, o.ends_at
    FROM public.subscription_offers o
   WHERE o.code = p_code
     AND p_site = ANY (o.sites)
     AND o.starts_at <= now() AND o.ends_at > now() AND o.ended_at IS NULL
$f$;

-- ── 5. CRÉATION : un paramètre `p_code` en plus, en dernier et facultatif. L'ancienne signature est
-- retirée ; la fonction v1, qui appelle par noms sans `p_code`, continue de créer (code engendré).
DROP FUNCTION IF EXISTS public.create_subscription_offer(uuid, text[], timestamptz, timestamptz, text, text, text, text);
CREATE OR REPLACE FUNCTION public.create_subscription_offer(
  p_client_id uuid, p_sites text[], p_ends_at timestamptz,
  p_starts_at timestamptz DEFAULT NULL, p_url text DEFAULT NULL, p_label text DEFAULT NULL, p_name text DEFAULT NULL,
  p_request_id text DEFAULT NULL, p_code text DEFAULT NULL)
RETURNS public.subscription_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v public.subscription_offers; essai integer := 0;
BEGIN
  PERFORM public.assert_offer_manager(p_client_id);
  IF p_code IS NOT NULL AND NOT public.offer_code_valid(p_code) THEN
    RAISE EXCEPTION 'offres : code de 3 à 40 caractères parmi a-z, 0-9 et -' USING ERRCODE = '22023';
  END IF;
  -- Rejeu : même clé, même demande → l'offre déjà créée, telle quelle (code compris). Même clé, autre
  -- demande → refus. Sans code demandé, le code engendré la première fois est rendu.
  IF p_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('subscription-offer:' || p_client_id || ':' || p_request_id, 0));
    SELECT * INTO v FROM public.subscription_offers WHERE created_by = p_client_id AND request_id = p_request_id;
    IF FOUND THEN
      IF v.sites = p_sites AND v.ends_at = p_ends_at AND (p_starts_at IS NULL OR v.starts_at = p_starts_at)
         AND v.url IS NOT DISTINCT FROM p_url AND v.label IS NOT DISTINCT FROM p_label
         AND v.name IS NOT DISTINCT FROM NULLIF(btrim(p_name), '')
         AND (p_code IS NULL OR v.code = p_code) THEN
        RETURN v;
      END IF;
      RAISE EXCEPTION 'offres : request_id déjà utilisé pour une autre offre' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_ends_at IS NULL OR p_ends_at <= now() THEN
    RAISE EXCEPTION 'offres : la date de fin doit être à venir' USING ERRCODE = '22023';
  END IF;
  IF p_url IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_sites) s WHERE public.offer_site_family(s) IS DISTINCT FROM public.offer_url_family(p_url)) THEN
    RAISE EXCEPTION 'offres : l''URL doit appartenir au domaine de chaque site visé' USING ERRCODE = '22023';
  END IF;
  IF p_label IS NOT NULL AND (SELECT count(DISTINCT public.offer_site_language(s)) FROM unnest(p_sites) s) > 1 THEN
    RAISE EXCEPTION 'offres : un libellé ne peut viser que des sites d''une même langue' USING ERRCODE = '22023';
  END IF;
  IF p_code IS NOT NULL AND EXISTS (SELECT 1 FROM public.subscription_offers WHERE code = p_code) THEN
    RAISE EXCEPTION 'offres : code déjà utilisé par une autre offre (un code n''est jamais réattribué)' USING ERRCODE = '23505';
  END IF;
  LOOP
    BEGIN
      INSERT INTO public.subscription_offers (name, sites, starts_at, ends_at, url, label, created_by, request_id, code)
      VALUES (NULLIF(btrim(p_name), ''), p_sites, COALESCE(p_starts_at, now()), p_ends_at, p_url, p_label, p_client_id, p_request_id,
              COALESCE(p_code, public.new_offer_code()))
      RETURNING * INTO v;
      RETURN v;
    EXCEPTION WHEN unique_violation THEN
      -- Code demandé pris entre le contrôle et l'écriture, ou (64 bits) code engendré déjà pris.
      IF p_code IS NOT NULL OR essai >= 3 THEN
        RAISE EXCEPTION 'offres : code déjà utilisé par une autre offre (un code n''est jamais réattribué)' USING ERRCODE = '23505';
      END IF;
      essai := essai + 1;
    END;
  END LOOP;
END $f$;

-- ── 6. LISTE DU MARKETING. Même périmètre qu'en 018 (à venir, en cours, terminées depuis moins de 30
-- jours, 500 au plus), avec le code ; `displayed_now` disparaît (plus d'offre affichée par défaut). Tri :
-- en cours, puis à venir, puis terminées ; puis début le plus récent.
CREATE OR REPLACE FUNCTION public.list_subscription_offers(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_offers jsonb; v_total integer;
BEGIN
  PERFORM public.assert_offer_manager(p_client_id);
  SELECT count(*) INTO v_total FROM public.subscription_offers WHERE COALESCE(ended_at, ends_at) > now() - interval '30 days';
  SELECT COALESCE(jsonb_agg(x.offer ORDER BY x.rank), '[]'::jsonb) INTO v_offers FROM (
    SELECT jsonb_build_object(
             'id', o.id, 'code', o.code, 'name', o.name, 'sites', to_jsonb(o.sites), 'starts_at', o.starts_at, 'ends_at', o.ends_at,
             'url', o.url, 'label', o.label, 'ended_at', o.ended_at,
             'status', CASE WHEN o.ended_at IS NOT NULL OR o.ends_at <= now() THEN 'ended'
                            WHEN o.starts_at > now() THEN 'scheduled' ELSE 'active' END) AS offer,
           row_number() OVER (ORDER BY
             (o.ended_at IS NULL AND o.starts_at <= now() AND o.ends_at > now()) DESC,
             (o.ended_at IS NULL AND o.ends_at > now()) DESC,
             o.starts_at DESC, o.created_at DESC, o.id DESC) AS rank
      FROM public.subscription_offers o
     WHERE COALESCE(o.ended_at, o.ends_at) > now() - interval '30 days'
  ) x WHERE x.rank <= 500;
  RETURN jsonb_build_object('offers', v_offers, 'truncated', v_total > 500);
END $f$;

-- ── 7. FIN ANTICIPÉE PAR CODE. Même règle que par id (end_subscription_offer de 018, inchangée).
-- Le droit est contrôlé avant toute recherche : un service sans droit n'apprend pas si un code existe.
CREATE OR REPLACE FUNCTION public.end_subscription_offer_by_code(p_client_id uuid, p_code text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_id uuid;
BEGIN
  PERFORM public.assert_offer_manager(p_client_id);
  SELECT id INTO v_id FROM public.subscription_offers WHERE code = p_code;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  RETURN public.end_subscription_offer(p_client_id, v_id);
END $f$;

REVOKE ALL ON FUNCTION public.get_subscription_offer(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_subscription_offer(uuid, text[], timestamptz, timestamptz, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_subscription_offer_by_code(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_subscription_offer(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_subscription_offer(uuid, text[], timestamptz, timestamptz, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_subscription_offer_by_code(uuid, text) TO service_role;

COMMENT ON TABLE public.subscription_offers IS
  'Offres d''abonnement de la barre de la page de lecture, chacune activée par son lien (paramètre offre = code, 020). Écriture par la fonction subscription-offers seulement ; lecture publique par get_subscription_offer(site, code), trois champs.';

COMMIT;
