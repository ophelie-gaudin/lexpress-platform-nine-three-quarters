-- Gift links — 013 : on ne jette un corps que lorsqu'on a décidé de le retirer (9 oct. 2026).
--
-- LA MIGRATION 012 AVAIT TORT. Elle vidait le corps d'un article 90 jours après la dernière expiration
-- de son lien, au motif qu'une copie d'article payant qui ne sert plus n'a pas à rester.
--
-- OBJECTION D'OPHÉLIE, et elle est juste : le jour où l'on réoffre cet article, le service recharge le
-- corps chez Arc — MAIS SEULEMENT SI ARC RÉPOND. Arc indisponible, article déplacé, accès changé, et le
-- repli public ne rend qu'un aperçu : l'appelant reçoit `content: "preview"` et ne peut plus offrir
-- l'article entier, alors qu'on en avait une copie et qu'on l'a jetée.
--
-- ET CE QU'ON METTAIT EN FACE NE PÈSE PAS LOURD. La base est fermée : aucune table lisible par `anon`
-- ni `authenticated`, RLS sans aucune politique, un seul chemin de lecture et il exige un token. Purger
-- ne réduit donc l'exposition que dans un scénario où la base est DÉJÀ compromise. Un gain conditionnel
-- contre une perte irréversible : la balance était inversée.
--
-- IL RESTE UN CAS OÙ PURGER EST JUSTE, ET UN SEUL : l'article RETIRÉ. `withdrawn_at` est une décision
-- éditoriale explicite — article corrigé, dépublié, retiré sur demande. En garder le texte intégral
-- contredit activement cette décision.
--
-- ET CE CAS NE PORTE AUCUN RISQUE DE RESYNCHRONISATION : un lien retiré n'est jamais ressuscité par le
-- service (migration 003). Le rouvrir demande d'effacer `withdrawn_at` à la main — un geste délibéré,
-- qui passera de toute façon par une nouvelle demande, donc par un rechargement.

BEGIN;

-- ON SUPPRIME LA PURGE FONDÉE SUR LE TEMPS. La laisser en place inviterait à la replanifier.
DROP FUNCTION IF EXISTS public.purge_stale_bodies(integer);

-- ── LE CORPS D'UN ARTICLE RETIRÉ.
--
-- SEPT JOURS DE GRÂCE. Un retrait se fait dans l'urgence, et se reprend parfois le lendemain. Une
-- semaine laisse le temps de se raviser sans avoir à repasser par Arc.
CREATE OR REPLACE FUNCTION public.purge_withdrawn_bodies(p_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE v_vides integer;
BEGIN
  IF p_days IS NULL OR p_days < 0 THEN
    RAISE EXCEPTION 'purge_withdrawn_bodies : délai de grâce invalide (%)', p_days;
  END IF;

  WITH videes AS (
    UPDATE public.articles a SET body = NULL
     WHERE a.body IS NOT NULL
       -- Le lien de cet article est retiré depuis plus que le délai de grâce…
       AND EXISTS (
         SELECT 1 FROM public.gift_links g
          WHERE g.arc_id = a.arc_id
            AND g.withdrawn_at IS NOT NULL
            AND g.withdrawn_at < now() - make_interval(days => p_days))
       -- …et AUCUN lien vivant ne pointe sur lui. Un lien par article aujourd'hui, mais cette condition
       -- ne coûte rien et protège d'un modèle à plusieurs liens.
       AND NOT EXISTS (
         SELECT 1 FROM public.gift_links g
          WHERE g.arc_id = a.arc_id AND g.withdrawn_at IS NULL)
    RETURNING 1)
  SELECT count(*)::integer INTO v_vides FROM videes;
  RETURN v_vides;
END $$;

REVOKE ALL ON FUNCTION public.purge_withdrawn_bodies(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_withdrawn_bodies(integer) TO service_role;

-- ── LE PASSAGE UNIQUE, SANS LA PURGE PAR ANCIENNETÉ.
--
-- Les deux autres horizons ne changent pas : `send_id` désigne une personne et part à 90 jours, la
-- lecture dépouillée part à 13 mois. Ni l'un ni l'autre n'est rechargeable depuis Arc, mais ni l'un ni
-- l'autre n'est nécessaire pour offrir un article — c'est toute la différence avec le corps.
CREATE OR REPLACE FUNCTION public.purge_gift_links()
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'withdrawn_bodies_cleared', public.purge_withdrawn_bodies(),
    'send_ids_erased',          public.purge_send_ids(),
    'reads_deleted',            public.purge_old_reads(),
    'ran_at',                   now());
$$;

REVOKE ALL ON FUNCTION public.purge_gift_links() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_gift_links() TO service_role;

COMMENT ON COLUMN public.articles.body IS
  'Copie du corps premium. CONSERVÉE SANS LIMITE DE TEMPS : la recharger suppose qu''Arc réponde, et un article qu''on ne peut plus recharger ne pourrait plus être offert entier. Effacée uniquement quand le lien de l''article a été RETIRÉ depuis plus de sept jours — là, la garder contredirait une décision éditoriale.';

COMMIT;
