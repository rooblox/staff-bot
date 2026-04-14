const https = require('https');

function fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    headers: res.headers,
                    json: () => Promise.resolve(JSON.parse(data)),
                    text: () => Promise.resolve(data)
                });
            });
        });

        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

const COOKIE = () => process.env.ROBLOX_COOKIE;

async function getRobloxIdFromUsername(username) {
    try {
        const res = await fetch('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        const data = await res.json();
        return data?.data?.[0]?.id || null;
    } catch (err) {
        console.error('getRobloxIdFromUsername error:', err);
        return null;
    }
}

async function getRobloxUsername(robloxId) {
    try {
        const res = await fetch(`https://users.roblox.com/v1/users/${robloxId}`);
        const data = await res.json();
        return data?.name || null;
    } catch (err) {
        console.error('getRobloxUsername error:', err);
        return null;
    }
}

async function getAvatarUrl(robloxId) {
    try {
        const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png&isCircular=false`);
        const data = await res.json();
        return data?.data?.[0]?.imageUrl || null;
    } catch (err) {
        console.error('getAvatarUrl error:', err);
        return null;
    }
}

async function getGroupRanks(groupId) {
    try {
        const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
        const data = await res.json();
        return (data.roles || []).filter(r => r.rank !== 0 && r.rank !== 255);
    } catch (err) {
        console.error('getGroupRanks error:', err);
        return [];
    }
}

async function getUserRankInGroup(groupId, robloxId) {
    try {
        const res = await fetch(`https://groups.roblox.com/v2/users/${robloxId}/groups/roles`);
        const data = await res.json();
        const group = (data.data || []).find(g => String(g.group.id) === String(groupId));
        return group?.role || null;
    } catch (err) {
        console.error('getUserRankInGroup error:', err);
        return null;
    }
}

async function getCsrfToken() {
    try {
        const res = await fetch('https://auth.roblox.com/v2/logout', {
            method: 'POST',
            headers: { 'Cookie': `.ROBLOSECURITY=${COOKIE()}` }
        });
        const token = res.headers['x-csrf-token'] || null;
        console.log('getCsrfToken result:', token ? '✅ Got token' : '❌ No token');
        return token;
    } catch (err) {
        console.error('getCsrfToken error:', err);
        return null;
    }
}

async function setRank(groupId, robloxId, rankId) {
    try {
        const csrfToken = await getCsrfToken();
        const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/users/${robloxId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `.ROBLOSECURITY=${COOKIE()}`,
                'x-csrf-token': csrfToken
            },
            body: JSON.stringify({ roleId: rankId })
        });
        if (!res.ok) {
            const text = await res.text();
            console.error('setRank failed:', res.status, text);
        }
        return res.ok;
    } catch (err) {
        console.error('setRank error:', err);
        return false;
    }
}

async function kickFromGroup(groupId, robloxId) {
    try {
        const csrfToken = await getCsrfToken();
        const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/users/${robloxId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `.ROBLOSECURITY=${COOKIE()}`,
                'x-csrf-token': csrfToken
            }
        });
        if (!res.ok) {
            const text = await res.text();
            console.error('kickFromGroup failed:', res.status, text);
        }
        return res.ok;
    } catch (err) {
        console.error('kickFromGroup error:', err);
        return false;
    }
}

async function getAuditLog(groupId, limit = 100) {
    try {
        const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/audit-log?actionType=ChangeRank&limit=${limit}`, {
            headers: {
                'Cookie': `.ROBLOSECURITY=${COOKIE()}`
            }
        });
        const data = await res.json();
        return data?.data || [];
    } catch (err) {
        console.error('getAuditLog error:', err);
        return [];
    }
}

async function sendGroupAnnouncement(groupId, title, content) {
    try {
        const csrfToken = await getCsrfToken();
        console.log('📢 Attempting announcement...');
        console.log('Group ID:', groupId);
        console.log('Title:', title);
        console.log('Content:', content);
        console.log('CSRF Token:', csrfToken ? '✅ Present' : '❌ Missing');

        // Try new announcements endpoint
        const url = `https://groups.roblox.com/v1/groups/${groupId}/announcements`;
        console.log('URL:', url);

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `.ROBLOSECURITY=${COOKIE()}`,
                'x-csrf-token': csrfToken
            },
            body: JSON.stringify({ title, content })
        });

        const responseText = await res.text();
        console.log('📢 Announcement status:', res.status);
        console.log('📢 Announcement response:', responseText);

        return res.ok;
    } catch (err) {
        console.error('sendGroupAnnouncement error:', err);
        return false;
    }
}

module.exports = {
    getRobloxIdFromUsername,
    getRobloxUsername,
    getAvatarUrl,
    getGroupRanks,
    getUserRankInGroup,
    setRank,
    kickFromGroup,
    getAuditLog,
    sendGroupAnnouncement
};