// Assemble la fonction déployable À PARTIR des sources testées.
//
// Pourquoi un fichier unique : le déploiement par l'API de gestion n'emporte qu'un fichier. Recopier le
// code à la main créerait deux vérités — celle qu'on teste et celle qui tourne. On a déjà payé ce prix
// avec le validateur embarqué du workflow n8n : la source corrigée, la copie déployée inchangée.
import { readFileSync, writeFileSync } from 'node:fs';

export const SOURCES = [
  'gift-links/functions/_shared/apercu.mjs',
  'gift-links/functions/_shared/arc-id.mjs',
  'gift-links/functions/_shared/arc.mjs',
];
export const ENTREE = 'gift-links/functions/create-gift-links/index.ts';
export const CIBLE = 'gift-links/functions/create-gift-links/index.bundle.ts';

const sansImportsLocaux = (s) => s.replace(/^import\s+\{[^}]*\}\s+from\s+'\.[^']*';\s*$/gm, '');
const sansExport = (s) => s.replace(/^export\s+(?=(function|const|async function))/gm, '');

export function build() {
  const entete = [
    '// FICHIER ENGENDRÉ — ne pas modifier à la main.',
    '// Régénérer : node build-gift-links-function.mjs',
    `// Sources : ${[...SOURCES, ENTREE].join(', ')}`,
    '',
  ].join('\n');
  const modules = SOURCES.map((f) => sansExport(sansImportsLocaux(readFileSync(f, 'utf8'))).trim()).join('\n\n');
  const entree = sansImportsLocaux(readFileSync(ENTREE, 'utf8')).trim();
  // L'import distant (jsr:) doit rester EN TÊTE du fichier : on le remonte avant les modules inlinés.
  const imports = entree.match(/^import .*$/gm) ?? [];
  return `${entete}${imports.join('\n')}\n\n${modules}\n\n${entree.replace(/^import .*$\n?/gm, '')}\n`;
}

const sortie = build();
writeFileSync(CIBLE, sortie);
console.log(`${CIBLE} engendré (${sortie.length} caractères).`);
