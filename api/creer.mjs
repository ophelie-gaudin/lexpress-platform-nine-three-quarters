// Adaptateur Vercel. LE JETON DE SERVICE NE VIT QUE DANS CE PROCESSUS : `process.env` est côté serveur,
// la page ne le voit jamais. C'est toute la raison d'être de ce fichier.
import { handlerCreer } from '../interface/handlers.mjs';

const handler = handlerCreer({ env: process.env });
export default { fetch: (request) => handler(request) };
