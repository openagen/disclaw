#!/usr/bin/env node

/**
 * Seller Review Daemon
 * Monitors and auto-approves pending sellers
 */

const { Client } = require('pg');
const { loadEnv } = require('./load-env');
const fs = require('fs');
const path = require('path');

loadEnv();

const PID_FILE = path.join(__dirname, '.seller-review-daemon.pid');
const LOG_FILE = path.join(__dirname, 'seller-review-daemon.log');

function log(message) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${message}\n`;
  console.log(logMsg.trim());
  fs.appendFileSync(LOG_FILE, logMsg);
}

function writePid() {
  fs.writeFileSync(PID_FILE, process.pid.toString());
}

function removePid() {
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

function isRunning() {
  if (!fs.existsSync(PID_FILE)) {
    return false;
  }
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
    process.kill(pid, 0); // Check if process exists
    return true;
  } catch (e) {
    // Process not running, remove stale PID file
    removePid();
    return false;
  }
}

async function checkAndApproveSellers(client) {
  const result = await client.query(`
    SELECT s.agent_id, s.review_status, a.status as agent_status, a.name
    FROM sellers s
    JOIN agents a ON s.agent_id = a.id
    WHERE s.review_status = 'pending'
  `);

  if (result.rows.length === 0) {
    return;
  }

  log(`Found ${result.rows.length} pending seller(s)`);

  let approved = 0;
  for (const row of result.rows) {
    await client.query('BEGIN');
    try {
      await client.query(
        'UPDATE sellers SET review_status = $1 WHERE agent_id = $2',
        ['approved', row.agent_id]
      );
      await client.query(
        "UPDATE agents SET status = 'seller_approved' WHERE id = $1",
        [row.agent_id]
      );
      await client.query('COMMIT');
      approved++;
      log(`✅ Approved: ${row.name} (${row.agent_id})`);
    } catch (err) {
      await client.query('ROLLBACK');
      log(`❌ Failed to approve ${row.agent_id}: ${err.message}`);
    }
  }

  log(`Approved ${approved} of ${result.rows.length} seller(s)`);
}

async function run() {
  // Check if already running
  if (isRunning()) {
    console.log('Daemon is already running');
    process.exit(0);
  }

  writePid();
  log('Seller Review Daemon started');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Graceful shutdown
  const shutdown = () => {
    log('Seller Review Daemon stopping...');
    client.end().then(() => {
      removePid();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Main loop - check every 30 seconds
  const INTERVAL = 30000;

  const loop = async () => {
    try {
      await checkAndApproveSellers(client);
    } catch (err) {
      log(`Error: ${err.message}`);
    }
  };

  // Initial check
  await loop();

  // Periodic checks
  const intervalId = setInterval(loop, INTERVAL);

  log(`Monitoring for pending sellers (interval: ${INTERVAL / 1000}s)`);
}

// CLI commands
const command = process.argv[2] || 'start';

switch (command) {
  case 'start':
    run().catch((err) => {
      console.error(err.message || err);
      removePid();
      process.exit(1);
    });
    break;

  case 'stop':
    if (isRunning()) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
      process.kill(pid, 'SIGTERM');
      console.log('Daemon stopped');
    } else {
      console.log('Daemon is not running');
    }
    break;

  case 'status':
    if (isRunning()) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
      console.log(`Daemon is running (PID: ${pid})`);
    } else {
      console.log('Daemon is not running');
    }
    break;

  case 'restart':
    if (isRunning()) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
      process.kill(pid, 'SIGTERM');
      // Wait for cleanup
      setTimeout(() => {
        run().catch((err) => {
          console.error(err.message || err);
          removePid();
          process.exit(1);
        });
      }, 500);
    } else {
      run().catch((err) => {
        console.error(err.message || err);
        removePid();
        process.exit(1);
      });
    }
    break;

  case 'once':
    log('Running single approval check...');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await checkAndApproveSellers(client);
    } finally {
      await client.end();
    }
    break;

  default:
    console.log('Usage: node scripts/seller-review-daemon.js [start|stop|status|restart|once]');
    process.exit(1);
}
