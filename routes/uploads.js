const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getDB } = require('../config/database');
const { authenticate, getCurrentEmployee } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { UserRole } = require('../models/schemas');
const {
  uploadFile,
  deleteFile,
  extractKeyFromUrl,
  isValidProfilePicture,
  isValidGovernmentId,
  getMaxFileSize,
} = require('../services/s3Service');

// Configure multer for memory storage
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max (we'll check specific limits per type)
  },
});

/**
 * POST /api/uploads/profile-picture
 * Upload profile picture for current user
 */
router.post('/profile-picture', authenticate, getCurrentEmployee, upload.single('file'), async (req, res) => {
  try {
    const db = getDB();
    const employee = req.employee;

    if (!req.file) {
      return res.status(400).json({ detail: 'No file provided' });
    }

    const { buffer, originalname, mimetype, size } = req.file;

    // Validate file type
    if (!isValidProfilePicture(mimetype)) {
      return res.status(400).json({
        detail: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP'
      });
    }

    // Validate file size
    const maxSize = getMaxFileSize('profile_picture');
    if (size > maxSize) {
      return res.status(400).json({
        detail: `File too large. Maximum size: ${maxSize / (1024 * 1024)}MB`
      });
    }

    // Delete old profile picture if exists
    if (employee.profile_picture_url) {
      const oldKey = extractKeyFromUrl(employee.profile_picture_url);
      if (oldKey) {
        try {
          await deleteFile(oldKey);
        } catch (err) {
          console.error('Failed to delete old profile picture:', err);
        }
      }
    }

    // Upload new profile picture
    const { key, url } = await uploadFile(
      buffer,
      originalname,
      mimetype,
      'profile_pictures',
      employee.employee_id
    );

    // Update employee document
    await db.collection('employees').updateOne(
      { email: employee.email },
      {
        $set: {
          profile_picture_url: url,
          profile_picture_key: key,
          updated_at: new Date()
        }
      }
    );

    res.json({
      status: 'success',
      message: 'Profile picture uploaded successfully',
      profile_picture_url: url
    });
  } catch (error) {
    console.error('Upload profile picture error:', error);
    res.status(500).json({ detail: 'Failed to upload profile picture' });
  }
});

/**
 * DELETE /api/uploads/profile-picture
 * Delete profile picture for current user
 */
router.delete('/profile-picture', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    const db = getDB();
    const employee = req.employee;

    if (!employee.profile_picture_url) {
      return res.status(400).json({ detail: 'No profile picture to delete' });
    }

    // Delete from S3
    const key = employee.profile_picture_key || extractKeyFromUrl(employee.profile_picture_url);
    if (key) {
      await deleteFile(key);
    }

    // Update employee document
    await db.collection('employees').updateOne(
      { email: employee.email },
      {
        $set: {
          profile_picture_url: null,
          profile_picture_key: null,
          updated_at: new Date()
        }
      }
    );

    res.json({
      status: 'success',
      message: 'Profile picture deleted successfully'
    });
  } catch (error) {
    console.error('Delete profile picture error:', error);
    res.status(500).json({ detail: 'Failed to delete profile picture' });
  }
});

/**
 * POST /api/uploads/government-id
 * Upload government ID for current user
 */
router.post('/government-id', authenticate, getCurrentEmployee, upload.single('file'), async (req, res) => {
  try {
    const db = getDB();
    const employee = req.employee;

    if (!req.file) {
      return res.status(400).json({ detail: 'No file provided' });
    }

    const { buffer, originalname, mimetype, size } = req.file;

    // Validate file type
    if (!isValidGovernmentId(mimetype)) {
      return res.status(400).json({
        detail: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF'
      });
    }

    // Validate file size
    const maxSize = getMaxFileSize('government_id');
    if (size > maxSize) {
      return res.status(400).json({
        detail: `File too large. Maximum size: ${maxSize / (1024 * 1024)}MB`
      });
    }

    // Get ID type from request body (optional)
    const idType = req.body.id_type || 'Government ID';

    // Delete old government ID if exists
    if (employee.government_id_url) {
      const oldKey = extractKeyFromUrl(employee.government_id_url);
      if (oldKey) {
        try {
          await deleteFile(oldKey);
        } catch (err) {
          console.error('Failed to delete old government ID:', err);
        }
      }
    }

    // Upload new government ID
    const { key, url } = await uploadFile(
      buffer,
      originalname,
      mimetype,
      'government_ids',
      employee.employee_id
    );

    // Update employee document
    await db.collection('employees').updateOne(
      { email: employee.email },
      {
        $set: {
          government_id_url: url,
          government_id_key: key,
          government_id_type: idType,
          government_id_uploaded_at: new Date(),
          updated_at: new Date()
        }
      }
    );

    res.json({
      status: 'success',
      message: 'Government ID uploaded successfully',
      government_id_url: url,
      government_id_type: idType
    });
  } catch (error) {
    console.error('Upload government ID error:', error);
    res.status(500).json({ detail: 'Failed to upload government ID' });
  }
});

/**
 * DELETE /api/uploads/government-id
 * Delete government ID for current user
 */
router.delete('/government-id', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    const db = getDB();
    const employee = req.employee;

    if (!employee.government_id_url) {
      return res.status(400).json({ detail: 'No government ID to delete' });
    }

    // Delete from S3
    const key = employee.government_id_key || extractKeyFromUrl(employee.government_id_url);
    if (key) {
      await deleteFile(key);
    }

    // Update employee document
    await db.collection('employees').updateOne(
      { email: employee.email },
      {
        $set: {
          government_id_url: null,
          government_id_key: null,
          government_id_type: null,
          government_id_uploaded_at: null,
          updated_at: new Date()
        }
      }
    );

    res.json({
      status: 'success',
      message: 'Government ID deleted successfully'
    });
  } catch (error) {
    console.error('Delete government ID error:', error);
    res.status(500).json({ detail: 'Failed to delete government ID' });
  }
});

/**
 * POST /api/uploads/employee/:employeeId/profile-picture
 * Upload profile picture for specific employee (admin only)
 */
router.post('/employee/:employeeId/profile-picture',
  authenticate,
  requireRole([UserRole.ADMIN]),
  upload.single('file'),
  async (req, res) => {
    try {
      const db = getDB();
      const { employeeId } = req.params;

      // Find employee
      const employee = await db.collection('employees').findOne(
        { employee_id: employeeId },
        { projection: { _id: 0 } }
      );

      if (!employee) {
        return res.status(404).json({ detail: 'Employee not found' });
      }

      if (!req.file) {
        return res.status(400).json({ detail: 'No file provided' });
      }

      const { buffer, originalname, mimetype, size } = req.file;

      // Validate file type
      if (!isValidProfilePicture(mimetype)) {
        return res.status(400).json({
          detail: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP'
        });
      }

      // Validate file size
      const maxSize = getMaxFileSize('profile_picture');
      if (size > maxSize) {
        return res.status(400).json({
          detail: `File too large. Maximum size: ${maxSize / (1024 * 1024)}MB`
        });
      }

      // Delete old profile picture if exists
      if (employee.profile_picture_url) {
        const oldKey = extractKeyFromUrl(employee.profile_picture_url);
        if (oldKey) {
          try {
            await deleteFile(oldKey);
          } catch (err) {
            console.error('Failed to delete old profile picture:', err);
          }
        }
      }

      // Upload new profile picture
      const { key, url } = await uploadFile(
        buffer,
        originalname,
        mimetype,
        'profile_pictures',
        employeeId
      );

      // Update employee document
      await db.collection('employees').updateOne(
        { employee_id: employeeId },
        {
          $set: {
            profile_picture_url: url,
            profile_picture_key: key,
            updated_at: new Date()
          }
        }
      );

      res.json({
        status: 'success',
        message: 'Profile picture uploaded successfully',
        profile_picture_url: url
      });
    } catch (error) {
      console.error('Upload employee profile picture error:', error);
      res.status(500).json({ detail: 'Failed to upload profile picture' });
    }
  }
);

/**
 * POST /api/uploads/employee/:employeeId/government-id
 * Upload government ID for specific employee (admin only)
 */
router.post('/employee/:employeeId/government-id',
  authenticate,
  requireRole([UserRole.ADMIN]),
  upload.single('file'),
  async (req, res) => {
    try {
      const db = getDB();
      const { employeeId } = req.params;

      // Find employee
      const employee = await db.collection('employees').findOne(
        { employee_id: employeeId },
        { projection: { _id: 0 } }
      );

      if (!employee) {
        return res.status(404).json({ detail: 'Employee not found' });
      }

      if (!req.file) {
        return res.status(400).json({ detail: 'No file provided' });
      }

      const { buffer, originalname, mimetype, size } = req.file;

      // Validate file type
      if (!isValidGovernmentId(mimetype)) {
        return res.status(400).json({
          detail: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF'
        });
      }

      // Validate file size
      const maxSize = getMaxFileSize('government_id');
      if (size > maxSize) {
        return res.status(400).json({
          detail: `File too large. Maximum size: ${maxSize / (1024 * 1024)}MB`
        });
      }

      const idType = req.body.id_type || 'Government ID';

      // Delete old government ID if exists
      if (employee.government_id_url) {
        const oldKey = extractKeyFromUrl(employee.government_id_url);
        if (oldKey) {
          try {
            await deleteFile(oldKey);
          } catch (err) {
            console.error('Failed to delete old government ID:', err);
          }
        }
      }

      // Upload new government ID
      const { key, url } = await uploadFile(
        buffer,
        originalname,
        mimetype,
        'government_ids',
        employeeId
      );

      // Update employee document
      await db.collection('employees').updateOne(
        { employee_id: employeeId },
        {
          $set: {
            government_id_url: url,
            government_id_key: key,
            government_id_type: idType,
            government_id_uploaded_at: new Date(),
            updated_at: new Date()
          }
        }
      );

      res.json({
        status: 'success',
        message: 'Government ID uploaded successfully',
        government_id_url: url,
        government_id_type: idType
      });
    } catch (error) {
      console.error('Upload employee government ID error:', error);
      res.status(500).json({ detail: 'Failed to upload government ID' });
    }
  }
);

module.exports = router;
