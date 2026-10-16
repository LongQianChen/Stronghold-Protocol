#!/usr/bin/env node
// Write schemas/records.schema.json from the runtime RECORDS_SCHEMA (DESIGN §32.5, PLUGINS §10).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDS_SCHEMA } from '../shared/plugins/recordsSchema.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'schemas/records.schema.json'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(RECORDS_SCHEMA, null, 2)}\n`);
