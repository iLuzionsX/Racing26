import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const appPath = path.resolve(process.cwd(), 'src/App.tsx');
const program = ts.createProgram({
  rootNames: [appPath],
  options: {
    noEmit: true,
    noResolve: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
  },
});

const runtimeScopeCodes = new Set([
  2304,  // Cannot find name
  2448,  // Block-scoped variable used before declaration
  2454,  // Variable used before being assigned
  2503,  // Cannot find namespace
  2552,  // Cannot find name; did you mean...
  18004, // No value exists in scope for shorthand property
]);

const diagnostics = ts
  .getPreEmitDiagnostics(program)
  .filter((diagnostic) => {
    if (!runtimeScopeCodes.has(diagnostic.code)) return false;
    if (!diagnostic.file) return false;
    return path.resolve(diagnostic.file.fileName) === appPath;
  });

if (diagnostics.length > 0) {
  console.error('App runtime wiring check failed:');
  for (const diagnostic of diagnostics) {
    const position = diagnostic.file && diagnostic.start != null
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : null;
    const where = position
      ? `${path.relative(process.cwd(), diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1}`
      : 'src/App.tsx';
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    console.error(`  TS${diagnostic.code} ${where} — ${message}`);
  }
  process.exit(1);
}

console.log('AppRuntimeWiringCheck: PASS');
