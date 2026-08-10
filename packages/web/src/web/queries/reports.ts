import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Reporting suite. Every report is read-only and cached for a minute. */

const STALE = 60_000;

export function useExecutiveReport(days = 365) {
  return useQuery(orpc.reports.executive.queryOptions({ input: { days }, staleTime: STALE }));
}

export function usePipelineReport() {
  return useQuery(orpc.reports.pipeline.queryOptions({ staleTime: STALE }));
}

export function useJdPerformanceReport() {
  return useQuery(orpc.reports.jdPerformance.queryOptions({ staleTime: STALE }));
}

export function useRecruiterPerformanceReport() {
  return useQuery(orpc.reports.recruiterPerformance.queryOptions({ staleTime: STALE }));
}

export function useClientPerformanceReport() {
  return useQuery(orpc.reports.clientPerformance.queryOptions({ staleTime: STALE }));
}

export function usePlacementReport(period: "monthly" | "quarterly" | "yearly" = "monthly") {
  return useQuery(orpc.reports.placementReport.queryOptions({ input: { period }, staleTime: STALE }));
}

export function useCandidateAnalyticsReport(days = 365) {
  return useQuery(orpc.reports.candidateAnalytics.queryOptions({ input: { days }, staleTime: STALE }));
}

export function useAiMatchingAnalyticsReport() {
  return useQuery(orpc.reports.aiMatchingAnalytics.queryOptions({ staleTime: STALE }));
}

export function useReportCatalogue() {
  return useQuery(orpc.reports.catalogue.queryOptions({ staleTime: STALE }));
}
