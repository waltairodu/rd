// Test double for wix-fetch. Tests set global.__FETCH = async (url, opts) => ({status, ok, json})
exports.fetch = async (url, opts) => { if (!global.__FETCH) throw new Error('no network'); global.__FETCH_CALLS = (global.__FETCH_CALLS || []).concat([{ url, opts }]); return global.__FETCH(url, opts); };
