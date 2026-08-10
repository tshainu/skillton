import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

type JobStatus = "open" | "on_hold" | "closed" | "filled";

export function useJobs(status?: JobStatus, clientId?: string) {
  return useQuery(orpc.jobs.list.queryOptions({ input: { status, clientId } }));
}

export function useJob(id: string) {
  return useQuery(orpc.jobs.get.queryOptions({ input: { id }, enabled: Boolean(id) }));
}

export function useJobMatches(jdId: string) {
  return useQuery(
    orpc.jobs.matches.queryOptions({ input: { jdId, limit: 100 }, enabled: Boolean(jdId) }),
  );
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: orpc.jobs.key() });
  qc.invalidateQueries({ queryKey: orpc.dashboard.key() });
  qc.invalidateQueries({ queryKey: orpc.matching.key() });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation(orpc.jobs.create.mutationOptions({ onSuccess: () => invalidateAll(qc) }));
}

export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation(orpc.jobs.update.mutationOptions({ onSuccess: () => invalidateAll(qc) }));
}

export function useReparseJob() {
  const qc = useQueryClient();
  return useMutation(orpc.jobs.reparse.mutationOptions({ onSuccess: () => invalidateAll(qc) }));
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation(orpc.jobs.remove.mutationOptions({ onSuccess: () => invalidateAll(qc) }));
}
