const express = require('express');
const router = express.Router();
const BlogPost = require('../models/BlogPost');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../utils/roles');

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const VALID_CATEGORIES = ['relogios', 'arte', 'mercado', 'guias', 'bidroom'];

const PUBLIC_FIELDS = 'title slug excerpt content coverImage category tags author publishedAt metaDescription viewCount createdAt updatedAt';
const LIST_FIELDS   = 'title slug excerpt coverImage category tags author publishedAt';

// ── Public ───────────────────────────────────────────────────────────────────

/** GET /api/blog — paginated list of published posts. */
router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const filter = { status: 'published' };
    if (req.query.category && VALID_CATEGORIES.includes(req.query.category)) {
      filter.category = req.query.category;
    }

    const [posts, total] = await Promise.all([
      BlogPost.find(filter)
        .select(LIST_FIELDS)
        .sort({ publishedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      BlogPost.countDocuments(filter)
    ]);

    res.json({ posts, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error listing blog posts:', error);
    res.status(500).json({ error: 'Failed to load blog posts' });
  }
});

/** GET /api/blog/:slug — single published post; increments view count. */
router.get('/:slug', async (req, res) => {
  try {
    const post = await BlogPost.findOneAndUpdate(
      { slug: req.params.slug, status: 'published' },
      { $inc: { viewCount: 1 } },
      { new: true }
    ).select(PUBLIC_FIELDS).lean();

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json({ post });
  } catch (error) {
    console.error('Error loading blog post:', error);
    res.status(500).json({ error: 'Failed to load blog post' });
  }
});

// ── Admin ────────────────────────────────────────────────────────────────────

/** GET /api/blog/admin/all — every post (draft + published), for the Nexus editor. */
router.get('/admin/all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const posts = await BlogPost.find({})
      .select(`${LIST_FIELDS} status createdAt updatedAt`)
      .sort({ createdAt: -1 })
      .lean();
    res.json({ posts });
  } catch (error) {
    console.error('Error listing admin blog posts:', error);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

/** GET /api/blog/admin/:id — single post by id, including drafts. */
router.get('/admin/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!OBJECT_ID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid post id' });
    }
    const post = await BlogPost.findById(req.params.id).lean();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ post });
  } catch (error) {
    console.error('Error loading admin blog post:', error);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

/** POST /api/blog — create a post (draft by default). */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, excerpt, content, coverImage, category, tags, author, status, metaDescription, slug } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const post = await BlogPost.create({
      title,
      slug: slug || undefined,
      excerpt: excerpt || '',
      content,
      coverImage: coverImage || '',
      category: category || 'mercado',
      tags: Array.isArray(tags) ? tags : [],
      author: author || 'BidRoom',
      status: status === 'published' ? 'published' : 'draft',
      metaDescription: metaDescription || ''
    });

    res.status(201).json({ post });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A post with this slug already exists' });
    }
    console.error('Error creating blog post:', error);
    res.status(500).json({ error: 'Failed to create blog post' });
  }
});

/** PUT /api/blog/:id — update a post (any field, including status to publish/unpublish). */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!OBJECT_ID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid post id' });
    }
    const { title, excerpt, content, coverImage, category, tags, author, status, metaDescription, slug } = req.body;

    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const update = {};
    if (title !== undefined) update.title = title;
    if (slug !== undefined && slug) update.slug = slug;
    if (excerpt !== undefined) update.excerpt = excerpt;
    if (content !== undefined) update.content = content;
    if (coverImage !== undefined) update.coverImage = coverImage;
    if (category !== undefined) update.category = category;
    if (tags !== undefined) update.tags = Array.isArray(tags) ? tags : [];
    if (author !== undefined) update.author = author;
    if (metaDescription !== undefined) update.metaDescription = metaDescription;
    if (status !== undefined && ['draft', 'published'].includes(status)) update.status = status;

    const post = await BlogPost.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    Object.assign(post, update);
    await post.save();

    res.json({ post });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A post with this slug already exists' });
    }
    console.error('Error updating blog post:', error);
    res.status(500).json({ error: 'Failed to update blog post' });
  }
});

/** DELETE /api/blog/:id */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!OBJECT_ID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid post id' });
    }
    const post = await BlogPost.findByIdAndDelete(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ message: 'Post deleted' });
  } catch (error) {
    console.error('Error deleting blog post:', error);
    res.status(500).json({ error: 'Failed to delete blog post' });
  }
});

module.exports = router;
