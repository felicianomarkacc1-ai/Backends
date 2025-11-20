import bcrypt from 'bcryptjs';

async function generateHash() {
  const passwords = [
    { label: 'Admin', email: 'admin@activecore.com', password: 'Admin@2024!Secure' },
    { label: 'Member', email: 'member@activecore.com', password: 'Member@2024!Secure' }
  ];

  console.log('Generating secure password hashes...\n');
  console.log('='.repeat(60));
  
  for (const user of passwords) {
    const hash = await bcrypt.hash(user.password, 12);
    console.log(`\n${user.label} Account:`);
    console.log(`Email: ${user.email}`);
    console.log(`Password: ${user.password}`);
    console.log(`Hash: ${hash}`);
    console.log('\nSQL UPDATE command:');
    console.log(`UPDATE users SET password = '${hash}' WHERE email = '${user.email}';`);
    console.log('\n' + '-'.repeat(60));
  }
  
  // Test the hashes
  console.log('\n=== TESTING HASHES ===\n');
  for (const user of passwords) {
    const hash = await bcrypt.hash(user.password, 12);
    const isValid = await bcrypt.compare(user.password, hash);
    console.log(`${user.label}: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n📋 INSTRUCTIONS:');
  console.log('1. Copy the SQL UPDATE commands above');
  console.log('2. Run them in phpMyAdmin SQL tab');
  console.log('3. Restart the backend server');
  console.log('4. Login with the new passwords shown above\n');
}

generateHash();