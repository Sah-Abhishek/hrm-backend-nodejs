const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, validate } = require('../middleware/roleCheck');
const { schemas, UserRole } = require('../models/schemas');
const { generateUUID, toISOString } = require('../utils/helpers');

/**
 * GET /api/holidays
 * Get all holidays (accessible to all authenticated users)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { year, month } = req.query;

    let query = {};

    // Filter by year
    if (year) {
      const yearInt = parseInt(year, 10);
      const startDate = `${yearInt}-01-01`;
      const endDate = `${yearInt}-12-31`;
      query.date = { $gte: startDate, $lte: endDate };
    }

    // Filter by month (requires year)
    if (year && month) {
      const yearInt = parseInt(year, 10);
      const monthInt = parseInt(month, 10);
      const lastDay = new Date(yearInt, monthInt, 0).getDate();
      const startDate = `${yearInt}-${String(monthInt).padStart(2, '0')}-01`;
      const endDate = `${yearInt}-${String(monthInt).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      query.date = { $gte: startDate, $lte: endDate };
    }

    const holidays = await db.collection('holidays')
      .find(query, { projection: { _id: 0 } })
      .sort({ date: 1 })
      .toArray();

    res.json(holidays);
  } catch (error) {
    console.error('Get holidays error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/holidays/:id
 * Get a single holiday
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    const holiday = await db.collection('holidays').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    if (!holiday) {
      return res.status(404).json({ detail: 'Holiday not found' });
    }

    res.json(holiday);
  } catch (error) {
    console.error('Get holiday error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/holidays
 * Create a new holiday (admin only)
 */
router.post('/', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.holidayCreate), async (req, res) => {
  try {
    const db = getDB();
    const holidayData = req.validatedBody;
    const user = req.user;

    // Format date as YYYY-MM-DD string
    const dateObj = new Date(holidayData.date);
    const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

    // Check if holiday already exists on this date
    const existing = await db.collection('holidays').findOne({ date: dateStr });
    if (existing) {
      return res.status(400).json({ detail: 'A holiday already exists on this date' });
    }

    const now = new Date();
    const holiday = {
      id: generateUUID(),
      name: holidayData.name,
      date: dateStr,
      type: holidayData.type || 'public',
      description: holidayData.description || null,
      created_by: user.email,
      created_at: toISOString(now),
      updated_at: toISOString(now)
    };

    await db.collection('holidays').insertOne(holiday);
    delete holiday._id;

    res.status(201).json(holiday);
  } catch (error) {
    console.error('Create holiday error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/holidays/:id
 * Update a holiday (admin only)
 */
router.put('/:id', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.holidayUpdate), async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const updateData = req.validatedBody;

    const holiday = await db.collection('holidays').findOne({ id });
    if (!holiday) {
      return res.status(404).json({ detail: 'Holiday not found' });
    }

    const updates = {
      updated_at: toISOString(new Date())
    };

    if (updateData.name !== undefined) updates.name = updateData.name;
    if (updateData.type !== undefined) updates.type = updateData.type;
    if (updateData.description !== undefined) updates.description = updateData.description;

    if (updateData.date !== undefined) {
      const dateObj = new Date(updateData.date);
      updates.date = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
    }

    await db.collection('holidays').updateOne({ id }, { $set: updates });

    const updatedHoliday = await db.collection('holidays').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    res.json(updatedHoliday);
  } catch (error) {
    console.error('Update holiday error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/holidays/:id
 * Delete a holiday (admin only)
 */
router.delete('/:id', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    const holiday = await db.collection('holidays').findOne({ id });
    if (!holiday) {
      return res.status(404).json({ detail: 'Holiday not found' });
    }

    await db.collection('holidays').deleteOne({ id });

    res.json({ status: 'success', message: 'Holiday deleted successfully' });
  } catch (error) {
    console.error('Delete holiday error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/holidays/recurring
 * Create recurring holidays (e.g., all Saturdays of a month/year) (admin only)
 */
router.post('/recurring', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.recurringHoliday), async (req, res) => {
  try {
    const db = getDB();
    const { name, day_of_week, scope, year, month, type } = req.validatedBody;
    const user = req.user;

    // Validate month is provided for 'month' scope
    if (scope === 'month' && !month) {
      return res.status(400).json({ detail: 'Month is required for monthly scope' });
    }

    // Generate all dates for the given day of week
    const dates = [];
    const startMonth = scope === 'month' ? month : 1;
    const endMonth = scope === 'month' ? month : 12;

    for (let m = startMonth; m <= endMonth; m++) {
      const daysInMonth = new Date(year, m, 0).getDate();

      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, m - 1, d);
        if (date.getDay() === day_of_week) {
          const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          dates.push(dateStr);
        }
      }
    }

    // Create holidays for each date (skip if already exists)
    const now = new Date();
    const created = [];
    const skipped = [];

    for (const dateStr of dates) {
      const existing = await db.collection('holidays').findOne({ date: dateStr });
      if (existing) {
        skipped.push(dateStr);
        continue;
      }

      const holiday = {
        id: generateUUID(),
        name: name,
        date: dateStr,
        type: type || 'public',
        description: `Recurring ${getDayName(day_of_week)} holiday`,
        is_recurring: true,
        recurring_day: day_of_week,
        created_by: user.email,
        created_at: toISOString(now),
        updated_at: toISOString(now)
      };

      await db.collection('holidays').insertOne(holiday);
      delete holiday._id;
      created.push(holiday);
    }

    res.status(201).json({
      status: 'success',
      message: `Created ${created.length} holidays, skipped ${skipped.length} (already exist)`,
      created_count: created.length,
      skipped_count: skipped.length,
      holidays: created
    });
  } catch (error) {
    console.error('Create recurring holidays error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/holidays/recurring
 * Delete all recurring holidays for a specific day of week (admin only)
 */
router.delete('/recurring', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { day_of_week, scope, year, month } = req.body;

    if (day_of_week === undefined || !scope || !year) {
      return res.status(400).json({ detail: 'day_of_week, scope, and year are required' });
    }

    // Build date range
    let startDate, endDate;
    if (scope === 'month') {
      if (!month) {
        return res.status(400).json({ detail: 'Month is required for monthly scope' });
      }
      const lastDay = new Date(year, month, 0).getDate();
      startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    } else {
      startDate = `${year}-01-01`;
      endDate = `${year}-12-31`;
    }

    // Delete holidays that are recurring and match the day of week
    const result = await db.collection('holidays').deleteMany({
      date: { $gte: startDate, $lte: endDate },
      is_recurring: true,
      recurring_day: day_of_week
    });

    res.json({
      status: 'success',
      message: `Deleted ${result.deletedCount} recurring holidays`,
      deleted_count: result.deletedCount
    });
  } catch (error) {
    console.error('Delete recurring holidays error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/holidays/check/:date
 * Check if a specific date is a holiday
 */
router.get('/check/:date', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { date } = req.params;

    const holiday = await db.collection('holidays').findOne(
      { date },
      { projection: { _id: 0 } }
    );

    res.json({
      is_holiday: !!holiday,
      holiday: holiday || null
    });
  } catch (error) {
    console.error('Check holiday error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/holidays/upcoming
 * Get upcoming holidays
 */
router.get('/list/upcoming', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { limit = 10 } = req.query;

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const holidays = await db.collection('holidays')
      .find({ date: { $gte: todayStr } }, { projection: { _id: 0 } })
      .sort({ date: 1 })
      .limit(parseInt(limit, 10))
      .toArray();

    res.json(holidays);
  } catch (error) {
    console.error('Get upcoming holidays error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Helper function
function getDayName(dayIndex) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayIndex];
}

module.exports = router;
