const bcrypt = require('bcryptjs');
const [,,plain] = process.argv;
if(!plain){
  console.error('usage: node hash-password.js <password>');
  process.exit(2);
}
const salt = bcrypt.genSaltSync(10);
const hash = bcrypt.hashSync(plain, salt);
console.log(hash);
