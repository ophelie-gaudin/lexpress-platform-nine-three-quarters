-- Éditions FR/EUR. Migration transactionnelle et rejouable ; conserve tous les tokens existants.
BEGIN;
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='articles' AND column_name='edition')
     AND EXISTS (SELECT 1 FROM public.articles WHERE canonical_url !~ '^https://(www\.)?lexpress\.fr/') THEN
    RAISE EXCEPTION 'Migration FR/EUR : origine historique non française à examiner';
  END IF;
END $preflight$;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS edition text NOT NULL DEFAULT 'FR';
ALTER TABLE public.gift_links ADD COLUMN IF NOT EXISTS edition text NOT NULL DEFAULT 'FR';
ALTER TABLE public.gift_links DROP CONSTRAINT IF EXISTS gift_links_arc_id_fkey;
ALTER TABLE public.gift_links DROP CONSTRAINT IF EXISTS gift_links_arc_id_unique;
DO $keys$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.articles'::regclass AND conname='articles_pkey' AND pg_get_constraintdef(oid)='PRIMARY KEY (arc_id)') THEN
    ALTER TABLE public.articles DROP CONSTRAINT articles_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.articles'::regclass AND conname='articles_pkey') THEN
    ALTER TABLE public.articles ADD CONSTRAINT articles_pkey PRIMARY KEY (edition,arc_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.gift_links'::regclass AND conname='gift_links_edition_arc_unique') THEN
    ALTER TABLE public.gift_links ADD CONSTRAINT gift_links_edition_arc_unique UNIQUE (edition,arc_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.gift_links'::regclass AND conname='gift_links_edition_arc_fkey') THEN
    ALTER TABLE public.gift_links ADD CONSTRAINT gift_links_edition_arc_fkey FOREIGN KEY (edition,arc_id) REFERENCES public.articles(edition,arc_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.articles'::regclass AND conname='articles_edition_check') THEN
    ALTER TABLE public.articles ADD CONSTRAINT articles_edition_check CHECK (edition IN ('FR','EUR'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.gift_links'::regclass AND conname='gift_links_edition_check') THEN
    ALTER TABLE public.gift_links ADD CONSTRAINT gift_links_edition_check CHECK (edition IN ('FR','EUR'));
  END IF;
END $keys$;

-- Origines propres à l'environnement : source commune de création et de disponibilité.
-- Les opérateurs TEST remplacent ces deux valeurs avant tout appel de recette.
CREATE TABLE IF NOT EXISTS public.gift_link_origins (
  edition text PRIMARY KEY CHECK (edition IN ('FR','EUR')),
  origin text NOT NULL CHECK (origin ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$')
);
ALTER TABLE public.gift_link_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gift_link_origins FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.gift_link_origins TO service_role;
INSERT INTO public.gift_link_origins(edition,origin) VALUES
 ('FR','https://articles.lexpress.fr'),('EUR','https://articles.lexpress.eu')
ON CONFLICT (edition) DO NOTHING;
CREATE OR REPLACE FUNCTION public.gift_link_origin(p_edition text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $origin$
DECLARE v_origin text;
BEGIN
  SELECT origin INTO v_origin FROM public.gift_link_origins WHERE edition=p_edition;
  IF NOT FOUND THEN RAISE EXCEPTION 'gift_link_origin : édition non configurée'; END IF;
  RETURN v_origin;
END $origin$;
REVOKE ALL ON FUNCTION public.gift_link_origin(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gift_link_origin(text) TO service_role;


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


CREATE OR REPLACE FUNCTION public.create_gift_links_for_edition(
 p_edition text,p_arc_ids text[],p_expires_at timestamptz DEFAULT NULL,p_client_id uuid DEFAULT NULL
) RETURNS TABLE(arc_id text,token text,expires_at timestamptz,state text,link text)
LANGUAGE plpgsql SET search_path=public,pg_temp AS $create$
DECLARE
 v_expire timestamptz:=COALESCE(p_expires_at,now()+interval '15 days');
 v_origin text;v_arc text;v_link public.gift_links%ROWTYPE;
BEGIN
 IF p_edition IS NULL OR p_edition NOT IN ('FR','EUR') THEN RAISE EXCEPTION 'édition invalide'; END IF;
 IF p_arc_ids IS NULL OR cardinality(p_arc_ids)=0 OR array_position(p_arc_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'aucun article valide demandé'; END IF;
 IF v_expire<=now() THEN RAISE EXCEPTION 'expiration déjà passée'; END IF;
 v_origin:=public.gift_link_origin(p_edition);
 IF EXISTS(SELECT 1 FROM unnest(p_arc_ids) a WHERE NOT EXISTS(SELECT 1 FROM public.articles x WHERE x.edition=p_edition AND x.arc_id=a)) THEN RAISE EXCEPTION 'article absent du cache de cette édition'; END IF;
 FOR v_arc IN SELECT DISTINCT a FROM unnest(p_arc_ids) a ORDER BY a LOOP
   -- Ordre déterministe et verrou même pour une ligne encore absente.
   PERFORM pg_advisory_xact_lock(hashtextextended('gift-link:'||p_edition||':'||v_arc,0));
   SELECT * INTO v_link FROM public.gift_links g WHERE g.edition=p_edition AND g.arc_id=v_arc FOR UPDATE;
   IF NOT FOUND THEN
     INSERT INTO public.gift_links AS g(edition,token,arc_id,expires_at,created_by,updated_by,updated_at)
     VALUES(p_edition,replace(gen_random_uuid()::text,'-',''),v_arc,v_expire,p_client_id,p_client_id,now())
     RETURNING g.* INTO v_link;
     state:='created';
   ELSIF v_link.withdrawn_at IS NOT NULL THEN
     arc_id:=v_arc;token:=NULL;expires_at:=NULL;state:='withdrawn';link:=NULL;
     RETURN NEXT;CONTINUE;
   ELSIF v_link.expires_at<v_expire THEN
     UPDATE public.gift_links g SET expires_at=GREATEST(g.expires_at,v_expire),extended_at=now(),
       updated_by=COALESCE(p_client_id,g.updated_by),updated_at=now()
     WHERE g.edition=p_edition AND g.arc_id=v_arc RETURNING g.* INTO v_link;
     state:='extended';
   ELSE state:='unchanged';
   END IF;
   arc_id:=v_arc;token:=v_link.token;expires_at:=v_link.expires_at;link:=v_origin||'/a/'||v_link.token;
   RETURN NEXT;
 END LOOP;
END $create$;
REVOKE ALL ON FUNCTION public.create_gift_links_for_edition(text,text[],timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_gift_links_for_edition(text,text[],timestamptz,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.create_gift_links(p_arc_ids text[],p_expires_at timestamptz DEFAULT NULL,p_client_id uuid DEFAULT NULL)
RETURNS TABLE(arc_id text,token text,expires_at timestamptz,state text)
LANGUAGE sql AS $legacy$
 SELECT f.arc_id,f.token,f.expires_at,f.state FROM public.create_gift_links_for_edition('FR',p_arc_ids,p_expires_at,p_client_id) f;
$legacy$;


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
CREATE OR REPLACE FUNCTION public.get_gift_article(p_token text,p_utm_source text DEFAULT NULL,p_utm_campaign text DEFAULT NULL,p_referrer text DEFAULT NULL,p_send_id text DEFAULT NULL,p_campaign_group text DEFAULT NULL)
RETURNS TABLE(status text,canonical_url text,title text,standfirst text,image_url text,body text,section text,author text,published_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $legacy$
 SELECT * FROM public.get_gift_article_for_edition('FR',p_token,p_utm_source,p_utm_campaign,p_referrer,p_send_id,p_campaign_group);
$legacy$;


CREATE OR REPLACE FUNCTION public.purge_withdrawn_bodies(p_days integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE v_vides integer;
BEGIN
  IF p_days IS NULL OR p_days < 0 THEN
    RAISE EXCEPTION 'purge_withdrawn_bodies : délai de grâce invalide (%)', p_days;
  END IF;
  WITH videes AS (
    UPDATE public.articles a SET body = NULL
     WHERE a.body IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.gift_links g
          WHERE g.edition = a.edition AND g.arc_id = a.arc_id
            AND g.withdrawn_at IS NOT NULL
            AND g.withdrawn_at < now() - make_interval(days => p_days))
       AND NOT EXISTS (
         SELECT 1 FROM public.gift_links g
          WHERE g.edition = a.edition AND g.arc_id = a.arc_id AND g.withdrawn_at IS NULL)
    RETURNING 1)
  SELECT count(*)::integer INTO v_vides FROM videes;
  RETURN v_vides;
END $function$
;

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


CREATE OR REPLACE VIEW public.gift_links_by_client WITH(security_invoker=true) AS
 SELECT g.token,g.arc_id,a.title,cre.name AS created_by,g.created_at,upd.name AS updated_by,
 g.updated_at,g.extended_at,g.expires_at,g.withdrawn_at,g.opens,g.edition
 FROM public.gift_links g LEFT JOIN public.articles a ON a.edition=g.edition AND a.arc_id=g.arc_id
 LEFT JOIN public.api_clients cre ON cre.id=g.created_by LEFT JOIN public.api_clients upd ON upd.id=g.updated_by;
CREATE OR REPLACE VIEW public.gift_link_reads_by_campaign WITH(security_invoker=true) AS
 SELECT o.campaign_group,o.utm_source,o.utm_campaign,count(*)::integer AS reads,
 count(DISTINCT o.send_id)::integer AS sends,count(DISTINCT o.token)::integer AS articles,
 min(o.opened_at) AS first_read,max(o.opened_at) AS last_read,g.edition
 FROM public.gift_link_opens o JOIN public.gift_links g ON g.token=o.token
 GROUP BY o.campaign_group,o.utm_source,o.utm_campaign,g.edition;
COMMIT;
