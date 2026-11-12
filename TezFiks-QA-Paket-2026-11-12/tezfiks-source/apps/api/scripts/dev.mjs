// Development server: `tsc --watch` (keeps the decorator metadata NestJS needs for constructor injection; tsx/esbuild drops it)
// plus `node --watch` on the compiled output, restarted whenever tsc writes new files. Run from apps/api: `npm run dev`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

const tsc = spawn(process.execPath, [tscBin, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
let app = null;

tsc.stdout.on('data', (chunk) => {
  const text = String(chunk);
  process.stdout.write(text);
  // Start the API after the first clean compile; node --watch restarts it on later compiles.
  if (!app && /Found 0 errors/.test(text)) {
    app = spawn(process.execPath, ['--watch-path=dist', 'dist/src/main.js'], { stdio: 'inherit' });
    app.on('exit', (code) => {
      if (code !== null && code !== 0) console.error(`[dev] API exited with code ${code}; it restarts on the next successful compile.`);
    });
  }
});

const stop = () => {
  tsc.kill();
  app?.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
tsc.on('exit', (code) => {
  app?.kill();
  process.exit(code ?? 0);
});
