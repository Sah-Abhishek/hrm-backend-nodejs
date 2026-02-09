/**
 * Migration script to add is_unlimited field to existing leave policies
 * Run this once to update your database
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URL || 'mongodb://localhost:27017/hrms';

async function migrate() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db();

    // Update all leave policies to add is_unlimited field
    const result = await db.collection('leave_policies').updateMany(
      {},
      {
        $set: {
          'policies.$[].is_unlimited': false
        }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} leave policy documents`);

    // Specifically set is_unlimited=true for Unpaid Leave and Work from Home
    const result2 = await db.collection('leave_policies').updateMany(
      {},
      {
        $set: {
          'policies.$[elem].is_unlimited': true
        }
      },
      {
        arrayFilters: [
          {
            'elem.leave_type': {
              $in: ['Unpaid Leave', 'Work from Home', 'Work From Home']
            }
          }
        ]
      }
    );

    console.log(`✅ Set unlimited=true for ${result2.modifiedCount} policy items (Unpaid Leave, Work from Home)`);

    // Show the updated policies
    const policies = await db.collection('leave_policies').find({}).toArray();
    console.log('\n📋 Updated Leave Policies:');
    policies.forEach(policy => {
      console.log(`\nOrganization: ${policy.organization_id}`);
      policy.policies.forEach(p => {
        console.log(`  - ${p.leave_type}: unlimited=${p.is_unlimited || false}`);
      });
    });

    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

migrate();
