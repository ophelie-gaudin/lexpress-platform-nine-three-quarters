-- Gift links — 012 : ce qu'on garde, et combien de temps (9 oct. 2026).
--
-- RIEN N'ÉTAIT JAMAIS EFFACÉ. Le cache accumulait des copies d'articles payants sans limite, et le
-- journal des lectures une ligne par ouverture, chacune portant l'identifiant d'un envoi — donc d'une
-- personne. Garder sans décider n'est pas une politique de conservation, c'est une absence de décision.
--
-- TROIS DONNÉES, TROIS HORIZONS. Elles ne se valent pas, et un seul délai pour tout serait soit trop
-- court pour l'une, soit trop long pour l'autre.

BEGIN;

-- ── LE CORPS DES ARTICLES — 90 JOURS APRÈS LA DERNIÈRE EXPIRATION.
--
-- C'est la donnée sensible : une copie intégrale d'un article réservé aux abonnés. Un lien vit 15 à
-- 30 jours ; trois mois après sa dernière expiration, plus personne ne le diffuse.
--
-- ON VIDE LE CORPS, ON NE SUPPRIME PAS LA LIGNE. Le titre, le chapeau et l'image sont publics — ils
-- s'affichent déjà sur lexpress.fr sans abonnement — et la page en a besoin pour son état `preview`.
-- Et si l'article est réoffert un jour, le service ira rechercher le corps chez Arc : le vide se
-- remplit tout seul, l'inverse n'est pas vrai.
--
-- UN ARTICLE ENCORE LIÉ À UN LIEN VIVANT N'EST JAMAIS TOUCHÉ, quelle que soit son ancienneté.
CREATE OR REPLACE FUNCTION public.purge_stale_bodies(p_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE v_vides integer;
BEGIN
  IF p_days IS NULL OR p_days < 7 THEN
    RAISE EXCEPTION 'purge_stale_bodies : rétention trop courte (%). Un lien vit 15 à 30 jours.', p_days;
  END IF;

  WITH videes AS (
    UPDATE public.articles a SET body = NULL
     WHERE a.body IS NOT NULL
       -- Aucun lien non retiré dont la date de fin soit récente OU encore à venir.
       AND NOT EXISTS (
         SELECT 1 FROM public.gift_links g
          WHERE g.arc_id = a.arc_id
            AND g.withdrawn_at IS NULL
            AND g.expires_at > now() - make_interval(days => p_days))
       -- Et l'article lui-même n'a pas été mis en cache récemment : un article fraîchement chargé mais
       -- dont la création de lien a échoué mérite le même délai que les autres.
       AND a.fetched_at < now() - make_interval(days => p_days)
    RETURNING 1)
  SELECT count(*)::integer INTO v_vides FROM videes;
  RETURN v_vides;
END $$;

-- ── L'IDENTIFIANT D'ENVOI — 90 JOURS.
--
-- `send_id` rattache une lecture à un envoi précis, donc à une personne de la base de l'agent. Il sert
-- à la relance J+2 : un besoin de quelques jours, pas de plusieurs mois. On l'efface sans toucher au
-- reste de la ligne — le segment et la date restent, et les comptes par campagne ne bougent pas.
CREATE OR REPLACE FUNCTION public.purge_send_ids(p_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE v_anonymisees integer;
BEGIN
  IF p_days IS NULL OR p_days < 7 THEN
    RAISE EXCEPTION 'purge_send_ids : rétention trop courte (%).', p_days;
  END IF;

  WITH touchees AS (
    UPDATE public.gift_link_opens SET send_id = NULL
     WHERE send_id IS NOT NULL AND opened_at < now() - make_interval(days => p_days)
    RETURNING 1)
  SELECT count(*)::integer INTO v_anonymisees FROM touchees;
  RETURN v_anonymisees;
END $$;

-- ── LES LECTURES — 13 MOIS.
--
-- Une fois l'identifiant d'envoi parti, la ligne ne porte plus qu'un segment et une date. Treize mois
-- permettent une comparaison d'une année sur l'autre ; au-delà, c'est Piano qui porte la mesure.
CREATE OR REPLACE FUNCTION public.purge_old_reads(p_days integer DEFAULT 400)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE v_supprimees integer;
BEGIN
  IF p_days IS NULL OR p_days < 90 THEN
    RAISE EXCEPTION 'purge_old_reads : rétention trop courte (%). Les lectures servent aux relances.', p_days;
  END IF;

  WITH parties AS (
    DELETE FROM public.gift_link_opens WHERE opened_at < now() - make_interval(days => p_days)
    RETURNING 1)
  SELECT count(*)::integer INTO v_supprimees FROM parties;
  RETURN v_supprimees;
END $$;

-- ── CE QU'ON NE PURGE PAS, ET POURQUOI.
--
-- `gift_links` N'EST JAMAIS ÉLAGUÉE. Supprimer une ligne casserait une promesse écrite : un lien expiré
-- se rouvre par une nouvelle demande, AVEC LE MÊME TOKEN. Sans la ligne, un token neuf est créé, et le
-- lien que quelqu'un garde dans un message ancien meurt pour de bon. Une ligne pèse quelques centaines
-- d'octets ; l'attribution et le compteur d'ouvertures y vivent.
--
-- ET UNE LIGNE `withdrawn_at` MOINS QUE TOUTE AUTRE : c'est la trace d'un retrait délibéré. L'effacer
-- rendrait l'article offrable de nouveau, en silence.

-- ── LE PASSAGE UNIQUE, pour une tâche planifiée.
CREATE OR REPLACE FUNCTION public.purge_gift_links()
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'bodies_cleared',  public.purge_stale_bodies(),
    'send_ids_erased', public.purge_send_ids(),
    'reads_deleted',   public.purge_old_reads(),
    'ran_at',          now());
$$;

REVOKE ALL ON FUNCTION public.purge_stale_bodies(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_send_ids(integer)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_old_reads(integer)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_gift_links()          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_stale_bodies(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_send_ids(integer)     TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_reads(integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_gift_links()          TO service_role;

COMMIT;
