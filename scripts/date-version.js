"use strict";

const DATE_VERSION_PATTERN =
  /^(\d{2})\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])-(0|[1-9]\d*)$/;

function parseDateVersion(version) {
  const match = DATE_VERSION_PATTERN.exec(String(version || ""));
  if (!match) return null;
  const [, year, month, day, patch] = match;
  const fullYear = 2000 + Number(year);
  const date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== fullYear ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  )
    return null;
  return {
    year,
    month,
    day,
    patch: Number(patch),
  };
}

function isDateVersion(version) {
  return parseDateVersion(version) !== null;
}

function formatDateVersion({ year, month, day, patch }) {
  return `${year}.${month}.${day}-${patch}`;
}

module.exports = {
  DATE_VERSION_PATTERN,
  formatDateVersion,
  isDateVersion,
  parseDateVersion,
};
