-- Gift links — 011 : ne jamais dégrader un lien déjà diffusé (8 oct. 2026).
--
-- RELEVÉ PAR UNE REVUE ADVERSE. Deux défauts touchaient des liens DÉJÀ entre les mains de lecteurs.
--
-- 1. LE CORPS POUVAIT DISPARAÎTRE. La fonction Edge écrivait le cache par un `upsert` qui remplaçait
--    `body` sans regarder ce qui s'y trouvait. Arc indisponible → le repli public rend un aperçu sans
--    corps → l'article complet déjà diffusé devenait un teaser. Avec `fake_body`, pire : un vrai
--    article devenait un texte de démonstration, toujours annoncé « article complet ».
--
-- 2. L'EXPIRATION POUVAIT RECULER. `create_gift_links` lisait la ligne sans la verrouiller, puis
--    écrivait la date décidée sur cette lecture périmée. Deux appels simultanés sur J+10 : A demande
--    J+30, B demande J+20, les deux lisent J+10, A écrit J+30, B écrase avec J+20. L'invariant « on ne
--    raccourcit jamais » ne tenait que tant que personne n'appelait en même temps.
--
-- CE FICHIER DÉPLACE LA RÈGLE DANS LA BASE. Elle était dans la fonction Edge, qui ne peut pas la tenir :
-- elle ne voit ni ce qui est déjà en cache, ni ce qu'un autre appel est en train d'écrire. Seul
-- PostgreSQL voit les deux.

BEGIN;

-- ── LE CACHE QUI NE DÉGRADE RIEN.
--
-- Remplace l'`upsert` que faisait la fonction Edge. Trois règles, dans l'ordre où elles comptent :
--
-- UN CHAMP VIDE N'EFFACE PAS UN CHAMP PLEIN. Vaut pour le corps comme pour le titre, le chapeau,
-- l'image : un repli public appauvri ne doit pas remplacer ce qu'Arc avait donné.
--
-- UNE DÉMONSTRATION NE REMPLACE JAMAIS UN VRAI CORPS. `fake_body` sert à éprouver une mise en page sur
-- un article qu'on n'a pas. Posé sur un article qu'on A, il transformerait en faux ce que des gens
-- lisent déjà.
--
-- UN LOT NE SE CONTREDIT PAS LUI-MÊME. Deux URLs du même article — avec et sans barre finale — donnaient
-- deux lignes de même clé, et PostgreSQL refusait le lot entier (21000). Le `DISTINCT ON` les réduit à
-- une, la première l'emporte.
CREATE OR REPLACE FUNCTION public.cache_articles(p_articles jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_touches integer;
BEGIN
  CREATE TEMP TABLE entrants ON COMMIT DROP AS
  SELECT DISTINCT ON (a.arc_id) a.*
  FROM jsonb_to_recordset(p_articles) AS a(
    arc_id text, canonical_url text, title text, standfirst text, image_url text,
    body text, section text, author text, published_at timestamptz, is_demo boolean)
  WHERE a.arc_id IS NOT NULL AND btrim(a.arc_id) <> '';

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
  FROM entrants e WHERE a.arc_id = e.arc_id;

  INSERT INTO public.articles (arc_id, canonical_url, title, standfirst, image_url,
                               body, section, author, published_at, fetched_at)
  SELECT e.arc_id, e.canonical_url, e.title, e.standfirst, e.image_url,
         e.body, e.section, e.author, e.published_at, now()
  FROM entrants e
  WHERE NOT EXISTS (SELECT 1 FROM public.articles a WHERE a.arc_id = e.arc_id);

  SELECT count(*)::integer INTO v_touches FROM entrants;
  DROP TABLE entrants;
  RETURN v_touches;
END $$;

REVOKE ALL ON FUNCTION public.cache_articles(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cache_articles(jsonb) TO service_role;

-- ── LA DATE DE FIN NE PEUT PLUS QUE CROÎTRE.
--
-- Le corps vient de la migration 009, la définition courante. Deux changements :
--
-- `FOR UPDATE` sur la lecture : les appels concurrents sur le même article s'attendent au lieu de
-- décider chacun sur une photo périmée.
--
-- `GREATEST` à l'écriture : même si un verrou cédait, la date ne peut pas reculer. La ceinture après les
-- bretelles — un invariant qui ne tient que par l'ordonnancement n'est pas un invariant.
--
-- Et l'INSERT passe par `ON CONFLICT` : deux transactions qui créent le même article en même temps ne
-- se soldent plus par une violation d'unicité, mais par une création et une prolongation.
DROP FUNCTION IF EXISTS public.create_gift_links(text[], timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.create_gift_links(
  p_arc_ids    text[],
  p_expires_at timestamptz DEFAULT NULL,
  p_client_id  uuid        DEFAULT NULL
) RETURNS TABLE (arc_id text, token text, expires_at timestamptz, state text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_expire timestamptz := COALESCE(p_expires_at, now() + interval '15 days');
  v_manquants text;
  v_arc text;
  v_lien public.gift_links%ROWTYPE;
BEGIN
  IF p_arc_ids IS NULL OR cardinality(p_arc_ids) = 0 THEN
    RAISE EXCEPTION 'create_gift_links : aucun article demandé';
  END IF;
  IF v_expire <= now() THEN
    RAISE EXCEPTION 'create_gift_links : expiration déjà passée (%)', v_expire;
  END IF;

  SELECT string_agg(a, ', ') INTO v_manquants
  FROM unnest(p_arc_ids) AS a
  WHERE NOT EXISTS (SELECT 1 FROM public.articles x WHERE x.arc_id = a);
  IF v_manquants IS NOT NULL THEN
    RAISE EXCEPTION 'create_gift_links : article(s) absent(s) du cache : %', v_manquants;
  END IF;

  FOREACH v_arc IN ARRAY (SELECT array_agg(DISTINCT a) FROM unnest(p_arc_ids) AS a) LOOP
    -- LE VERROU. Sans lui, un autre appel peut écrire entre cette lecture et notre écriture.
    SELECT * INTO v_lien FROM public.gift_links g WHERE g.arc_id = v_arc FOR UPDATE;

    IF NOT FOUND THEN
      -- LA COURSE À LA CRÉATION. `FOR UPDATE` ne verrouille pas une ligne qui n'existe pas encore :
      -- deux appels peuvent passer ici en même temps pour le même article. Le second se heurtait à
      -- l'unicité et faisait échouer tout le lot. Il prolonge désormais ce que le premier a créé.
      BEGIN
        INSERT INTO public.gift_links AS g (token, arc_id, expires_at, created_by, updated_by, updated_at)
        VALUES (replace(gen_random_uuid()::text, '-', ''), v_arc, v_expire, p_client_id, p_client_id, now())
        RETURNING g.arc_id, g.token, g.expires_at, 'created'::text
        INTO arc_id, token, expires_at, state;
      EXCEPTION WHEN unique_violation THEN
        UPDATE public.gift_links AS g
           SET expires_at = GREATEST(g.expires_at, v_expire),
               extended_at = CASE WHEN v_expire > g.expires_at THEN now() ELSE g.extended_at END,
               updated_by  = CASE WHEN v_expire > g.expires_at
                                  THEN COALESCE(p_client_id, g.updated_by) ELSE g.updated_by END,
               updated_at  = CASE WHEN v_expire > g.expires_at THEN now() ELSE g.updated_at END
         WHERE g.arc_id = v_arc
        RETURNING g.arc_id, g.token, g.expires_at,
                  CASE WHEN v_expire > g.expires_at THEN 'extended' ELSE 'unchanged' END
        INTO arc_id, token, expires_at, state;
      END;
      RETURN NEXT;

    ELSIF v_lien.withdrawn_at IS NOT NULL THEN
      arc_id := v_arc; token := NULL; expires_at := NULL; state := 'withdrawn';
      RETURN NEXT;

    ELSIF v_lien.expires_at < v_expire THEN
      UPDATE public.gift_links AS g
         SET expires_at = GREATEST(g.expires_at, v_expire), extended_at = now(),
             updated_by = COALESCE(p_client_id, g.updated_by), updated_at = now()
       WHERE g.arc_id = v_arc
      RETURNING g.arc_id, g.token, g.expires_at, 'extended'::text
      INTO arc_id, token, expires_at, state;
      RETURN NEXT;

    ELSE
      arc_id := v_lien.arc_id; token := v_lien.token; expires_at := v_lien.expires_at;
      state := 'unchanged';
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.create_gift_links(text[], timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_gift_links(text[], timestamptz, uuid) TO service_role;

COMMIT;
