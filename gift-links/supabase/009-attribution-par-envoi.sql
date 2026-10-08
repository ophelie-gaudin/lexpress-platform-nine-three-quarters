-- Gift links — 009 : l'attribution appartient à l'envoi, pas au lien (8 oct. 2026).
--
-- CE QU'ON RETIRE ET POURQUOI. `gift_links.channel` et `gift_links.campaign` datent de la migration 001,
-- quand on croyait fabriquer un lien par destinataire. La migration 003 a imposé UN lien par article,
-- commun à tous. Les colonnes sont restées ; l'hypothèse qui les justifiait a disparu.
--
-- ELLES ATTRIBUAIENT FAUX, EN SILENCE. Chaque appel les écrasait — dernier appelant gagne. Un article
-- offert en `prospects_chauds` lundi puis en `prospects_abandon` jeudi voyait TOUTES ses conversions,
-- y compris celles de lundi, attribuées à `prospects_abandon`.
--
-- LA PAGE AVAIT DÉJÀ LA BONNE VALEUR. Elle lit `at_campaign_group` dans la query string du visiteur,
-- l'envoie ici pour journaliser la lecture… puis construisait le bouton d'abonnement avec `campaign`
-- relu de la base. La valeur faisait un aller-retour pour revenir en moins bon. Depuis la migration 005,
-- la campagne est connue de l'ENVOI, et l'envoi la met dans l'URL.
--
-- ET LE REPLI CONTREDISAIT LA RÈGLE DE LA PAGE : « ne rien inventer quand un paramètre manque, une
-- absence est une information ». Attribuer faux est pire que ne pas attribuer.
--
-- CE QU'ON NE FAIT PAS ENCORE. Les colonnes ne sont PAS supprimées. Une colonne qu'on ne lit plus ne
-- nuit pas ; un DROP COLUMN ne se reprend pas. Elles partiront dans une migration ultérieure, après un
-- temps d'observation. Ce fichier coupe les lectures, pas la donnée.
--
-- ORDRE D'APPLICATION — IMPORTANT. La page Lovable doit être publiée AVANT ce fichier : elle doit
-- construire son bouton avec le paramètre d'URL, pas avec le champ rendu. Appliqué trop tôt, elle lit
-- un champ disparu. Et la fonction Edge doit être déployée DANS LA MÊME FENÊTRE que ce fichier : une
-- version qui envoie encore `p_campaign` à une fonction qui ne l'accepte plus ne trouve plus la
-- fonction du tout.

BEGIN;

-- ── 1. LA LECTURE. `campaign` quitte la sortie ; tout le reste est inchangé.
--
-- ON REPART DE LA DÉFINITION COURANTE, celle de 005 : elle porte l'assainissement de `?s=` et du groupe
-- de campagne, et la signature de l'auteur venue de 002. Repartir de 001 ou 002 effacerait l'un ou
-- l'autre — erreur déjà commise deux fois sur ce service, et rattrapée par les tests.
--
-- UN DROP EMPORTE LES DROITS : les GRANT sont refaits plus bas. Sans eux, `anon` perd l'accès et la page
-- affiche son erreur de chargement à tout le monde.
DROP FUNCTION IF EXISTS public.get_gift_article(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.get_gift_article(
  p_token          text,
  p_utm_source     text DEFAULT NULL,   -- at_medium
  p_utm_campaign   text DEFAULT NULL,   -- at_campaign
  p_referrer       text DEFAULT NULL,
  p_send_id        text DEFAULT NULL,   -- ?s=… , l'identifiant d'envoi
  p_campaign_group text DEFAULT NULL    -- at_campaign_group, journalisé ici, lu dans l'URL par la page
) RETURNS TABLE (
  status        text,
  canonical_url text,
  title         text,
  standfirst    text,
  image_url     text,
  body          text,
  section       text,
  author        text,
  published_at  timestamptz
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
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO v_link FROM public.gift_links WHERE gift_links.token = p_token;

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
   WHERE gift_links.token = p_token;

  RETURN QUERY
  SELECT CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN 'preview' ELSE 'ok' END,
         a.canonical_url, a.title, a.standfirst, a.image_url,
         CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN NULL ELSE a.body END,
         a.section, a.author, a.published_at
  FROM public.articles a WHERE a.arc_id = v_link.arc_id;
END $$;

REVOKE ALL ON FUNCTION public.get_gift_article(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gift_article(text, text, text, text, text, text) TO anon, authenticated, service_role;

-- ── 2. LA CRÉATION. `p_channel` et `p_campaign` disparaissent.
--
-- `channel` n'était lu NULLE PART — ni fonction, ni page, ni workflow. Une colonne écrite et jamais
-- relue est une promesse qu'on ne tient pas.
--
-- Le corps vient de la migration 008, la définition courante : noms anglais, attribution par service.
DROP FUNCTION IF EXISTS public.create_gift_links(text[], text, text, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.create_gift_links(
  p_arc_ids    text[],
  p_expires_at timestamptz DEFAULT NULL,
  p_client_id  uuid        DEFAULT NULL   -- le service qui demande ; NULL = appelant sans jeton nommé
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

  -- Un article inconnu du cache est un REFUS EXPLICITE, jamais un lien silencieusement absent de la
  -- réponse : l'appelant croirait avoir trois liens et n'en enverrait que deux.
  SELECT string_agg(a, ', ') INTO v_manquants
  FROM unnest(p_arc_ids) AS a
  WHERE NOT EXISTS (SELECT 1 FROM public.articles x WHERE x.arc_id = a);
  IF v_manquants IS NOT NULL THEN
    RAISE EXCEPTION 'create_gift_links : article(s) absent(s) du cache : %', v_manquants;
  END IF;

  FOREACH v_arc IN ARRAY (SELECT array_agg(DISTINCT a) FROM unnest(p_arc_ids) AS a) LOOP
    SELECT * INTO v_lien FROM public.gift_links g WHERE g.arc_id = v_arc;

    IF NOT FOUND THEN
      INSERT INTO public.gift_links AS g (token, arc_id, expires_at, created_by, updated_by, updated_at)
      VALUES (replace(gen_random_uuid()::text, '-', ''), v_arc, v_expire, p_client_id, p_client_id, now())
      RETURNING g.arc_id, g.token, g.expires_at, 'created'::text
      INTO arc_id, token, expires_at, state;
      RETURN NEXT;

    ELSIF v_lien.withdrawn_at IS NOT NULL THEN
      arc_id := v_arc; token := NULL; expires_at := NULL; state := 'withdrawn';
      RETURN NEXT;

    ELSIF v_lien.expires_at < v_expire THEN
      UPDATE public.gift_links AS g
         SET expires_at = v_expire, extended_at = now(),
             updated_by = COALESCE(p_client_id, g.updated_by), updated_at = now()
       WHERE g.arc_id = v_arc
      RETURNING g.arc_id, g.token, g.expires_at, 'extended'::text
      INTO arc_id, token, expires_at, state;
      RETURN NEXT;

    ELSE
      -- Déjà valable plus longtemps que demandé : on ne raccourcit pas, et PLUS RIEN n'est écrit.
      -- Avant ce fichier, cette branche écrasait quand même `channel` et `campaign` — un appel qui ne
      -- changeait rien changeait pourtant l'attribution de tout le monde.
      arc_id := v_lien.arc_id; token := v_lien.token; expires_at := v_lien.expires_at;
      state := 'unchanged';
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.create_gift_links(text[], timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_gift_links(text[], timestamptz, uuid) TO service_role;

-- ── 3. LA VUE. Elle ne nommait pas ces colonnes ; elle est recréée pour suivre la fonction, pas pour
-- changer. On en profite pour y faire remonter l'attribution JUSTE : celle des lectures.
CREATE OR REPLACE VIEW public.gift_links_by_client AS
  SELECT g.token, g.arc_id, a.title,
         cre.name AS created_by, g.created_at,
         upd.name AS updated_by, g.updated_at, g.extended_at,
         g.expires_at, g.withdrawn_at, g.opens
    FROM public.gift_links g
    LEFT JOIN public.articles a      ON a.arc_id = g.arc_id
    LEFT JOIN public.api_clients cre ON cre.id = g.created_by
    LEFT JOIN public.api_clients upd ON upd.id = g.updated_by;

REVOKE ALL ON public.gift_links_by_client FROM PUBLIC, anon, authenticated;

-- LA CAMPAGNE SE LIT ICI DÉSORMAIS : une ligne par lecture, chacune avec le segment que CE visiteur
-- portait. C'est la réponse à « combien de conversions pour prospects_chauds », et elle est juste.
CREATE OR REPLACE VIEW public.gift_link_reads_by_campaign AS
  SELECT o.campaign_group, o.utm_source, o.utm_campaign,
         count(*)::int                       AS reads,
         count(DISTINCT o.send_id)::int      AS sends,
         count(DISTINCT o.token)::int        AS articles,
         min(o.opened_at)                    AS first_read,
         max(o.opened_at)                    AS last_read
    FROM public.gift_link_opens o
   GROUP BY o.campaign_group, o.utm_source, o.utm_campaign;

REVOKE ALL ON public.gift_link_reads_by_campaign FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.gift_links.channel IS
  'OBSOLÈTE depuis le 8 oct. 2026, plus écrite ni lue. Jamais relue de toute sa vie. Supprimée dans une migration ultérieure.';
COMMENT ON COLUMN public.gift_links.campaign IS
  'OBSOLÈTE depuis le 8 oct. 2026, plus écrite ni lue. L''attribution vit dans gift_link_opens.campaign_group, une ligne par lecture. Supprimée dans une migration ultérieure.';

COMMIT;
