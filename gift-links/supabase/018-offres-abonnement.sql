-- Gift links — 018 : l'offre d'abonnement du moment (23 nov. 2026).
--
-- CE QUI CHANGE. La page de lecture affiche une barre « S'abonner » dont le lien et le texte étaient
-- fixes, par site. Le marketing veut y mettre l'offre du moment (Black Friday, offre de rentrée…) sans
-- passer par une publication Lovable. Il la déclare par l'API, avec une date de fin obligatoire ; la page
-- la lit par la clé publique, au moment de l'affichage.
--
-- ADDITIF. Aucune table, aucune fonction existante n'est modifiée ; seule une colonne de droit s'ajoute à
-- `api_clients`, fausse par défaut. Sans offre en cours, la page garde exactement son bouton actuel.
--
-- UN SITE, PAS UNE ÉDITION. L'édition EUR couvre trois sites en trois langues (www, fr., pl.) : une offre
-- polonaise n'a rien à faire sur un article anglais. Les quatre valeurs sont les hôtes publics des sites.
--
-- RÈGLE DE SÉLECTION, DÉTERMINISTE. Parmi les offres en cours pour un site (début passé, fin à venir),
-- la plus récemment commencée gagne ; à égalité, la plus récemment créée ; puis l'identifiant. Une offre
-- courte posée par-dessus une offre longue s'affiche donc pendant sa durée, puis l'autre reprend.
BEGIN;
SET LOCAL lock_timeout = '3s';

-- ── QUI PEUT GÉRER LES OFFRES. Un jeton de service existant n'y a pas droit : l'agent WhatsApp crée des
-- liens, il ne doit pas pouvoir changer le bouton de toutes les pages. Le droit s'accorde jeton par jeton.
ALTER TABLE public.api_clients ADD COLUMN IF NOT EXISTS manage_offers boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.api_clients.manage_offers IS
  'Vrai si ce service peut créer, lister et terminer les offres d''abonnement (018). Faux par défaut.';

-- Sites et familles de domaines, en une seule règle partagée par les contraintes et les fonctions.
CREATE OR REPLACE FUNCTION public.offer_site_family(p_site text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$
  SELECT CASE p_site
    WHEN 'www.lexpress.fr' THEN 'fr'
    WHEN 'www.lexpress.eu' THEN 'eu'
    WHEN 'fr.lexpress.eu'  THEN 'eu'
    WHEN 'pl.lexpress.eu'  THEN 'eu'
  END
$f$;
CREATE OR REPLACE FUNCTION public.offer_site_language(p_site text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$
  SELECT CASE p_site
    WHEN 'www.lexpress.fr' THEN 'fr'
    WHEN 'www.lexpress.eu' THEN 'en'
    WHEN 'fr.lexpress.eu'  THEN 'fr'
    WHEN 'pl.lexpress.eu'  THEN 'pl'
  END
$f$;
-- Famille de l'URL de redirection : https, hôte de la liste fermée, sans port ni identifiants,
-- sans espace ni caractère de contrôle. NULL = URL refusée.
CREATE OR REPLACE FUNCTION public.offer_url_family(p_url text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$
  SELECT CASE
    WHEN p_url IS NULL OR length(p_url) > 500 OR p_url ~ '[[:space:][:cntrl:]\\"<>`]' THEN NULL
    WHEN p_url ~ '^https://(abonnements-digitaux\.lexpress\.fr|(www\.)?lexpress\.fr)([/?]|$)' THEN 'fr'
    WHEN p_url ~ '^https://((www|fr|pl)\.)?lexpress\.eu([/?]|$)' THEN 'eu'
  END
$f$;
-- Un à quatre sites, tous connus, sans doublon ni valeur nulle.
CREATE OR REPLACE FUNCTION public.offer_sites_valid(p_sites text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$
  SELECT p_sites IS NOT NULL
     AND cardinality(p_sites) BETWEEN 1 AND 4
     AND array_position(p_sites, NULL) IS NULL
     AND p_sites <@ ARRAY['www.lexpress.fr','www.lexpress.eu','fr.lexpress.eu','pl.lexpress.eu']::text[]
     AND cardinality(p_sites) = (SELECT count(DISTINCT s) FROM unnest(p_sites) s)
$f$;
-- Fonctions pures, sans lecture de données : exécutables par tous, comme article_language (017).
GRANT EXECUTE ON FUNCTION public.offer_site_family(text), public.offer_site_language(text), public.offer_url_family(text), public.offer_sites_valid(text[]) TO PUBLIC;

CREATE TABLE IF NOT EXISTS public.subscription_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text CHECK (name IS NULL OR (btrim(name) <> '' AND length(name) <= 80 AND name !~ '[[:cntrl:]]')),
  sites       text[] NOT NULL,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL,
  url         text,
  label       text,
  created_by  uuid REFERENCES public.api_clients(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  ended_by    uuid REFERENCES public.api_clients(id),
  ended_at    timestamptz,
  -- Clé de rejeu fournie par l'appelant : un POST renvoyé après une réponse perdue ne crée pas de doublon.
  request_id  text CHECK (request_id IS NULL OR request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  CONSTRAINT subscription_offers_dates CHECK (ends_at > starts_at),
  -- Un à quatre sites, tous connus, sans doublon.
  CONSTRAINT subscription_offers_sites CHECK (public.offer_sites_valid(sites)),
  CONSTRAINT subscription_offers_url CHECK (url IS NULL OR public.offer_url_family(url) IS NOT NULL),
  CONSTRAINT subscription_offers_label CHECK (label IS NULL OR (
    label = btrim(label) AND char_length(label) BETWEEN 1 AND 40 AND label !~ '[[:cntrl:]<>]'))
);
COMMENT ON TABLE public.subscription_offers IS
  'Offres d''abonnement affichées dans la barre de la page de lecture. Écriture par la fonction subscription-offers seulement ; lecture publique par get_subscription_offer, trois champs.';
CREATE INDEX IF NOT EXISTS subscription_offers_ends_at ON public.subscription_offers (ends_at);
-- Chaque page lit l'offre de son site : filtre par appartenance au tableau, sans parcourir les autres sites.
CREATE INDEX IF NOT EXISTS subscription_offers_sites ON public.subscription_offers USING gin (sites);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_offers_request ON public.subscription_offers (created_by, request_id)
  WHERE request_id IS NOT NULL;

-- ── LES DROITS. Table fermée : RLS active, aucune politique, aucun droit public.
ALTER TABLE public.subscription_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_offers FROM PUBLIC, anon, authenticated;

-- ── LECTURE PUBLIQUE. Le strict nécessaire : libellé, URL, date de fin. Au plus une ligne.
-- NULL dans libellé ou URL = la page garde son texte ou son lien par défaut, dans la langue du site.
-- LA règle de sélection, une seule fois : la page et la liste du marketing la lisent toutes deux ici,
-- à la précision de PostgreSQL (la microseconde), jamais recalculée ailleurs.
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

-- Contrôle de droit commun aux trois gestes d'écriture ou de liste.
CREATE OR REPLACE FUNCTION public.assert_offer_manager(p_client_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.api_clients WHERE id = p_client_id AND active AND manage_offers) THEN
    RAISE EXCEPTION 'offres : service non autorisé' USING ERRCODE = '42501';
  END IF;
END $f$;

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

-- La liste du marketing, en un seul appel donc une seule photographie de la base et une seule horloge :
-- offres à venir, en cours, et terminées depuis moins de 30 jours (500 au plus, celles affichées en tête,
-- puis celles en cours), l'offre affichée par site (même fonction que la page) et `truncated`.
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

-- Fin anticipée : la ligne reste, marquée `ended_at`, et ne s'affiche plus. Ses dates ne changent pas, si
-- bien qu'un POST rejoué avec le même request_id retrouve l'offre au lieu d'en recréer une.
-- Rend 'cancelled' (pas encore commencée), 'ended' (en cours), 'already_ended' ou 'unknown'.
CREATE OR REPLACE FUNCTION public.end_subscription_offer(p_client_id uuid, p_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v public.subscription_offers;
BEGIN
  PERFORM public.assert_offer_manager(p_client_id);
  SELECT * INTO v FROM public.subscription_offers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF v.ended_at IS NOT NULL OR v.ends_at <= now() THEN RETURN 'already_ended'; END IF;
  UPDATE public.subscription_offers SET ended_at = now(), ended_by = p_client_id WHERE id = p_id;
  RETURN CASE WHEN v.starts_at > now() THEN 'cancelled' ELSE 'ended' END;
END $f$;

REVOKE ALL ON FUNCTION public.get_subscription_offer(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_offer_manager(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_subscription_offer_id(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_subscription_offer(uuid, text[], timestamptz, timestamptz, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_subscription_offers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_subscription_offer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_subscription_offer(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_subscription_offer(uuid, text[], timestamptz, timestamptz, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_subscription_offers(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_subscription_offer(uuid, uuid) TO service_role;

COMMIT;
