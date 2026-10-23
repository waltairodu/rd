// Test double for wix-secrets-backend. Tests set global.__SECRETS = { ANTHROPIC_API_KEY: '...' }
exports.getSecret = async (n) => { const s = global.__SECRETS || {}; if (!(n in s)) throw new Error('secret not found'); return s[n]; };
