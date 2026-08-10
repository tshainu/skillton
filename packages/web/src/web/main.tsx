// Entry point referenced by index.html — composition only, real bootstrap
// lives in __main.tsx (template-managed).
import "./__main";
import { authClient } from "./lib/auth";

// Completes a returning managed sign-in redirect; the reactive session updates
// as soon as it resolves.
void authClient.managedAuth.handleRedirect();
