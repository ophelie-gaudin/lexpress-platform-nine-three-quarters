-- Gift links — 003 : UN lien par article, prolongé plutôt que recréé (1er oct. 2026).
--
-- CE QUI CHANGE. Jusqu'ici, chaque appel fabriquait un nouveau token : neuf liens pour quatre articles
-- après une demi-journée d'essais. Désormais le token est STABLE par article. Redemander un article
-- déjà connu rend le MÊME lien, et repousse seulement sa date de fin si la demande va plus loin.
--
-- Conséquence voulue : un lien déjà diffusé reste valable. Si on le recréait, la personne qui l'a reçu
-- hier se retrouverait avec un lien mort pendant qu'un autre circule.
--
-- ON NE RACCOURCIT JAMAIS. Demander 10 jours sur un lien valable encore 20 jours ne le ramène pas à 10 :
-- quelqu'un l'a peut-être déjà reçu avec la promesse des 20. C'est le seul cas où l'état vaut
-- « unchanged » : redemander la même durée repousse réellement la fin, puisqu'elle court à partir de
-- maintenant, et l'état vaut alors « extended ».
--
-- UN LIEN RETIRÉ N'EST PAS RESSUSCITÉ. withdrawn_at est une décision éditoriale — article corrigé,
-- dépublié, retiré sur demande. Un appel d'API ne la défait pas en silence : l'article est rendu dans
-- les refus, avec son motif. Pour le rouvrir, il faut effacer withdrawn_at à la main, délibérément.

BEGIN;

-- ── MÉNAGE AVANT CONTRAINTE. On garde, par article, le lien le plus consulté ; à égalité, le plus ancien.
-- Le plus consulté d'abord, parce que c'est celui qui a le plus de chances d'avoir été diffusé.
WITH classement AS (
  SELECT g.token,
         row_number() OVER (
           PARTITION BY g.arc_id
           ORDER BY (SELECT count(*) FROM public.gift_link_opens o WHERE o.token = g.token) DESC,
                    g.created_at ASC
         ) AS rang
  FROM public.gift_links g
)
DELETE FROM public.gift_links WHERE token IN (SELECT token FROM classement WHERE rang > 1);

ALTER TABLE public.gift_links
  DROP CONSTRAINT IF EXISTS gift_links_arc_id_unique,
  ADD  CONSTRAINT gift_links_arc_id_unique UNIQUE (arc_id);

DROP INDEX IF EXISTS gift_links_arc_id;   -- l'unicité porte déjà son index

DROP FUNCTION IF EXISTS public.create_gift_links(text[], text, text, timestamptz);

CREATE FUNCTION public.create_gift_links(
  p_arc_ids    text[],
  p_channel    text        DEFAULT NULL,
  p_campaign   text        DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
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
      INSERT INTO public.gift_links AS g (token, arc_id, channel, campaign, expires_at)
      VALUES (replace(gen_random_uuid()::text, '-', ''), v_arc, p_channel, p_campaign, v_expire)
      RETURNING g.arc_id, g.token, g.expires_at, 'created'::text
      INTO arc_id, token, expires_at, state;
      RETURN NEXT;

    ELSIF v_lien.withdrawn_at IS NOT NULL THEN
      arc_id := v_arc; token := NULL; expires_at := NULL; state := 'withdrawn';
      RETURN NEXT;

    ELSIF v_lien.expires_at < v_expire THEN
      UPDATE public.gift_links AS g
         SET expires_at = v_expire, extended_at = now(),
             channel = COALESCE(p_channel, g.channel), campaign = COALESCE(p_campaign, g.campaign)
       WHERE g.arc_id = v_arc
      RETURNING g.arc_id, g.token, g.expires_at, 'extended'::text
      INTO arc_id, token, expires_at, state;
      RETURN NEXT;

    ELSE
      -- Déjà valable plus longtemps que demandé : on ne raccourcit pas.
      UPDATE public.gift_links AS g
         SET channel = COALESCE(p_channel, g.channel), campaign = COALESCE(p_campaign, g.campaign)
       WHERE g.arc_id = v_arc
      RETURNING g.arc_id, g.token, g.expires_at, 'unchanged'::text
      INTO arc_id, token, expires_at, state;
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.create_gift_links(text[], text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_gift_links(text[], text, text, timestamptz) TO service_role;

COMMIT;
