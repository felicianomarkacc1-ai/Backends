import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

console.log('🔍 Database Configuration:');
console.log('   Host:', process.env.DB_HOST || 'localhost');
console.log('   Port:', process.env.DB_PORT || '3306');
console.log('   User:', process.env.DB_USER || 'root');
console.log('   Database:', process.env.DB_NAME || 'activecore');

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'activecore',
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 0
});

export async function initializeDatabase() {
  try {
    console.log('\n🔌 Connecting to database...');
    const connection = await pool.getConnection();
    console.log('✅ Database connected successfully!');
    console.log('📊 Connection ID:', connection.threadId);
    console.log('🗄️  Database:', process.env.DB_NAME || 'activecore');
    console.log('');
    connection.release();
    return true;
  } catch (error: any) {
    console.error('\n❌ ========================================');
    console.error('❌ DATABASE CONNECTION FAILED');
    console.error('❌ ========================================');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
    console.error('');
    console.error('📝 Troubleshooting steps:');
    console.error('1. Check if XAMPP MySQL is running');
    console.error('2. Verify database "activecore" exists');
    console.error('3. Confirm MySQL is on port 3306');
    console.error('4. Check .env file configuration');
    console.error('========================================\n');
    return false;
  }
}

// Test connection on startup
pool.on('connection', (connection) => {
  console.log('🔗 New database connection established (ID:', connection.threadId, ')');
});

pool.on('release', (connection) => {
  console.log('📤 Database connection released (ID:', connection.threadId, ')');
});