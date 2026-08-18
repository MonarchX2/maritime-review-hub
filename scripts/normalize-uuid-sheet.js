#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function generateUuid8() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function normalizeSubject(subject) {
  return String(subject ?? '').trim();
}

function isTruthy(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
  }
  return Boolean(value);
}

function normalizeExistingRow(row) {
  if (Array.isArray(row)) {
    const [uuid, subject, hidden, password, createdAt] = row;
    return {
      UUID: String(uuid ?? '').trim(),
      Subject: String(subject ?? '').trim(),
      Hidden: isTruthy(hidden) ? 'true' : '',
      Password: String(password ?? '').trim(),
      CreatedAt: String(createdAt ?? '').trim(),
    };
  }

  if (row && typeof row === 'object') {
    return {
      UUID: String(row.UUID ?? row.uuid ?? '').trim(),
      Subject: normalizeSubject(row.Subject ?? row.subject),
      Hidden: isTruthy(row.Hidden ?? row.hidden) ? 'true' : '',
      Password: String(row.Password ?? row.password ?? '').trim(),
      CreatedAt: String(row.CreatedAt ?? row.createdAt ?? '').trim(),
    };
  }

  return null;
}

function loadUuidSheet(inputPath) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = JSON.parse(raw);

  let rows = [];
  let outputShape = 'array';

  if (Array.isArray(parsed)) {
    rows = parsed
      .map(normalizeExistingRow)
      .filter(Boolean);
  } else if (parsed && Array.isArray(parsed.rows)) {
    rows = parsed.rows
      .map(normalizeExistingRow)
      .filter(Boolean);
    outputShape = 'rows';
  } else if (parsed && Array.isArray(parsed.values)) {
    rows = parsed.values
      .map(normalizeExistingRow)
      .filter(Boolean);
    outputShape = 'values';
  } else if (parsed && Array.isArray(parsed.data)) {
    rows = parsed.data
      .map(normalizeExistingRow)
      .filter(Boolean);
    outputShape = 'data';
  } else {
    throw new Error(
      'Unsupported UUID sheet format. Expected a JSON array or an object with rows/values/data arrays.'
    );
  }

  return { rows, outputShape };
}

function appendMissingParentSubjects(rows) {
  const seen = new Map();

  rows.forEach((row) => {
    const subject = normalizeSubject(row.Subject);
    if (subject) seen.set(subject, row);
  });

  const appended = [];

  for (const row of rows) {
    const subject = normalizeSubject(row.Subject);
    if (!subject) continue;

    const parts = subject.split('::').filter(Boolean);
    if (parts.length <= 1) continue;

    let parentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      parentPath = parentPath ? `${parentPath}::${segment}` : segment;

      if (seen.has(parentPath)) continue;

      const parentRow = {
        UUID: generateUuid8(),
        Subject: parentPath,
        Hidden: '',
        Password: '',
        CreatedAt: new Date().toISOString(),
      };

      seen.set(parentPath, parentRow);
      appended.push(parentRow);
    }
  }

  return [...rows, ...appended];
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const left = normalizeSubject(a.Subject);
    const right = normalizeSubject(b.Subject);
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function writeOutput(outputPath, rows, outputShape) {
  let payload;

  if (outputShape === 'rows') {
    payload = { rows };
  } else if (outputShape === 'values') {
    payload = { values: rows };
  } else if (outputShape === 'data') {
    payload = { data: rows };
  } else {
    payload = rows;
  }

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
}

function main() {
  const args = process.argv.slice(2);
  const inputPathArg = args.find((arg) => arg.startsWith('--input='))
    ? args.find((arg) => arg.startsWith('--input='))
        .split('=')[1]
    : args[0];

  const outputPathArg = args.find((arg) => arg.startsWith('--output='))
    ? args.find((arg) => arg.startsWith('--output='))
        .split('=')[1]
    : inputPathArg;

  const inputPath = path.resolve(inputPathArg || './uuid-sheet.json');
  const outputPath = path.resolve(outputPathArg || inputPath);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const { rows, outputShape } = loadUuidSheet(inputPath);
  const normalized = sortRows(appendMissingParentSubjects(rows));

  writeOutput(outputPath, normalized, outputShape);

  const addedCount = normalized.length - rows.length;
  console.log(`UUID normalization complete.`);
  console.log(`Existing rows: ${rows.length}`);
  console.log(`Added parent rows: ${addedCount}`);
  console.log(`Final rows: ${normalized.length}`);
  console.log(`Saved to: ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error('UUID normalization failed:');
  console.error(error.message);
  process.exit(1);
}
