const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const azureStorageService = require('../services/azureStorage.service');

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

// Multer configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
    files: 10 // Maximum 10 files per request
  }
});

/**
 * POST /api/uploads
 * Upload multiple images to Azure Blob Storage
 * Requires authentication
 */
router.post('/', authenticateToken, upload.array('images', 10), async (req, res) => {
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

    // Upload to Azure Blob Storage
    const urls = await azureStorageService.uploadMultipleImages(files);

    res.json({
      urls: urls,
      count: urls.length
    });
  } catch (error) {
    console.error('Error uploading images:', error);
    res.status(500).json({
      error: 'Failed to upload images',
      message: error.message
    });
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
      message: error.message
    });
  }
});

module.exports = router;

