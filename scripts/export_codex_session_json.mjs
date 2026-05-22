#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const DEFAULT_OUTPUT = 'out/codex-session.json';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function usage() {
  return [
    'Usage:',
    '  node scripts/export_codex_session_json.mjs [--out out/codex-session.json] [--prompt=login] [--no-open]',
    '',
    'Defaults:',
    '  --out      out/codex-session.json',
    '  --prompt   omitted, so the browser can reuse an existing OpenAI/Auth login session',
    '  --open     enabled, opens the OAuth URL in your default browser',
    '',
    'Notes:',
    '  The script listens on http://localhost:1455/auth/callback and writes the token JSON locally.',
    '  Tokens are never printed to the terminal; only a field/length summary is shown.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUTPUT,
    open: true,
    prompt: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--no-open') {
      args.open = false;
    } else if (arg === '--out') {
      index += 1;
      args.out = argv[index] || args.out;
    } else if (arg.startsWith('--out=')) {
      args.out = arg.slice('--out='.length) || args.out;
    } else if (arg === '--prompt') {
      index += 1;
      args.prompt = argv[index] || '';
    } else if (arg.startsWith('--prompt=')) {
      args.prompt = arg.slice('--prompt='.length);
    } else if (arg === '--timeout-ms') {
      index += 1;
      args.timeoutMs = Math.max(1000, Number(argv[index]) || DEFAULT_TIMEOUT_MS);
    } else if (arg.startsWith('--timeout-ms=')) {
      args.timeoutMs = Math.max(1000, Number(arg.slice('--timeout-ms='.length)) || DEFAULT_TIMEOUT_MS);
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  args.out = resolve(process.cwd(), args.out);
  return args;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomBase64Url(byteLength) {
  return base64Url(randomBytes(byteLength));
}

function sha256Base64Url(value) {
  return base64Url(createHash('sha256').update(String(value)).digest());
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) {
    return {};
  }
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) || {};
  } catch {
    return {};
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function isoFromUnixSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '';
  }
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function buildAuthUrl({ state, codeChallenge, prompt }) {
  const params = new URLSearchParams();
  params.set('client_id', CLIENT_ID);
  params.set('response_type', 'code');
  params.set('redirect_uri', REDIRECT_URI);
  params.set('scope', 'openid email profile offline_access');
  params.set('state', state);
  params.set('code_challenge', codeChallenge);
  params.set('code_challenge_method', 'S256');
  if (prompt) {
    params.set('prompt', prompt);
  }
  params.set('id_token_add_organizations', 'true');
  params.set('codex_cli_simplified_flow', 'true');
  return `${AUTH_URL}?${params.toString()}`;
}

function openUrl(url) {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function waitForCallback({ expectedState, timeoutMs }) {
  return new Promise((resolveCallback, rejectCallback) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url || '/', REDIRECT_URI);
      if (requestUrl.pathname !== '/auth/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const error = requestUrl.searchParams.get('error') || '';
      const errorDescription = requestUrl.searchParams.get('error_description') || '';
      const code = requestUrl.searchParams.get('code') || '';
      const state = requestUrl.searchParams.get('state') || '';

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>OAuth failed</h1><p>${escapeHtml(errorDescription || error)}</p>`);
        finish(new Error(`OAuth failed: ${errorDescription || error}`));
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>OAuth failed</h1><p>Missing code.</p>');
        finish(new Error('OAuth callback missing code.'));
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>OAuth failed</h1><p>State mismatch.</p>');
        finish(new Error('OAuth state mismatch.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Codex session exported</h1><p>You can close this tab and return to the terminal.</p>');
      finish(null, { code, state, callbackUrl: requestUrl.toString() });
    });

    const timeout = setTimeout(() => {
      finish(new Error(`Timed out after ${Math.round(timeoutMs / 1000)} seconds waiting for OAuth callback.`));
    }, timeoutMs);

    function finish(error, value) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      server.close(() => {
        if (error) {
          rejectCallback(error);
        } else {
          resolveCallback(value);
        }
      });
    }

    server.on('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        finish(new Error('Port 1455 is already in use. Stop the other localhost OAuth listener and retry.'));
        return;
      }
      finish(error);
    });

    server.listen(1455, '127.0.0.1');
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function exchangeCodeForTokens({ code, codeVerifier }) {
  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('client_id', CLIENT_ID);
  form.set('code', code);
  form.set('redirect_uri', REDIRECT_URI);
  form.set('code_verifier', codeVerifier);

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(text || '{}');
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = firstString(payload.error_description, payload.error, text, `HTTP ${response.status}`);
    throw new Error(`Token exchange failed: ${message}`);
  }
  if (!payload.access_token) {
    throw new Error('Token exchange response is missing access_token.');
  }
  return payload;
}

function buildSessionJson(tokenPayload) {
  const accessPayload = decodeJwtPayload(tokenPayload.access_token);
  const idPayload = decodeJwtPayload(tokenPayload.id_token);
  const auth = accessPayload['https://api.openai.com/auth'] || {};
  const idAuth = idPayload['https://api.openai.com/auth'] || {};
  const profile = accessPayload['https://api.openai.com/profile'] || {};
  const expiresAtUnix = Number(accessPayload.exp) || Math.floor(Date.now() / 1000 + Number(tokenPayload.expires_in || 0));
  const expiresAt = isoFromUnixSeconds(expiresAtUnix);
  const accountId = firstString(auth.chatgpt_account_id, idAuth.chatgpt_account_id);
  const userId = firstString(auth.chatgpt_user_id, auth.user_id, idAuth.chatgpt_user_id, idAuth.user_id, accessPayload.sub, idPayload.sub);
  const email = firstString(profile.email, idPayload.email, accessPayload.email);
  const planType = firstString(auth.chatgpt_plan_type, idAuth.chatgpt_plan_type);
  const exportedAt = new Date().toISOString();

  return Object.fromEntries(Object.entries({
    type: 'codex',
    provider: 'openai',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    account_id: accountId,
    chatgpt_account_id: accountId,
    user_id: userId,
    email,
    name: email || 'Codex OAuth Session',
    plan_type: planType,
    chatgpt_plan_type: planType,
    token_type: tokenPayload.token_type || 'Bearer',
    access_token: tokenPayload.access_token,
    refresh_token: tokenPayload.refresh_token || '',
    id_token: tokenPayload.id_token || '',
    scope: tokenPayload.scope || 'openid email profile offline_access',
    last_refresh: exportedAt,
    obtained_at: exportedAt,
    expired: expiresAt,
    expires_at: expiresAtUnix || undefined,
    expires_in: Number.isFinite(Number(tokenPayload.expires_in)) ? Number(tokenPayload.expires_in) : undefined,
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token || '',
    idToken: tokenPayload.id_token || '',
    expiresAt,
  }).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function summarizeSession(sessionJson) {
  return {
    type: sessionJson.type,
    email: sessionJson.email || '(not present)',
    account_id_present: Boolean(sessionJson.account_id),
    plan_type: sessionJson.plan_type || '(not present)',
    access_token_length: String(sessionJson.access_token || '').length,
    refresh_token_present: Boolean(sessionJson.refresh_token),
    id_token_present: Boolean(sessionJson.id_token),
    expired: sessionJson.expired || '(not present)',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const state = randomBase64Url(16);
  const codeVerifier = randomBase64Url(96);
  const codeChallenge = sha256Base64Url(codeVerifier);
  const oauthUrl = buildAuthUrl({ state, codeChallenge, prompt: args.prompt });

  console.log('Listening on http://localhost:1455/auth/callback');
  console.log(`Output: ${args.out}`);
  console.log(args.prompt ? `OAuth prompt: ${args.prompt}` : 'OAuth prompt: omitted (reuse existing login if possible)');
  console.log('Open this URL if the browser does not open automatically:');
  console.log(oauthUrl);

  const callbackPromise = waitForCallback({ expectedState: state, timeoutMs: args.timeoutMs });
  if (args.open) {
    openUrl(oauthUrl);
  }

  const callback = await callbackPromise;
  console.log('OAuth callback received. Exchanging code for tokens...');
  const tokenPayload = await exchangeCodeForTokens({ code: callback.code, codeVerifier });
  const sessionJson = buildSessionJson(tokenPayload);

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(sessionJson, null, 2)}\n`, 'utf8');

  console.log('Saved Codex session JSON. Summary:');
  console.log(JSON.stringify(summarizeSession(sessionJson), null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
