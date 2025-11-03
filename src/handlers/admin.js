import { ConfigService } from '../services/config.js';
import { KVService } from '../services/kv.js';
import { renderAdminPage } from '../views/admin.html.js';
import { renderLoginPage } from '../views/login.html.js';
import { createResponse, generateToken } from '../utils.js';
import { TelegramService } from '../services/telegram.js';
import { verifyJwt, createJwt, getAuthCookie, createAuthCookie } from '../services/auth.js';

// 登录处理器
async function handleLogin(request) {
    const { password } = await request.json();
    const adminPassword = ConfigService.get('adminPassword');
    const jwtSecret = ConfigService.getEnv().JWT_SECRET;

    if (!adminPassword || !jwtSecret) {
        return createResponse({ error: 'Admin password or JWT secret not set on server.' }, 500);
    }

    if (password === adminPassword) {
        const token = await createJwt(jwtSecret);
        const cookie = createAuthCookie(token, 8 * 60 * 60); // 8 hours
        return createResponse({ success: true }, 200, { 'Set-Cookie': cookie });
    } else {
        return createResponse({ error: 'Invalid password' }, 401);
    }
}

// 登出处理器
function handleLogout() {
    const cookie = createAuthCookie('logged_out', 0); // Expire immediately
    return createResponse({ success: true }, 200, { 'Set-Cookie': cookie });
}

// API请求处理器 (现在它假设请求已通过认证)
async function handleApiRequest(request, url) {
    const method = request.method;
    const pathParts = url.pathname.split('/').filter(Boolean); // ['admin', 'api', 'groups', 'token123']

    // 路由到不同的 API 处理器
    if (pathParts[2] === 'logout' && method === 'POST') {
        return handleLogout();
    }
    if (pathParts[2] === 'config' && method === 'GET') {
        const config = await KVService.getGlobalConfig() || ConfigService.get();
        return createResponse(config);
    }
    if (pathParts[2] === 'config' && method === 'PUT') {
        const newConfig = await request.json();
        // 合并而不是完全替换，防止丢失未在前端展示的配置项
        const oldConfig = await KVService.getGlobalConfig() || {};
        const mergedConfig = { ...oldConfig, ...newConfig };
        await KVService.saveGlobalConfig(mergedConfig);
        await TelegramService.sendAdminLog('更新全局配置');
        return createResponse({ success: true });
    }
    if (pathParts[2] === 'groups' && method === 'GET') {
        const groups = await KVService.getAllGroups();
        return createResponse(groups);
    }
    if (pathParts[2] === 'groups' && method === 'POST') {
        const newGroup = await request.json();
        if (!newGroup.token) newGroup.token = generateToken();
        await KVService.saveGroup(newGroup);
        await TelegramService.sendAdminLog('创建订阅组', `名称: ${newGroup.name}`);
        return createResponse(newGroup);
    }
    if (pathParts[2] === 'groups' && pathParts[3] && method === 'PUT') {
        const token = pathParts[3];
        const groupData = await request.json();
        groupData.token = token;
        await KVService.saveGroup(groupData);
        await TelegramService.sendAdminLog('更新订阅组', `名称: ${groupData.name}`);
        return createResponse(groupData);
    }
    if (pathParts[2] === 'groups' && pathParts[3] && method === 'DELETE') {
        const token = pathParts[3];
        await KVService.deleteGroup(token);
        await TelegramService.sendAdminLog('删除订阅组', `Token: ${token}`);
        return createResponse({ success: true });
    }
    if (pathParts[2] === 'utils' && pathParts[3] === 'gentoken' && method === 'GET') {
        return createResponse({ token: generateToken() });
    }

    return createResponse({ error: 'API endpoint not found' }, 404);
}


// 主处理器
export async function handleAdminRequest(request) {
    const url = new URL(request.url);
    const jwtSecret = ConfigService.getEnv().JWT_SECRET;
    if (!jwtSecret) {
        return createResponse({ error: 'JWT_SECRET is not configured.'}, 500);
    }

    // 1. 检查是否是登录API的请求，如果是，则直接处理
    if (url.pathname === '/admin/api/login' && request.method === 'POST') {
        return handleLogin(request);
    }

    // 2. 验证所有其他 /admin 请求的JWT
    const token = getAuthCookie(request);
    const isValid = await verifyJwt(jwtSecret, token);

    if (isValid) {
        // 认证通过
        if (url.pathname.startsWith('/admin/api/')) {
            return handleApiRequest(request, url); // 处理API请求
        }
        return createResponse(renderAdminPage(), 200, {}, 'text/html; charset=utf-8'); // 提供主应用
    } else {
        // 认证失败
        // 清除可能存在的无效cookie
        const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': createAuthCookie('invalid', 0) };
        return createResponse(renderLoginPage(), 401, headers, 'text/html; charset=utf-8');
    }
}