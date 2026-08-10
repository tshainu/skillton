import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { authClient } from "../lib/auth";

export function useMe() {
  const { data: authSession, isPending } = authClient.useSession();
  const query = useQuery({
    ...orpc.session.me.queryOptions(),
    enabled: !isPending && Boolean(authSession),
    staleTime: 30_000,
  });
  return {
    ...query,
    isSignedIn: Boolean(authSession),
    authPending: isPending,
  };
}

export function useTeamMembers() {
  return useQuery(orpc.session.teamMembers.queryOptions());
}

export function useSetRole() {
  const qc = useQueryClient();
  return useMutation(
    orpc.session.setRole.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.session.key() }),
    }),
  );
}

export function useSetActive() {
  const qc = useQueryClient();
  return useMutation(
    orpc.session.setActive.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.session.key() }),
    }),
  );
}

export function useNotifications(enabled = true) {
  return useQuery({ ...orpc.session.notifications.queryOptions(), enabled, refetchInterval: 60_000 });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation(
    orpc.session.markNotificationsRead.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.session.key() }),
    }),
  );
}

export function useAuditLog(limit = 60) {
  return useQuery(orpc.session.auditLog.queryOptions({ input: { limit } }));
}

export function useDemoStatus() {
  return useQuery(orpc.demo.status.queryOptions());
}

export function useSeedDemo() {
  const qc = useQueryClient();
  return useMutation(
    orpc.demo.seed.mutationOptions({
      onSuccess: () => qc.invalidateQueries(),
    }),
  );
}
