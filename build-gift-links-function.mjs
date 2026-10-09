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
  'gift-links/functions/_shared/corps.mjs',
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

// ── CE FICHIER N'ÉCRIT QUE LORSQU'ON LE LANCE (8 oct. 2026).
//
// RELEVÉ PAR UNE REVUE ADVERSE. Il écrivait à l'import. Le test qui vérifiait « le fichier déployable
// correspond aux sources » importait ce module, qui RÉÉCRIVAIT le fichier, puis comparait — une égalité
// qu'il venait de fabriquer. Le contrôle ne pouvait pas échouer, et un oubli de génération avant
// déploiement serait passé inaperçu. C'est exactement le genre de panne qu'on avait déjà payée avec le
// validateur embarqué du workflow n8n.
if (process.argv[1] && process.argv[1].endsWith('build-gift-links-function.mjs')) {
  const sortie = build();
  writeFileSync(CIBLE, sortie);
  console.log(`${CIBLE} engendré (${sortie.length} caractères).`);
}
