const express = require('express');
const multer = require('multer');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const azureStorageService = require('../services/azureStorage.service');
const { scanImages } = require('../services/contentSafetyService');
const { recordViolation } = require('../services/contentViolationService');
const { appendModerationAudit } = require('../services/moderationAuditService');
const Customer = require('../models/Customer');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for memory storage (we'll upload directly to Azure)
const storage = multer.memoryStorage();

/**
 * Detect image type from the first bytes of the buffer (magic numbers).
 * Returns the MIME type string, or null if not a recognised image format.
 * This is used AFTER multer so we can verify the actual file content,
 * not just the Content-Type header supplied by the client.
 */
function detectImageMagic(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  // WebP: RIFF????WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  // BMP: 42 4D
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'image/bmp';
  return null;
}

// File filter - only allow images (first pass: client-declared MIME type)
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images (JPEG, PNG, GIF, WebP, BMP) are allowed.'), false);
  }
};

// Multer configuration for listing images
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
    files: 10 // Maximum 10 files per request
  }
});

// Proof of payment: PDF, JPG, PNG only; single file; max 30MB
const PROOF_MAX_SIZE = 30 * 1024 * 1024;
const proofFileFilter = (req, file, cb) => {
  const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPG and PNG are allowed.'), false);
  }
};
const proofUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: proofFileFilter,
  limits: { fileSize: PROOF_MAX_SIZE, files: 1 }
});

/**
 * POST /api/uploads
 * Upload multiple images to Azure Blob Storage
 * Requires authentication
 */
router.post('/', authenticateToken, requireActiveAccount, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'No files uploaded',
        message: 'Please provide at least one image file'
      });
    }

    // Validate actual file content via magic bytes (second pass — client cannot spoof this)
    for (const file of req.files) {
      const detectedMime = detectImageMagic(file.buffer);
      if (!detectedMime) {
        return res.status(400).json({
          error: 'Invalid file content',
          message: 'One or more files do not match a supported image format (JPEG, PNG, GIF, WebP, BMP).'
        });
      }
      file.mimetype = detectedMime; // use verified type for all downstream processing
    }

    // Prepare files for upload
    const files = req.files.map(file => ({
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype
    }));

    // Content safety scan — block before reaching Blob Storage
    try {
      const scan = await scanImages(files.map(f => f.buffer));

      if (scan.blocked) {
        // Resolve the MongoDB user from the Firebase uid carried by the auth token
        const currentUser = await Customer.findOne({ uid: req.user.uid }).select('_id contentViolationCount contentRestrictedUntil');
        if (currentUser) {
          // Escalating penalty: warning → temp restriction → suspension
          recordViolation(currentUser, 'inappropriate_image').catch(err =>
            logger.error('recordViolation (image) error:', err.message)
          );
          appendModerationAudit({
            subjectUserId: currentUser._id,
            actionType: 'image_upload_blocked',
            metadata: {
              fileCount: files.length,
              categories: scan.results?.map(r => r.categories),
              provider: scan.results?.[0]?.provider || 'azure'
            }
          }).catch(() => {});
        }
        return res.status(400).json({
          error: 'Content policy violation',
          message: 'One or more images contain content that violates our policies and cannot be uploaded.'
        });
      }

      // Borderline (flagged): allow upload but queue for admin review
      if (scan.anyFlagged) {
        const currentUser = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
        if (currentUser) {
          appendModerationAudit({
            subjectUserId: currentUser._id,
            actionType: 'image_upload_flagged',
            metadata: {
              fileCount: files.length,
              categories: scan.results?.map(r => r.categories),
              provider: scan.results?.[0]?.provider || 'azure'
            }
          }).catch(() => {});
        }
      }
    } catch (scanErr) {
      logger.error('Content safety scan error (non-blocking):', scanErr.message);
      // Scan failure is non-fatal — availability is preserved; monitoring should alert on repeated errors
    }

    // Upload to Azure Blob Storage — returns [{ url, blobName }]
    const uploadResults = await azureStorageService.uploadMultipleImages(files);
    const urls = uploadResults.map(r => r.url);

    res.json({
      urls,
      images: uploadResults,
      count: urls.length
    });
  } catch (error) {
    logger.error('Error uploading images:', error);
    res.status(500).json({
      error: 'Failed to upload images',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/uploads/proof-of-payment
 * Upload a single proof of payment file (PDF, JPG or PNG, max 30MB).
 * Returns { url } for use in PATCH /api/transactions/:id (buyerProofOfPaymentUrl).
 */
router.post('/proof-of-payment', authenticateToken, (req, res, next) => {
  proofUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large', message: 'Proof of payment must be 30MB or less.' });
      }
      return res.status(400).json({ error: 'Upload error', message: err.message || 'Invalid file.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        message: 'Please upload a PDF, JPG or PNG file (max 30MB).'
      });
    }

    const url = await azureStorageService.uploadProofOfPayment(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    res.json({ url });
  } catch (error) {
    logger.error('Error uploading proof of payment:', error);
    res.status(500).json({
      error: 'Failed to upload file',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Dispute evidence: images (JPEG, PNG, GIF, WebP) or video (MP4, WebM); max 30MB per file; up to 5 files
const DISPUTE_EVIDENCE_MAX_SIZE = 30 * 1024 * 1024;
const disputeEvidenceFileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'video/mp4', 'video/webm'
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images (JPEG, PNG, GIF, WebP), PDF, or video (MP4, WebM) are allowed.'), false);
  }
};
const disputeEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: disputeEvidenceFileFilter,
  limits: { fileSize: DISPUTE_EVIDENCE_MAX_SIZE, files: 5 }
});

/**
 * POST /api/uploads/dispute-evidence
 * Upload dispute evidence (images or video). Returns { url }.
 * Multiple calls needed for multiple files (3 photos or 1 video minimum per spec).
 */
router.post('/dispute-evidence', authenticateToken, (req, res, next) => {
  disputeEvidenceUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large', message: 'Dispute evidence must be 30MB or less.' });
      }
      return res.status(400).json({ error: 'Upload error', message: err.message || 'Invalid file.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        message: 'Please upload an image (JPEG, PNG, GIF, WebP), PDF, or video (MP4, WebM) file (max 30MB).'
      });
    }
    const url = await azureStorageService.uploadDisputeEvidence(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    res.json({ url });
  } catch (error) {
    logger.error('Error uploading dispute evidence:', error);
    res.status(500).json({
      error: 'Upload failed',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/uploads/proof-of-delivery
 * Upload a single proof of delivery file (PDF, JPG or PNG, max 30MB). Returns { url }.
 */
router.post('/proof-of-delivery', authenticateToken, (req, res, next) => {
  proofUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large', message: 'Proof of delivery must be 30MB or less.' });
      }
      return res.status(400).json({ error: 'Upload error', message: err.message || 'Invalid file.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        message: 'Please upload a PDF, JPG or PNG file (max 30MB).'
      });
    }
    const url = await azureStorageService.uploadProofOfDelivery(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    res.json({ url });
  } catch (error) {
    logger.error('Error uploading proof of delivery:', error);
    res.status(500).json({ error: 'Failed to upload file', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * DELETE /api/uploads
 * Delete images from Azure Blob Storage
 * Requires authentication
 */
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Please provide an array of image URLs to delete'
      });
    }

    await azureStorageService.deleteMultipleImages(urls);

    res.json({
      success: true,
      message: 'Images deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting images:', error);
    res.status(500).json({
      error: 'Failed to delete images',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;

