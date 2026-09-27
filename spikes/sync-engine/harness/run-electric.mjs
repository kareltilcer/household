import { scenario3, scenario7, accessLoss } from './electric.mjs';
import { admin } from './common.mjs';
const [which = 'all', variant = 'gate', replica = 'shape'] = process.argv.slice(2);
const all = [];
try {
  if (which === 'all' || which === '3') all.push(...(await scenario3(variant)));
  if (which === 'all' || which === '7') all.push(...(await scenario7(variant, replica)));
  if (which === 'all' || which === 'loss') all.push(...(await accessLoss(variant, replica)));
} finally {
  await admin.end();
}
console.log(JSON.stringify({ failed: all.filter((r) => r.ok === false).length, total: all.length }));
process.exit(0);
