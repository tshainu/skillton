import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useClients() {
  return useQuery(orpc.clients.list.queryOptions());
}

export function useClient(id: string) {
  return useQuery(orpc.clients.get.queryOptions({ input: { id }, enabled: Boolean(id) }));
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation(
    orpc.clients.create.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.clients.key() }),
    }),
  );
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation(
    orpc.clients.update.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.clients.key() }),
    }),
  );
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation(
    orpc.clients.remove.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.clients.key() }),
    }),
  );
}
