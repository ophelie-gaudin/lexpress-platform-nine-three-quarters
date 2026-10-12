// Adaptateur Vercel : il ne fait que brancher l'environnement sur le handler testé.
// Toute la logique est dans `interface/handlers.mjs`, qui s'exécute sous Node sans la plateforme.
import { handlerSession } from '../interface/handlers.mjs';

const handler = handlerSession({ env: process.env });
export default { fetch: (request) => handler(request) };
