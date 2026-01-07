/**
 * Cron Job Scheduler Setup
 * 
 * Add this to your main server file (e.g., index.js or app.js):
 *   require('./cron/scheduler');
 * 
 * Or import and call setupCronJobs(db) after database connection
 */

const cron = require('node-cron');
const { creditMonthlyLeaves, LEAVE_CREDIT_RULES } = require('./monthlyLeaveCredit');

let dbInstance = null;

/**
 * Setup all cron jobs
 * @param {Db} db - MongoDB database instance
 */
function setupCronJobs(db) {
  dbInstance = db;

  console.log('\n📅 Setting up cron jobs...');

  // ============================================
  // Monthly Leave Credit - 1st of every month at 00:01 AM
  // 
  // On January 1st:
  //   - Casual Leave: Reset to 6
  //   - Sick Leave: Reset to 0, then +0.5 = 0.5
  //   - Earned Leave: Reset to 0
  // 
  // On other months:
  //   - Sick Leave: +0.5
  //   - Earned Leave: +1
  // ============================================
  cron.schedule('1 0 1 * *', async () => {
    console.log('\n🔄 Running monthly leave credit cron job...');
    try {
      await creditMonthlyLeaves(dbInstance);
      console.log('✅ Monthly leave credit completed');
    } catch (error) {
      console.error('❌ Monthly leave credit failed:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"  // Adjust to your timezone
  });

  console.log('  ✅ Monthly leave credit: 1st of every month at 00:01 AM');
  console.log('     - January: Reset all leaves + credit CL=6, SL=0.5, EL=0');
  console.log('     - Other months: Credit SL+0.5, EL+1');

  console.log('📅 Cron jobs setup complete!\n');
}

/**
 * Manually trigger monthly credit (for testing)
 * @param {Db} db - MongoDB database instance
 * @param {Date} forDate - Optional date to simulate credit for
 */
async function triggerMonthlyCredit(db, forDate = new Date()) {
  return await creditMonthlyLeaves(db || dbInstance, forDate);
}

module.exports = {
  setupCronJobs,
  triggerMonthlyCredit,
  LEAVE_CREDIT_RULES
};
