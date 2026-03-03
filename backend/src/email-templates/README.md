# Email Templates Directory

This directory contains all email templates organized by language.

## Structure

```
email-templates/
├── en/          # English templates
├── pt/          # Portuguese templates
├── es/          # Spanish templates
├── fr/          # French templates
├── de/          # German templates
└── README.md    # This file
```

## Template Format

Each template is a JSON file with the following structure:

```json
{
  "subject": "Email Subject with {{variable}}",
  "html": "<html>...{{variable}}...</html>",
  "text": "Plain text version with {{variable}}"
}
```

## Variable Substitution

Templates use `{{variableName}}` syntax for variable substitution.

Example:
- Template: `"Hello {{name}}, your bid of {{amount}} was placed."`
- Data: `{ name: "John", amount: "$100" }`
- Result: `"Hello John, your bid of $100 was placed."`

## Adding a New Template

### Quick Method (Recommended)
Use the template generator script:

```bash
npm run email:create-template <template-name>
# Example:
npm run email:create-template bidReceived
```

This will create template files for all supported languages (en, pt, es, fr, de) based on the example template.

### Manual Method
1. Create a JSON file in each language directory (or start with English)
2. File name should match the template name in camelCase (e.g., `bidReceived.json`)
3. Include `subject`, `html`, and optionally `text` fields
4. Use `{{variableName}}` for dynamic content
5. Copy and translate to other language directories

## Adding a New Language

1. Create a new directory with the language code (e.g., `it/` for Italian)
2. Copy template files from `en/` directory
3. Translate the content while keeping `{{variable}}` placeholders
4. Update `SUPPORTED_LANGUAGES` in `backend/src/services/templateEngine.js`

## Current Templates

- `auctionClosed` - Sent to bidders when auction ends (except winner/seller)
- `chooseWinner` - Sent to seller to choose winner (24h deadline)
- `youWon` - Sent to winner when selected (manual winner selection)
- `privateRoomWinner` - Sent to winner when private room closes (highest bid not outbid for 60s)
- `privateRoomNotWinner` - Sent to other bidders when private room closes (they did not win)
- `privateRoomClosedNoAcceptanceSeller` - Sent to seller when no invited bidders accept in time
- `privateRoomClosedNoAcceptanceInvited` - Sent to invited buyers when no one accepts in time
- `firstBidPlaced` - Sent to user when they place their first bid on a listing

## Usage

### In Your Code

```javascript
const { renderEmailTemplate } = require('../services/templateEngine');

// Render template with data
const email = renderEmailTemplate('auctionClosed', 'en', {
  bidderName: 'John Doe',
  listingTitle: 'Vintage Camera',
  finalBid: '$150',
  listingUrl: 'https://...'
});

// email.subject - Rendered subject line
// email.html - Rendered HTML content
// email.text - Rendered plain text (if available)
```

### Available Functions

```javascript
const templateEngine = require('../services/templateEngine');

// Render a template
const email = templateEngine.renderEmailTemplate('templateName', 'en', { ...data });

// Get all available templates for a language
const templates = templateEngine.getAvailableTemplates('en');

// Get all templates across all languages
const allTemplates = templateEngine.getAllAvailableTemplates();

// Check if template exists
const exists = templateEngine.templateExists('templateName', 'en');

// Clear cache (useful in development)
templateEngine.clearCache();

// Preload all templates for a language (performance optimization)
templateEngine.preloadTemplates('en');
```

## Supported Languages

- `en` - English (default)
- `pt` - Portuguese
- `es` - Spanish
- `fr` - French
- `de` - German

## Template Caching

Templates are automatically cached in memory for performance. This is especially important when you have 100+ templates. The cache is cleared when the server restarts, or you can manually clear it using `clearCache()`.

## Performance Tips

- Templates are loaded on-demand (lazy loading)
- Templates are cached after first load
- Use `preloadTemplates()` on server startup if you want to pre-warm the cache
- File I/O is minimal due to caching

## Adding More Languages

1. Create a new directory: `email-templates/<language-code>/`
2. Add template files for that language
3. Update `SUPPORTED_LANGUAGES` array in `backend/src/services/templateEngine.js`
4. The system will automatically support the new language

