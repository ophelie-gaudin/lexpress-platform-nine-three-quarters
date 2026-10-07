-- Gift links — 006 : un jeton par service appelant (7 oct. 2026).
--
-- CE QUI CHANGE. Jusqu'ici, un seul secret partagé (GIFT_SERVICE_TOKEN) ouvrait l'API. On ne pouvait ni
-- savoir qui appelait, ni couper un appelant sans couper tout le monde. Ophélie veut ouvrir l'accès
-- progressivement à d'autres services : il faut donc des jetons nominatifs, révocables un par un.
--
-- LE JETON EN CLAIR N'ARRIVE JAMAIS ICI. La fonction Edge calcule son empreinte SHA-256 et ne transmet
-- que l'empreinte. Quelqu'un qui lirait cette table n'y trouverait rien d'utilisable — c'est la même
-- raison qui fait qu'on ne stocke pas un mot de passe.
--
-- PAS DE PLAFOND POUR L'INSTANT (décision d'Ophélie), mais on COMPTE. Ajouter une limite plus tard ne
-- demandera qu'une colonne et une condition : les chiffres seront déjà là.

BEGIN;

CREATE TABLE IF NOT EXISTS public.api_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom           text NOT NULL UNIQUE CHECK (btrim(nom) <> '' AND length(nom) <= 80),
  token_sha256  text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  actif         boolean NOT NULL DEFAULT true,
  note          text,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  revoque_le    timestamptz,
  derniere_utilisation timestamptz,
  appels        integer NOT NULL DEFAULT 0,
  liens_crees   integer NOT NULL DEFAULT 0,
  CONSTRAINT api_clients_revocation_coherente CHECK ((actif = false) = (revoque_le IS NOT NULL))
);

COMMENT ON TABLE public.api_clients IS
  'Un service appelant = une ligne = un jeton. Révoquer, c''est poser actif = false : la ligne reste, et avec elle ce que ce service a consommé.';
COMMENT ON COLUMN public.api_clients.token_sha256 IS
  'Empreinte SHA-256 du jeton, en hexadécimal minuscule. Le jeton en clair n''existe QUE chez l''appelant : il est montré une fois à la création, jamais retrouvable ensuite.';

CREATE INDEX IF NOT EXISTS api_clients_actifs ON public.api_clients (token_sha256) WHERE actif;

-- ── LA VÉRIFICATION. Appelée par la fonction Edge à chaque requête.
--
-- ELLE NE DIT PAS POURQUOI ELLE REFUSE À L'APPELANT : la fonction Edge rend un 401 nu. Le motif est rendu
-- ici pour les journaux, pas pour la réponse HTTP — distinguer « jeton inconnu » de « jeton révoqué »
-- renseignerait qui cherche à deviner.
CREATE OR REPLACE FUNCTION public.verifier_client_api(p_token_sha256 text)
RETURNS TABLE (client_id uuid, nom text, ok boolean, motif text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v public.api_clients%ROWTYPE;
BEGIN
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, false, 'empreinte mal formée'; RETURN;
  END IF;

  SELECT * INTO v FROM public.api_clients WHERE token_sha256 = p_token_sha256;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, false, 'jeton inconnu'; RETURN;
  END IF;
  IF NOT v.actif THEN
    RETURN QUERY SELECT v.id, v.nom, false, 'jeton révoqué'; RETURN;
  END IF;

  UPDATE public.api_clients
     SET appels = appels + 1, derniere_utilisation = now()
   WHERE id = v.id;

  RETURN QUERY SELECT v.id, v.nom, true, NULL::text;
END $$;

-- ── CE QU'UN APPEL A PRODUIT. Séparé de la vérification : on ne sait qu'à la fin combien de liens ont
-- été créés, et un appel qui échoue en chemin ne doit pas compter de liens qu'il n'a pas faits.
CREATE OR REPLACE FUNCTION public.compter_liens_client(p_client_id uuid, p_liens integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.api_clients
     SET liens_crees = liens_crees + GREATEST(COALESCE(p_liens, 0), 0)
   WHERE id = p_client_id;
$$;

-- ── CRÉER UN CLIENT. Prend l'EMPREINTE, jamais le jeton : même le geste d'administration ne fait pas
-- transiter le secret par la base.
CREATE OR REPLACE FUNCTION public.creer_client_api(p_nom text, p_token_sha256 text, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.api_clients (nom, token_sha256, note)
  VALUES (btrim(p_nom), lower(btrim(p_token_sha256)), p_note)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ── RÉVOQUER. La ligne reste : on ne perd pas la trace de ce que ce service a créé.
CREATE OR REPLACE FUNCTION public.revoquer_client_api(p_nom text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_fait boolean;
BEGIN
  UPDATE public.api_clients SET actif = false, revoque_le = now()
   WHERE nom = btrim(p_nom) AND actif
   RETURNING true INTO v_fait;
  RETURN COALESCE(v_fait, false);
END $$;

-- ── LES DROITS. Tout est fermé ; seul le rôle de service, celui de la fonction Edge, peut appeler.
ALTER TABLE public.api_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_clients FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verifier_client_api(text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compter_liens_client(uuid, integer)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creer_client_api(text, text, text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoquer_client_api(text)            FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_client_api(text)           TO service_role;
GRANT EXECUTE ON FUNCTION public.compter_liens_client(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.creer_client_api(text, text, text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoquer_client_api(text)           TO service_role;

COMMIT;
