/**
 * Template Engine Service
 * Handles loading and rendering email templates with variable substitution
 * Supports 5+ languages and 100+ email templates
 */

const fs = require('fs');
const path = require('path');
const { wrapBidRoomEmail } = require('../utils/bidroomEmailLayout');

const TEMPLATES_DIR = path.join(__dirname, '../email-templates');
const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = ['en', 'pt', 'es', 'fr', 'de'];

// Cache for loaded templates (improves performance)
const templateCache = new Map();

/**
 * Simple template variable substitution using {{variableName}} syntax
 * Supports nested objects with dot notation (e.g., {{user.name}})
 * 
 * @param {string} template - Template string with {{variables}}
 * @param {object} data - Data object to substitute
 * @returns {string} Rendered template
 */
function renderTemplate(template, data) {
  let rendered = template;
  
  // Replace all {{variable}} or {{object.property}} occurrences
  const variableRegex = /\{\{(\w+(?:\.\w+)*)\}\}/g;
  
  rendered = rendered.replace(variableRegex, (match, varPath) => {
    // Handle dot notation for nested objects (e.g., user.name)
    const value = varPath.split('.').reduce((obj, key) => {
      return obj && obj[key] !== undefined ? obj[key] : undefined;
    }, data);
    
    // Return value if found, otherwise keep the original placeholder
    return value !== undefined ? String(value) : match;
  });
  
  return rendered;
}

/**
 * Load a template from file system
 * Templates are cached for performance
 * 
 * @param {string} templateName - Name of the template (e.g., 'auctionClosed')
 * @param {string} language - Language code (e.g., 'en', 'pt')
 * @returns {object} Template object with subject, html, and text
 */
function loadTemplate(templateName, language = DEFAULT_LANGUAGE) {
  // Normalize language
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    console.warn(`⚠️  Language "${language}" not supported, using "${DEFAULT_LANGUAGE}"`);
    language = DEFAULT_LANGUAGE;
  }

  const cacheKey = `${language}:${templateName}`;
  
  // Check cache first
  if (templateCache.has(cacheKey)) {
    return templateCache.get(cacheKey);
  }

  // Try to load template for requested language
  let templatePath = path.join(TEMPLATES_DIR, language, `${templateName}.json`);
  
  // Fallback to default language if template not found
  if (!fs.existsSync(templatePath)) {
    if (language !== DEFAULT_LANGUAGE) {
      console.warn(`⚠️  Template "${templateName}" not found for language "${language}", using "${DEFAULT_LANGUAGE}"`);
      templatePath = path.join(TEMPLATES_DIR, DEFAULT_LANGUAGE, `${templateName}.json`);
    }
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template "${templateName}" not found for language "${language}" or "${DEFAULT_LANGUAGE}"`);
    }
  }

  try {
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const template = JSON.parse(templateContent);
    
    // Validate template structure
    if (!template.subject) {
      throw new Error(`Invalid template structure for "${templateName}": missing "subject" field`);
    }
    const usesLayout = template.layout === 'bidroom';
    if (!usesLayout && !template.html) {
      throw new Error(`Invalid template structure for "${templateName}": missing "html" field`);
    }
    if (usesLayout && (!template.body || !template.title)) {
      throw new Error(`Invalid template structure for "${templateName}": layout "bidroom" requires "title" and "body"`);
    }
    
    // text field is optional
    if (!template.text) {
      template.text = null;
    }
    
    // Cache the template
    templateCache.set(cacheKey, template);
    
    return template;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Template file not found: ${templatePath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in template file "${templatePath}": ${error.message}`);
    }
    throw error;
  }
}

/**
 * Render a template with data
 * 
 * @param {string} templateName - Name of the template
 * @param {string} language - Language code (defaults to 'en')
 * @param {object} data - Data to substitute in template
 * @returns {object} Rendered email with subject, html, and optional text
 * 
 * @example
 * const email = renderEmailTemplate('auctionClosed', 'en', {
 *   bidderName: 'John Doe',
 *   listingTitle: 'Vintage Camera',
 *   finalBid: '$150',
 *   listingUrl: 'https://example.com/listing/123'
 * });
 */
function renderEmailTemplate(templateName, language = DEFAULT_LANGUAGE, data = {}) {
  const template = loadTemplate(templateName, language);

  const subject = renderTemplate(template.subject, data);
  const text = template.text ? renderTemplate(template.text, data) : null;

  let html;
  if (template.layout === 'bidroom') {
    html = wrapBidRoomEmail({
      title: renderTemplate(template.title, data),
      preheader: template.preheader ? renderTemplate(template.preheader, data) : undefined,
      bodyHtml: renderTemplate(template.body, data),
      ctaUrl: template.ctaUrl ? renderTemplate(template.ctaUrl, data) : undefined,
      ctaLabel: template.ctaLabel ? renderTemplate(template.ctaLabel, data) : undefined
    });
  } else {
    html = renderTemplate(template.html, data);
  }

  return { subject, html, text };
}

/**
 * Get list of available templates for a language
 * 
 * @param {string} language - Language code
 * @returns {string[]} Array of template names
 */
function getAvailableTemplates(language = DEFAULT_LANGUAGE) {
  const langDir = path.join(TEMPLATES_DIR, language);
  
  if (!fs.existsSync(langDir)) {
    return [];
  }
  
  try {
    const files = fs.readdirSync(langDir);
    return files
      .filter(file => file.endsWith('.json') && file !== 'template.example.json')
      .map(file => file.replace('.json', ''));
  } catch (error) {
    console.error(`Error reading templates directory for "${language}":`, error.message);
    return [];
  }
}

/**
 * Get list of all available templates across all languages
 * 
 * @returns {object} Object with language keys and arrays of template names
 */
function getAllAvailableTemplates() {
  const result = {};
  
  for (const lang of SUPPORTED_LANGUAGES) {
    result[lang] = getAvailableTemplates(lang);
  }
  
  return result;
}

/**
 * Check if a template exists
 * 
 * @param {string} templateName - Name of the template
 * @param {string} language - Language code
 * @returns {boolean}
 */
function templateExists(templateName, language = DEFAULT_LANGUAGE) {
  const templatePath = path.join(TEMPLATES_DIR, language, `${templateName}.json`);
  return fs.existsSync(templatePath);
}

/**
 * Clear template cache (useful for development/testing)
 */
function clearCache() {
  templateCache.clear();
  console.log('✅ Template cache cleared');
}

/**
 * Preload all templates for a language (useful for warmup)
 * 
 * @param {string} language - Language code
 * @returns {number} Number of templates loaded
 */
function preloadTemplates(language = DEFAULT_LANGUAGE) {
  const templates = getAvailableTemplates(language);
  let loaded = 0;
  
  for (const templateName of templates) {
    try {
      loadTemplate(templateName, language);
      loaded++;
    } catch (error) {
      console.warn(`Failed to preload template "${templateName}" for "${language}":`, error.message);
    }
  }
  
  console.log(`✅ Preloaded ${loaded} template(s) for language "${language}"`);
  return loaded;
}

module.exports = {
  renderEmailTemplate,
  loadTemplate,
  getAvailableTemplates,
  getAllAvailableTemplates,
  templateExists,
  clearCache,
  preloadTemplates,
  renderTemplate, // Exposed for testing
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE
};
