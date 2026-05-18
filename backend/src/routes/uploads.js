const express = require('express');
const multer = require('multer');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const azureStorageService = require('../services/azureStorage.service');
const { scanImages } = require('../services/contentSafetyService');

const router = express.Router();

// Configure multer for memory storage (we'll upload directly to Azure)
const storage = multer.memoryStorage();

// File filter - only allow images
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
        return res.status(400).json({
          error: 'Content policy violation',
          message: 'One or more images contain content that violates our policies and cannot be uploaded.'
        });
      }
    } catch (scanErr) {
      console.error('Content safety scan error (non-blocking):', scanErr.message);
      // Scan failure is non-fatal — don't block the upload
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
    console.error('Error uploading images:', error);
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
    console.error('Error uploading proof of payment:', error);
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
    console.error('Error uploading dispute evidence:', error);
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
    console.error('Error uploading proof of delivery:', error);
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
    console.error('Error deleting images:', error);
    res.status(500).json({
      error: 'Failed to delete images',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;

