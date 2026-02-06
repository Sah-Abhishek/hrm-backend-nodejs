#!/usr/bin/env node

/**
 * JWT Generator Script
 * Generates a JWT token for testing/admin purposes
 * 
 * Usage: node scripts/generateJwt.js
 */

const readline = require('readline');
const path = require('path');

// Load config from parent directory
const { config } = require('../config/config');
const { createAccessToken } = require('../middleware/auth');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n========================================');
  console.log('       JWT Token Generator');
  console.log('========================================\n');

  try {
    // Get email from user
    const email = await prompt('Enter email address: ');

    if (!email) {
      console.error('\n❌ Error: Email is required');
      process.exit(1);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('\n❌ Error: Invalid email format');
      process.exit(1);
    }

    // Ask for custom expiration (optional)
    const customExpiry = await prompt('Enter expiration (e.g., "7d", "24h", "30d") [default: from config]: ');

    let token;

    if (customExpiry) {
      // Generate with custom expiry using jwt directly
      const jwt = require('jsonwebtoken');
      const payload = {
        sub: email,
        iat: Math.floor(Date.now() / 1000)
      };
      token = jwt.sign(payload, config.jwtSecret, { expiresIn: customExpiry });
    } else {
      // Use the existing createAccessToken function
      token = createAccessToken(email);
    }

    console.log('\n========================================');
    console.log('✅ JWT Generated Successfully!');
    console.log('========================================\n');

    console.log('Email:', email);
    console.log('Expiration:', customExpiry || config.jwtExpiresIn || 'default');
    console.log('\n📋 Your JWT Token:\n');
    console.log(token);

    console.log('\n----------------------------------------');
    console.log('📌 Use in Postman:');
    console.log('----------------------------------------');
    console.log('Header Name:  Authorization');
    console.log('Header Value: Bearer ' + token.substring(0, 20) + '...');
    console.log('\n----------------------------------------');
    console.log('📌 Full Authorization Header:');
    console.log('----------------------------------------');
    console.log(`Bearer ${token}`);
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Error generating JWT:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
