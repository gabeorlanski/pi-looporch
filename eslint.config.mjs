import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const tsFiles = ["**/*.ts"];
const sourceFiles = ["extensions/**/*.ts", "scripts/**/*.ts", "src/**/*.ts"];
const typeCheckedConfigs = [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked].map((config) => ({
  ...config,
  files: tsFiles,
}));

/** Enforces concise module and public-API JSDoc where consumers need contracts. */
const documentationRules = {
  rules: {
    "module-doc": {
      meta: {
        type: "suggestion",
        fixable: "code",
        docs: { description: "require a leading JSDoc module purpose" },
        messages: { missing: "Source modules must begin with a JSDoc comment that states their purpose." },
        schema: [],
      },
      create(context) {
        const sourceCode = context.sourceCode;
        return {
          Program(node) {
            const firstToken = sourceCode.getFirstToken(node);
            const lastLeadingComment = sourceCode
              .getAllComments()
              .filter((comment) => comment.range[1] <= firstToken.range[0])
              .at(-1);
            if (
              !lastLeadingComment ||
              lastLeadingComment.type !== "Block" ||
              !lastLeadingComment.value.startsWith("*") ||
              sourceCode.text.slice(lastLeadingComment.range[1], firstToken.range[0]).trim() !== ""
            ) {
              const moduleName =
                context.filename
                  .split("/")
                  .at(-1)
                  ?.replace(/\.[^.]+$/, "")
                  .replaceAll(/[-_]/g, " ") ?? "source";
              context.report({
                node,
                messageId: "missing",
                fix(fixer) {
                  return fixer.insertTextBefore(firstToken, `/** Provides ${moduleName} behavior. */\n`);
                },
              });
            }
          },
        };
      },
    },
    "public-api-jsdoc": {
      meta: {
        type: "suggestion",
        fixable: "code",
        docs: { description: "require JSDoc contracts for exported runtime declarations" },
        messages: { missing: "Exported {{kind}} '{{name}}' must have a leading JSDoc contract." },
        schema: [],
      },
      create(context) {
        const sourceCode = context.sourceCode;
        const hasLeadingJsDoc = (node) => {
          const lastLeadingComment = sourceCode.getCommentsBefore(node).at(-1);
          return Boolean(lastLeadingComment && lastLeadingComment.type === "Block" && lastLeadingComment.value.startsWith("*"));
        };
        const report = (node, kind, name) => {
          if (!hasLeadingJsDoc(node)) {
            context.report({
              node,
              messageId: "missing",
              data: { kind, name },
              fix(fixer) {
                return fixer.insertTextBefore(node, `/** Provides the ${name} ${kind} contract. */\n`);
              },
            });
          }
        };
        const checkDeclaration = (declaration, exportNode) => {
          if (declaration.type === "FunctionDeclaration") report(exportNode, "function", declaration.id?.name ?? "default");
          if (declaration.type === "ClassDeclaration") report(exportNode, "class", declaration.id?.name ?? "default");
          if (declaration.type === "VariableDeclaration") {
            for (const variable of declaration.declarations) {
              if (
                variable.id.type === "Identifier" &&
                (variable.init?.type === "ArrowFunctionExpression" || variable.init?.type === "FunctionExpression")
              ) {
                report(exportNode, "function", variable.id.name);
              }
            }
          }
        };
        return {
          ExportNamedDeclaration(node) {
            if (node.declaration) checkDeclaration(node.declaration, node);
          },
          ExportDefaultDeclaration(node) {
            if (node.declaration.type !== "Identifier") checkDeclaration(node.declaration, node);
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: ["node_modules/**", "coverage/**", "dist/**", ".pi/**", ".husky/**"],
  },
  js.configs.recommended,
  ...typeCheckedConfigs,
  eslintConfigPrettier,
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: sourceFiles,
    plugins: { documentation: documentationRules },
    rules: {
      "documentation/module-doc": "error",
      "documentation/public-api-jsdoc": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true, allowTypedFunctionExpressions: true }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
    },
  },
);
