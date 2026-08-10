import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Recruitment buckets, flagged candidates, hidden gems and the blacklist. */

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  /* Candidate transitions ripple through every pipeline view, the dashboard and
     the placement register — refresh the whole cache rather than guessing. */
  qc.invalidateQueries();
}

export function useBuckets(bucket?: string) {
  return useQuery(
    orpc.talent.byBucket.queryOptions({
      input: bucket ? { bucket: bucket as never } : {},
      staleTime: 10_000,
    }),
  );
}

export function useFlaggedCandidates() {
  return useQuery(orpc.talent.flagged.queryOptions({ staleTime: 10_000 }));
}

export function useHiddenGems() {
  return useQuery(orpc.talent.hiddenGems.queryOptions({ staleTime: 15_000 }));
}

export function useBlacklist() {
  return useQuery(orpc.talent.blacklist.queryOptions({ staleTime: 10_000 }));
}

export function useSetBucket() {
  const qc = useQueryClient();
  return useMutation(orpc.talent.setBucket.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useSetBucketBulk() {
  const qc = useQueryClient();
  return useMutation(orpc.talent.setBucketBulk.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useSetClientOutcome() {
  const qc = useQueryClient();
  return useMutation(orpc.talent.setClientOutcome.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useSetBlacklisted() {
  const qc = useQueryClient();
  return useMutation(orpc.talent.setBlacklisted.mutationOptions({ onSuccess: () => invalidate(qc) }));
}
