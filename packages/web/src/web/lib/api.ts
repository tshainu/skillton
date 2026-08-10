import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "../../api";
import { authClient } from "./auth";

/** Bearer token minted by managed auth — shared by oRPC and the agent stream. */
export function authHeaders(): Record<string, string> {
  const token = authClient.managedAuth.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const link = new RPCLink({
  url: `${window.location.origin}/api/rpc`,
  headers: () => authHeaders(),
});

/** Direct typed client: await client.ping() */
export const client: AppRouterClient = createORPCClient(link);

/** TanStack Query helpers: useQuery(orpc.ping.queryOptions()) */
export const orpc = createTanstackQueryUtils(client);
