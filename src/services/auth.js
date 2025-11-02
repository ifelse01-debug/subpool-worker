const cookieName = 'auth_token';
const textEncoder = new TextEncoder();

// Base64URL 编码/解码
function base64UrlEncode(str) {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return atob(str);
}

// 从字符串生成用于签名的密钥
async function getKey(secret) {
  const keyData = textEncoder.encode(secret);
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// 创建JWT
export async function createJwt(secret, expirationInSeconds = 8 * 60 * 60) {
  const key = await getKey(secret);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { exp: Math.floor(Date.now() / 1000) + expirationInSeconds };
  
  const partialToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(partialToken)
  );
  
  const signature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signatureBuffer)));
  
  return `${partialToken}.${signature}`;
}

// 验证JWT
export async function verifyJwt(secret, token) {
  if (!token) return false;
  
  try {
    const key = await getKey(secret);
    const [header, payload, signature] = token.split('.');
    
    if (!header || !payload || !signature) return false;
    
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      Uint8Array.from(base64UrlDecode(signature), c => c.charCodeAt(0)),
      textEncoder.encode(`${header}.${payload}`)
    );
    
    if (!isValid) return false;
    
    const payloadData = JSON.parse(base64UrlDecode(payload));
    return payloadData.exp > Math.floor(Date.now() / 1000);
  } catch (e) {
    return false;
  }
}

// 从请求中获取Cookie
export function getAuthCookie(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  
  const cookies = cookieHeader.split(';');
  const authCookie = cookies.find(c => c.trim().startsWith(`${cookieName}=`));
  
  return authCookie ? authCookie.split('=')[1].trim() : null;
}

// 创建Set-Cookie头
export function createAuthCookie(token, maxAge) {
  return `${cookieName}=${token}; HttpOnly; Secure; Path=/admin; Max-Age=${maxAge}; SameSite=Strict`;
}