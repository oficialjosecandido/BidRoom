const { BlobServiceClient } = require('@azure/storage-blob');

class AzureStorageService {
  constructor() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'listing-images';

    if (!connectionString) {
      console.warn('⚠️  AZURE_STORAGE_CONNECTION_STRING not set. Image uploads will fail.');
      this.blobServiceClient = null;
      this.containerClient = null;
    } else {
      this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
      this.containerClient = this.blobServiceClient.getContainerClient(containerName);
      this.containerName = containerName;
      
      // Ensure container exists
      this.ensureContainerExists();
    }
  }

  async ensureContainerExists() {
    if (!this.containerClient) return;
    
    try {
      const exists = await this.containerClient.exists();
      if (!exists) {
        console.log(`Creating container: ${this.containerName}`);
        await this.containerClient.create({
          access: 'blob' // Allow public read access to blobs
        });
        console.log(`✅ Container ${this.containerName} created successfully`);
      }
    } catch (error) {
      console.error('Error ensuring container exists:', error);
    }
  }

  /**
   * Generate a unique filename for the blob
   * @param {string} originalFilename - Original filename
   * @param {string} mimetype - MIME type of the file
   * @returns {string} - Unique filename with UUID prefix
   */
  generateBlobName(originalFilename, mimetype) {
    const uuid = require('uuid').v4();
    const extension = this.getFileExtension(originalFilename, mimetype);
    const sanitizedOriginal = originalFilename
      .replace(/[^a-zA-Z0-9.-]/g, '-')
      .toLowerCase()
      .substring(0, 50); // Limit length
    
    return `${uuid}-${sanitizedOriginal}${extension}`;
  }

  /**
   * Get file extension from filename or MIME type
   */
  getFileExtension(filename, mimetype) {
    // Try to get extension from filename first
    const filenameExt = filename.match(/\.[0-9a-z]+$/i);
    if (filenameExt) {
      return filenameExt[0];
    }
    
    // Fall back to MIME type
    const mimeToExt = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'image/svg+xml': '.svg',
      'application/pdf': '.pdf'
    };

    return mimeToExt[mimetype] || '.jpg';
  }

  /**
   * Upload proof of payment (PDF, JPG, PNG). Stored under prefix proof-of-payment/ for optional cleanup.
   * @param {Buffer} buffer - File buffer
   * @param {string} originalFilename - Original filename
   * @param {string} mimetype - MIME type
   * @returns {Promise<string>} - Public URL of uploaded blob
   */
  async uploadProofOfPayment(buffer, originalFilename, mimetype) {
    if (!this.containerClient) {
      throw new Error('Azure Storage is not configured. Please set AZURE_STORAGE_CONNECTION_STRING.');
    }

    const uuid = require('uuid').v4();
    const ext = this.getFileExtension(originalFilename, mimetype);
    const sanitized = originalFilename
      .replace(/[^a-zA-Z0-9.-]/g, '-')
      .toLowerCase()
      .substring(0, 80);
    const blobName = `proof-of-payment/${uuid}-${sanitized}${ext}`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: {
        blobContentType: mimetype,
        blobCacheControl: 'private, max-age=2592000'
      }
    });

    return blockBlobClient.url;
  }

  /**
   * Upload a single image to Azure Blob Storage
   * @param {Buffer} buffer - File buffer
   * @param {string} originalFilename - Original filename
   * @param {string} mimetype - MIME type
   * @returns {Promise<string>} - Public URL of uploaded blob
   */
  async uploadImage(buffer, originalFilename, mimetype) {
    if (!this.containerClient) {
      throw new Error('Azure Storage is not configured. Please set AZURE_STORAGE_CONNECTION_STRING.');
    }

    const blobName = this.generateBlobName(originalFilename, mimetype);
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    // Upload the buffer
    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: {
        blobContentType: mimetype,
        blobCacheControl: 'public, max-age=31536000' // Cache for 1 year
      }
    });

    // Return public URL
    return blockBlobClient.url;
  }

  /**
   * Upload proof of delivery (PDF, JPG, PNG). Stored under prefix proof-of-delivery/.
   */
  async uploadProofOfDelivery(buffer, originalFilename, mimetype) {
    if (!this.containerClient) {
      throw new Error('Azure Storage is not configured. Please set AZURE_STORAGE_CONNECTION_STRING.');
    }
    const uuid = require('uuid').v4();
    const ext = this.getFileExtension(originalFilename, mimetype);
    const sanitized = originalFilename.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase().substring(0, 80);
    const blobName = `proof-of-delivery/${uuid}-${sanitized}${ext}`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: mimetype, blobCacheControl: 'private, max-age=2592000' }
    });
    return blockBlobClient.url;
  }

  /**
   * Base URL for blobs in our container (e.g. https://account.blob.core.windows.net/container-name/).
   * Used to detect our own proof-of-payment URLs for 30-day cleanup.
   */
  getContainerBaseUrl() {
    if (!this.containerClient) return null;
    const dummy = this.containerClient.getBlockBlobClient('_');
    const u = dummy.url;
    return u.substring(0, u.length - 1) + '/'; // base with trailing slash
  }

  /**
   * Upload multiple images
   * @param {Array} files - Array of file objects with { buffer, originalname, mimetype }
   * @returns {Promise<string[]>} - Array of public URLs
   */
  async uploadMultipleImages(files) {
    if (!Array.isArray(files) || files.length === 0) {
      return [];
    }

    const uploadPromises = files.map(file => {
      if (!file.buffer || !file.originalname || !file.mimetype) {
        throw new Error('Invalid file format. Expected { buffer, originalname, mimetype }');
      }
      return this.uploadImage(file.buffer, file.originalname, file.mimetype);
    });

    return Promise.all(uploadPromises);
  }

  /**
   * Delete an image from Azure Blob Storage
   * @param {string} blobUrl - Full URL of the blob
   * @returns {Promise<void>}
   */
  async deleteImage(blobUrl) {
    if (!this.containerClient) {
      throw new Error('Azure Storage is not configured.');
    }

    try {
      // Extract blob name from URL
      const urlParts = blobUrl.split('/');
      const blobName = urlParts[urlParts.length - 1].split('?')[0]; // Remove query params if any
      
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.delete();
    } catch (error) {
      console.error('Error deleting blob:', error);
      // Don't throw - deletion failures shouldn't break the flow
    }
  }

  /**
   * Delete multiple images
   * @param {string[]} blobUrls - Array of blob URLs
   * @returns {Promise<void>}
   */
  async deleteMultipleImages(blobUrls) {
    if (!Array.isArray(blobUrls) || blobUrls.length === 0) {
      return;
    }

    const deletePromises = blobUrls.map(url => this.deleteImage(url));
    await Promise.allSettled(deletePromises); // Use allSettled to continue even if some fail
  }
}

// Export singleton instance
module.exports = new AzureStorageService();

