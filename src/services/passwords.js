const crypto = require('node:crypto');

/**
 * Standard Node.js scrypt password hashing
 */
function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Valid password string required');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return {
    hash: derivedKey.toString('hex'),
    salt
  };
}

function verifyPassword(password, storedHash, storedSalt) {
  if (!password || !storedHash || !storedSalt) {
    return false;
  }
  try {
    const key = crypto.scryptSync(password, storedSalt, 64);
    const hashBuf = Buffer.from(storedHash, 'hex');
    if (key.length !== hashBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(key, hashBuf);
  } catch (err) {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword
};
