// Adaptateur Vercel. La logique est dans `interface/handlers.mjs`, qui s'exécute sous Node sans la
// plateforme — donc qui se teste.
import { handlerAcces } from '../interface/handlers.mjs';

const handler = handlerAcces({ env: process.env });
export default { fetch: (request) => handler(request) };
