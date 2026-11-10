// Fails when vendor material is tracked by git. RME/Elgato documents, tables and binaries are
// copyrighted: they live in the gitignored docs/vendor/ (see scripts/fetch-vendor.sh).
import { execFileSync } from 'node:child_process';

const allowedInVendor = new Set(['docs/vendor/README.md']);
const blockedExtensions = /\.(pdf|zip|7z|rar|xls|xlsx|xlsm|doc|docx|streamDeckPlugin)$/i;

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => file !== '');

const offending = tracked.filter(
  (file) =>
    (file.startsWith('docs/vendor/') && !allowedInVendor.has(file)) || blockedExtensions.test(file),
);

if (offending.length > 0) {
  console.error('Vendor material must not be committed (keep it in the gitignored docs/vendor/):');
  for (const file of offending) console.error(`  ${file}`);
  console.error('Remove it with `git rm --cached <file>`.');
  process.exit(1);
}

console.log(`check:vendor: ${String(tracked.length)} tracked files, no vendor material.`);
