/**
 * User Notifications Routes
 * Endpoints for in-app notifications management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { UserRole } = require('../models/schemas');
const { getDB } = require('../config/database');
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  restoreNotification
} = require('../services/notificationService');

// ============================================
// STATIC ROUTES (must be before /:id routes)
// ============================================

/**
 * GET /api/notifications
 * Get notifications for the authenticated user
 * Query params: limit, offset, unread_only
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { limit = 50, offset = 0, unread_only = 'false' } = req.query;
    const userEmail = req.user.email;

    const notifications = await getNotifications(userEmail, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      unreadOnly: unread_only === 'true'
    });

    // Remove MongoDB _id from response
    const cleanedNotifications = notifications.map(n => {
      const { _id, ...rest } = n;
      return rest;
    });

    res.json({
      notifications: cleanedNotifications,
      count: cleanedNotifications.length
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ detail: 'Failed to fetch notifications' });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get unread notification count for the authenticated user
 */
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const count = await getUnreadCount(userEmail);

    res.json({ unread_count: count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ detail: 'Failed to fetch unread count' });
  }
});

/**
 * GET /api/notifications/deleted
 * Get deleted notifications for the authenticated user (for recovery)
 */
router.get('/deleted', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const userEmail = req.user.email;
    const { limit = 50 } = req.query;

    const deletedNotifications = await db.collection('notifications')
      .find({
        user_email: userEmail,
        deleted: true
      })
      .sort({ deleted_at: -1 })
      .limit(parseInt(limit))
      .toArray();

    // Remove MongoDB _id from response
    const cleanedNotifications = deletedNotifications.map(n => {
      const { _id, ...rest } = n;
      return rest;
    });

    res.json({
      notifications: cleanedNotifications,
      count: cleanedNotifications.length
    });
  } catch (error) {
    console.error('Get deleted notifications error:', error);
    res.status(500).json({ detail: 'Failed to fetch deleted notifications' });
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read for the authenticated user
 */
router.put('/read-all', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const count = await markAllAsRead(userEmail);

    res.json({
      status: 'success',
      message: `Marked ${count} notifications as read`
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ detail: 'Failed to mark all notifications as read' });
  }
});

/**
 * GET /api/notifications/admin/all
 * Get all notifications for all users (admin only) - for audit purposes
 */
router.get('/admin/all', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { limit = 100, include_deleted = 'false' } = req.query;

    const query = {};
    if (include_deleted !== 'true') {
      query.deleted = { $ne: true };
    }

    const notifications = await db.collection('notifications')
      .find(query)
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .toArray();

    // Remove MongoDB _id from response
    const cleanedNotifications = notifications.map(n => {
      const { _id, ...rest } = n;
      return rest;
    });

    res.json({
      notifications: cleanedNotifications,
      count: cleanedNotifications.length
    });
  } catch (error) {
    console.error('Get all notifications error:', error);
    res.status(500).json({ detail: 'Failed to fetch notifications' });
  }
});

// ============================================
// PARAMETERIZED ROUTES (must be after static routes)
// ============================================

/**
 * PUT /api/notifications/:id/read
 * Mark a specific notification as read
 */
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.user.email;

    const success = await markAsRead(id, userEmail);

    if (success) {
      res.json({ status: 'success', message: 'Notification marked as read' });
    } else {
      res.status(404).json({ detail: 'Notification not found' });
    }
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ detail: 'Failed to mark notification as read' });
  }
});

/**
 * PUT /api/notifications/:id/restore
 * Restore a soft-deleted notification
 */
router.put('/:id/restore', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.user.email;

    const success = await restoreNotification(id, userEmail);

    if (success) {
      res.json({ status: 'success', message: 'Notification restored' });
    } else {
      res.status(404).json({ detail: 'Notification not found or not deleted' });
    }
  } catch (error) {
    console.error('Restore notification error:', error);
    res.status(500).json({ detail: 'Failed to restore notification' });
  }
});

/**
 * DELETE /api/notifications/:id
 * Soft delete a specific notification (can be recovered)
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.user.email;

    const success = await deleteNotification(id, userEmail);

    if (success) {
      res.json({ status: 'success', message: 'Notification deleted' });
    } else {
      res.status(404).json({ detail: 'Notification not found' });
    }
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ detail: 'Failed to delete notification' });
  }
});

module.exports = router;
