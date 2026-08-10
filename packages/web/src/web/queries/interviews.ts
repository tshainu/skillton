import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/* ------------------------------------------------------------ HR screening */

export function useHrQuestions() {
  return useQuery(orpc.screening.questions.queryOptions());
}

export function useScreeningQueue() {
  return useQuery(orpc.screening.queue.queryOptions({ staleTime: 10_000 }));
}

export function useScreeningHistory(candidateId?: string) {
  return useQuery(orpc.screening.history.queryOptions({ input: { candidateId } }));
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries();
}

export function useSaveHrQuestion() {
  const qc = useQueryClient();
  return useMutation(
    orpc.screening.saveQuestion.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.screening.key() }),
    }),
  );
}

export function useRemoveHrQuestion() {
  const qc = useQueryClient();
  return useMutation(
    orpc.screening.removeQuestion.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.screening.key() }),
    }),
  );
}

export function useSubmitScreening() {
  const qc = useQueryClient();
  return useMutation(orpc.screening.submit.mutationOptions({ onSuccess: () => invalidateAll(qc) }));
}

/* ----------------------------------------------------------- AI interviews */

export function useAiInterviews(status?: string) {
  return useQuery(orpc.aiInterviews.list.queryOptions({ input: { status } }));
}

export function useAiInterviewQueue() {
  return useQuery(orpc.aiInterviews.queue.queryOptions());
}

export function useAiInterview(id: string) {
  return useQuery(orpc.aiInterviews.get.queryOptions({ input: { id }, enabled: Boolean(id) }));
}

export function useInviteAiInterview() {
  const qc = useQueryClient();
  return useMutation(orpc.aiInterviews.invite.mutationOptions({ onSuccess: () => invalidateAll(qc) }));
}

/** Bulk-mark screened candidates as selected for the AI interview. */
export function useMarkForAiInterview() {
  const qc = useQueryClient();
  return useMutation(
    orpc.screening.markForAiInterview.mutationOptions({ onSuccess: () => invalidateAll(qc) }),
  );
}

/** Completed AI interview results with a derived 0-100 score. */
export function useAiInterviewResults(candidateId?: string) {
  return useQuery(orpc.aiInterviews.results.queryOptions({ input: { candidateId }, staleTime: 15_000 }));
}

/** Re-issue an unfinished interview with a fresh link and optional new set. */
export function useRescheduleAiInterview() {
  const qc = useQueryClient();
  return useMutation(orpc.aiInterviews.reschedule.mutationOptions({ onSuccess: () => invalidateAll(qc) }));
}

export function useRegradeAiInterview() {
  const qc = useQueryClient();
  return useMutation(orpc.aiInterviews.regrade.mutationOptions({ onSuccess: () => invalidateAll(qc) }));
}

/* --------------------------------------------- Candidate interview room API */

export function useInterviewByToken(token: string) {
  return useQuery(
    orpc.aiInterviews.byToken.queryOptions({ input: { token }, enabled: Boolean(token), retry: false }),
  );
}

export function useInterviewConsent() {
  const qc = useQueryClient();
  return useMutation(
    orpc.aiInterviews.consent.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.aiInterviews.key() }),
    }),
  );
}

export function useStartInterview() {
  return useMutation(orpc.aiInterviews.start.mutationOptions());
}

export function useAppendTranscript() {
  return useMutation(orpc.aiInterviews.appendTranscript.mutationOptions());
}

/** Keeps the server's "last seen" fresh so a reload gap can be priced exactly. */
export function useInterviewHeartbeat() {
  return useMutation(orpc.aiInterviews.heartbeat.mutationOptions());
}

/** Rejoins an interview left in progress and returns the state to restore. */
export function useResumeInterview() {
  return useMutation(orpc.aiInterviews.resume.mutationOptions());
}

/** Camera/microphone never came up — the interview was never conducted. */
export function useInterviewDeviceFailure() {
  return useMutation(orpc.aiInterviews.deviceFailure.mutationOptions());
}

/** Escalates the raw room/voice error to the super admins. */
export function useReportInterviewError() {
  return useMutation(orpc.aiInterviews.reportError.mutationOptions());
}

export function useProctorEvent() {
  return useMutation(orpc.aiInterviews.proctorEvent.mutationOptions());
}

export function useFinishInterview() {
  const qc = useQueryClient();
  return useMutation(
    orpc.aiInterviews.finish.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.aiInterviews.key() }),
    }),
  );
}

/* --------------------------------------------------- Technical interviews */

export function useTechTemplates() {
  return useQuery(orpc.techInterviews.templates.queryOptions());
}

export function useTechQueue() {
  return useQuery(orpc.techInterviews.queue.queryOptions({ staleTime: 10_000 }));
}

export function useTechInterviews() {
  return useQuery(orpc.techInterviews.list.queryOptions());
}

export function useFinalReport(candidateId: string, jdId?: string) {
  return useQuery(
    orpc.techInterviews.finalReport.queryOptions({
      input: { candidateId, jdId },
      enabled: Boolean(candidateId),
    }),
  );
}

export function useSaveTechTemplate() {
  const qc = useQueryClient();
  return useMutation(
    orpc.techInterviews.saveTemplate.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.techInterviews.key() }),
    }),
  );
}

export function useRemoveTechTemplate() {
  const qc = useQueryClient();
  return useMutation(
    orpc.techInterviews.removeTemplate.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.techInterviews.key() }),
    }),
  );
}

export function useSubmitTechInterview() {
  const qc = useQueryClient();
  return useMutation(orpc.techInterviews.submit.mutationOptions({ onSuccess: () => invalidateAll(qc) }));
}
