import { scenario3, scenario7, accessLoss, axes } from './powersync.mjs';
import { admin } from './common.mjs';
const which = process.argv[2] ?? 'all';
const all = [];
try {
  if (which === 'all' || which === '3') all.push(...(await scenario3()));
  if (which === 'all' || which === '7') all.push(...(await scenario7()));
  if (which === 'all' || which === 'loss') all.push(...(await accessLoss()));
  if (which === 'all' || which === 'axes') all.push(...(await axes()));
} finally {
  await admin.end();
}
console.log(JSON.stringify({ failed: all.filter((r) => r.ok === false).length, total: all.length }));
process.exit(0);
