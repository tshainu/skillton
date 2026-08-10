import { assetImports } from "./asset-imports.mjs";
import { protectedFiles } from "./protected-files.mjs";

// Every custom template lint rule, composed into one oxlint plugin under the
// "template" namespace. This whole folder is template-managed (the __ prefix),
// so the platform declares the rules — apps can't add, edit, or disable them.
//
// To add a rule: create a sibling file exporting the rule object, import it
// here, register it below, and enable it in .oxlintrc.json under "template/".

const plugin = {
  meta: { name: "template" },
  rules: {
    "asset-imports": assetImports,
    "protected-files": protectedFiles,
  },
};

export default plugin;
