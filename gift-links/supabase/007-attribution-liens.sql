-- Gift links — 007 : qui a créé ce lien, et qui l'a prolongé (7 oct. 2026).
--
-- POURQUOI. La migration 006 compte ce que chaque service consomme, mais pas CE QU'IL A FAIT : on savait
-- qu'un jeton avait créé trois liens, sans savoir lesquels. Demande d'Ophélie : pouvoir relier chaque
-- lien au service qui l'a fabriqué, et savoir lequel en a repoussé la date de fin.
--
-- DEUX COLONNES, PAS UN JOURNAL. `cree_par` ne change jamais ; `maj_par` suit la dernière MODIFICATION
-- réelle. Un journal de chaque passage viendra si le besoin s'en fait sentir — ces deux colonnes
-- répondent à la question posée sans alourdir la table la plus lue du service.
--
-- « INCHANGÉ » N'EST PAS UNE MODIFICATION. Redemander un lien déjà valable plus longtemps ne touche pas
-- `maj_par` : sinon « dernier à avoir modifié » finirait par vouloir dire « dernier à avoir demandé »,
-- et la colonne ne répondrait plus à la question qu'on lui pose.

BEGIN;

ALTER TABLE public.gift_links
  ADD COLUMN IF NOT EXISTS cree_par uuid REFERENCES public.api_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS maj_par  uuid REFERENCES public.api_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS maj_le   timestamptz;

COMMENT ON COLUMN public.gift_links.cree_par IS
  'Service qui a fabriqué ce lien. NULL = créé avant le 7 oct. 2026, ou par l''appelant d''héritage — une absence honnête, pas une attribution devinée.';
COMMENT ON COLUMN public.gift_links.maj_par IS
  'Dernier service à avoir MODIFIÉ ce lien, c''est-à-dire à en avoir repoussé la date de fin. Redemander sans rien changer ne compte pas.';

CREATE INDEX IF NOT EXISTS gift_links_cree_par ON public.gift_links (cree_par) WHERE cree_par IS NOT NULL;

-- ON SUPPRIME AVANT DE CRÉER : ajouter un paramètre change la signature, et CREATE OR REPLACE ne peut
-- pas la changer — il créerait une SECONDE fonction, et PostgreSQL aurait deux candidates.
-- Le corps vient de la migration 003, la définition COURANTE : repartir de 001 perdrait la règle
-- « un lien par article » et le refus de ressusciter un lien retiré.
DROP FUNCTION IF EXISTS public.create_gift_links(text[], text, text, timestamptz);

CREATE FUNCTION public.create_gift_links(
  p_arc_ids    text[],
  p_channel    text        DEFAULT NULL,
  p_campaign   text        DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_client_id  uuid        DEFAULT NULL   -- le service qui demande ; NULL = appelant d'héritage
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
      INSERT INTO public.gift_links AS g (token, arc_id, channel, campaign, expires_at,
                                          cree_par, maj_par, maj_le)
      VALUES (replace(gen_random_uuid()::text, '-', ''), v_arc, p_channel, p_campaign, v_expire,
              p_client_id, p_client_id, now())
      RETURNING g.arc_id, g.token, g.expires_at, 'created'::text
      INTO arc_id, token, expires_at, state;
      RETURN NEXT;

    ELSIF v_lien.withdrawn_at IS NOT NULL THEN
      arc_id := v_arc; token := NULL; expires_at := NULL; state := 'withdrawn';
      RETURN NEXT;

    ELSIF v_lien.expires_at < v_expire THEN
      UPDATE public.gift_links AS g
         SET expires_at = v_expire, extended_at = now(),
             channel = COALESCE(p_channel, g.channel), campaign = COALESCE(p_campaign, g.campaign),
             maj_par = COALESCE(p_client_id, g.maj_par), maj_le = now()
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

-- UN DROP EMPORTE LES DROITS : sans ces deux lignes, la fonction Edge perdrait l'accès et le service
-- entier s'arrêterait de fabriquer des liens.
REVOKE ALL ON FUNCTION public.create_gift_links(text[], text, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_gift_links(text[], text, text, timestamptz, uuid) TO service_role;

-- ── LA VUE QUI RÉPOND À LA QUESTION, sans jointure à réécrire à chaque fois.
CREATE OR REPLACE VIEW public.liens_par_service AS
  SELECT g.token, g.arc_id, a.title AS titre,
         cre.nom AS cree_par, g.created_at,
         maj.nom AS dernier_intervenant, g.maj_le, g.extended_at,
         g.expires_at, g.withdrawn_at, g.opens
    FROM public.gift_links g
    LEFT JOIN public.articles a   ON a.arc_id = g.arc_id
    LEFT JOIN public.api_clients cre ON cre.id = g.cree_par
    LEFT JOIN public.api_clients maj ON maj.id = g.maj_par;

REVOKE ALL ON public.liens_par_service FROM PUBLIC, anon, authenticated;

COMMIT;
