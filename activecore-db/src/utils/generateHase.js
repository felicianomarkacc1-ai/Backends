const bcrypt = require('bcryptjs');

async function generateHash() {
  const password = 'member123';
  const hash = await bcrypt.hash(password, 12);
  console.log('Hash for "member123":', hash);
}

generateHash();