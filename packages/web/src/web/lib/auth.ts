import { createAuthClient } from "better-auth/react";
import { managedAuthClient } from "@runablehq/managed-auth/client";

const config = {
  applicationId: import.meta.env.VITE_APPLICATION_ID,
  issuer: import.meta.env.VITE_RUNABLE_AUTH_ISSUER,
};

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_WEBSITE_URL ?? window.location.origin,
  basePath: "/api/auth",
  plugins: [managedAuthClient(config)],
});

export type Role =
  | "super_admin"
  | "agency_admin"
  | "recruiter"
  | "tech_interviewer"
  | "client"
  | "candidate";

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  agency_admin: "Agency Admin",
  recruiter: "Recruiter",
  tech_interviewer: "Technical Interviewer",
  client: "Client",
  candidate: "Candidate",
};
