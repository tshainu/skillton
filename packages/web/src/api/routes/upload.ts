import { z } from "zod";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "../lib/s3";
import { authed } from "../middleware/auth";

const safe = (name: string) => name.replace(/[^\w.-]+/g, "_").slice(-80);

export const upload = {
  /** Presigned PUT for direct browser -> Tigris upload of a CV or JD document. */
  presign: authed
    .input(
      z.object({
        filename: z.string(),
        contentType: z.string(),
        kind: z.enum(["cv", "jd", "recording"]).default("cv"),
      }),
    )
    .handler(async ({ input, context }) => {
      const key = `${context.agencyId}/${input.kind}/${Date.now()}-${safe(input.filename)}`;
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: input.contentType }),
        { expiresIn: 900 },
      );
      return { url, key };
    }),

  /** Presigned GET so recruiters can open the original document. */
  download: authed
    .input(z.object({ key: z.string() }))
    .handler(async ({ input, context }) => {
      if (!input.key.startsWith(`${context.agencyId}/`)) {
        return { url: null as string | null };
      }
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: input.key }), {
        expiresIn: 3600,
      });
      return { url };
    }),
};
