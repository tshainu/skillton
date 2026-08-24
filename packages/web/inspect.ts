import { createClient } from "@libsql/client";
const db = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
const iv = await db.execute({
  sql: `SELECT id, status, conducted_at, duration_seconds, question_set_id, topic_coverage, transcript, proctor_events
        FROM interviews_ai WHERE candidate_id = ? ORDER BY conducted_at DESC LIMIT 3`,
  args: ["cnd_k28rakofxjhx2j7n"],
});
for (const r of iv.rows) {
  console.log("=== interview", r.id, r.status, r.conducted_at, "dur", r.duration_seconds, "qset", r.question_set_id);
  console.log("coverage:", r.topic_coverage);
}
const last = iv.rows[0];
if (last) {
  const turns = JSON.parse((last.transcript as string) ?? "[]");
  console.log("\n--- TRANSCRIPT", turns.length, "turns ---");
  for (const t of turns) console.log(`[${t.role}] ${t.text}`);
  console.log("\n--- PROCTOR ---");
  console.log(last.proctor_events);
  await Bun.write("/tmp/last-interview.json", JSON.stringify(last, null, 2));
}
