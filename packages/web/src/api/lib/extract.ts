import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "./s3";

/** Download an object from Tigris as a Buffer. */
export async function downloadObject(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

function cleanText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract plain text from a CV/JD document (pdf, docx, txt). */
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "pdf") {
    const { extractText: pdfExtract, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await pdfExtract(pdf, { mergePages: true });
    return cleanText(Array.isArray(text) ? text.join("\n") : text);
  }

  if (ext === "docx" || ext === "doc") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    return cleanText(value);
  }

  return cleanText(buffer.toString("utf8"));
}

export async function extractFromKey(key: string, filename: string): Promise<string> {
  const buffer = await downloadObject(key);
  return extractText(buffer, filename);
}
