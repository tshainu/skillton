import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** JD <-> CV matrix. */

export function useJdOptions() {
  return useQuery(orpc.matrix.jdOptions.queryOptions({ staleTime: 60_000 }));
}

export function useCandidateOptions(query: string) {
  return useQuery(
    orpc.matrix.candidateOptions.queryOptions({ input: { query, limit: 60 }, staleTime: 15_000 }),
  );
}

export function useCandidatesForJd(jdId: string | null) {
  return useQuery(
    orpc.matrix.candidatesForJd.queryOptions({
      input: { jdId: jdId ?? "", top: 10 },
      enabled: Boolean(jdId),
      staleTime: 30_000,
    }),
  );
}

export function useJdsForCandidate(candidateId: string | null) {
  return useQuery(
    orpc.matrix.jdsForCandidate.queryOptions({
      input: { candidateId: candidateId ?? "", top: 10 },
      enabled: Boolean(candidateId),
      staleTime: 30_000,
    }),
  );
}

export function useSendToScreening() {
  const qc = useQueryClient();
  return useMutation(
    orpc.matrix.sendToScreening.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: orpc.screening.key() });
        qc.invalidateQueries({ queryKey: orpc.candidates.key() });
        qc.invalidateQueries({ queryKey: orpc.matrix.key() });
      },
    }),
  );
}
