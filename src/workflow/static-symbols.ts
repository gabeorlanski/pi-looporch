/** Provides static symbols behavior. */
import * as ts from "typescript";

/** Creates a TypeScript checker that resolves lexical bindings in one workflow source file. */
export function createWorkflowTypeChecker(sourceFile: ts.SourceFile): ts.TypeChecker {
  const options: ts.CompilerOptions = {
    allowJs: true,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    noLib: true,
    target: ts.ScriptTarget.Latest,
  };
  const host: ts.CompilerHost = {
    fileExists: (fileName) => fileName === sourceFile.fileName,
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => "",
    getDirectories: () => [],
    getNewLine: () => "\n",
    getSourceFile: (fileName) => (fileName === sourceFile.fileName ? sourceFile : undefined),
    readFile: (fileName) => (fileName === sourceFile.fileName ? sourceFile.text : undefined),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => undefined,
  };
  return ts.createProgram([sourceFile.fileName], options, host).getTypeChecker();
}
