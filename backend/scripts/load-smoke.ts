/**
 * Lightweight staging latency gate. It deliberately exercises only idempotent
 * reads after a single test-only login, so it is safe to run repeatedly.
 *
 * Required: LOAD_TEST_URL, LOAD_TEST_PHONE, LOAD_TEST_OTP
 * Optional: LOAD_REQUESTS (default 40), LOAD_CONCURRENCY (default 8)
 */
const baseUrl = process.env.LOAD_TEST_URL?.replace(/\/$/, '');
const phone = process.env.LOAD_TEST_PHONE;
const otp = process.env.LOAD_TEST_OTP;
const requests = Number(process.env.LOAD_REQUESTS ?? 40);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 8);

if (!baseUrl || !phone || !otp) throw new Error('LOAD_TEST_URL, LOAD_TEST_PHONE and LOAD_TEST_OTP are required');

const now = () => performance.now();
const percentile = (samples: number[], value: number) => samples.sort((a, b) => a - b)[Math.ceil(samples.length * value) - 1]!;

async function timed(url: string, headers: Record<string, string> = {}) {
  const started = now();
  const response = await fetch(`${baseUrl}${url}`, { headers });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  await response.arrayBuffer();
  return now() - started;
}

async function sample(label: string, request: () => Promise<number>) {
  const samples: number[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < requests) {
        cursor += 1;
        samples.push(await request());
      }
    }),
  );
  return { label, count: samples.length, p50Ms: Math.round(percentile(samples, 0.5)), p95Ms: Math.round(percentile(samples, 0.95)), maxMs: Math.round(Math.max(...samples)) };
}

const bootstrap = await fetch(`${baseUrl}/api/v1/app/bootstrap`);
if (!bootstrap.ok) throw new Error(`bootstrap returned ${bootstrap.status}`);
const bootstrapJson = (await bootstrap.json()) as { data: { requiredLegalDocuments: Array<{ documentId: string; version: string; required: boolean }> } };
const device = { deviceId: `load-smoke-${Date.now()}`, timezone: 'Asia/Shanghai', appVersion: 'r1.0-load-smoke' };
const challengeResponse = await fetch(`${baseUrl}/api/v1/auth/sms-challenges`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
  body: JSON.stringify({ phone: { countryCode: '+86', nationalNumber: phone }, purpose: 'LOGIN', device }),
});
if (!challengeResponse.ok) throw new Error(`sms challenge returned ${challengeResponse.status}`);
const challenge = (await challengeResponse.json()) as { data: { challengeId: string } };
const sessionResponse = await fetch(`${baseUrl}/api/v1/auth/sessions`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
  body: JSON.stringify({ challengeId: challenge.data.challengeId, verificationCode: otp, device, consentAcceptances: bootstrapJson.data.requiredLegalDocuments.filter((item) => item.required).map(({ documentId, version }) => ({ documentId, version })) }),
});
if (!sessionResponse.ok) throw new Error(`session returned ${sessionResponse.status}`);
const session = (await sessionResponse.json()) as { data: { accessToken: string } };
const authorization = { authorization: `Bearer ${session.data.accessToken}` };

const report = [
  await sample('bootstrap', () => timed('/api/v1/app/bootstrap')),
  await sample('me', () => timed('/api/v1/me', authorization)),
  await sample('home-overview', () => timed('/api/v1/me/home-overview', authorization)),
];
console.log(JSON.stringify({ baseUrl, requests, concurrency, report }, null, 2));
