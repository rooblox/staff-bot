const DEPARTMENTS = {
'SHR': {
        serverId: '1229426371592327250',
        roleId: '1493723763064438904',
        logChannelId: '1417829293001805854',
        loaChannelId: '1493723954370580561',
        loaLogChannelId: '1493723954370580561'
    },
    'PR Member': {
        serverId: '1385081586285940796',
        roleId: '1485100238715883720',
        logChannelId: '1482430133561196625',
        loaChannelId: '1493722891278221432',
        loaLogChannelId: '1493722607264993471'
    },
    'MR Member': {
        serverId: '1372680943592280217',
        roleId: '1493725057254428753',
        logChannelId: '1493725407332139179',
        loaChannelId: '1462104324917166174',
        loaLogChannelId: '1493725489498427542'
    },
    'HR Member': {
        serverId: '1372680943592280217',
        roleId: '1493725057254428753',
        logChannelId: '1493725407332139179',
        loaChannelId: '1462104324917166174',
        loaLogChannelId: '1493725489498427542'
    },
    'Media Team': {
        serverId: '1313780438061420584',
        roleId: '1493724127033561108',
        logChannelId: '1493724275549536266',
        loaChannelId: '1493724355442639080',
        loaLogChannelId: '1493724398115487875'
    },
    'Development Member': {
        serverId: '1462152073478017243',
        roleId: '1493723210783654048',
        logChannelId: '1493723334855102568',
        loaChannelId: '1493723545824530462',
        loaLogChannelId: '1493723407286538310'
    },
    'Development Tester': {
        serverId: '1462152073478017243',
        roleId: '1493723210783654048',
        logChannelId: '1493723334855102568',
        loaChannelId: '1493723545824530462',
        loaLogChannelId: '1493723407286538310'
    },
    'Human Resources': {
        serverId: '1434556801096876034',
        roleId: '1484973859513045224',
        logChannelId: '1462475668506808330',
        loaChannelId: '1493725925819289805',
        loaLogChannelId: '1464070445698650316',
        strikeLogChannelId: '1508460972094918832'
    }
};

const DEPT_CHOICES = [
    { name: 'SHR', value: 'SHR' },
    { name: 'PR Member', value: 'PR Member' },
    { name: 'MR Member', value: 'MR Member' },
    { name: 'HR Member', value: 'HR Member' },
    { name: 'Media Team', value: 'Media Team' },
    { name: 'Development Member', value: 'Development Member' },
    { name: 'Development Tester', value: 'Development Tester' },
    { name: 'Human Resources', value: 'Human Resources' }
];

const MAIN_GUILD_ID = '1370892833182974035';
const MAIN_REQUIRED_ROLE_ID = '1493354187109433434';

async function checkDeptPermission(client, userId, department) {
    try {
        const dept = DEPARTMENTS[department];
        if (!dept) return false;
        const guild = await client.guilds.fetch(dept.serverId);
        const member = await guild.members.fetch(userId).catch(() => null);
        return member && member.roles.cache.has(dept.roleId);
    } catch {
        return false;
    }
}

async function hasMainRole(client, userId) {
    try {
        const guild = await client.guilds.fetch(MAIN_GUILD_ID);
        const member = await guild.members.fetch(userId).catch(() => null);
        return member && member.roles.cache.has(MAIN_REQUIRED_ROLE_ID);
    } catch {
        return false;
    }
}

async function getDeptLogChannel(client, department) {
    try {
        const dept = DEPARTMENTS[department];
        if (!dept) return null;
        return await client.channels.fetch(dept.logChannelId);
    } catch {
        return null;
    }
}

async function getDeptStrikeLogChannel(client, department) {
    try {
        const dept = DEPARTMENTS[department];
        if (!dept) return null;
        const channelId = dept.strikeLogChannelId || dept.logChannelId;
        return await client.channels.fetch(channelId);
    } catch {
        return null;
    }
}

module.exports = {
    DEPARTMENTS,
    DEPT_CHOICES,
    MAIN_GUILD_ID,
    MAIN_REQUIRED_ROLE_ID,
    checkDeptPermission,
    hasMainRole,
    getDeptLogChannel,
    getDeptStrikeLogChannel
};