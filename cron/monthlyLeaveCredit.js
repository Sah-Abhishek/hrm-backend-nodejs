/**
 * Monthly Leave Credit Cron Job
 * 
 * This script should be run on the 1st of every month to credit leaves.
 * 
 * Leave Policy:
 * - Casual Leave: 6 days credited annually (on January 1st) - NO CARRY FORWARD
 * - Sick Leave: 0.5 days credited monthly - RESETS TO 0 on January 1st
 * - Earned Leave: 1 day credited monthly - RESETS TO 0 on January 1st
 * 
 * On January 1st:
 *   - Casual Leave: Reset to 6
 *   - Sick Leave: Reset to 0, then +0.5 = 0.5
 *   - Earned Leave: Reset to 0 (first credit on Feb 1st)
 * 
 * Setup with cron:
 *   0 0 1 * * node /path/to/cron/monthlyLeaveCredit.js
 * 
 * Or with node-cron in your app:
 *   cron.schedule('0 0 1 * *', () => { ... });
 */

const { MongoClient } = require('mongodb');

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'hrms';

// Leave credit rules
const LEAVE_CREDIT_RULES = {
  casual_leave: {
    credit_type: 'annually',      // Credited once a year in January
    annual_credit: 6,             // 6 days per year
    credit_month: 1,              // January (1-12)
    max_balance: 6,               // Maximum balance cap
    carry_forward: false,         // No carry forward - resets each year
    reset_on_year_start: true     // Reset to 0 on January 1st before crediting
  },
  sick_leave: {
    credit_type: 'monthly',       // Credited every month
    monthly_credit: 0.5,          // 0.5 days per month
    max_balance: 6,               // Maximum balance cap
    carry_forward: false,         // No carry forward
    reset_on_year_start: true     // Reset to 0 on January 1st
  },
  earned_leave: {
    credit_type: 'monthly',       // Credited every month
    monthly_credit: 1,            // 1 day per month
    max_balance: 12,              // Maximum balance cap per year
    carry_forward: false,         // No carry forward (change to true if needed)
    reset_on_year_start: true     // Reset to 0 on January 1st
  }
};

/**
 * Credit leaves to all active employees
 * @param {Db} db - MongoDB database instance
 * @param {Date} creditDate - The date for which to credit (defaults to today)
 */
async function creditMonthlyLeaves(db, creditDate = new Date()) {
  const currentMonth = creditDate.getMonth() + 1; // 1-12
  const currentYear = creditDate.getFullYear();
  const isJanuary = currentMonth === 1;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`MONTHLY LEAVE CREDIT - ${creditDate.toDateString()}`);
  if (isJanuary) {
    console.log('🔄 JANUARY - YEAR START RESET + CREDIT');
  }
  console.log(`${'='.repeat(60)}`);

  // Get all active employees
  const employees = await db.collection('employees').find({
    status: { $ne: 'inactive' }  // Exclude inactive employees
  }).toArray();

  console.log(`\nProcessing ${employees.length} employees...`);

  const results = {
    processed: 0,
    credited: [],
    errors: []
  };

  for (const employee of employees) {
    try {
      // Skip if employee hasn't joined yet
      const joiningDate = employee.joining_date ? new Date(employee.joining_date) : null;
      if (joiningDate && joiningDate > creditDate) {
        console.log(`  ⏭️  ${employee.full_name} - Not yet joined (joins ${joiningDate.toDateString()})`);
        continue;
      }

      const currentBalance = employee.leave_balance || {};
      const newBalance = { ...currentBalance };
      const credits = [];

      // ============================================
      // JANUARY - YEAR START RESET
      // ============================================
      if (isJanuary) {
        // Reset Casual Leave to 6
        newBalance.casual_leave = LEAVE_CREDIT_RULES.casual_leave.annual_credit;
        credits.push(`casual_leave: RESET to ${newBalance.casual_leave}`);

        // Reset Sick Leave to 0, then add first month credit
        newBalance.sick_leave = LEAVE_CREDIT_RULES.sick_leave.monthly_credit;
        credits.push(`sick_leave: RESET to 0, +${LEAVE_CREDIT_RULES.sick_leave.monthly_credit} = ${newBalance.sick_leave}`);

        // Reset Earned Leave to 0 (first credit will be on Feb 1st)
        newBalance.earned_leave = 0;
        credits.push(`earned_leave: RESET to 0`);
      }
      // ============================================
      // OTHER MONTHS - MONTHLY CREDITS
      // ============================================
      else {
        // Sick Leave: add 0.5
        const currentSick = newBalance.sick_leave || 0;
        newBalance.sick_leave = Math.min(
          currentSick + LEAVE_CREDIT_RULES.sick_leave.monthly_credit,
          LEAVE_CREDIT_RULES.sick_leave.max_balance
        );
        newBalance.sick_leave = Math.round(newBalance.sick_leave * 10) / 10;
        credits.push(`sick_leave: ${currentSick} + ${LEAVE_CREDIT_RULES.sick_leave.monthly_credit} = ${newBalance.sick_leave}`);

        // Earned Leave: add 1
        const currentEarned = newBalance.earned_leave || 0;
        newBalance.earned_leave = Math.min(
          currentEarned + LEAVE_CREDIT_RULES.earned_leave.monthly_credit,
          LEAVE_CREDIT_RULES.earned_leave.max_balance
        );
        newBalance.earned_leave = Math.round(newBalance.earned_leave * 10) / 10;
        credits.push(`earned_leave: ${currentEarned} + ${LEAVE_CREDIT_RULES.earned_leave.monthly_credit} = ${newBalance.earned_leave}`);

        // Casual Leave: no change in non-January months
        if (newBalance.casual_leave === undefined) {
          newBalance.casual_leave = 0;
        }
      }

      // Ensure all leave types exist
      newBalance.casual_leave = newBalance.casual_leave ?? 0;
      newBalance.sick_leave = newBalance.sick_leave ?? 0;
      newBalance.earned_leave = newBalance.earned_leave ?? 0;
      newBalance.comp_off = newBalance.comp_off ?? 0;
      newBalance.unpaid_leave = newBalance.unpaid_leave ?? 0;

      // Update employee balance
      await db.collection('employees').updateOne(
        { id: employee.id },
        {
          $set: {
            leave_balance: newBalance,
            last_leave_credit_date: creditDate
          }
        }
      );

      // Log the credit transaction
      await db.collection('leave_credit_logs').insertOne({
        employee_id: employee.employee_id,
        employee_email: employee.email,
        credit_date: creditDate,
        credit_month: currentMonth,
        credit_year: currentYear,
        is_year_start_reset: isJanuary,
        previous_balance: currentBalance,
        credits_applied: credits,
        new_balance: newBalance,
        created_at: new Date()
      });

      results.processed++;
      results.credited.push({
        employee_id: employee.employee_id,
        name: employee.full_name,
        credits,
        new_balance: newBalance
      });

      console.log(`  ✅ ${employee.full_name}: ${credits.join(', ')}`);

    } catch (error) {
      console.error(`  ❌ ${employee.full_name}: ${error.message}`);
      results.errors.push({
        employee_id: employee.employee_id,
        error: error.message
      });
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Month: ${currentMonth}/${currentYear}`);
  console.log(`  Processed: ${results.processed}`);
  console.log(`  Errors: ${results.errors.length}`);
  if (isJanuary) {
    console.log(`  Year Start Reset: Applied`);
  }

  return results;
}

/**
 * Initialize leave balance for new employee
 * Called when employee is created
 * 
 * New employees get:
 * - Casual Leave: 6 (full annual quota)
 * - Sick Leave: 0.5 (first month credit, if joined before 15th)
 * - Earned Leave: 0 (credited from next month)
 * 
 * @param {Date} joiningDate - Employee's joining date
 */
function initializeLeaveBalance(joiningDate = new Date()) {
  const joinDay = new Date(joiningDate).getDate();

  return {
    casual_leave: 6,                    // Full annual quota
    sick_leave: joinDay <= 15 ? 0.5 : 0, // 0.5 if joined before 15th
    earned_leave: 0,                    // Credited from next month
    comp_off: 0,
    unpaid_leave: 0
  };
}

/**
 * Main execution for cron job
 */
async function main() {
  let client;

  try {
    console.log('Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();

    const db = client.db(DB_NAME);
    console.log(`Connected to database: ${DB_NAME}`);

    // Run monthly credit
    const results = await creditMonthlyLeaves(db);

    console.log('\nCron job completed successfully!');
    return results;

  } catch (error) {
    console.error('Cron job failed:', error);
    throw error;
  } finally {
    if (client) {
      await client.close();
      console.log('Database connection closed.');
    }
  }
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

// Export for use in Express routes
module.exports = {
  creditMonthlyLeaves,
  initializeLeaveBalance,
  LEAVE_CREDIT_RULES
};
