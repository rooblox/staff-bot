const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

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
    } catch {
        return null;
    }
}

async function getRobloxUsername(robloxId) {
    try {
        const res = await fetch(`https://users.roblox.com/v1/users/${robloxId}`);
        const data = await res.json();
        return data?.name || null;
    } catch {
        return null;
    }
}

async function getAvatarUrl(robloxId) {
    try {
        const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png&isCircular=false`);
        const data = await res.json();
        return data?.data?.[0]?.imageUrl || null;
    } catch {
        return null;
    }
}

async function getGroupRanks(groupId) {
    try {
        const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
        const data = await res.json();
        return (data.roles || []).filter(r => r.rank !== 0 && r.rank !== 255);
    } catch {
        return [];
    }
}

async function getUserRankInGroup(groupId, robloxId) {
    try {
        const res = await fetch(`https://groups.roblox.com/v2/users/${robloxId}/groups/roles`);
        const data = await res.json();
        const group = (data.data || []).find(g => String(g.group.id) === String(groupId));
        return group?.role || null;
    } catch {
        return null;
    }
}

async function getCsrfToken() {
    try {
        const res = await fetch('https://auth.roblox.com/v2/logout', {
            method: 'POST',
            headers: { 'Cookie': `.ROBLOSECURITY=${COOKIE()}` }
        });
        return res.headers.get('x-csrf-token');
    } catch {
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
        return res.ok;
    } catch {
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
        return res.ok;
    } catch {
        return false;
    }
}

async function sendGroupAnnouncement(groupId, message) {
    try {
        const csrfToken = await getCsrfToken();
        const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `.ROBLOSECURITY=${COOKIE()}`,
                'x-csrf-token': csrfToken
            },
            body: JSON.stringify({ message })
        });
        return res.ok;
    } catch {
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
    sendGroupAnnouncement
};