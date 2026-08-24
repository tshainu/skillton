import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, orpc } from "../lib/api";
import type { CandidateStage, CandidateStatus } from "../lib/candidate-status";

export interface CandidateFilters {
  search?: string;
  /** Empty string means "no status filter" — anything else must be a real enum member. */
  status?: CandidateStatus | "";
  stage?: CandidateStage | "";
  skill?: string;
  minExperience?: number;
  bucket?: string;
  /** all | active (default) | blacklisted */
  scope?: "all" | "active" | "blacklisted";
}

export function useCandidates(filters: CandidateFilters = {}) {
  return useQuery(
    orpc.candidates.list.queryOptions({
      input: {
        search: filters.search || undefined,
        status: filters.status || undefined,
        stage: filters.stage || undefined,
        skill: filters.skill || undefined,
        minExperience: filters.minExperience,
        bucket: filters.bucket || undefined,
        scope: filters.scope ?? "active",
        limit: 300,
      },
      staleTime: 10_000,
    }),
  );
}

export function useCandidate(id: string) {
  return useQuery(orpc.candidates.get.queryOptions({ input: { id }, enabled: Boolean(id) }));
}

export function useCandidateMatches(candidateId: string) {
  return useQuery(
    orpc.candidates.matches.queryOptions({ input: { candidateId }, enabled: Boolean(candidateId) }),
  );
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  /* Candidate transitions ripple through every pipeline view, the dashboard and
     the placement register — refresh the whole cache rather than guessing. */
  qc.invalidateQueries();
}

export function useBulkUpload() {
  const qc = useQueryClient();
  return useMutation(orpc.candidates.bulkUpload.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useParseCandidate() {
  const qc = useQueryClient();
  return useMutation(orpc.candidates.parse.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useSetCandidateStatus() {
  const qc = useQueryClient();
  return useMutation(orpc.candidates.setStatus.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useSetCandidateTags() {
  const qc = useQueryClient();
  return useMutation(orpc.candidates.setTags.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useBlacklistCandidate() {
  const qc = useQueryClient();
  return useMutation(orpc.candidates.blacklist.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useRestoreCandidate() {
  const qc = useQueryClient();
  return useMutation(orpc.candidates.restore.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useMarkHired() {
  const qc = useQueryClient();
  return useMutation(orpc.candidates.markHired.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

export function useDeleteCandidate() {
  const qc = useQueryClient();
  return useMutation(orpc.candidates.remove.mutationOptions({ onSuccess: () => invalidate(qc) }));
}

/** Upload a file straight to object storage through a presigned PUT. */
export async function uploadFile(file: File, kind: "cv" | "jd" | "recording" = "cv") {
  const { url, key } = await client.upload.presign({
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    kind,
  });
  const res = await fetch(url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`Upload failed for ${file.name}`);
  return { key, filename: file.name };
}

export async function openDocument(key: string) {
  const { url } = await client.upload.download({ key });
  if (url) window.open(url, "_blank", "noopener");
  return url;
}
