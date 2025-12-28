const fs = require('fs');
const path = require('path');
require('dotenv').config();

const BASE_URL = process.env.BACKEND_URL || `http://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 8000}`;
const REPORT_FILE = 'api_test_report.md';

console.log(`Targeting Backend URL: ${BASE_URL}`);

const results = [];

async function runTest(name, method, endpoint, body = null, token = null) {
    const start = Date.now();
    try {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const options = {
            method,
            headers,
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${BASE_URL}${endpoint}`, options);
        const duration = Date.now() - start;

        let data;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        const result = {
            name,
            method,
            endpoint,
            status: response.status,
            duration,
            success: response.ok,
            data
        };

        results.push(result);
        console.log(`[${response.ok ? 'PASS' : 'FAIL'}] ${name} (${response.status}) - ${duration}ms`);
        return result;

    } catch (error) {
        const duration = Date.now() - start;
        const result = {
            name,
            method,
            endpoint,
            status: 'ERROR',
            duration,
            success: false,
            error: error.message
        };
        results.push(result);
        console.log(`[ERROR] ${name} - ${error.message}`);
        return result;
    }
}

async function generateReport() {
    let md = `# Backend API Test Report\n\n`;
    md += `**Date:** ${new Date().toISOString()}\n`;
    md += `**Base URL:** ${BASE_URL}\n\n`;

    const passed = results.filter(r => r.success).length;
    const total = results.length;

    md += `## Summary\n`;
    md += `- **Total Tests:** ${total}\n`;
    md += `- **Passed:** ${passed}\n`;
    md += `- **Failed:** ${total - passed}\n\n`;

    md += `## Detailed Results\n\n`;
    md += `| Test Name | Method | Endpoint | Status | Time | Result |\n`;
    md += `|-----------|--------|----------|--------|------|--------|\n`;

    for (const r of results) {
        const icon = r.success ? '✅' : '❌';
        md += `| ${r.name} | ${r.method} | ${r.endpoint} | ${r.status} | ${r.duration}ms | ${icon} |\n`;
    }

    md += `\n## Response Details\n\n`;
    for (const r of results) {
        if (!r.success) {
            md += `### ❌ ${r.name}\n`;
            md += `**Endpoint:** \`${r.method} ${r.endpoint}\`\n`;
            md += `**Status:** ${r.status}\n`;
            md += `**Error/Response:**\n\`\`\`json\n${JSON.stringify(r.data || r.error, null, 2)}\n\`\`\`\n\n`;
        }
    }

    fs.writeFileSync(REPORT_FILE, md);
    console.log(`Report generated: ${REPORT_FILE}`);
}

async function main() {
    console.log('Starting API Tests...');

    // 1. Health Check
    await runTest('Health Check', 'GET', '/health');

    // 2. Register Test User
    const testUser = {
        email: `test_${Date.now()}@example.com`,
        password: 'Password123!',
        full_name: 'Test User',
        role: 'employee',
        department: 'Engineering',
        designation: 'Tester'
    };

    const registerRes = await runTest('Register User', 'POST', '/api/auth/register', testUser);

    let token = null;
    if (registerRes.success && registerRes.data.access_token) {
        token = registerRes.data.access_token;
    }

    // 3. Login (if register failed, try login with a known user or skip)
    if (!token) {
        const loginRes = await runTest('Login User', 'POST', '/api/auth/login', {
            email: testUser.email,
            password: testUser.password
        });
        if (loginRes.success) token = loginRes.data.access_token;
    }

    if (token) {
        // 4. Get Me
        await runTest('Get Profile', 'GET', '/api/auth/me', null, token);

        // 5. List Employees
        await runTest('List Employees', 'GET', '/api/employees', null, token);

        // 6. List Leaves
        await runTest('List Leaves', 'GET', '/api/leaves', null, token);

        // 7. Dashboard Stats
        await runTest('Dashboard Stats', 'GET', '/api/dashboard/stats', null, token);

        // 8. Notifications
        await runTest('Notifications', 'GET', '/api/notifications', null, token);

    } else {
        console.log('Skipping authenticated tests due to login failure');
    }

    await generateReport();
}

main().catch(console.error);
