-- Langue d'édition d'origine du contenu, indépendante de la durée et du jeton d'un lien offert.
-- Additif : les RPC historiques et les tokens existants restent utilisables.
-- Rejouable, y compris après le retour arrière : la langue se retrouve par l'hôte canonique.
BEGIN;
-- Ne pas faire attendre les lectures derrière un verrou : échouer vite, puis rejouer.
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS language text;

-- Une seule règle, partagée par le remplissage, le défaut et la contrainte :
-- pl.lexpress.eu = pl, fr.lexpress.eu = fr, reste de l'édition Europe = en, France = fr.
CREATE OR REPLACE FUNCTION public.article_language(p_edition text, p_canonical_url text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $language$
 SELECT CASE
  WHEN p_edition = 'EUR' AND p_canonical_url ~* '^https://pl\.lexpress\.eu([/?#]|$)' THEN 'pl'
  WHEN p_edition = 'EUR' AND p_canonical_url ~* '^https://fr\.lexpress\.eu([/?#]|$)' THEN 'fr'
  WHEN p_edition = 'EUR' THEN 'en'
  ELSE 'fr'
 END
$language$;
-- Fonction pure, sans lecture de données : exécutable par tous. La contrainte ci-dessous l'évalue
-- avec les droits du rôle qui écrit ; la restreindre casserait une purge ou une correction manuelle.
GRANT EXECUTE ON FUNCTION public.article_language(text,text) TO PUBLIC;

UPDATE public.articles SET language = public.article_language(edition, canonical_url)
 WHERE language IS DISTINCT FROM public.article_language(edition, canonical_url);
ALTER TABLE public.articles ALTER COLUMN language SET NOT NULL;
-- La langue reste liée à l'adresse canonique : l'une ne change pas sans l'autre.
ALTER TABLE public.articles DROP CONSTRAINT IF EXISTS articles_language_check;
ALTER TABLE public.articles ADD CONSTRAINT articles_language_check
 CHECK (language = public.article_language(edition, canonical_url));

-- PostgreSQL ne permet pas un DEFAULT dépendant d'une autre colonne : le trigger fournit
-- le défaut aux anciens appelants, à l'insertion seulement. Effacer une langue reste une erreur.
CREATE OR REPLACE FUNCTION public.default_article_language() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $default$
BEGIN
 IF NEW.language IS NULL THEN NEW.language := public.article_language(NEW.edition, NEW.canonical_url); END IF;
 RETURN NEW;
END $default$;
REVOKE ALL ON FUNCTION public.default_article_language() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS article_language_default ON public.articles;
CREATE TRIGGER article_language_default BEFORE INSERT ON public.articles
FOR EACH ROW EXECUTE FUNCTION public.default_article_language();

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
    arc_id text, edition text, language text, canonical_url text, title text, standfirst text, image_url text,
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

  -- La langue d'origine d'un article existant ne change pas : un identifiant Arc appartient à un seul
  -- site. Un ancien appelant sans langue est jugé sur l'hôte de l'adresse canonique qu'il apporte.
  IF EXISTS (
    SELECT 1 FROM entrants e JOIN public.articles a ON a.edition = e.edition AND a.arc_id = e.arc_id
    WHERE COALESCE(e.language, public.article_language(e.edition,
            COALESCE(NULLIF(btrim(e.canonical_url), ''), a.canonical_url))) <> a.language
  ) THEN
    RAISE EXCEPTION 'cache_articles : la langue d''un article existant ne change pas';
  END IF;

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

  INSERT INTO public.articles (edition, arc_id, language, canonical_url, title, standfirst, image_url,
                               body, section, author, published_at, fetched_at)
  SELECT e.edition, e.arc_id, e.language, e.canonical_url, e.title, e.standfirst, e.image_url,
         e.body, e.section, e.author, e.published_at, now()
  FROM entrants e
  WHERE NOT EXISTS (SELECT 1 FROM public.articles a WHERE a.edition = e.edition AND a.arc_id = e.arc_id);

  SELECT count(*)::integer INTO v_touches FROM entrants;
  DROP TABLE entrants;
  RETURN v_touches;
END $function$
;

-- Nouveau contrat de lecture. L'ancien reste inchangé pour un rollback sans rupture.
CREATE OR REPLACE FUNCTION public.get_gift_article_for_edition_v2(
 p_edition text, p_token text, p_utm_source text DEFAULT NULL,
 p_utm_campaign text DEFAULT NULL, p_referrer text DEFAULT NULL,
 p_send_id text DEFAULT NULL, p_campaign_group text DEFAULT NULL)
RETURNS TABLE(status text, canonical_url text, title text, standfirst text,
 image_url text, body text, section text, author text, published_at timestamptz, language text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $v2$
 WITH response AS MATERIALIZED (
  SELECT * FROM public.get_gift_article_for_edition(p_edition,p_token,p_utm_source,p_utm_campaign,p_referrer,p_send_id,p_campaign_group)
 )
 SELECT r.*, CASE WHEN r.status IN ('ok','preview') THEN a.language ELSE NULL END
 FROM response r
 LEFT JOIN public.gift_links g ON g.edition=p_edition AND g.token=p_token
 LEFT JOIN public.articles a ON a.edition=g.edition AND a.arc_id=g.arc_id;
$v2$;
REVOKE ALL ON FUNCTION public.get_gift_article_for_edition_v2(text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gift_article_for_edition_v2(text,text,text,text,text,text,text) TO anon,authenticated,service_role;
COMMIT;
