import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/* -------------------------------------------------------------- dashboard */

export function useDashboard() {
  return useQuery(
    orpc.dashboard.overview.queryOptions({
      staleTime: 5_000,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    }),
  );
}

/* ------------------------------------------------------------- placements */

export function usePlacements(input: { search?: string; clientId?: string; status?: string } = {}) {
  return useQuery(
    orpc.placements.list.queryOptions({
      input: {
        search: input.search || undefined,
        clientId: input.clientId || undefined,
        status: input.status as never,
      },
      staleTime: 5_000,
      refetchOnMount: "always",
    }),
  );
}

export function usePlacementStats() {
  return useQuery(orpc.placements.stats.queryOptions({ staleTime: 5_000, refetchOnMount: "always" }));
}

export function useUpdatePlacement() {
  const qc = useQueryClient();
  return useMutation(
    orpc.placements.update.mutationOptions({ onSuccess: () => qc.invalidateQueries() }),
  );
}

/* --------------------------------------------------------------- settings */

export function useSettings() {
  return useQuery(orpc.settings.get.queryOptions());
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation(
    orpc.settings.update.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: orpc.settings.key() });
        qc.invalidateQueries({ queryKey: orpc.session.key() });
      },
    }),
  );
}

export function useAddBlacklistReason() {
  const qc = useQueryClient();
  return useMutation(
    orpc.settings.addBlacklistReason.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.settings.key() }),
    }),
  );
}

export function useRemoveBlacklistReason() {
  const qc = useQueryClient();
  return useMutation(
    orpc.settings.removeBlacklistReason.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.settings.key() }),
    }),
  );
}

/* ------------------------------------------------------ backup & recovery */

export function useBackupStatus() {
  return useQuery(orpc.backup.status.queryOptions({ staleTime: 15_000 }));
}

export function useStorageBreakdown() {
  return useQuery(orpc.backup.storageBreakdown.queryOptions());
}

export function useCleanupPreview() {
  return useQuery(orpc.backup.previewCleanup.queryOptions({ staleTime: 30_000 }));
}

export function useRunBackup() {
  const qc = useQueryClient();
  return useMutation(
    orpc.backup.run.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.backup.key() }),
    }),
  );
}

export function useRunCleanup() {
  const qc = useQueryClient();
  return useMutation(orpc.backup.runCleanup.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
}

export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation(orpc.backup.restore.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
}

/** Automatic backup schedule + Google Drive destination. */
export function useSaveBackupSchedule() {
  const qc = useQueryClient();
  return useMutation(
    orpc.backup.saveSchedule.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.backup.key() }),
    }),
  );
}

export function useTestDrive() {
  return useMutation(orpc.backup.testDrive.mutationOptions());
}

export function useBackupDownload() {
  return useMutation(orpc.backup.downloadUrl.mutationOptions());
}
