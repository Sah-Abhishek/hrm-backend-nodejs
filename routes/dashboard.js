const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate, getCurrentEmployee } = require('../middleware/auth');
const { UserRole, LeaveStatus } = require('../models/schemas');

/**
 * GET /api/dashboard/stats
 * Get dashboard statistics
 */
router.get('/stats', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    const db = getDB();
    const user = req.user;
    const employee = req.employee;

    const stats = {
      total_employees: 0,
      pending_leaves: 0,
      approved_leaves_this_month: 0,
      my_leave_balance: null,
      recent_leaves: []
    };

    if (user.role === UserRole.ADMIN) {
      // Admin stats
      stats.total_employees = await db.collection('employees').countDocuments({});
      stats.pending_leaves = await db.collection('leaves').countDocuments({
        status: { $in: [LeaveStatus.PENDING, LeaveStatus.MANAGER_APPROVED] }
      });

      // Approved leaves this month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      stats.approved_leaves_this_month = await db.collection('leaves').countDocuments({
        status: LeaveStatus.APPROVED,
        created_at: { $gte: startOfMonth.toISOString() }
      });
    } else if (user.role === UserRole.MANAGER) {
      // Manager stats
      stats.total_employees = await db.collection('employees').countDocuments({
        manager_email: employee.email
      });
      stats.pending_leaves = await db.collection('leaves').countDocuments({
        manager_email: employee.email,
        status: LeaveStatus.PENDING
      });
    }

    // Employee's own leave balance
    stats.my_leave_balance = employee.leave_balance;

    // Recent leaves query
    let query = {};
    if (user.role === UserRole.ADMIN) {
      query = {};
    } else if (user.role === UserRole.MANAGER) {
      query = { manager_email: employee.email };
    } else {
      query = { employee_email: employee.email };
    }

    const recentLeaves = await db.collection('leaves')
      .find(query, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .limit(5)
      .toArray();

    // Normalize dates
    for (const leave of recentLeaves) {
      for (const field of ['start_date', 'end_date', 'created_at', 'updated_at']) {
        if (typeof leave[field] === 'string') {
          leave[field] = new Date(leave[field]);
        }
      }
      for (const approval of leave.approvals || []) {
        if (typeof approval.timestamp === 'string') {
          approval.timestamp = new Date(approval.timestamp);
        }
      }
    }

    stats.recent_leaves = recentLeaves;

    res.json(stats);
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
