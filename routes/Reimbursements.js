const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { UserRole } = require('../models/schemas');
const { generateUUID, toISOString } = require('../utils/helpers');
const { sendEmailNotification } = require('../services/emailService');
const { uploadFile, deleteFile, extractKeyFromUrl } = require('../services/s3Service');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (validTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image and PDF files are allowed'), false);
    }
  }
});

/**
 * POST /api/reimbursements/apply
 * Apply for reimbursement (employee/manager)
 */
router.post('/apply', authenticate, requireRole([UserRole.EMPLOYEE, UserRole.MANAGER]), upload.single('bill_image'), async (req, res) => {
  try {
    const db = getDB();
    const { title, category, amount, description, expense_date } = req.body;

    // Validate required fields
    if (!title || !category || !amount) {
      return res.status(400).json({ detail: 'Title, category, and amount are required' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ detail: 'Invalid amount' });
    }

    // Get employee info
    const employee = await db.collection('employees').findOne(
      { email: req.user.email },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Upload bill image to S3 if provided
    let billUrl = null;
    let billKey = null;
    if (req.file) {
      try {
        const uploadResult = await uploadFile(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          'reimbursements',  // folder name in S3
          employee.employee_id || employee.id
        );
        billUrl = uploadResult.url;
        billKey = uploadResult.key;
        console.log('Bill uploaded successfully:', billUrl);
      } catch (uploadError) {
        console.error('Failed to upload bill image:', uploadError);
        // Continue without the image - it's optional
      }
    }

    // Create reimbursement record
    const reimbursement = {
      id: generateUUID(),
      employee_id: employee.employee_id || employee.id,
      employee_email: employee.email,
      employee_name: employee.full_name,
      department: employee.department,
      title,
      category,
      amount: parsedAmount,
      description: description || '',
      expense_date: expense_date || toISOString(new Date()),
      bill_url: billUrl,
      bill_key: billKey,  // Store key for deletion later if needed
      status: 'pending',
      created_at: toISOString(new Date()),
      updated_at: toISOString(new Date()),
      admin_remarks: null,
      processed_by: null,
      processed_at: null,
      cleared_at: null
    };

    await db.collection('reimbursements').insertOne(reimbursement);

    delete reimbursement._id;

    res.json({
      status: 'success',
      message: 'Reimbursement request submitted successfully',
      reimbursement
    });
  } catch (error) {
    console.error('Apply reimbursement error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/reimbursements/my
 * Get my reimbursements (employee/manager)
 */
router.get('/my', authenticate, requireRole([UserRole.EMPLOYEE, UserRole.MANAGER]), async (req, res) => {
  try {
    const db = getDB();

    const reimbursements = await db.collection('reimbursements')
      .find(
        { employee_email: req.user.email },
        { projection: { _id: 0 } }
      )
      .sort({ created_at: -1 })
      .toArray();

    res.json(reimbursements);
  } catch (error) {
    console.error('Get my reimbursements error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/reimbursements/all
 * Get all reimbursements (admin only)
 */
router.get('/all', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    const reimbursements = await db.collection('reimbursements')
      .find({}, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    res.json(reimbursements);
  } catch (error) {
    console.error('Get all reimbursements error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/reimbursements/stats
 * Get reimbursement statistics (admin only)
 */
router.get('/stats', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    const reimbursements = await db.collection('reimbursements')
      .find({}, { projection: { _id: 0, status: 1, amount: 1 } })
      .toArray();

    const stats = {
      total_count: reimbursements.length,
      total_amount: 0,
      pending_count: 0,
      pending_amount: 0,
      approved_count: 0,
      approved_amount: 0,
      cleared_count: 0,
      cleared_amount: 0,
      rejected_count: 0,
      rejected_amount: 0
    };

    reimbursements.forEach(r => {
      const amount = parseFloat(r.amount) || 0;
      stats.total_amount += amount;

      switch (r.status) {
        case 'pending':
          stats.pending_count++;
          stats.pending_amount += amount;
          break;
        case 'approved':
          stats.approved_count++;
          stats.approved_amount += amount;
          break;
        case 'cleared':
          stats.cleared_count++;
          stats.cleared_amount += amount;
          break;
        case 'rejected':
          stats.rejected_count++;
          stats.rejected_amount += amount;
          break;
      }
    });

    res.json(stats);
  } catch (error) {
    console.error('Get reimbursement stats error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/reimbursements/:id/action
 * Process reimbursement action (admin only)
 * Actions: approve, reject, clear
 */
router.post('/:id/action', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { action, remarks } = req.body;

    if (!['approve', 'reject', 'clear'].includes(action)) {
      return res.status(400).json({ detail: 'Invalid action. Must be approve, reject, or clear' });
    }

    // Get reimbursement
    const reimbursement = await db.collection('reimbursements').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    if (!reimbursement) {
      return res.status(404).json({ detail: 'Reimbursement not found' });
    }

    // Validate action based on current status
    if (action === 'approve' && reimbursement.status !== 'pending') {
      return res.status(400).json({ detail: 'Can only approve pending reimbursements' });
    }
    if (action === 'reject' && reimbursement.status !== 'pending') {
      return res.status(400).json({ detail: 'Can only reject pending reimbursements' });
    }
    if (action === 'clear' && reimbursement.status !== 'approved') {
      return res.status(400).json({ detail: 'Can only clear approved reimbursements' });
    }

    // Require remarks for rejection
    if (action === 'reject' && !remarks?.trim()) {
      return res.status(400).json({ detail: 'Remarks are required for rejection' });
    }

    // Determine new status
    let newStatus;
    switch (action) {
      case 'approve':
        newStatus = 'approved';
        break;
      case 'reject':
        newStatus = 'rejected';
        break;
      case 'clear':
        newStatus = 'cleared';
        break;
    }

    // Update reimbursement
    const updateData = {
      status: newStatus,
      admin_remarks: remarks || null,
      processed_by: req.user.email,
      processed_at: toISOString(new Date()),
      updated_at: toISOString(new Date())
    };

    if (action === 'clear') {
      updateData.cleared_at = toISOString(new Date());
    }

    await db.collection('reimbursements').updateOne(
      { id },
      { $set: updateData }
    );

    // Send email notification for cleared reimbursements
    if (action === 'clear') {
      const emailHtml = generateReimbursementClearedEmail({
        employeeName: reimbursement.employee_name,
        title: reimbursement.title,
        category: reimbursement.category,
        amount: reimbursement.amount,
        expenseDate: reimbursement.expense_date,
        clearedDate: new Date(),
        remarks: remarks
      });

      await sendEmailNotification(
        reimbursement.employee_email,
        'Reimbursement Cleared - Payment Processed',
        emailHtml
      );
    }

    // Send email for rejection
    if (action === 'reject') {
      const emailHtml = generateReimbursementRejectedEmail({
        employeeName: reimbursement.employee_name,
        title: reimbursement.title,
        category: reimbursement.category,
        amount: reimbursement.amount,
        reason: remarks
      });

      await sendEmailNotification(
        reimbursement.employee_email,
        'Reimbursement Request Rejected',
        emailHtml
      );
    }

    res.json({
      status: 'success',
      message: `Reimbursement ${action}${action === 'clear' ? 'ed' : action === 'approve' ? 'd' : 'ed'} successfully`,
      reimbursement_id: id,
      new_status: newStatus
    });
  } catch (error) {
    console.error('Process reimbursement action error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/reimbursements/:id
 * Get single reimbursement details
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    const reimbursement = await db.collection('reimbursements').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    if (!reimbursement) {
      return res.status(404).json({ detail: 'Reimbursement not found' });
    }

    // Check permission
    if (req.user.role !== UserRole.ADMIN && reimbursement.employee_email !== req.user.email) {
      return res.status(403).json({ detail: 'Not authorized' });
    }

    res.json(reimbursement);
  } catch (error) {
    console.error('Get reimbursement error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/reimbursements/:id
 * Cancel/delete reimbursement (only if pending)
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    const reimbursement = await db.collection('reimbursements').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    if (!reimbursement) {
      return res.status(404).json({ detail: 'Reimbursement not found' });
    }

    // Check permission - only owner can delete pending, admin can delete any
    if (req.user.role !== UserRole.ADMIN) {
      if (reimbursement.employee_email !== req.user.email) {
        return res.status(403).json({ detail: 'Not authorized' });
      }
      if (reimbursement.status !== 'pending') {
        return res.status(400).json({ detail: 'Can only cancel pending reimbursements' });
      }
    }

    // Delete bill from S3 if exists
    if (reimbursement.bill_key) {
      try {
        await deleteFile(reimbursement.bill_key);
      } catch (deleteError) {
        console.error('Failed to delete bill from S3:', deleteError);
        // Continue with deletion anyway
      }
    } else if (reimbursement.bill_url) {
      // Try to extract key from URL if bill_key is not stored
      const key = extractKeyFromUrl(reimbursement.bill_url);
      if (key) {
        try {
          await deleteFile(key);
        } catch (deleteError) {
          console.error('Failed to delete bill from S3:', deleteError);
        }
      }
    }

    await db.collection('reimbursements').deleteOne({ id });

    res.json({
      status: 'success',
      message: 'Reimbursement deleted successfully'
    });
  } catch (error) {
    console.error('Delete reimbursement error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Email Template Functions

/**
 * Generate reimbursement cleared email
 */
const generateReimbursementClearedEmail = ({ employeeName, title, category, amount, expenseDate, clearedDate, remarks }) => {
  const formattedExpenseDate = new Date(expenseDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  const formattedClearedDate = clearedDate.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 32px; text-align: center;">
      <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 60px;">
        <span style="font-size: 28px; color: #ffffff;">✓</span>
      </div>
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Reimbursement Cleared!</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Your payment has been processed</p>
    </div>

    <!-- Content -->
    <div style="padding: 32px;">
      <p style="color: #334155; font-size: 16px; margin: 0 0 24px 0;">
        Dear <strong>${employeeName}</strong>,
      </p>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">
        Great news! Your reimbursement request has been processed and the payment has been cleared. Here are the details:
      </p>

      <!-- Details Box -->
      <div style="background-color: #f8fafc; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Title</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${title}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Category</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${category}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Expense Date</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${formattedExpenseDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Cleared Date</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${formattedClearedDate}</td>
          </tr>
        </table>
        
        <!-- Amount -->
        <div style="margin-top: 16px; padding-top: 16px; border-top: 2px dashed #e2e8f0; text-align: center;">
          <p style="color: #64748b; font-size: 12px; margin: 0 0 4px 0;">Amount Reimbursed</p>
          <p style="color: #059669; font-size: 32px; font-weight: 700; margin: 0;">₹${parseFloat(amount).toLocaleString('en-IN')}</p>
        </div>
      </div>

      ${remarks ? `
      <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="color: #065f46; font-size: 13px; margin: 0;">
          <strong>Note from Admin:</strong> ${remarks}
        </p>
      </div>
      ` : ''}

      <p style="color: #64748b; font-size: 14px; margin: 0;">
        The amount will be credited to your account as per company policy. If you have any questions, please contact the HR department.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">
        This is an automated email from the HRMS System.<br>
        Please do not reply to this email.
      </p>
    </div>

  </div>
</body>
</html>
  `;
};

/**
 * Generate reimbursement rejected email
 */
const generateReimbursementRejectedEmail = ({ employeeName, title, category, amount, reason }) => {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 32px; text-align: center;">
      <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 60px;">
        <span style="font-size: 28px; color: #334155;">✕</span>
      </div>
      <h1 style="color: #334155; margin: 0; font-size: 24px; font-weight: 700;">Reimbursement Rejected</h1>
    </div>

    <!-- Content -->
    <div style="padding: 32px;">
      <p style="color: #334155; font-size: 16px; margin: 0 0 24px 0;">
        Dear <strong>${employeeName}</strong>,
      </p>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">
        We regret to inform you that your reimbursement request has been rejected. Here are the details:
      </p>

      <!-- Details Box -->
      <div style="background-color: #fef2f2; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #fecaca;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Title</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${title}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Category</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${category}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Amount</td>
            <td style="padding: 8px 0; color: #dc2626; font-size: 14px; font-weight: 600; text-align: right;">₹${parseFloat(amount).toLocaleString('en-IN')}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="color: #991b1b; font-size: 13px; margin: 0;">
          <strong>Reason for Rejection:</strong> ${reason}
        </p>
      </div>

      <p style="color: #64748b; font-size: 14px; margin: 0;">
        If you believe this was rejected in error or have any questions, please contact the HR department.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">
        This is an automated email from the HRMS System.<br>
        Please do not reply to this email.
      </p>
    </div>

  </div>
</body>
</html>
  `;
};

module.exports = router;
