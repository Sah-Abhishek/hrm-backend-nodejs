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

  return { key, url };
}

/**
 * Delete file from S3
 * @param {string} key - S3 object key
 */
async function deleteFile(key) {
  if (!key) return;

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting file from S3:', error);
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
 * @param {string} url - Full S3 URL
 * @returns {string|null}
 */
function extractKeyFromUrl(url) {
  if (!url) return null;

  try {
    const urlObj = new URL(url);
    // Remove leading slash and bucket name from path
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts[0] === BUCKET_NAME) {
      return pathParts.slice(1).join('/');
    }
    return pathParts.join('/');
  } catch {
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

module.exports = {
  uploadFile,
  deleteFile,
  getPresignedUrl,
  extractKeyFromUrl,
  isValidProfilePicture,
  isValidGovernmentId,
  getMaxFileSize,
  BUCKET_NAME,
  BASE_FOLDER,
};
