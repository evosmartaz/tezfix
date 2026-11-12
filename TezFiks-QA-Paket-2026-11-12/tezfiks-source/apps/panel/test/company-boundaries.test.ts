/**
 * Server/client boundary of the company panel (lane P2): server pages may render components from 'use client' modules
 * but must never call plain functions exported from them (Next.js throws "Attempted to call X() from the server").
 * Also checks that no company code reaches for KYC documents or admin endpoints (managers never see KYC files).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const companyApp = files(join(root, 'src/app/company'));
const companyFeature = files(join(root, 'src/features/company'));

function isClientModule(src: string): boolean {
  return /^\s*['"]use client['"]/.test(src);
}

describe('company panel boundaries', () => {
  it('server pages import only components (PascalCase) or types from client modules', () => {
    const offenders: string[] = [];
    for (const page of companyApp) {
      const src = readFileSync(page, 'utf8');
      if (isClientModule(src)) continue;
      for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]+)\}\s+from\s+'@\/([^']+)'/g)) {
        if (m[1]) continue;
        const target = join(root, 'src', m[3]!);
        const candidates = [`${target}.tsx`, `${target}.ts`, join(target, 'index.tsx'), join(target, 'index.ts')];
        const file = candidates.find((c) => {
          try {
            return statSync(c).isFile();
          } catch {
            return false;
          }
        });
        if (!file || !isClientModule(readFileSync(file, 'utf8'))) continue;
        for (const raw of m[2]!.split(',')) {
          const name = raw.trim().replace(/^type\s+/, '');
          if (!name || raw.trim().startsWith('type ')) continue;
          if (!/^[A-Z]/.test(name)) offenders.push(`${relative(root, page)}: ${name} from ${m[3]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('company code never calls KYC document or admin endpoints', () => {
    const offenders = [...companyApp, ...companyFeature].filter((f) =>
      /api\.(admin|adminCategories|kyc)\./.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });
});
