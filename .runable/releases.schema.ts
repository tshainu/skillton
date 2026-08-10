import { valid as validSemanticVersion } from "semver";
import { z } from "zod/v4";

const semanticVersionSchema = z.stringFormat("semantic-version", (version) => {
  const [versionPrecedence] = version.split("+", 1);
  return validSemanticVersion(version) === versionPrecedence;
});
const gitRevisionSchema = z.hash("sha1");

const releaseSchema = z.strictObject({
  version: semanticVersionSchema,
  policy: z.enum(["optional", "required"]),
  revision: gitRevisionSchema.optional(),
  released_at: z.iso.datetime({ offset: true }).optional(),
  migration_notes: z.array(z.string().min(1)).min(1).optional(),
  verification_commands: z.array(z.string().min(1)).min(1).optional(),
  runtime_checks: z.array(z.string().min(1)).min(1).optional(),
});

export const releaseJournalSchema = z
  .strictObject({
    schema_version: z.literal(1),
    releases: z.array(releaseSchema).min(1),
  })
  .superRefine(({ releases }, context) => {
    const [baselineRelease, ...newReleases] = releases;

    if (!baselineRelease?.revision || !baselineRelease.released_at) {
      context.addIssue({
        code: "custom",
        path: ["releases", 0],
        message: "The baseline release must include revision and released_at",
      });
    }

    newReleases.forEach((release, index) => {
      if (!release.revision && !release.released_at) return;
      context.addIssue({
        code: "custom",
        path: ["releases", index + 1],
        message: "New releases derive revision and released_at from their introduction commit",
      });
    });

    if (new Set(releases.map(({ version }) => version)).size === releases.length) return;
    context.addIssue({
      code: "custom",
      path: ["releases"],
      message: "Release versions must be unique",
    });
  });
