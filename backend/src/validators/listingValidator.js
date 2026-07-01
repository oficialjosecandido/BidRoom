'use strict';

const { getAttributeSchema } = require('../config/categoryAttributes');

/**
 * Validates and coerces submitted attributes against the category schema.
 *
 * Returns { valid, errors, cleaned }:
 *   valid   – false when any required field is missing or type invalid
 *   errors  – array of { key, message }
 *   cleaned – coerced values safe to store (booleans cast, numbers parsed, strings trimmed)
 */
function validateAttributes(attributes = {}, subCategory, category) {
  const schema = getAttributeSchema(subCategory, category);
  const errors  = [];
  const cleaned = {};

  for (const def of schema) {
    const raw = attributes[def.key];
    const missing = raw === undefined || raw === null || raw === '';

    if (def.required && missing) {
      errors.push({ key: def.key, message: `${def.label} é obrigatório.` });
      continue;
    }
    if (missing) continue;

    switch (def.type) {
      case 'number': {
        const n = Number(raw);
        if (Number.isNaN(n)) errors.push({ key: def.key, message: `${def.label} deve ser um número.` });
        else cleaned[def.key] = n;
        break;
      }
      case 'boolean':
        cleaned[def.key] = raw === true || raw === 'true';
        break;
      case 'enum':
        if (!def.options.includes(raw)) {
          errors.push({ key: def.key, message: `${def.label}: valor inválido. Opções: ${def.options.join(', ')}.` });
        } else {
          cleaned[def.key] = raw;
        }
        break;
      default:
        cleaned[def.key] = String(raw).trim().slice(0, 300);
    }
  }

  return { valid: errors.length === 0, errors, cleaned };
}

module.exports = { validateAttributes };
