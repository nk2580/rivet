import assert from 'node:assert/strict';

const base = process.env.RIVET_TEST_API || 'http://127.0.0.1:8080';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local verification cannot target a remote API.');
const response = await fetch(`${base}/api/config`);
const config = await response.json();
assert.equal(config.mode, 'emulator', 'Refusing to create test identities outside emulator mode.');
assert.equal(config.firebase.projectId, 'demo-rivet');
assert(['127.0.0.1', 'localhost'].includes(new URL(config.authEmulatorUrl).hostname));
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function token(email, verified) {
  const payload = {sub: `api-test-${email}-${verified}`, email, email_verified: verified, name: email==='owner@example.test'?'Local test owner':'Synthetic API test', aud: 'demo-rivet', iss: 'https://accounts.google.com', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600};
  const idToken = `${encode({alg:'none',typ:'JWT'})}.${encode(payload)}.`;
  const result = await fetch(`${config.authEmulatorUrl}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-rivet-public-key`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestUri:base,returnSecureToken:true,postBody:new URLSearchParams({id_token:idToken,providerId:'google.com'}).toString()})});
  assert.equal(result.status, 200, 'Could not create the explicitly local test identity.');
  return (await result.json()).idToken;
}
for (const test of [{name:'different Google identity',email:'rivet-test@example.com',verified:true,status:403},{name:'unverified owner',email:'owner@example.test',verified:false,status:403},{name:'verified Google owner',email:'owner@example.test',verified:true,status:200}]) {
  const credential = await token(test.email,test.verified);
  const result = await fetch(`${base}/api/v1/account`,{headers:{Authorization:`Bearer ${credential}`}});
  assert.equal(result.status,test.status,test.name);
  console.log(`${test.name}: ${result.status}`);
}
assert.equal((await fetch(`${base}/api/v1/account`)).status,401);
console.log('Missing credentials: 401. No identity tokens were written or logged.');
