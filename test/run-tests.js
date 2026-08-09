const { readdirSync } = require('node:fs');
const path = require('node:path');

for (const file of readdirSync(__dirname)
  .filter((name) => name.endsWith('.test.js'))
  .sort()) {
  require(path.join(__dirname, file));
}
