/**
 * Notification Service
 * Handles creating in-app notifications and sending email notifications
 */

const { getDB } = require('../config/database');
const { sendEmailNotification } = require('./emailService');
const { sendWhatsAppNotification, shouldSendWhatsApp } = require('./whatsappService');
const { v4: uuidv4 } = require('uuid');

// Notification Types
const NotificationType = {
  // Leave related
  LEAVE_APPLIED: 'leave_applied',
  LEAVE_APPROVED: 'leave_approved',
  LEAVE_REJECTED: 'leave_rejected',
  LEAVE_CANCELLED: 'leave_cancelled',

  // Comp-off related
  COMPOFF_APPLIED: 'compoff_applied',
  COMPOFF_APPROVED: 'compoff_approved',
  COMPOFF_REJECTED: 'compoff_rejected',

  // Reimbursement related
  REIMBURSEMENT_APPLIED: 'reimbursement_applied',
  REIMBURSEMENT_APPROVED: 'reimbursement_approved',
  REIMBURSEMENT_REJECTED: 'reimbursement_rejected',
  REIMBURSEMENT_CLEARED: 'reimbursement_cleared',

  // Leave balance related
  LEAVE_BALANCE_ADJUSTED: 'leave_balance_adjusted',

  // General
  GENERAL: 'general'
};

/**
 * Try to send WhatsApp notification for a given type
 * Checks settings, looks up employee phone, sends if enabled
 */
const trySendWhatsApp = async (type, userEmail, message) => {
  try {
    const enabled = await shouldSendWhatsApp(type);
    if (!enabled) return;

    const db = getDB();
    const employee = await db.collection('employees').findOne(
      { email: userEmail },
      { projection: { phone: 1 } }
    );

    if (employee?.phone) {
      await sendWhatsAppNotification(employee.phone, message);
    }
  } catch (error) {
    console.error('trySendWhatsApp error:', error.message);
  }
};

/**
 * Create an in-app notification
 * @param {Object} params - Notification parameters
 * @param {string} params.userId - The user ID to notify
 * @param {string} params.userEmail - The user email to notify
 * @param {string} params.type - Notification type from NotificationType
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification message
 * @param {string} params.actionUrl - Optional URL to navigate to
 * @param {Object} params.metadata - Optional additional data
 */
const createNotification = async ({
  userId,
  userEmail,
  type,
  title,
  message,
  actionUrl = null,
  metadata = {}
}) => {
  try {
    const db = getDB();

    const notification = {
      id: uuidv4(),
      user_id: userId,
      user_email: userEmail,
      type,
      title,
      message,
      action_url: actionUrl,
      metadata,
      read: false,
      created_at: new Date(),
      updated_at: new Date()
    };

    await db.collection('notifications').insertOne(notification);

    console.log(`🔔 Notification created for ${userEmail}: ${title}`);

    // Fire-and-forget WhatsApp notification
    trySendWhatsApp(type, userEmail, message).catch(err =>
      console.error('WhatsApp send error (non-blocking):', err.message)
    );

    return notification;
  } catch (error) {
    console.error('Failed to create notification:', error.message);
    return null;
  }
};

/**
 * Create notification and send email
 * @param {Object} params - Same as createNotification plus emailHtml
 * @param {string} params.emailSubject - Email subject
 * @param {string} params.emailHtml - Email HTML content
 */
const notifyWithEmail = async ({
  userId,
  userEmail,
  type,
  title,
  message,
  actionUrl = null,
  metadata = {},
  emailSubject,
  emailHtml
}) => {
  // Create in-app notification
  const notification = await createNotification({
    userId,
    userEmail,
    type,
    title,
    message,
    actionUrl,
    metadata
  });

  // Send email notification
  if (emailSubject && emailHtml) {
    await sendEmailNotification(userEmail, emailSubject, emailHtml);
  }

  return notification;
};

/**
 * Notify multiple users
 * @param {Array} users - Array of { userId, userEmail } objects
 * @param {Object} notificationData - Notification data (type, title, message, etc.)
 */
const notifyMultiple = async (users, notificationData) => {
  const notifications = [];

  for (const user of users) {
    const notification = await createNotification({
      userId: user.userId,
      userEmail: user.userEmail,
      ...notificationData
    });
    if (notification) {
      notifications.push(notification);
    }
  }

  return notifications;
};

/**
 * Get notifications for a user
 * @param {string} userEmail - User email
 * @param {Object} options - Query options
 */
const getNotifications = async (userEmail, options = {}) => {
  try {
    const db = getDB();
    const { limit = 50, offset = 0, unreadOnly = false } = options;

    const query = {
      user_email: userEmail,
      deleted: { $ne: true }  // Exclude soft-deleted notifications
    };
    if (unreadOnly) {
      query.read = false;
    }

    const notifications = await db.collection('notifications')
      .find(query)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return notifications;
  } catch (error) {
    console.error('Failed to get notifications:', error.message);
    return [];
  }
};

/**
 * Get unread notification count for a user
 * @param {string} userEmail - User email
 */
const getUnreadCount = async (userEmail) => {
  try {
    const db = getDB();
    const count = await db.collection('notifications').countDocuments({
      user_email: userEmail,
      read: false,
      deleted: { $ne: true }  // Exclude soft-deleted notifications
    });
    return count;
  } catch (error) {
    console.error('Failed to get unread count:', error.message);
    return 0;
  }
};

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 * @param {string} userEmail - User email (for verification)
 */
const markAsRead = async (notificationId, userEmail) => {
  try {
    const db = getDB();
    const result = await db.collection('notifications').updateOne(
      { id: notificationId, user_email: userEmail },
      { $set: { read: true, updated_at: new Date() } }
    );
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Failed to mark notification as read:', error.message);
    return false;
  }
};

/**
 * Mark all notifications as read for a user
 * @param {string} userEmail - User email
 */
const markAllAsRead = async (userEmail) => {
  try {
    const db = getDB();
    const result = await db.collection('notifications').updateMany(
      { user_email: userEmail, read: false },
      { $set: { read: true, updated_at: new Date() } }
    );
    return result.modifiedCount;
  } catch (error) {
    console.error('Failed to mark all as read:', error.message);
    return 0;
  }
};

/**
 * Soft delete a notification (marks as deleted but keeps in database)
 * @param {string} notificationId - Notification ID
 * @param {string} userEmail - User email (for verification)
 */
const deleteNotification = async (notificationId, userEmail) => {
  try {
    const db = getDB();
    const result = await db.collection('notifications').updateOne(
      { id: notificationId, user_email: userEmail },
      {
        $set: {
          deleted: true,
          deleted_at: new Date(),
          updated_at: new Date()
        }
      }
    );
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Failed to delete notification:', error.message);
    return false;
  }
};

/**
 * Restore a soft-deleted notification
 * @param {string} notificationId - Notification ID
 * @param {string} userEmail - User email (for verification)
 */
const restoreNotification = async (notificationId, userEmail) => {
  try {
    const db = getDB();
    const result = await db.collection('notifications').updateOne(
      { id: notificationId, user_email: userEmail, deleted: true },
      {
        $set: {
          deleted: false,
          updated_at: new Date()
        },
        $unset: { deleted_at: '' }
      }
    );
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Failed to restore notification:', error.message);
    return false;
  }
};

/**
 * Permanently delete old soft-deleted notifications (for cleanup)
 * @param {number} daysOld - Permanently delete notifications deleted more than this many days ago
 */
const permanentlyDeleteOldNotifications = async (daysOld = 90) => {
  try {
    const db = getDB();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await db.collection('notifications').deleteMany({
      deleted: true,
      deleted_at: { $lt: cutoffDate }
    });

    console.log(`🗑️ Permanently deleted ${result.deletedCount} old soft-deleted notifications`);
    return result.deletedCount;
  } catch (error) {
    console.error('Failed to permanently delete notifications:', error.message);
    return 0;
  }
};

/**
 * Soft-delete all read notifications older than specified days
 * @param {number} daysOld - Soft-delete notifications older than this many days
 */
const cleanupOldNotifications = async (daysOld = 30) => {
  try {
    const db = getDB();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await db.collection('notifications').updateMany(
      {
        read: true,
        deleted: { $ne: true },
        created_at: { $lt: cutoffDate }
      },
      {
        $set: {
          deleted: true,
          deleted_at: new Date(),
          updated_at: new Date()
        }
      }
    );

    console.log(`🧹 Soft-deleted ${result.modifiedCount} old read notifications`);
    return result.modifiedCount;
  } catch (error) {
    console.error('Failed to cleanup notifications:', error.message);
    return 0;
  }
};

// ============================================
// Helper functions for specific notification types
// ============================================

/**
 * Notify manager/admin when employee applies for leave
 */
const notifyLeaveApplication = async (leave, employee, managers) => {
  const title = 'New Leave Application';
  const message = `${employee.full_name} has applied for ${leave.leave_type} from ${formatDateRange(leave.dates)}`;

  for (const manager of managers) {
    await createNotification({
      userId: manager.id,
      userEmail: manager.email,
      type: NotificationType.LEAVE_APPLIED,
      title,
      message,
      actionUrl: '/approvals',
      metadata: {
        leave_id: leave.id,
        employee_id: employee.employee_id,
        employee_name: employee.full_name,
        leave_type: leave.leave_type,
        dates: leave.dates
      }
    });
  }
};

/**
 * Notify employee when leave is approved/rejected
 */
const notifyLeaveAction = async (leave, employee, action, comments, actionByName) => {
  const isApproved = action === 'approve';
  const title = isApproved ? 'Leave Approved' : 'Leave Rejected';
  const message = isApproved
    ? `Your ${leave.leave_type} request for ${formatDateRange(leave.dates)} has been approved by ${actionByName}`
    : `Your ${leave.leave_type} request for ${formatDateRange(leave.dates)} has been rejected by ${actionByName}${comments ? `. Reason: ${comments}` : ''}`;

  await createNotification({
    userId: employee.id,
    userEmail: employee.email,
    type: isApproved ? NotificationType.LEAVE_APPROVED : NotificationType.LEAVE_REJECTED,
    title,
    message,
    actionUrl: '/leaves',
    metadata: {
      leave_id: leave.id,
      leave_type: leave.leave_type,
      dates: leave.dates,
      action,
      comments,
      action_by: actionByName
    }
  });
};

/**
 * Notify manager/admin when employee applies for comp-off
 */
const notifyCompOffApplication = async (compOff, employee, managers) => {
  const title = 'New Comp-Off Request';
  const message = `${employee.full_name} has requested ${compOff.days} day(s) comp-off for work on ${formatDate(compOff.work_date)}`;

  for (const manager of managers) {
    await createNotification({
      userId: manager.id,
      userEmail: manager.email,
      type: NotificationType.COMPOFF_APPLIED,
      title,
      message,
      actionUrl: '/admincompoff',
      metadata: {
        compoff_id: compOff.id,
        employee_id: employee.employee_id,
        employee_name: employee.full_name,
        days: compOff.days,
        work_date: compOff.work_date
      }
    });
  }
};

/**
 * Notify employee when comp-off is approved/rejected
 */
const notifyCompOffAction = async (compOff, employee, action, remarks, actionByName) => {
  const isApproved = action === 'approve';
  const title = isApproved ? 'Comp-Off Approved' : 'Comp-Off Rejected';
  const message = isApproved
    ? `Your comp-off request for ${compOff.days} day(s) has been approved by ${actionByName}. ${compOff.days} day(s) added to your balance.`
    : `Your comp-off request has been rejected by ${actionByName}${remarks ? `. Reason: ${remarks}` : ''}`;

  await createNotification({
    userId: employee.id,
    userEmail: employee.email,
    type: isApproved ? NotificationType.COMPOFF_APPROVED : NotificationType.COMPOFF_REJECTED,
    title,
    message,
    actionUrl: '/mycompoff',
    metadata: {
      compoff_id: compOff.id,
      days: compOff.days,
      action,
      remarks,
      action_by: actionByName
    }
  });
};

/**
 * Notify admin when employee applies for reimbursement
 */
const notifyReimbursementApplication = async (reimbursement, employee, admins) => {
  const title = 'New Reimbursement Request';
  const message = `${employee.full_name} has submitted a reimbursement request for ₹${reimbursement.amount} (${reimbursement.category})`;

  for (const admin of admins) {
    await createNotification({
      userId: admin.id,
      userEmail: admin.email,
      type: NotificationType.REIMBURSEMENT_APPLIED,
      title,
      message,
      actionUrl: '/adminreimbursements',
      metadata: {
        reimbursement_id: reimbursement.id,
        employee_id: employee.employee_id,
        employee_name: employee.full_name,
        amount: reimbursement.amount,
        category: reimbursement.category
      }
    });
  }
};

/**
 * Notify employee when reimbursement status changes
 */
const notifyReimbursementAction = async (reimbursement, employee, action, remarks, actionByName) => {
  let title, message, type;

  switch (action) {
    case 'approve':
      title = 'Reimbursement Approved';
      message = `Your reimbursement request for ₹${reimbursement.amount} (${reimbursement.title}) has been approved by ${actionByName}`;
      type = NotificationType.REIMBURSEMENT_APPROVED;
      break;
    case 'reject':
      title = 'Reimbursement Rejected';
      message = `Your reimbursement request for ₹${reimbursement.amount} (${reimbursement.title}) has been rejected by ${actionByName}${remarks ? `. Reason: ${remarks}` : ''}`;
      type = NotificationType.REIMBURSEMENT_REJECTED;
      break;
    case 'clear':
      title = 'Reimbursement Cleared';
      message = `Your reimbursement of ₹${reimbursement.amount} (${reimbursement.title}) has been cleared/paid by ${actionByName}`;
      type = NotificationType.REIMBURSEMENT_CLEARED;
      break;
    default:
      return;
  }

  await createNotification({
    userId: employee.id,
    userEmail: employee.email,
    type,
    title,
    message,
    actionUrl: '/myreimbursements',
    metadata: {
      reimbursement_id: reimbursement.id,
      amount: reimbursement.amount,
      title: reimbursement.title,
      action,
      remarks,
      action_by: actionByName
    }
  });
};

/**
 * Notify employee when their leave balance is adjusted
 */
const notifyLeaveBalanceAdjustment = async (employee, adjustment, adjustedByName) => {
  const { action_type, leave_type, days, previous_balance, new_balance, reason } = adjustment;

  let actionText;
  switch (action_type) {
    case 'add':
      actionText = `increased by ${days} day(s)`;
      break;
    case 'deduct':
      actionText = `decreased by ${days} day(s)`;
      break;
    case 'set':
      actionText = `set to ${new_balance} day(s)`;
      break;
    default:
      actionText = 'adjusted';
  }

  const leaveTypeDisplay = leave_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  const title = 'Leave Balance Updated';
  const message = `Your ${leaveTypeDisplay} balance has been ${actionText} by ${adjustedByName}. Previous: ${previous_balance}, New: ${new_balance}${reason ? `. Reason: ${reason}` : ''}`;

  await createNotification({
    userId: employee.id,
    userEmail: employee.email,
    type: NotificationType.LEAVE_BALANCE_ADJUSTED,
    title,
    message,
    actionUrl: '/leaves',
    metadata: {
      leave_type,
      action_type,
      days,
      previous_balance,
      new_balance,
      reason,
      adjusted_by: adjustedByName
    }
  });
};

// Helper function to format dates
const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatDateRange = (dates) => {
  if (!dates || !Array.isArray(dates) || dates.length === 0) return '';
  if (dates.length === 1) return formatDate(dates[0]);

  const sortedDates = dates.map(d => new Date(d)).sort((a, b) => a - b);
  return `${formatDate(sortedDates[0])} to ${formatDate(sortedDates[sortedDates.length - 1])}`;
};

module.exports = {
  NotificationType,
  createNotification,
  notifyWithEmail,
  notifyMultiple,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  restoreNotification,
  cleanupOldNotifications,
  permanentlyDeleteOldNotifications,
  // Helper functions for specific types
  notifyLeaveApplication,
  notifyLeaveAction,
  notifyCompOffApplication,
  notifyCompOffAction,
  notifyReimbursementApplication,
  notifyReimbursementAction,
  notifyLeaveBalanceAdjustment
};
