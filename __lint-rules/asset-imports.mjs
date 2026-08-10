import path from "node:path";
import { fileURLToPath } from "node:url";

// The `asset-imports` rule: web static assets (images, videos, fonts, audio)
// live in packages/web/public/ and are referenced by absolute URL path — never
// imported from source. Scoped to packages/web; Expo (packages/mobile)
// requires asset imports, so mobile is exempt by design.

const ASSET_EXT =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot)(\?.*)?$/i;
const LOCAL_SPECIFIER = /^(\.\.?\/|@\/)/; // relative or "@/" alias — bare package imports stay legal

const rulesDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(rulesDir);

export const assetImports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Static assets must live in packages/web/public/ and be referenced by URL path, not imported.",
    },
  },
  create(context) {
    const filename = context.physicalFilename ?? context.filename;
    const rel = path.relative(rootDir, filename).split(path.sep).join("/");
    if (!rel.startsWith("packages/web/")) return {};

    const check = (node, source) => {
      if (typeof source !== "string") return;
      if (!LOCAL_SPECIFIER.test(source) || !ASSET_EXT.test(source)) return;
      context.report({
        node,
        message:
          `Static assets belong in packages/web/public/ — move "${source}" into public/ and ` +
          `reference it by absolute URL path instead of importing it ` +
          `(e.g. <img src="/images/hero.png" /> or CSS url('/fonts/heading.woff2')). ` +
          `Files in public/ are served at / and optimized automatically at build time.`,
      });
    };

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") check(node, node.source.value);
      },
      NewExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "URL" &&
          node.arguments[0]?.type === "Literal"
        ) {
          check(node, node.arguments[0].value);
        }
      },
    };
  },
};
