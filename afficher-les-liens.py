#!/usr/bin/env python3
"""Met en forme la réponse de create-gift-links. Rien d'autre.

    curl … | python3 afficher-les-liens.py

CE SCRIPT N'APPELLE RIEN. Il lit ce qu'on lui donne sur l'entrée standard, l'affiche lisiblement, et
s'arrête là. Aucun réseau, aucun jeton, aucune dépendance : le python3 livré avec macOS et Linux suffit.

POURQUOI IL EXISTE. La réponse de l'API est du JSON sur une seule ligne, illisible dans un terminal.
Les personnes à qui l'on confie l'outil veulent un lien à copier, pas une structure à déchiffrer.
"""
import json
import sys

ETATS = {
    "created":   "nouveau lien",
    "extended":  "lien existant, sa date de fin a été repoussée",
    "unchanged": "lien existant, déjà valable plus longtemps que demandé",
    "withdrawn": "ARTICLE RETIRÉ — ce lien ne peut pas être rouvert",
}

# UN TRAIT, ET DE L'AIR AUTOUR. Sans cela le résultat se confond avec ce que curl a écrit juste avant —
# sa jauge de progression, les en-têtes — et le lien à copier se perd dans le bruit.
TRAIT = "─" * 72

def titre(texte):
    print(f"\n{TRAIT}\n  {texte}\n{TRAIT}\n")

def jour(iso):
    a, m, j = iso[:10].split("-")
    return f"{j}/{m}/{a}"

def main():
    try:
        r = json.load(sys.stdin)
    except json.JSONDecodeError:
        print("Réponse illisible : ce n'est pas du JSON. L'appel a-t-il abouti ?", file=sys.stderr)
        return 2

    # UN REFUS GLOBAL. Jeton absent ou inconnu, corps mal formé, aucune URL exploitable.
    if "error" in r:
        titre(f'REFUSÉ — {r["error"]}')
        if r.get("accepted_keys"):
            print("Clés acceptées :", ", ".join(r["accepted_keys"]))
        if r.get("hint"):
            print(r["hint"])
        for x in r.get("rejected", []):
            print("  -", x.get("url"), "→", x.get("erreur"))
        return 1

    liens = r.get("links", [])
    titre(f'{len(liens)} lien(s) — demandés par « {r.get("client", "?")} »')

    for i, l in enumerate(liens):
        if i:
            print()
        print(l["link"])
        # LE CONTENU D'ABORD : c'est la seule chose qui peut décevoir le destinataire.
        contenu = ("article complet" if l.get("content") == "full"
                   else "APERÇU SEULEMENT — titre et chapeau, pas l'article entier")
        print(f'   {contenu}')
        print(f'   valable jusqu\'au {jour(l["expires_at"])} · {ETATS.get(l.get("state"), l.get("state"))}')
        print(f'   article : {l["url"]}')

    # LES REFUS NE SONT JAMAIS TUS. Un appelant qui demande trois liens doit savoir qu'il n'en a que deux.
    rejets = r.get("rejected", [])
    if rejets:
        titre(f'{len(rejets)} article(s) refusé(s)')
        for x in rejets:
            print("  -", x.get("url"))
            print("    →", x.get("erreur"))
    return 0

if __name__ == "__main__":
    sys.exit(main())
