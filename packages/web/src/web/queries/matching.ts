import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useExpiryOverview() {
  return useQuery(orpc.matching.expiryOverview.queryOptions({ staleTime: 15_000 }));
}

export function useMatchSearch(input: {
  skill?: string;
  minScore?: number;
  jdId?: string;
  stage?: string;
  enabled?: boolean;
}) {
  return useQuery(
    orpc.matching.search.queryOptions({
      input: {
        skill: input.skill || undefined,
        minScore: input.minScore ?? 0,
        jdId: input.jdId || undefined,
        stage: input.stage || undefined,
        limit: 100,
      },
      enabled: input.enabled ?? true,
    }),
  );
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: orpc.matching.key() });
  qc.invalidateQueries({ queryKey: orpc.jobs.key() });
  qc.invalidateQueries({ queryKey: orpc.candidates.key() });
  qc.invalidateQueries({ queryKey: orpc.dashboard.key() });
  qc.invalidateQueries({ queryKey: orpc.screening.key() });
}

/**
 * The engine returns the ranking as soon as the deterministic scores are saved
 * and writes the AI narration afterwards, so we refresh once immediately and
 * again a few seconds later to pick the explanations up.
 */
function invalidateWithNarration(qc: ReturnType<typeof useQueryClient>) {
  invalidate(qc);
  for (const delay of [4000, 12000]) setTimeout(() => invalidate(qc), delay);
}

export function useRunMatchForJob() {
  const qc = useQueryClient();
  return useMutation(
    orpc.matching.runForJob.mutationOptions({ onSuccess: () => invalidateWithNarration(qc) }),
  );
}

export function useRunMatchForCandidate() {
  const qc = useQueryClient();
  return useMutation(
    orpc.matching.runForCandidate.mutationOptions({ onSuccess: () => invalidateWithNarration(qc) }),
  );
}

/** Re-run a single expired (or stale) candidate/JD pair. */
export function useRerunMatch() {
  const qc = useQueryClient();
  return useMutation(orpc.matching.rerun.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useRerunExpired() {
  const qc = useQueryClient();
  return useMutation(orpc.matching.rerunExpired.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useToggleShortlist() {
  const qc = useQueryClient();
  return useMutation(orpc.matching.toggleShortlist.mutationOptions({ onSuccess: () => invalidate(qc) }));
}
