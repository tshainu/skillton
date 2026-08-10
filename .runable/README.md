# Managed App Releases

`releases.json` is the source of truth for app-impacting template releases. The latest entry's
version is also written to `.template-version`.

`build-template.ts` regenerates the derived files (`.template-version` and
`.runable/protected-files.json`) from `releases.json` and the `__` files, and validates
`releases.json` under `--check`. It is platform tooling run by the sandbox image build
(`runable/packages/sandbox`) against the cloned template — not an app script, and not part of the
app's `bun run lint`. Run it directly (`bun run .runable/build-template.ts`) when iterating on the
template locally.

Add a release entry in the same commit as the template changes:

```json
{
  "version": "0.1.1",
  "policy": "optional"
}
```

Only add fields when the template diff is insufficient or shared checks need an override:

```json
{
  "version": "0.1.2",
  "policy": "required",
  "migration_notes": ["Preserve customized Expo plugins."],
  "verification_commands": ["bun install", "bun run typecheck", "bun run build"],
  "runtime_checks": ["The web preview starts without startup errors."]
}
```

Runable derives `revision` and `released_at` from the commit where the version first appears. The
explicit values on `0.1.0` only seed the historical baseline and must not be added to new releases.
