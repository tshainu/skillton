import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** AI interview question banks, managed from Settings. */

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: orpc.questionSets.key() });
}

export function useQuestionSets() {
  return useQuery(orpc.questionSets.list.queryOptions({ staleTime: 30_000 }));
}

export function useCreateQuestionSet() {
  const qc = useQueryClient();
  return useMutation(orpc.questionSets.create.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useUpdateQuestionSet() {
  const qc = useQueryClient();
  return useMutation(orpc.questionSets.update.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useRemoveQuestionSet() {
  const qc = useQueryClient();
  return useMutation(orpc.questionSets.remove.mutationOptions({ onSuccess: () => invalidate(qc) }));
}
