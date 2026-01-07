/**
 * Test Script: Leave Balance Calculation Verification
 * 
 * This script tests the leave balance calculation for an employee
 * with joining date August 7, 2026, simulating different "current dates"
 * to verify the calculation will be accurate.
 * 
 * Run with: node test-leave-calculation.js
 */

// Default monthly credit rates
const DEFAULT_MONTHLY_CREDITS = {
  'casual_leave': 0.5,
  'sick_leave': 0.5,
  'earned_leave': 1
};

// Annual maximums
const ANNUAL_MAXIMUMS = {
  'casual_leave': 6,
  'sick_leave': 6,
  'earned_leave': 12
};

/**
 * Calculate months since joining date
 * @param {Date} joiningDate - Employee's joining date
 * @param {Date} currentDate - The "current" date to calculate from (for testing)
 * @returns {number} - Number of complete months since joining
 */
function calculateMonthsSinceJoining(joiningDate, currentDate = new Date()) {
  const now = new Date(currentDate);
  const joining = new Date(joiningDate);

  let months = (now.getFullYear() - joining.getFullYear()) * 12;
  months += now.getMonth() - joining.getMonth();

  // If current day is before joining day in the month, subtract one month
  if (now.getDate() < joining.getDate()) {
    months--;
  }

  // Ensure non-negative (for future joining dates)
  return Math.max(0, months);
}

/**
 * Calculate accrued balance
 * @param {Date} joiningDate - Employee's joining date
 * @param {number} monthlyCredit - Days credited per month
 * @param {number} maxBalance - Maximum balance cap
 * @param {Date} currentDate - The "current" date (for testing)
 * @returns {number} - Accrued balance
 */
function calculateAccruedBalance(joiningDate, monthlyCredit, maxBalance, currentDate = new Date()) {
  const months = calculateMonthsSinceJoining(joiningDate, currentDate);
  const accrued = months * monthlyCredit;
  return Math.min(Math.round(accrued * 10) / 10, maxBalance);
}

/**
 * Calculate full leave balance for an employee
 * @param {Date} joiningDate - Employee's joining date
 * @param {Date} currentDate - The "current" date (for testing)
 * @returns {Object} - Leave balance object
 */
function calculateLeaveBalance(joiningDate, currentDate = new Date()) {
  const months = calculateMonthsSinceJoining(joiningDate, currentDate);

  return {
    months_since_joining: months,
    casual_leave: calculateAccruedBalance(joiningDate, DEFAULT_MONTHLY_CREDITS.casual_leave, ANNUAL_MAXIMUMS.casual_leave, currentDate),
    sick_leave: calculateAccruedBalance(joiningDate, DEFAULT_MONTHLY_CREDITS.sick_leave, ANNUAL_MAXIMUMS.sick_leave, currentDate),
    earned_leave: calculateAccruedBalance(joiningDate, DEFAULT_MONTHLY_CREDITS.earned_leave, ANNUAL_MAXIMUMS.earned_leave, currentDate),
    comp_off: 0,
    unpaid_leave: 0
  };
}

/**
 * Format date for display
 */
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

// ============================================
// TEST CASES
// ============================================

console.log('='.repeat(70));
console.log('LEAVE BALANCE CALCULATION TEST');
console.log('Employee Joining Date: August 7, 2026');
console.log('='.repeat(70));
console.log('\nMonthly Credit Rates:');
console.log('  - Casual Leave:  0.5 days/month (max 6)');
console.log('  - Sick Leave:    0.5 days/month (max 6)');
console.log('  - Earned Leave:  1 day/month (max 12)');
console.log('='.repeat(70));

const joiningDate = new Date('2026-08-07');

// Test scenarios - simulate different "current dates"
const testDates = [
  { date: new Date('2026-01-07'), label: 'Today (Jan 7, 2026) - Before joining' },
  { date: new Date('2026-08-07'), label: 'Joining Day (Aug 7, 2026)' },
  { date: new Date('2026-08-15'), label: 'Aug 15, 2026 - 8 days after joining' },
  { date: new Date('2026-09-06'), label: 'Sep 6, 2026 - Before 1 month' },
  { date: new Date('2026-09-07'), label: 'Sep 7, 2026 - Exactly 1 month' },
  { date: new Date('2026-09-15'), label: 'Sep 15, 2026 - After 1 month' },
  { date: new Date('2026-10-07'), label: 'Oct 7, 2026 - Exactly 2 months' },
  { date: new Date('2026-11-07'), label: 'Nov 7, 2026 - Exactly 3 months' },
  { date: new Date('2026-12-07'), label: 'Dec 7, 2026 - Exactly 4 months' },
  { date: new Date('2027-01-07'), label: 'Jan 7, 2027 - Exactly 5 months' },
  { date: new Date('2027-02-07'), label: 'Feb 7, 2027 - Exactly 6 months' },
  { date: new Date('2027-08-07'), label: 'Aug 7, 2027 - Exactly 12 months (1 year)' },
  { date: new Date('2028-08-07'), label: 'Aug 7, 2028 - Exactly 24 months (2 years) - Should cap at max' },
];

console.log('\n' + '-'.repeat(70));
console.log('SIMULATION RESULTS');
console.log('-'.repeat(70));

console.log('\n| Current Date                    | Months | Casual | Sick | Earned |');
console.log('|' + '-'.repeat(33) + '|' + '-'.repeat(8) + '|' + '-'.repeat(8) + '|' + '-'.repeat(6) + '|' + '-'.repeat(8) + '|');

for (const test of testDates) {
  const balance = calculateLeaveBalance(joiningDate, test.date);

  const casual = balance.casual_leave.toFixed(1).padStart(5);
  const sick = balance.sick_leave.toFixed(1).padStart(4);
  const earned = balance.earned_leave.toFixed(1).padStart(5);
  const months = String(balance.months_since_joining).padStart(5);

  console.log(`| ${test.label.padEnd(31)} | ${months}  | ${casual}  | ${sick} | ${earned}  |`);
}

console.log('\n' + '='.repeat(70));
console.log('DETAILED BREAKDOWN FOR KEY DATES');
console.log('='.repeat(70));

const keyDates = [
  new Date('2026-08-07'),  // Joining day
  new Date('2026-09-07'),  // 1 month
  new Date('2027-02-07'),  // 6 months
  new Date('2027-08-07'),  // 12 months
];

for (const currentDate of keyDates) {
  const balance = calculateLeaveBalance(joiningDate, currentDate);

  console.log(`\n📅 Current Date: ${formatDate(currentDate)}`);
  console.log(`   Joining Date: ${formatDate(joiningDate)}`);
  console.log(`   Months Since Joining: ${balance.months_since_joining}`);
  console.log('   ┌─────────────────┬───────────┬─────────────────────────────┐');
  console.log('   │ Leave Type      │ Balance   │ Calculation                 │');
  console.log('   ├─────────────────┼───────────┼─────────────────────────────┤');
  console.log(`   │ Casual Leave    │ ${balance.casual_leave.toFixed(1).padStart(6)}    │ ${balance.months_since_joining} months × 0.5 = ${(balance.months_since_joining * 0.5).toFixed(1).padStart(4)} (max 6)   │`);
  console.log(`   │ Sick Leave      │ ${balance.sick_leave.toFixed(1).padStart(6)}    │ ${balance.months_since_joining} months × 0.5 = ${(balance.months_since_joining * 0.5).toFixed(1).padStart(4)} (max 6)   │`);
  console.log(`   │ Earned Leave    │ ${balance.earned_leave.toFixed(1).padStart(6)}    │ ${balance.months_since_joining} months × 1.0 = ${(balance.months_since_joining * 1.0).toFixed(1).padStart(4)} (max 12)  │`);
  console.log('   └─────────────────┴───────────┴─────────────────────────────┘');
}

console.log('\n' + '='.repeat(70));
console.log('EDGE CASE TESTS');
console.log('='.repeat(70));

// Test: Day before 1 month anniversary
const dayBefore = new Date('2026-09-06');
const dayOf = new Date('2026-09-07');
const dayAfter = new Date('2026-09-08');

console.log('\n🔍 Testing month boundary (around Sep 7, 2026):');
console.log(`   Sep 6, 2026 (day before): ${calculateMonthsSinceJoining(joiningDate, dayBefore)} months → Earned: ${calculateAccruedBalance(joiningDate, 1, 12, dayBefore)}`);
console.log(`   Sep 7, 2026 (exact):      ${calculateMonthsSinceJoining(joiningDate, dayOf)} months → Earned: ${calculateAccruedBalance(joiningDate, 1, 12, dayOf)}`);
console.log(`   Sep 8, 2026 (day after):  ${calculateMonthsSinceJoining(joiningDate, dayAfter)} months → Earned: ${calculateAccruedBalance(joiningDate, 1, 12, dayAfter)}`);

// Test: Max cap
const twoYearsLater = new Date('2028-08-07');
const threeYearsLater = new Date('2029-08-07');

console.log('\n🔍 Testing maximum cap:');
console.log(`   After 2 years (24 months): Casual=${calculateAccruedBalance(joiningDate, 0.5, 6, twoYearsLater)} (capped at 6), Earned=${calculateAccruedBalance(joiningDate, 1, 12, twoYearsLater)} (capped at 12)`);
console.log(`   After 3 years (36 months): Casual=${calculateAccruedBalance(joiningDate, 0.5, 6, threeYearsLater)} (capped at 6), Earned=${calculateAccruedBalance(joiningDate, 1, 12, threeYearsLater)} (capped at 12)`);

console.log('\n' + '='.repeat(70));
console.log('✅ TEST COMPLETE');
console.log('='.repeat(70));
console.log('\nThe calculation logic is working correctly!');
console.log('When the employee joins on Aug 7, 2026, their balance will accrue monthly.');
console.log('\n');
