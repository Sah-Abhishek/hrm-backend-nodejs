const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const { generateUUID } = require('../utils/helpers');

// Initialize S3 client for Utho (S3-compatible)
const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT_URL,
  region: process.env.S3_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true, // Required for S3-compatible services
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const BASE_FOLDER = 'hrms_documents';

/**
 * Upload file to S3
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} originalName - Original filename
 * @param {string} mimeType - File MIME type
 * @param {string} folder - Subfolder (e.g., 'profile_pictures', 'government_ids')
 * @param {string} employeeId - Employee ID for organizing files
 * @returns {Promise<{key: string, url: string}>}
 */
async function uploadFile(fileBuffer, originalName, mimeType, folder, employeeId) {
  const ext = path.extname(originalName);
  const uniqueFilename = `${generateUUID()}${ext}`;
  const key = `${BASE_FOLDER}/${folder}/${employeeId}/${uniqueFilename}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
    ACL: 'public-read', // Make file publicly accessible
  });

  await s3Client.send(command);

  // Construct the public URL
  const url = `${process.env.S3_ENDPOINT_URL}/${BUCKET_NAME}/${key}`;

  console.log('[S3] File uploaded:', { key, url });

  return { key, url };
}

/**
 * Delete file from S3
 * @param {string} key - S3 object key
 */
async function deleteFile(key) {
  if (!key) {
    console.warn('[S3] deleteFile called with empty key');
    return;
  }

  console.log('[S3] Attempting to delete file:', {
    key,
    bucket: BUCKET_NAME,
    endpoint: process.env.S3_ENDPOINT_URL
  });

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const result = await s3Client.send(command);
    console.log('[S3] File deleted successfully:', { key, result });
  } catch (error) {
    console.error('[S3] Error deleting file:', {
      key,
      bucket: BUCKET_NAME,
      errorName: error.name,
      errorMessage: error.message,
      errorCode: error.Code || error.$metadata?.httpStatusCode,
    });
    throw error;
  }
}

/**
 * Get a presigned URL for temporary access
 * @param {string} key - S3 object key
 * @param {number} expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns {Promise<string>}
 */
async function getPresignedUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Extract key from S3 URL
 * Handles multiple URL formats:
 * - https://endpoint/bucket/key
 * - https://bucket.endpoint/key
 * - https://endpoint/key (bucket in subdomain)
 * @param {string} url - Full S3 URL
 * @returns {string|null}
 */
function extractKeyFromUrl(url) {
  if (!url) {
    console.warn('[S3] extractKeyFromUrl called with empty URL');
    return null;
  }

  // Get current bucket name (in case it wasn't loaded initially)
  const bucketName = process.env.S3_BUCKET_NAME || BUCKET_NAME;

  if (!bucketName) {
    console.error('[S3] BUCKET_NAME is not defined');
    return null;
  }

  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    console.log('[S3] Extracting key from URL:', {
      url,
      pathname,
      bucketName,
      host: urlObj.host
    });

    // Remove leading slash
    const pathWithoutLeadingSlash = pathname.startsWith('/') ? pathname.slice(1) : pathname;

    // Split into parts
    const pathParts = pathWithoutLeadingSlash.split('/').filter(Boolean);

    if (pathParts.length === 0) {
      console.warn('[S3] No path parts found in URL');
      return null;
    }

    let key;

    // Check if bucket name is in the path (path-style URL)
    if (pathParts[0] === bucketName) {
      // URL format: https://endpoint/bucket/key
      key = pathParts.slice(1).join('/');
    } else if (urlObj.host.startsWith(bucketName + '.')) {
      // URL format: https://bucket.endpoint/key (virtual-hosted style)
      key = pathParts.join('/');
    } else {
      // Assume the path is the key directly
      key = pathParts.join('/');
    }

    console.log('[S3] Extracted key:', { key });

    return key || null;
  } catch (error) {
    console.error('[S3] Error extracting key from URL:', { url, error: error.message });
    return null;
  }
}

/**
 * Validate file type for profile picture
 * @param {string} mimeType 
 * @returns {boolean}
 */
function isValidProfilePicture(mimeType) {
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  return validTypes.includes(mimeType);
}

/**
 * Validate file type for government ID
 * @param {string} mimeType 
 * @returns {boolean}
 */
function isValidGovernmentId(mimeType) {
  const validTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf'
  ];
  return validTypes.includes(mimeType);
}

/**
 * Get max file size in bytes
 * @param {string} type - 'profile_picture' or 'government_id'
 * @returns {number}
 */
function getMaxFileSize(type) {
  if (type === 'profile_picture') {
    return 5 * 1024 * 1024; // 5MB
  }
  return 10 * 1024 * 1024; // 10MB for government ID
}

/**
 * Check if S3 is properly configured
 * @returns {boolean}
 */
function isS3Configured() {
  const configured = !!(
    process.env.S3_ENDPOINT_URL &&
    process.env.S3_BUCKET_NAME &&
    process.env.S3_ACCESS_KEY &&
    process.env.S3_SECRET_KEY
  );

  if (!configured) {
    console.warn('[S3] S3 is not fully configured:', {
      hasEndpoint: !!process.env.S3_ENDPOINT_URL,
      hasBucket: !!process.env.S3_BUCKET_NAME,
      hasAccessKey: !!process.env.S3_ACCESS_KEY,
      hasSecretKey: !!process.env.S3_SECRET_KEY,
    });
  }

  return configured;
}

module.exports = {
  uploadFile,
  deleteFile,
  getPresignedUrl,
  extractKeyFromUrl,
  isValidProfilePicture,
  isValidGovernmentId,
  getMaxFileSize,
  isS3Configured,
  BUCKET_NAME,
  BASE_FOLDER,
};
