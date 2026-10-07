-- Gift links — 008 : tout le schéma en anglais (7 oct. 2026).
--
-- POURQUOI. Les migrations 001 à 005 nomment tout en anglais : `created_at`, `expires_at`,
-- `withdrawn_at`, `canonical_url`. Les migrations 006 et 007, écrites le même jour, ont introduit du
-- français : `nom`, `actif`, `cree_par`, `liens_par_service`. Demande d'Ophélie : attributs, valeurs et
-- noms de tables entièrement en anglais. Un service extérieur qui lit ce schéma ne doit pas avoir à
-- deviner deux langues.
--
-- ON RENOMME, ON NE RECONSTRUIT PAS. `ALTER ... RENAME` garde les données, les index, les clés
-- étrangères et les droits. Recréer les tables perdrait l'attribution déjà collectée aujourd'hui.
--
-- CHAQUE RENOMMAGE EST GARDÉ. `RENAME COLUMN` n'accepte pas `IF EXISTS` : sans garde, rejouer ce
-- fichier échouerait, et le rejouer est exactement ce que font les tests sur une base neuve.

BEGIN;

-- ── 1. LES COLONNES DE `api_clients`.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('nom', 'name'),
      ('actif', 'active'),
      ('cree_le', 'created_at'),
      ('revoque_le', 'revoked_at'),
      ('derniere_utilisation', 'last_used_at'),
      ('appels', 'calls'),
      ('liens_crees', 'links_created')
    ) AS t(ancien, nouveau)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'api_clients'
                  AND column_name = r.ancien) THEN
      EXECUTE format('ALTER TABLE public.api_clients RENAME COLUMN %I TO %I', r.ancien, r.nouveau);
    END IF;
  END LOOP;
END $$;

-- ── 2. LES CONTRAINTES ET LES INDEX. Leur DÉFINITION suit le renommage des colonnes, mais pas leur NOM.
-- Et un nom de contrainte n'est pas interne : il remonte dans le message d'erreur rendu à l'appelant.
--
-- LES NOT NULL SONT NOMMÉES DEPUIS POSTGRESQL 17 (`api_clients_nom_not_null`). Sur une version
-- antérieure elles n'existent pas sous ce nom : la garde les ignore au lieu d'échouer.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('api_clients', 'api_clients_nom_check',            'api_clients_name_check'),
      ('api_clients', 'api_clients_nom_key',              'api_clients_name_key'),
      ('api_clients', 'api_clients_revocation_coherente', 'api_clients_revocation_consistent'),
      ('api_clients', 'api_clients_nom_not_null',         'api_clients_name_not_null'),
      ('api_clients', 'api_clients_actif_not_null',       'api_clients_active_not_null'),
      ('api_clients', 'api_clients_cree_le_not_null',     'api_clients_created_at_not_null'),
      ('api_clients', 'api_clients_appels_not_null',      'api_clients_calls_not_null'),
      ('api_clients', 'api_clients_liens_crees_not_null', 'api_clients_links_created_not_null'),
      ('gift_links',  'gift_links_cree_par_fkey',         'gift_links_created_by_fkey'),
      ('gift_links',  'gift_links_maj_par_fkey',          'gift_links_updated_by_fkey')
    ) AS t(relation, ancien, nouveau)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = ('public.' || r.relation)::regclass AND conname = r.ancien) THEN
      EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', r.relation, r.ancien, r.nouveau);
    END IF;
  END LOOP;
END $$;

ALTER INDEX IF EXISTS public.api_clients_actifs RENAME TO api_clients_active;

COMMENT ON TABLE public.api_clients IS
  'Un service appelant = une ligne = un jeton. Révoquer, c''est poser active = false : la ligne reste, et avec elle ce que ce service a consommé.';

-- ── 3. LES COLONNES D'ATTRIBUTION DE `gift_links`.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('cree_par', 'created_by'),
      ('maj_par', 'updated_by'),
      ('maj_le', 'updated_at')
    ) AS t(ancien, nouveau)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'gift_links'
                  AND column_name = r.ancien) THEN
      EXECUTE format('ALTER TABLE public.gift_links RENAME COLUMN %I TO %I', r.ancien, r.nouveau);
    END IF;
  END LOOP;
END $$;

ALTER INDEX IF EXISTS public.gift_links_cree_par RENAME TO gift_links_created_by;

COMMENT ON COLUMN public.gift_links.created_by IS
  'Service qui a fabriqué ce lien. NULL = créé avant le 7 oct. 2026, ou par l''appelant d''héritage — une absence honnête, pas une attribution devinée.';
COMMENT ON COLUMN public.gift_links.updated_by IS
  'Dernier service à avoir MODIFIÉ ce lien, c''est-à-dire à en avoir repoussé la date de fin. Redemander sans rien changer ne compte pas.';
COMMENT ON COLUMN public.gift_links.updated_at IS
  'Date de cette dernière modification réelle. NULL tant que personne n''a repoussé la date de fin.';

-- ── 4. LES FONCTIONS. On SUPPRIME puis on CRÉE : un nom de fonction se renomme, mais pas les noms de
-- ses colonnes de sortie ni de ses paramètres, et la fonction Edge lit ces noms (`.name`, `.reason`).
-- UN DROP EMPORTE LES DROITS : les GRANT du bas ne sont pas décoratifs.
--
-- ET ON RECRÉE EN `OR REPLACE` : ce fichier doit pouvoir se rejouer, c'est ce que font les tests sur
-- une base neuve puis déjà migrée. Un `CREATE` nu échouerait au second passage.
DROP FUNCTION IF EXISTS public.verifier_client_api(text);
DROP FUNCTION IF EXISTS public.compter_liens_client(uuid, integer);
DROP FUNCTION IF EXISTS public.creer_client_api(text, text, text);
DROP FUNCTION IF EXISTS public.revoquer_client_api(text);

-- LA VÉRIFICATION. Appelée par la fonction Edge à chaque requête.
--
-- ELLE NE DIT PAS POURQUOI ELLE REFUSE À L'APPELANT : la fonction Edge rend un 401 nu. Le motif est rendu
-- ici pour les journaux, pas pour la réponse HTTP — distinguer « jeton inconnu » de « jeton révoqué »
-- renseignerait qui cherche à deviner.
CREATE OR REPLACE FUNCTION public.verify_api_client(p_token_sha256 text)
RETURNS TABLE (client_id uuid, name text, ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v public.api_clients%ROWTYPE;
BEGIN
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, false, 'malformed digest'; RETURN;
  END IF;

  SELECT * INTO v FROM public.api_clients c WHERE c.token_sha256 = p_token_sha256;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, false, 'unknown token'; RETURN;
  END IF;
  IF NOT v.active THEN
    RETURN QUERY SELECT v.id, v.name, false, 'revoked token'; RETURN;
  END IF;

  UPDATE public.api_clients c
     SET calls = c.calls + 1, last_used_at = now()
   WHERE c.id = v.id;

  RETURN QUERY SELECT v.id, v.name, true, NULL::text;
END $$;

-- CE QU'UN APPEL A PRODUIT. Séparé de la vérification : on ne sait qu'à la fin combien de liens ont été
-- créés, et un appel qui échoue en chemin ne doit pas compter de liens qu'il n'a pas faits.
CREATE OR REPLACE FUNCTION public.count_client_links(p_client_id uuid, p_links integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.api_clients
     SET links_created = links_created + GREATEST(COALESCE(p_links, 0), 0)
   WHERE id = p_client_id;
$$;

-- CRÉER UN CLIENT. Prend l'EMPREINTE, jamais le jeton : même le geste d'administration ne fait pas
-- transiter le secret par la base.
CREATE OR REPLACE FUNCTION public.create_api_client(p_name text, p_token_sha256 text, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.api_clients (name, token_sha256, note)
  VALUES (btrim(p_name), lower(btrim(p_token_sha256)), p_note)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- RÉVOQUER. La ligne reste : on ne perd pas la trace de ce que ce service a créé.
CREATE OR REPLACE FUNCTION public.revoke_api_client(p_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_done boolean;
BEGIN
  UPDATE public.api_clients c SET active = false, revoked_at = now()
   WHERE c.name = btrim(p_name) AND c.active
   RETURNING true INTO v_done;
  RETURN COALESCE(v_done, false);
END $$;

REVOKE ALL ON FUNCTION public.verify_api_client(text)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_client_links(uuid, integer)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_api_client(text, text, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_api_client(text)              FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_api_client(text)             TO service_role;
GRANT EXECUTE ON FUNCTION public.count_client_links(uuid, integer)   TO service_role;
GRANT EXECUTE ON FUNCTION public.create_api_client(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_api_client(text)             TO service_role;

-- ── 5. `create_gift_links` RÉÉCRITE SUR LES NOUVEAUX NOMS. Signature inchangée, donc CREATE OR REPLACE
-- suffit et les droits survivent. Le corps vient de la migration 007, la définition COURANTE : il
-- référence les colonnes renommées, et un plpgsql ne résout ses noms qu'à l'exécution — sans cette
-- réécriture, le service continuerait de se lancer puis échouerait au premier lien.
CREATE OR REPLACE FUNCTION public.create_gift_links(
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
                                          created_by, updated_by, updated_at)
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
             updated_by = COALESCE(p_client_id, g.updated_by), updated_at = now()
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

-- ── 6. LA VUE. Renommée et ses colonnes avec : `titre` et `dernier_intervenant` étaient les deux
-- derniers mots français que lisait un appelant.
DROP VIEW IF EXISTS public.liens_par_service;

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

COMMIT;
