const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, validate } = require('../middleware/roleCheck');
const { schemas, AttendanceStatus } = require('../models/schemas');

/**
 * GET /api/attendance
 * Get attendance data for a specific month/year
 * Query params: month (1-12), year (YYYY)
 */
router.get('/', authenticate, requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const db = getDB();
    const { month, year } = req.query;

    // Default to current month/year
    const now = new Date();
    const targetMonth = month ? parseInt(month) : now.getMonth() + 1;
    const targetYear = year ? parseInt(year) : now.getFullYear();

    // Fetch all employees
    const employees = await db.collection('employees')
      .find({}, {
        projection: {
          employee_id: 1,
          full_name: 1,
          email: 1,
          department: 1,
          designation: 1
        }
      })
      .sort({ employee_id: 1 })
      .toArray();

    // Fetch attendance records for the month
    const attendanceRecords = await db.collection('attendance')
      .find({
        month: targetMonth,
        year: targetYear
      })
      .toArray();

    // Fetch ALL holidays and filter by month/year in JavaScript
    // This handles any date storage format (Date objects, strings, ISO strings, etc.)
    const allHolidays = await db.collection('holidays').find({}).toArray();

    console.log(`Total holidays in DB: ${allHolidays.length}`);

    const holidays = allHolidays.filter(holiday => {
      try {
        const holidayDate = new Date(holiday.date);
        const holidayMonth = holidayDate.getMonth() + 1;
        const holidayYear = holidayDate.getFullYear();
        const matches = holidayMonth === targetMonth && holidayYear === targetYear;
        if (matches) {
          console.log(`Holiday matched: ${holiday.name} on ${holiday.date}`);
        }
        return matches;
      } catch (e) {
        console.error(`Failed to parse holiday date: ${holiday.date}`, e);
        return false;
      }
    });

    console.log(`Holidays for ${targetMonth}/${targetYear}: ${holidays.length}`);

    // Get number of days in the month
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();

    // Create a map for quick lookup
    const attendanceMap = {};
    attendanceRecords.forEach(record => {
      attendanceMap[record.employee_id] = record.attendance || {};
    });

    // Combine employees with their attendance
    const result = employees.map(emp => ({
      ...emp,
      attendance: attendanceMap[emp.employee_id] || {}
    }));

    res.json({
      month: targetMonth,
      year: targetYear,
      daysInMonth,
      holidays: holidays.map(h => ({
        date: h.date,
        name: h.name,
        type: h.type,
        description: h.description
      })),
      employees: result
    });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/attendance/mark
 * Mark attendance for an employee on a specific date
 * Body: { employee_id, date (YYYY-MM-DD), status (present/absent/half-day/leave/holiday) }
 */
router.post('/mark', authenticate, requireRole(['admin']), validate(schemas.attendanceMark), async (req, res) => {
  try {
    const db = getDB();
    const { employee_id, date, status } = req.validatedBody;

    // Check if the date is a holiday
    const dateObj = new Date(date);
    const day = dateObj.getDate();
    const month = dateObj.getMonth() + 1;
    const year = dateObj.getFullYear();

    // Fetch all holidays and check if this date is a holiday
    const allHolidays = await db.collection('holidays').find({}).toArray();
    const holiday = allHolidays.find(h => {
      const holidayDate = new Date(h.date);
      return holidayDate.getDate() === day &&
        holidayDate.getMonth() + 1 === month &&
        holidayDate.getFullYear() === year;
    });

    if (holiday) {
      return res.status(400).json({
        detail: `Cannot mark attendance on holiday: ${holiday.name}`
      });
    }

    // Update or create attendance record
    const updateField = `attendance.${day}`;

    if (status === '') {
      // Remove the attendance entry if status is empty
      await db.collection('attendance').updateOne(
        { employee_id, month, year },
        {
          $unset: { [updateField]: '' },
          $set: { updated_at: new Date() }
        }
      );
    } else {
      await db.collection('attendance').updateOne(
        { employee_id, month, year },
        {
          $set: {
            [updateField]: status,
            updated_at: new Date()
          },
          $setOnInsert: {
            created_at: new Date()
          }
        },
        { upsert: true }
      );
    }

    res.json({
      status: 'success',
      message: 'Attendance marked successfully',
      employee_id,
      date,
      attendance_status: status
    });
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/attendance/bulk-mark
 * Mark attendance for multiple employees/dates at once
 * Body: { records: [{ employee_id, date, status }] }
 */
router.post('/bulk-mark', authenticate, requireRole(['admin']), validate(schemas.attendanceBulkMark), async (req, res) => {
  try {
    const db = getDB();
    const { records } = req.validatedBody;

    // Fetch all holidays once
    const allHolidays = await db.collection('holidays').find({}).toArray();

    // Create a set of holiday date strings for quick lookup
    const holidayDates = new Set();
    allHolidays.forEach(h => {
      const holidayDate = new Date(h.date);
      const key = `${holidayDate.getFullYear()}-${holidayDate.getMonth() + 1}-${holidayDate.getDate()}`;
      holidayDates.add(key);
    });

    const bulkOps = [];
    let skippedHolidays = 0;

    for (const record of records) {
      const { employee_id, date, status } = record;

      const dateObj = new Date(date);
      const day = dateObj.getDate();
      const month = dateObj.getMonth() + 1;
      const year = dateObj.getFullYear();

      // Check if this date is a holiday
      const dateKey = `${year}-${month}-${day}`;
      if (holidayDates.has(dateKey)) {
        skippedHolidays++;
        continue;
      }

      const updateField = `attendance.${day}`;

      if (status === '') {
        bulkOps.push({
          updateOne: {
            filter: { employee_id, month, year },
            update: {
              $unset: { [updateField]: '' },
              $set: { updated_at: new Date() }
            }
          }
        });
      } else {
        bulkOps.push({
          updateOne: {
            filter: { employee_id, month, year },
            update: {
              $set: {
                [updateField]: status,
                updated_at: new Date()
              },
              $setOnInsert: {
                created_at: new Date()
              }
            },
            upsert: true
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      await db.collection('attendance').bulkWrite(bulkOps);
    }

    res.json({
      status: 'success',
      message: `${bulkOps.length} attendance records updated${skippedHolidays > 0 ? `, ${skippedHolidays} skipped (holidays)` : ''}`
    });
  } catch (error) {
    console.error('Bulk mark attendance error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/attendance/mark-column
 * Mark attendance for all employees on a specific date
 * Body: { date (YYYY-MM-DD), status }
 */
router.post('/mark-column', authenticate, requireRole(['admin']), validate(schemas.attendanceMarkColumn), async (req, res) => {
  try {
    const db = getDB();
    const { date, status } = req.validatedBody;

    const dateObj = new Date(date);
    const day = dateObj.getDate();
    const month = dateObj.getMonth() + 1;
    const year = dateObj.getFullYear();

    // Check if the date is a holiday
    const allHolidays = await db.collection('holidays').find({}).toArray();
    const holiday = allHolidays.find(h => {
      const holidayDate = new Date(h.date);
      return holidayDate.getDate() === day &&
        holidayDate.getMonth() + 1 === month &&
        holidayDate.getFullYear() === year;
    });

    if (holiday) {
      return res.status(400).json({
        detail: `Cannot mark attendance on holiday: ${holiday.name}`
      });
    }

    // Get all employees
    const employees = await db.collection('employees')
      .find({}, { projection: { employee_id: 1 } })
      .toArray();

    const updateField = `attendance.${day}`;

    const bulkOps = employees.map(emp => ({
      updateOne: {
        filter: { employee_id: emp.employee_id, month, year },
        update: {
          $set: {
            [updateField]: status,
            updated_at: new Date()
          },
          $setOnInsert: {
            created_at: new Date()
          }
        },
        upsert: true
      }
    }));

    if (bulkOps.length > 0) {
      await db.collection('attendance').bulkWrite(bulkOps);
    }

    res.json({
      status: 'success',
      message: `Marked ${status} for ${employees.length} employees on ${date}`
    });
  } catch (error) {
    console.error('Mark column error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/attendance/summary
 * Get attendance summary for a month
 */
router.get('/summary', authenticate, requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const db = getDB();
    const { month, year } = req.query;

    const now = new Date();
    const targetMonth = month ? parseInt(month) : now.getMonth() + 1;
    const targetYear = year ? parseInt(year) : now.getFullYear();

    // Get all attendance records for the month
    const records = await db.collection('attendance')
      .find({ month: targetMonth, year: targetYear })
      .toArray();

    // Fetch ALL holidays and filter by month/year
    const allHolidays = await db.collection('holidays').find({}).toArray();
    const holidays = allHolidays.filter(h => {
      try {
        const holidayDate = new Date(h.date);
        return holidayDate.getMonth() + 1 === targetMonth &&
          holidayDate.getFullYear() === targetYear;
      } catch (e) {
        return false;
      }
    });

    const holidayCount = holidays.length;

    // Calculate summary for each employee
    const summary = records.map(record => {
      const attendance = record.attendance || {};
      let present = 0, absent = 0, halfDay = 0, leave = 0;

      Object.values(attendance).forEach(status => {
        switch (status) {
          case 'present': present++; break;
          case 'absent': absent++; break;
          case 'half-day': halfDay++; break;
          case 'leave': leave++; break;
        }
      });

      return {
        employee_id: record.employee_id,
        present,
        absent,
        half_day: halfDay,
        leave,
        holidays: holidayCount,
        total_working_days: present + halfDay * 0.5
      };
    });

    res.json({
      month: targetMonth,
      year: targetYear,
      holidays: holidayCount,
      summary
    });
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/attendance/clear
 * Clear all attendance for a month (admin only)
 */
router.delete('/clear', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ detail: 'month and year are required' });
    }

    const result = await db.collection('attendance').deleteMany({
      month: parseInt(month),
      year: parseInt(year)
    });

    res.json({
      status: 'success',
      message: `Cleared ${result.deletedCount} attendance records for ${month}/${year}`
    });
  } catch (error) {
    console.error('Clear attendance error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/attendance/download
 * Download attendance as XLSX file
 * Body: { month, year }
 */
router.post('/download', authenticate, requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const db = getDB();
    const { month, year } = req.body;

    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const targetYear = year ? parseInt(year) : new Date().getFullYear();

    // Get month name
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[targetMonth - 1];

    // Get number of days in month
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();

    // Fetch ALL holidays and filter by month/year
    const allHolidays = await db.collection('holidays').find({}).toArray();
    const holidaysData = allHolidays.filter(h => {
      try {
        const holidayDate = new Date(h.date);
        return holidayDate.getMonth() + 1 === targetMonth &&
          holidayDate.getFullYear() === targetYear;
      } catch (e) {
        return false;
      }
    });

    // Create holiday map (day -> holiday info)
    const holidayMap = {};
    holidaysData.forEach(holiday => {
      const day = new Date(holiday.date).getDate();
      holidayMap[day] = {
        name: holiday.name,
        type: holiday.type
      };
    });

    // Fetch all employees
    const employees = await db.collection('employees')
      .find({}, {
        projection: {
          employee_id: 1,
          full_name: 1,
          email: 1,
          department: 1,
          designation: 1
        }
      })
      .sort({ employee_id: 1 })
      .toArray();

    // Fetch attendance records
    const attendanceRecords = await db.collection('attendance')
      .find({
        month: targetMonth,
        year: targetYear
      })
      .toArray();

    // Create attendance map
    const attendanceMap = {};
    attendanceRecords.forEach(record => {
      attendanceMap[record.employee_id] = record.attendance || {};
    });

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HRMS System';
    workbook.created = new Date();

    // Add worksheet
    const worksheet = workbook.addWorksheet(`${monthName} ${targetYear}`, {
      views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }]
    });

    // Define columns
    const columns = [
      { header: 'S.No', key: 'sno', width: 6 },
      { header: 'Employee ID', key: 'employee_id', width: 12 },
      { header: 'Employee Name', key: 'full_name', width: 25 },
      { header: 'Department', key: 'department', width: 15 }
    ];

    // Add day columns
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(targetYear, targetMonth - 1, day);
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
      const isHoliday = !!holidayMap[day];
      columns.push({
        header: isHoliday ? `${day}\n${dayName}\n🎉` : `${day}\n${dayName}`,
        key: `day_${day}`,
        width: 5
      });
    }

    // Add summary columns
    columns.push(
      { header: 'Present', key: 'present', width: 8 },
      { header: 'Absent', key: 'absent', width: 8 },
      { header: 'Half Day', key: 'half_day', width: 9 },
      { header: 'Leave', key: 'leave', width: 8 },
      { header: 'Holidays', key: 'holidays', width: 9 },
      { header: 'Working Days', key: 'working_days', width: 13 }
    );

    worksheet.columns = columns;

    // Add title row
    worksheet.insertRow(1, [`Attendance Report - ${monthName} ${targetYear}`]);
    worksheet.mergeCells(1, 1, 1, columns.length);
    const titleRow = worksheet.getRow(1);
    titleRow.font = { bold: true, size: 14 };
    titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.height = 30;

    // Style header row (row 2)
    const headerRow = worksheet.getRow(2);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    headerRow.height = 45;

    // Color holiday columns in header
    for (let day = 1; day <= daysInMonth; day++) {
      if (holidayMap[day]) {
        const colIndex = 4 + day; // After S.No, Employee ID, Name, Department
        const cell = headerRow.getCell(colIndex);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF8B5CF6' } // Purple for holidays
        };
      }
    }

    // Status abbreviations
    const statusMap = {
      'present': 'P',
      'absent': 'A',
      'half-day': 'H',
      'leave': 'L'
    };

    // Status colors
    const statusColors = {
      'present': 'FF10B981',
      'absent': 'FFEF4444',
      'half-day': 'FFF59E0B',
      'leave': 'FF3B82F6'
    };

    // Count total holidays in month
    const totalHolidays = Object.keys(holidayMap).length;

    // Add employee rows
    employees.forEach((employee, index) => {
      const attendance = attendanceMap[employee.employee_id] || {};

      // Calculate summary
      let present = 0, absent = 0, halfDay = 0, leave = 0;

      const rowData = {
        sno: index + 1,
        employee_id: employee.employee_id,
        full_name: employee.full_name,
        department: employee.department || ''
      };

      // Add daily attendance
      for (let day = 1; day <= daysInMonth; day++) {
        const isHoliday = !!holidayMap[day];

        if (isHoliday) {
          // Show holiday indicator
          rowData[`day_${day}`] = 'HO';
        } else {
          const status = attendance[day] || '';
          rowData[`day_${day}`] = statusMap[status] || '';

          switch (status) {
            case 'present': present++; break;
            case 'absent': absent++; break;
            case 'half-day': halfDay++; break;
            case 'leave': leave++; break;
          }
        }
      }

      // Add summary
      rowData.present = present;
      rowData.absent = absent;
      rowData.half_day = halfDay;
      rowData.leave = leave;
      rowData.holidays = totalHolidays;
      rowData.working_days = present + (halfDay * 0.5);

      const row = worksheet.addRow(rowData);
      row.alignment = { horizontal: 'center', vertical: 'middle' };

      // Style employee name column
      row.getCell('full_name').alignment = { horizontal: 'left', vertical: 'middle' };
      row.getCell('department').alignment = { horizontal: 'left', vertical: 'middle' };

      // Color code attendance cells
      for (let day = 1; day <= daysInMonth; day++) {
        const cell = row.getCell(`day_${day}`);
        const isHoliday = !!holidayMap[day];

        if (isHoliday) {
          // Holiday styling
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE9D5FF' } // Light purple
          };
          cell.font = { color: { argb: 'FF7C3AED' }, bold: true };
        } else {
          const status = attendance[day] || '';
          if (statusColors[status]) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: statusColors[status] }
            };
            cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
          }
        }
      }

      // Style summary columns
      row.getCell('present').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
      row.getCell('present').font = { bold: true, color: { argb: 'FF059669' } };
      row.getCell('absent').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
      row.getCell('absent').font = { bold: true, color: { argb: 'FFDC2626' } };
      row.getCell('half_day').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
      row.getCell('leave').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      row.getCell('holidays').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };
      row.getCell('holidays').font = { bold: true, color: { argb: 'FF7C3AED' } };
      row.getCell('working_days').font = { bold: true };

      // Alternate row colors for first columns
      if (index % 2 === 0) {
        for (let col = 1; col <= 4; col++) {
          const cell = row.getCell(col);
          if (!cell.fill || cell.fill.fgColor?.argb === undefined) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF8FAFC' }
            };
          }
        }
      }
    });

    // Add borders to all cells
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
      });
    });

    // Add legend sheet
    const legendSheet = workbook.addWorksheet('Legend');
    legendSheet.columns = [
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Meaning', key: 'meaning', width: 20 },
      { header: 'Color', key: 'color', width: 15 }
    ];

    const legendData = [
      { code: 'P', meaning: 'Present', color: 'Green' },
      { code: 'A', meaning: 'Absent', color: 'Red' },
      { code: 'H', meaning: 'Half Day', color: 'Amber' },
      { code: 'L', meaning: 'Leave', color: 'Blue' },
      { code: 'HO', meaning: 'Holiday', color: 'Purple' }
    ];

    const legendColors = ['FF10B981', 'FFEF4444', 'FFF59E0B', 'FF3B82F6', 'FF8B5CF6'];

    legendSheet.getRow(1).font = { bold: true };
    legendSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' }
    };
    legendSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    legendData.forEach((item, idx) => {
      const row = legendSheet.addRow(item);
      const colorCell = row.getCell('code');
      colorCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: legendColors[idx] }
      };
      colorCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      colorCell.alignment = { horizontal: 'center' };
    });

    // Add holidays sheet if there are holidays
    if (Object.keys(holidayMap).length > 0) {
      const holidaysSheet = workbook.addWorksheet('Holidays');
      holidaysSheet.columns = [
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Day', key: 'day', width: 12 },
        { header: 'Holiday Name', key: 'name', width: 30 },
        { header: 'Type', key: 'type', width: 15 }
      ];

      holidaysSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      holidaysSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF8B5CF6' }
      };

      Object.entries(holidayMap).forEach(([day, info]) => {
        const date = new Date(targetYear, targetMonth - 1, parseInt(day));
        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
        holidaysSheet.addRow({
          date: `${day} ${monthName} ${targetYear}`,
          day: dayName,
          name: info.name,
          type: info.type
        });
      });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Attendance_${monthName}_${targetYear}.xlsx`);
    res.setHeader('Content-Length', buffer.length);

    res.send(buffer);
  } catch (error) {
    console.error('Download attendance error:', error);
    res.status(500).json({ detail: 'Failed to generate attendance report' });
  }
});

module.exports = router;
