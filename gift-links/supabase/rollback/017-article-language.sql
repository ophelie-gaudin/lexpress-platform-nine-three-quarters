-- Revenir d’abord à la fonction précédente, puis au lecteur historique (jamais l’inverse :
-- la fonction crée des liens PL/FR que l’ancien lecteur refuse).
-- La colonne est supprimée ; tokens, corps, expirations et adresses canoniques sont conservés.
-- Rejouer 017 retrouve les langues par l'hôte canonique.
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP FUNCTION IF EXISTS public.get_gift_article_for_edition_v2(text,text,text,text,text,text,text);
CREATE OR REPLACE FUNCTION public.cache_articles(p_articles jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_touches integer;
BEGIN
  CREATE TEMP TABLE entrants ON COMMIT DROP AS
  SELECT DISTINCT ON (COALESCE(a.edition, 'FR'), a.arc_id) a.*
  FROM jsonb_to_recordset(p_articles) AS a(
    arc_id text, edition text, canonical_url text, title text, standfirst text, image_url text,
    body text, section text, author text, published_at timestamptz, is_demo boolean)
  WHERE a.arc_id IS NOT NULL AND btrim(a.arc_id) <> ''
  ORDER BY COALESCE(a.edition, 'FR'), a.arc_id, COALESCE(a.is_demo, false),
           CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN 1 ELSE 0 END;
  UPDATE entrants SET edition = 'FR' WHERE edition IS NULL;
  IF EXISTS (SELECT 1 FROM entrants WHERE edition NOT IN ('FR','EUR')) THEN
    RAISE EXCEPTION 'cache_articles : édition invalide';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gift-cache:' || e.edition || ':' || e.arc_id, 0))
    FROM entrants e ORDER BY e.edition, e.arc_id;

  UPDATE public.articles a SET
    canonical_url = COALESCE(NULLIF(btrim(e.canonical_url), ''), a.canonical_url),
    title         = COALESCE(NULLIF(btrim(e.title), ''),         a.title),
    standfirst    = COALESCE(NULLIF(btrim(e.standfirst), ''),    a.standfirst),
    image_url     = COALESCE(NULLIF(btrim(e.image_url), ''),     a.image_url),
    section       = COALESCE(NULLIF(btrim(e.section), ''),       a.section),
    author        = COALESCE(NULLIF(btrim(e.author), ''),        a.author),
    published_at  = COALESCE(e.published_at,                     a.published_at),
    body = CASE
      -- rien de neuf à dire : on garde ce qu'on avait
      WHEN e.body IS NULL OR btrim(e.body) = ''                          THEN a.body
      -- une démonstration ne recouvre pas un article réel
      WHEN COALESCE(e.is_demo, false) AND a.body IS NOT NULL
           AND btrim(a.body) <> ''                                       THEN a.body
      ELSE e.body
    END,
    fetched_at = now()
  FROM entrants e WHERE a.edition = e.edition AND a.arc_id = e.arc_id;

  INSERT INTO public.articles (edition, arc_id, canonical_url, title, standfirst, image_url,
                               body, section, author, published_at, fetched_at)
  SELECT e.edition, e.arc_id, e.canonical_url, e.title, e.standfirst, e.image_url,
         e.body, e.section, e.author, e.published_at, now()
  FROM entrants e
  WHERE NOT EXISTS (SELECT 1 FROM public.articles a WHERE a.edition = e.edition AND a.arc_id = e.arc_id);

  SELECT count(*)::integer INTO v_touches FROM entrants;
  DROP TABLE entrants;
  RETURN v_touches;
END $function$
;
-- Disponibilité : retour à la définition 015 (hôtes pl. et fr. de nouveau refusés).
CREATE OR REPLACE FUNCTION public.gift_link_status_v107(p_digest text, p_urls text[])
 RETURNS TABLE(url text, arc_id text, observed_at timestamp with time zone, available boolean, reason text, token text, link text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE observed timestamptz := statement_timestamp();
BEGIN
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR NOT EXISTS(SELECT 1 FROM api_clients c WHERE c.token_sha256=p_digest AND c.active AND c.revoked_at IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='non autorisé';
 END IF;
 IF p_urls IS NULL OR cardinality(p_urls)>100 OR EXISTS(SELECT 1 FROM unnest(p_urls) u WHERE u IS NULL OR u !~ '^https://(www\.)?lexpress\.(fr|eu)/[^?#[:space:]]+-[A-Z0-9]{26}/?([?#][^[:space:]]*)?$') THEN RAISE EXCEPTION 'URLs invalides'; END IF;
 RETURN QUERY WITH requested AS (
 SELECT DISTINCT u AS requested_url, CASE WHEN u ~ '^https://(www\.)?lexpress\.eu/' THEN 'EUR' ELSE 'FR' END AS requested_edition, substring(split_part(split_part(u,'?',1),'#',1) FROM '-([A-Z0-9]{26})/?$') AS requested_arc FROM unnest(p_urls) u
 ), states AS (
 SELECT r.*,g.token AS gift_token,g.expires_at AS gift_expiry,
 CASE WHEN g.token IS NULL THEN 'missing' WHEN g.withdrawn_at IS NOT NULL THEN 'withdrawn'
 WHEN g.expires_at<=observed THEN 'expired' WHEN NULLIF(btrim(a.body),'') IS NULL THEN 'preview'
 WHEN a.body ILIKE '%TEXTE DE DÉMONSTRATION%' OR a.body ILIKE '%data-demo%' OR a.body ILIKE '%DEMONSTRATION TEXT%' THEN 'demo'
 ELSE 'available' END AS status_reason
 FROM requested r LEFT JOIN gift_links g ON g.edition=r.requested_edition AND g.arc_id=r.requested_arc LEFT JOIN articles a ON a.edition=r.requested_edition AND a.arc_id=r.requested_arc
 ) SELECT s.requested_url,s.requested_arc,observed,s.status_reason='available',s.status_reason,
 CASE WHEN s.status_reason='available' THEN s.gift_token END,
 CASE WHEN s.status_reason='available' THEN public.gift_link_origin(s.requested_edition)||'/a/'||s.gift_token END,
 CASE WHEN s.status_reason='available' THEN s.gift_expiry END FROM states s ORDER BY s.requested_url;
END $function$
;
DROP TRIGGER IF EXISTS article_language_default ON public.articles;
DROP FUNCTION IF EXISTS public.default_article_language();
ALTER TABLE public.articles DROP COLUMN IF EXISTS language;
DROP FUNCTION IF EXISTS public.article_language(text,text);
COMMIT;
