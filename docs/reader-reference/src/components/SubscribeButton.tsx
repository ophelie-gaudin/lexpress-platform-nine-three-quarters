import { useQuery } from "@tanstack/react-query";
import type { ArticleLanguage } from "@/lib/articleLanguage";
import { useReader } from "@/lib/useReader";
import { subscriptionAction } from "@/lib/subscriptionLink";
import { getSubscriptionOffer, offerSite } from "@/lib/subscriptionOffer";

/**
 * La seule action d'abonnement de la page (retour d'Enzo du 20/11, points 1 et 2) : une barre collée en
 * bas de l'écran, toujours visible. `sticky` et non `fixed` : placée en dernier dans la page, elle reprend
 * sa place sous le contenu une fois en bas, et ne recouvre donc jamais la fin de l'article.
 * L'offre du moment (table « offres ») remplace libellé et cible ; sans offre, le bouton d'aujourd'hui.
 */
export function SubscribeBar({ token, search, language }: { token: string; search: string; language?: ArticleLanguage }) {
  const reader = useReader();
  const site = offerSite(reader.edition, language);
  const { data: offer, isPending } = useQuery({
    // Une lecture par affichage : rien n'est gardé une fois la barre démontée (gcTime 0), si bien qu'un
    // article rouvert après le début d'une offre la voit, sans montrer d'abord l'ancienne réponse.
    queryKey: ["subscription-offer", reader.environment, site, token],
    queryFn: () => getSubscriptionOffer(site, reader),
    enabled: typeof window !== "undefined",
    staleTime: Infinity,
    gcTime: 0,
    // Hors ligne, la requête part quand même : son délai et son repli rendent le bouton par défaut.
    networkMode: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });
  // Quatre secondes au plus (délai de la requête) : pas de libellé qui change sous les yeux du lecteur.
  if (isPending) return null;
  const action = subscriptionAction(search, reader.edition, language, offer);
  return (
    <div className="sticky bottom-0 z-40 border-t border-rule bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="measure px-5 py-3">
        <a
          href={action.href}
          className="inline-flex w-full items-center justify-center rounded-sm bg-express px-6 py-3.5 text-center text-base font-semibold tracking-wide text-express-foreground transition-opacity hover:opacity-90"
        >
          {action.label}
        </a>
      </div>
    </div>
  );
}
