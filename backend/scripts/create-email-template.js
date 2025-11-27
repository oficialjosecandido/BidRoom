#!/usr/bin/env node

/**
 * Script to create a new email template for all supported languages
 * Usage: node scripts/create-email-template.js <template-name>
 * Example: node scripts/create-email-template.js bidReceived
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '../src/email-templates');
const SUPPORTED_LANGUAGES = ['en', 'pt', 'es', 'fr', 'de'];
const EXAMPLE_TEMPLATE = path.join(__dirname, '../src/email-templates/template.example.json');

const templateName = process.argv[2];

if (!templateName) {
  console.error('❌ Error: Template name is required');
  console.log('\nUsage: node scripts/create-email-template.js <template-name>');
  console.log('Example: node scripts/create-email-template.js bidReceived\n');
  process.exit(1);
}

// Validate template name (alphanumeric and camelCase)
if (!/^[a-z][a-zA-Z0-9]*$/.test(templateName)) {
  console.error('❌ Error: Template name must be in camelCase (e.g., bidReceived, auctionEnded)');
  process.exit(1);
}

// Read example template
let exampleContent;
try {
  exampleContent = fs.readFileSync(EXAMPLE_TEMPLATE, 'utf8');
} catch (error) {
  console.error('❌ Error reading example template:', error.message);
  process.exit(1);
}

// Create templates for each language
console.log(`\n📝 Creating email template: ${templateName}\n`);

let created = 0;
let skipped = 0;

for (const lang of SUPPORTED_LANGUAGES) {
  const langDir = path.join(TEMPLATES_DIR, lang);
  const templatePath = path.join(langDir, `${templateName}.json`);

  // Check if template already exists
  if (fs.existsSync(templatePath)) {
    console.log(`⚠️  Skipped ${lang}/${templateName}.json (already exists)`);
    skipped++;
    continue;
  }

  // Ensure language directory exists
  if (!fs.existsSync(langDir)) {
    fs.mkdirSync(langDir, { recursive: true });
    console.log(`📁 Created directory: ${lang}/`);
  }

  // Create template file
  try {
    fs.writeFileSync(templatePath, exampleContent, 'utf8');
    console.log(`✅ Created ${lang}/${templateName}.json`);
    created++;
  } catch (error) {
    console.error(`❌ Failed to create ${lang}/${templateName}.json:`, error.message);
  }
}

console.log(`\n✨ Done! Created ${created} template(s), skipped ${skipped} existing template(s)`);
console.log(`\n📋 Next steps:`);
console.log(`   1. Edit the template files in src/email-templates/<lang>/${templateName}.json`);
console.log(`   2. Replace placeholder content with actual email content`);
console.log(`   3. Use variables with {{variableName}} syntax`);
console.log(`   4. Test the template: const email = renderEmailTemplate('${templateName}', 'en', {...data});\n`);

