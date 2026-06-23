const mongoose = require('mongoose');

function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents (á -> a)
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const blogPostSchema = new mongoose.Schema({
  /** Portuguese title (primary/fallback — the site defaults to PT). */
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 160
  },
  /** English title override; falls back to `title` when empty. */
  titleEn: {
    type: String,
    trim: true,
    maxlength: 160,
    default: ''
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  excerpt: {
    type: String,
    trim: true,
    maxlength: 300,
    default: ''
  },
  excerptEn: {
    type: String,
    trim: true,
    maxlength: 300,
    default: ''
  },
  /** Markdown body (Portuguese — primary/fallback). Rendered to HTML on the frontend. */
  content: {
    type: String,
    required: true
  },
  /** Markdown body (English override); falls back to `content` when empty. */
  contentEn: {
    type: String,
    default: ''
  },
  coverImage: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    enum: ['relogios', 'arte', 'mercado', 'guias', 'bidroom'],
    default: 'mercado'
  },
  tags: {
    type: [String],
    default: []
  },
  author: {
    type: String,
    trim: true,
    default: 'BidRoom'
  },
  status: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft',
    index: true
  },
  publishedAt: {
    type: Date,
    default: null,
    index: true
  },
  /** SEO meta description override; falls back to `excerpt` when empty. */
  metaDescription: {
    type: String,
    trim: true,
    maxlength: 160,
    default: ''
  },
  metaDescriptionEn: {
    type: String,
    trim: true,
    maxlength: 160,
    default: ''
  },
  viewCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

blogPostSchema.index({ status: 1, publishedAt: -1 });
blogPostSchema.index({ category: 1, status: 1 });

// pre('validate'), not pre('save') — the `slug` field is `required`, and
// Mongoose runs schema validation before 'save' hooks, so generating it
// in pre('save') is too late and fails the required check on create().
blogPostSchema.pre('validate', async function(next) {
  const slugTitle = this.titleEn || this.title;
  if (!this.slug && slugTitle) {
    const baseSlug = generateSlug(slugTitle);
    let slug = baseSlug;
    let counter = 1;
    while (await this.constructor.findOne({ slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    this.slug = slug;
  }

  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }

  next();
});

module.exports = mongoose.model('BlogPost', blogPostSchema);
