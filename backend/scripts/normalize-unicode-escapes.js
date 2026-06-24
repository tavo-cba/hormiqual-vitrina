// Helper one-off: convierte escapes \uXXXX literales a sus caracteres UTF-8
// en ensayoEvalEngine.js. Ejecutar: node scripts/normalize-unicode-escapes.js

'use strict';
const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'src', 'domain', 'ensayoEvalEngine.js');
const original = fs.readFileSync(target, 'utf8');

// Solo reemplazar dentro de strings literales y template literals.
// Aprox: matchear \uXXXX que NO esté precedido por \\ (escape doble).
// Para este archivo en particular no hay regex con \u (verificado), así que
// es seguro hacer un replace global.

const pattern = /\\u([0-9a-fA-F]{4})/g;
const matches = original.match(pattern) || [];
console.log(`Found ${matches.length} \\uXXXX escape sequences.`);

const converted = original.replace(pattern, (_, hex) => {
  return String.fromCharCode(parseInt(hex, 16));
});

if (converted === original) {
  console.log('No changes — nothing to do.');
  process.exit(0);
}

fs.writeFileSync(target, converted, 'utf8');
console.log(`✓ Wrote ${target} with converted escapes.`);
console.log(`  Bytes before: ${original.length}, after: ${converted.length}.`);
