-- Gift links — lot 1 : schéma et fonctions de la base dédiée (1er oct. 2026).
--
-- BASE SÉPARÉE de celle de l'agent WhatsApp. Cette base-ci doit être lisible par `anon` depuis une page
-- publique ; l'autre l'interdit délibérément. Nommage en anglais (décision d'Ophélie).
--
-- CE QUE `anon` PEUT FAIRE : appeler get_gift_article(token). Rien d'autre. Surtout pas lire `articles`
-- directement — sinon le token ne protège plus rien, il suffirait d'énumérer la table.

BEGIN;

-- ── LE CACHE DE CONTENU. Une ligne par article, remplie par le service au moment où on crée le lien.
CREATE TABLE IF NOT EXISTS public.articles (
  arc_id        text PRIMARY KEY,
  canonical_url text        NOT NULL,
  title         text        NOT NULL,
  standfirst    text,
  image_url     text,
  body          text,                     -- NULL tant que les accès Arc manquent : la page sert l'aperçu
  section       text,
  published_at  timestamptz,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.articles.body IS
  'Corps de l''article. NULL = aperçu seul (titre, chapeau, image) : la page Lovable le gère comme un état à part entière, pas comme une erreur.';

-- ── LES LIENS. Un lien par article (décision d'Ophélie), partageable par construction.
CREATE TABLE IF NOT EXISTS public.gift_links (
  token          text PRIMARY KEY,
  arc_id         text        NOT NULL REFERENCES public.articles(arc_id) ON DELETE RESTRICT,
  channel        text,
  campaign       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  extended_at    timestamptz,
  withdrawn_at   timestamptz,
  opens          integer     NOT NULL DEFAULT 0,
  last_opened_at timestamptz,
  CONSTRAINT gift_links_token_opaque CHECK (token ~ '^[0-9a-f]{32}$')
);

-- PAS DE CHECK « expires_at > created_at ». La date de création est validée par create_gift_links, qui
-- refuse une expiration déjà passée. Une contrainte de table interdirait en plus de RACCOURCIR une
-- expiration après coup — l'opération symétrique de l'extension qu'on veut justement pouvoir faire à la
-- main depuis Supabase. La lecture tranche de toute façon : get_gift_article compare à now().


COMMENT ON COLUMN public.gift_links.withdrawn_at IS
  'Coupure immédiate. Indispensable : la page sert une COPIE qui ne suit pas les corrections du site — article corrigé, dépublié ou retiré sur demande.';

CREATE INDEX IF NOT EXISTS gift_links_arc_id ON public.gift_links (arc_id);
CREATE INDEX IF NOT EXISTS gift_links_expires_at ON public.gift_links (expires_at);

-- ── LES OUVERTURES. Une ligne par ouverture : le compteur de gift_links sert l'affichage, ce journal sert la mesure.
CREATE TABLE IF NOT EXISTS public.gift_link_opens (
  id           bigserial PRIMARY KEY,
  token        text        NOT NULL REFERENCES public.gift_links(token) ON DELETE CASCADE,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  utm_source   text,
  utm_campaign text,
  referrer     text
);

CREATE INDEX IF NOT EXISTS gift_link_opens_token ON public.gift_link_opens (token, opened_at DESC);

-- ── CRÉATION DES LIENS. Réservée au service : jamais appelable depuis la page publique.
--
-- Le token vient de gen_random_uuid() — 128 bits, cœur de PostgreSQL, pas d'extension à installer.
-- Un identifiant séquentiel ou dérivé de l'URL rendrait la page aspirable par énumération.
CREATE OR REPLACE FUNCTION public.create_gift_links(
  p_arc_ids    text[],
  p_channel    text        DEFAULT NULL,
  p_campaign   text        DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
) RETURNS TABLE (arc_id text, token text, expires_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  v_expire timestamptz := COALESCE(p_expires_at, now() + interval '15 days');
  v_manquants text;
BEGIN
  IF p_arc_ids IS NULL OR cardinality(p_arc_ids) = 0 THEN
    RAISE EXCEPTION 'create_gift_links : aucun article demandé';
  END IF;
  IF v_expire <= now() THEN
    RAISE EXCEPTION 'create_gift_links : expiration déjà passée (%)', v_expire;
  END IF;

  -- Un article inconnu est un REFUS EXPLICITE, jamais un lien silencieusement absent de la réponse :
  -- l'appelant croirait avoir trois liens et n'en enverrait que deux.
  SELECT string_agg(a, ', ') INTO v_manquants
  FROM unnest(p_arc_ids) AS a
  WHERE NOT EXISTS (SELECT 1 FROM public.articles x WHERE x.arc_id = a);
  IF v_manquants IS NOT NULL THEN
    RAISE EXCEPTION 'create_gift_links : article(s) absent(s) du cache : %', v_manquants;
  END IF;

  RETURN QUERY
  INSERT INTO public.gift_links AS g (token, arc_id, channel, campaign, expires_at)
  SELECT replace(gen_random_uuid()::text, '-', ''), a, p_channel, p_campaign, v_expire
  FROM unnest(p_arc_ids) AS a
  RETURNING g.arc_id, g.token, g.expires_at;
END $$;

-- ── LECTURE PAR LA PAGE PUBLIQUE. La seule porte ouverte à `anon`.
--
-- L'EXPIRATION EST VÉRIFIÉE ICI, À LA LECTURE, jamais par le cron : un cron en retard d'une heure
-- laisserait l'article lisible une heure de trop.
--
-- « expiré » et « retiré » ne racontent pas la même histoire au lecteur : les deux statuts sont distincts.
CREATE OR REPLACE FUNCTION public.get_gift_article(
  p_token        text,
  p_utm_source   text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_referrer     text DEFAULT NULL
) RETURNS TABLE (
  status        text,
  canonical_url text,
  title         text,
  standfirst    text,
  image_url     text,
  body          text,
  section       text,
  published_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_link public.gift_links%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO v_link FROM public.gift_links WHERE gift_links.token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  -- Retiré d'abord : une coupure manuelle prime sur une date encore valide.
  IF v_link.withdrawn_at IS NOT NULL THEN
    RETURN QUERY SELECT 'withdrawn'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_link.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  -- On ne compte que les ouvertures qui servent vraiment l'article : un lien expiré n'est pas une lecture.
  INSERT INTO public.gift_link_opens (token, utm_source, utm_campaign, referrer)
  VALUES (p_token, p_utm_source, p_utm_campaign, p_referrer);
  UPDATE public.gift_links
     SET opens = gift_links.opens + 1, last_opened_at = now()
   WHERE gift_links.token = p_token;

  RETURN QUERY
  SELECT CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN 'preview' ELSE 'ok' END,
         a.canonical_url, a.title, a.standfirst, a.image_url,
         CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN NULL ELSE a.body END,
         a.section, a.published_at
  FROM public.articles a WHERE a.arc_id = v_link.arc_id;
END $$;

-- ── LES DROITS. Tout est fermé, puis on rouvre une seule porte.
REVOKE ALL ON public.articles, public.gift_links, public.gift_link_opens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_gift_links(text[], text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_gift_article(text, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_gift_links(text[], text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_gift_article(text, text, text, text) TO anon, authenticated, service_role;

-- RLS activée partout : le SECURITY DEFINER de get_gift_article reste le seul chemin de lecture.
ALTER TABLE public.articles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_links      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_link_opens ENABLE ROW LEVEL SECURITY;

COMMIT;
