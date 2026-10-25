require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, EmbedBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { connectDB, Reminder, Session, LOA, CompletedTrainings, Ticket, Review, TicketPanel, Birthday, Checklist, Payment, MessageLog, WeeklyStats } = require('./db');
const { createServer, handleRankButton } = require('./server');

const REQUEST_CHANNEL_ID = '1493737208597971045';
const ANNOUNCEMENT_CHANNEL_ID = '1385105286926172160';
const ANNOUNCEMENT_GUILD_ID = '1370892833182974035';
const MAIN_GUILD_ID = '1370892833182974035';
const REQUIRED_BUTTON_ROLE_ID = '1493354187109433434';
const TRAINING_BUTTON_ROLE_ID = '1495951292605009930';
const TRAINING_BUTTON_GUILD_ID = '1301333604315561994';
const SHIFT_PING_ROLE_ID = '1371568661592019044';
const TRAINING_PING_ROLE_ID = '1371568736569659462';
const TRAINING_LINK = 'https://docs.google.com/document/d/1BW5Nmy14butcEscy9PMOTeAbfsfAwj9pJF2uXNkQu6A/edit?usp=drivesdk';
const SHIFT_LINK = 'https://docs.google.com/document/d/12MhP5KnwSqvpiP7w6l7iqgFuJwWkoMNpKYQCdtp3vfA/edit?usp=drivesdk';
const LOA_STAFF_ROLE_ID = '1434623628078743584';
const TICKET_IMAGE = 'https://media.galaxybot.app/server/1370892833182974035/001854df-a22e-4f51-aa3a-784de10a309f.png';
const PANEL_IMAGE = 'https://images-ext-1.discordapp.net/external/BRbAFEkp6sgftr5ZZdkP1qB0t_VrQJxkENCKXh76XG4/https/media.galaxybot.app/server/1370892833182974035/d00d856a-6931-405b-a916-b875c51eeee3.jpeg?format=webp';

const ALLOWED_GUILD_IDS = new Set([
    '1370892833182974035', // Kavià Cafe (main)
    '1434556801096876034', // Human Resources
    '1229426371592327250', // SHR
    '1385081586285940796', // PR
    '1372680943592280217', // MR
    '1313780438061420584', // Media Team
    '1462152073478017243', // Development
    '1301333604315561994', // Training Center
    '1417973638346309653', // Kavia Cafe Development
]);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: ['CHANNEL']
});

client.dmLogChannels = new Map();
client.commands = new Collection();
client.ticketRepingTimeouts = new Map();
client.ticketInactivityTimeouts = new Map();
client.trollReviews = new Map();
client.ticketInactivityTimeouts = new Map();

const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
const cmds = [];
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (!command.data || !command.execute) continue;
    client.commands.set(command.data.name, command);
    cmds.push(command.data.toJSON());
    console.log(`Loaded command: ${command.data.name}`);
}

const trainingModule = require('./commands/starttraining');
const { activeSessions, getSectionEmbed, getSectionButtons, getQuizEmbed, getQuizButtons, getTrainingConfig, TRAINING_DEPTS } = trainingModule;

const loaModule = require('./commands/loa');
const { scheduleLOAReturnReminder, DEPARTMENTS } = loaModule;


// ========== WELCOME SYSTEM ==========
const WELCOME_GUILD_ID = '1370892833182974035';
const WELCOME_CHANNEL_ID = '1370974444721410129';
const WELCOME_THUMBNAIL = 'https://media.discordapp.net/attachments/1370974444721410129/1540552765623902228/kaviacafesingle.png?ex=6a8c5951&is=6a8b07d1&hm=5184709fe82614cd0199b24611ecdfacc47748356218f1cc790276c3172ee5d7&=&format=webp&quality=lossless';
const WELCOME_BANNER = 'https://media.discordapp.net/attachments/1370974444721410129/1540552766236401664/kaviacafewelcome.jpg?ex=6a8c5951&is=6a8b07d1&hm=6e9b2f151d06a789161d011c4be7e166dc948ddc1288f20b6d55b6cc77359871&=&format=webp';

// ========== ROBLOX GROUP TRACKER ==========
const ROBLOX_GROUP_ID = '13827902';
const ROBLOX_COUNT_CHANNEL_ID = '1371143149812187177';
let lastRobloxMemberCount = 3947;
let robloxMemberGoal = 4000;

// Weekly Discord stats tracking
let weeklyDiscordJoins = 0;
let weeklyDiscordLeaves = 0;
let lastWeekDiscordJoins = 0;
let lastWeekDiscordLeaves = 0;
let weeklyTotalMessages = 0;
let lastWeekTotalMessages = 0;
let lastWeekRobloxCount = 3947;
let weekStartRobloxCount = 3947;

// ========== MOD REPORT / ALLIANCE ==========
const STAFF_ROLE_ID = '1372833756489973823';
const MOD_REPORT_GUILD_ID = '1370892833182974035';
const WEEKLY_STATS_CHANNEL_ID = '1551043091174002708';
const MOD_REPORT_CHANNEL_ID = '1551043091174002708';
const ALLIANCE_SERVER_ID = process.env.ALLIANCE_SERVER_ID || '1385081586285940796';
const ALLIANCE_ROLE_ID = process.env.ALLIANCE_ROLE_ID || '1371492999854293024';

// ========== HELPERS ==========
async function hasRequiredRole(userId) {
    try {
        const hrGuild = await client.guilds.fetch('1434556801096876034');
        const hrMember = await hrGuild.members.fetch(userId).catch(() => null);
        return hrMember && hrMember.roles.cache.has('1434563855354167358');
    } catch { return false; }
}

async function hasTrainingRole(userId) {
    try {
        const trainingGuild = await client.guilds.fetch(TRAINING_BUTTON_GUILD_ID);
        const member = await trainingGuild.members.fetch(userId).catch(() => null);
        if (member && member.roles.cache.has(TRAINING_BUTTON_ROLE_ID)) return true;
        const hrGuild = await client.guilds.fetch('1434556801096876034');
        const hrMember = await hrGuild.members.fetch(userId).catch(() => null);
        if (hrMember && hrMember.roles.cache.has('1484973859513045224')) return true;
        return false;
    } catch { return false; }
}

async function hasStaffRole(userId, department) {
    try {
        const deptConfig = department ? DEPARTMENTS[department] : null;
        if (deptConfig) {
            const guild = await client.guilds.fetch(deptConfig.serverId);
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member && member.roles.cache.has(deptConfig.roleId)) return true;
        }
        for (const guild of client.guilds.cache.values()) {
            const m = await guild.members.fetch(userId).catch(() => null);
            if (m && m.roles.cache.has(LOA_STAFF_ROLE_ID)) return true;
        }
        return false;
    } catch { return false; }
}

async function hasTicketStaffRole(userId, guildId, pingRoleId, pingRoleIds) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;
        const allRoleIds = pingRoleIds?.length > 0 ? pingRoleIds : (pingRoleId ? [pingRoleId] : []);
        for (const roleId of allRoleIds) {
            if (member.roles.cache.has(roleId)) return true;
        }
        for (const dept of Object.values(DEPARTMENTS)) {
            if (dept.serverId === guildId && member.roles.cache.has(dept.roleId)) return true;
        }
        const { hasMainRole } = require('./commands/departments');
        return await hasMainRole(client, userId);
    } catch { return false; }
}

async function hasBotPermsRole(guildId, userId) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;
        for (const dept of Object.values(DEPARTMENTS)) {
            if (dept.serverId === guildId && member.roles.cache.has(dept.roleId)) return true;
        }
        if (guildId === MAIN_GUILD_ID && member.roles.cache.has(REQUIRED_BUTTON_ROLE_ID)) return true;
        return false;
    } catch { return false; }
}

async function hasBotPermsRole(guildId, userId) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;
        for (const dept of Object.values(DEPARTMENTS)) {
            if (dept.serverId === guildId && member.roles.cache.has(dept.roleId)) return true;
        }
        if (guildId === MAIN_GUILD_ID && member.roles.cache.has(REQUIRED_BUTTON_ROLE_ID)) return true;
        return false;
    } catch { return false; }
}

async function sendLOALog(user, title, color, loaId, extraFields = []) {
    try {
        const loa = await LOA.findById(loaId);
        const deptConfig = loa?.department ? DEPARTMENTS[loa.department] : null;
        if (!deptConfig) return;
        const logGuild = await client.guilds.fetch(deptConfig.serverId);
        const logChannel = await logGuild.channels.fetch(deptConfig.loaLogChannelId);
        const embed = new EmbedBuilder()
            .setTitle(title).setColor(color)
            .addFields(
                { name: '👤 User', value: `${user.tag} (${user.id})` },
                { name: '🏢 Department', value: loa.department || 'Unknown' },
                ...extraFields
            )
            .setTimestamp().setFooter({ text: `LOA ID: ${loaId}` });
        await logChannel.send({ embeds: [embed] });
    } catch (err) { console.error('Error sending LOA log:', err); }
}

// ========== TICKET HELPERS ==========
function generateCaseId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return `KC-${result}`;
}

async function updatePanelWorkload(panel, guild) {
    try {
        const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
        if (!channel) return;
        const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
        if (!msg) return;
        const workloadData = await Promise.all(panel.categories.map(async (c) => {
            const count = await Ticket.countDocuments({ serverId: guild.id, category: c.name, status: { $in: ['open', 'claimed'] } });
            const pct = Math.round((count / 5) * 100);
            return `• **${c.emoji ? c.emoji + ' ' : ''}${c.name}:** Available \`${count}/5\` (${pct}%)`;
        }));
        const oldEmbed = msg.embeds[0];
        const newEmbed = EmbedBuilder.from(oldEmbed).spliceFields(0, 1, {
            name: '📊 Ticket Utilization',
            value: `Here you can see the current workload of our tickets.\n\n${workloadData.join('\n')}`
        });

        const components = [];
        if (panel.categories.length > 0) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`ticket_open_${guild.id}`)
                .setPlaceholder('Choose a category...')
                .addOptions(panel.categories.map(c => {
                    const option = { label: c.name, value: c.name };
                    if (c.emoji) {
                        const customMatch = c.emoji.match(/^<a?:(\w+):(\d+)>$/);
                        if (customMatch) { option.emoji = { name: customMatch[1], id: customMatch[2] }; }
                        else { option.emoji = c.emoji; }
                    }
                    if (c.description) option.description = c.description.substring(0, 100);
                    return option;
                }));
            components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        await msg.edit({ embeds: [newEmbed], components });
    } catch (err) { console.error('Error updating panel workload:', err); }
}

async function saveTranscript(ticket, channel, logChannelId, closedBy) {
    try {
        const { AttachmentBuilder } = require('discord.js');
        const messages = await channel.messages.fetch({ limit: 100 });
        const sorted = [...messages.values()].reverse();
        const lines = sorted.map(m => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content || '[embed/attachment]'}`);
        const transcript = lines.join('\n');
        const buffer = Buffer.from(transcript, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: `transcript-${ticket.caseId}.txt` });
        const logChannel = await client.channels.fetch(logChannelId).catch(() => null);

        const claimTimeText = ticket.claimedAt && ticket.createdAt
            ? `${Math.round((new Date(ticket.claimedAt).getTime() - new Date(ticket.createdAt).getTime()) / 1000 / 60)}m`
            : 'N/A';
        const durationText = ticket.createdAt
            ? `${Math.round((Date.now() - new Date(ticket.createdAt).getTime()) / 1000 / 60)}m`
            : 'Unknown';

        let ratingText = 'N/A';
        if (ticket.claimedBy) {
            try {
                const review = await Review.findOne({ ticketCaseId: ticket.caseId }).sort({ createdAt: -1 });
                if (review) ratingText = `${review.rating}/5`;
            } catch {}
        }

        if (logChannel?.isTextBased()) {
            await logChannel.send({
                embeds: [new EmbedBuilder()
                    .setTitle('🎫 Ticket Closed')
                    .setColor(0xE74C3C)
                    .setDescription(`**Case #${ticket.caseId}** has been closed.`)
                    .addFields(
                        { name: '👤 Opened By', value: `<@${ticket.userId}>`, inline: true },
                        { name: '📂 Category', value: ticket.category, inline: true },
                        { name: '👮 Claimed By', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed', inline: true },
                        { name: '⏱️ Claim Time', value: claimTimeText, inline: true },
                        { name: '⏳ Duration', value: durationText, inline: true },
                        { name: '⭐ Rating', value: ratingText, inline: true },
                        { name: '🔒 Closed By', value: closedBy ? `${closedBy.tag}` : 'System', inline: true },
                        { name: '📅 Closed At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    )
                    .setFooter({ text: `Kavià Café • Ticket System • Case #${ticket.caseId}` })
                    .setTimestamp()
                ],
                files: [attachment]
            });
        }
    } catch (err) { console.error('Error saving transcript:', err); }
}

async function closeTicket(ticket, channel, closedBy, reason) {
    try {
        if (client.ticketRepingTimeouts.has(ticket.caseId)) {
            clearTimeout(client.ticketRepingTimeouts.get(ticket.caseId));
            client.ticketRepingTimeouts.delete(ticket.caseId);
        }
        if (client.ticketInactivityTimeouts.has(ticket.caseId)) {
            clearTimeout(client.ticketInactivityTimeouts.get(ticket.caseId));
            client.ticketInactivityTimeouts.delete(ticket.caseId);
        }
       await Ticket.findByIdAndUpdate(ticket._id, { status: 'closed', closedAt: new Date() });
        await saveTranscript(ticket, channel, ticket.logChannelId, closedBy);

        if (ticket.claimedBy) {
            try {
                const opener = await client.users.fetch(ticket.userId);
                const ratingRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ticket_rate_1_${ticket.caseId}_${ticket.claimedBy}`).setLabel('⭐ 1').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`ticket_rate_2_${ticket.caseId}_${ticket.claimedBy}`).setLabel('⭐ 2').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`ticket_rate_3_${ticket.caseId}_${ticket.claimedBy}`).setLabel('⭐ 3').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`ticket_rate_4_${ticket.caseId}_${ticket.claimedBy}`).setLabel('⭐ 4').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`ticket_rate_5_${ticket.caseId}_${ticket.claimedBy}`).setLabel('⭐ 5').setStyle(ButtonStyle.Success)
                );
                await opener.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('⭐ Rate Your Experience')
                        .setDescription(`Your ticket **#${ticket.caseId}** has been closed.\n\nHow was your experience with <@${ticket.claimedBy}>? Please rate them below!`)
                        .setColor(0xF39C12)
                        .setFooter({ text: 'Kavià Café • Ticket System' })
                        .setTimestamp()
                    ],
                    components: [ratingRow]
                });
            } catch {}
        }

       await channel.send({
            embeds: [new EmbedBuilder()
                .setTitle('🔒 Ticket Closing')
                .setDescription(`This ticket has been closed${reason ? ` — **${reason}**` : ''}.\n\nThis channel will be deleted in **10 seconds**.`)
                .setColor(0xE74C3C)
.setImage('https://cdn.discordapp.com/attachments/620024668673409069/1521630733469225000/9KmYliAAAABklEQVQDABtrtrOVD3Q5AAAAAElFTkSuQmCC.png?ex=6a45888d&is=6a44370d&hm=ca06f3c0597f4b01940fa6fb337d37cc7a4fad61f96fe217ab700f1dde2563ff&')
                .setFooter({ text: `Closed by ${closedBy?.tag || 'System'}` })
                .setTimestamp()
            ]
        });

        try {
            const panel = await TicketPanel.findOne({ serverId: ticket.serverId });
            if (panel) {
                const guild = await client.guilds.fetch(ticket.serverId);
                await updatePanelWorkload(panel, guild);
            }
        } catch {}

        setTimeout(async () => { await channel.delete().catch(() => {}); }, 10000);

    } catch (err) { console.error('Error closing ticket:', err); }
}

function scheduleTicketReping(ticket, panel, guild) {
    if (client.ticketRepingTimeouts.has(ticket.caseId)) clearTimeout(client.ticketRepingTimeouts.get(ticket.caseId));
    const timeout = setTimeout(async () => {
        try {
            const latestTicket = await Ticket.findById(ticket._id);
            if (!latestTicket || latestTicket.status !== 'open' || latestTicket.claimedBy) return;
            const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
            if (channel) {
                const allRoleIds = ticket.pingRoleIds?.length > 0 ? ticket.pingRoleIds : (ticket.pingRoleId ? [ticket.pingRoleId] : []);
                const pingContent = allRoleIds.map(id => `<@&${id}>`).join(' ');
                await channel.send({
                    content: `${pingContent} ⚠️ This ticket has been open for 12 hours and has not been claimed!`,
                    embeds: [new EmbedBuilder()
                        .setTitle('⏰ Unclaimed Ticket Reminder')
                        .setColor(0xF39C12)
                        .addFields(
                            { name: '🔖 Case ID', value: `#${ticket.caseId}`, inline: true },
                            { name: '📂 Category', value: ticket.category, inline: true },
                            { name: '👤 Opened By', value: `<@${ticket.userId}>`, inline: true }
                        )
                        .setTimestamp()
                    ]
                });
            }
        } catch (err) { console.error('Error sending ticket reping:', err); }
    }, 12 * 60 * 60 * 1000);
    client.ticketRepingTimeouts.set(ticket.caseId, timeout);
}

function scheduleTicketInactivity(ticket, guild) {
    if (client.ticketInactivityTimeouts.has(ticket.caseId)) clearTimeout(client.ticketInactivityTimeouts.get(ticket.caseId));
    const timeout = setTimeout(async () => {
        try {
            const latestTicket = await Ticket.findById(ticket._id);
            if (!latestTicket || latestTicket.status === 'closed') return;
            const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
            if (!channel) return;
            const messages = await channel.messages.fetch({ limit: 1 });
            const lastMsg = messages.first();
            if (lastMsg && Date.now() - lastMsg.createdTimestamp < 23 * 60 * 60 * 1000) {
                scheduleTicketInactivity(latestTicket, guild);
                return;
            }
            const allRoleIds = ticket.pingRoleIds?.length > 0 ? ticket.pingRoleIds : (ticket.pingRoleId ? [ticket.pingRoleId] : []);
            const pingContent = allRoleIds.map(id => `<@&${id}>`).join(' ');
            await channel.send({
                content: `${pingContent}`,
                embeds: [new EmbedBuilder()
                    .setTitle('⏰ Ticket Inactivity Warning')
                    .setDescription(`This ticket has had no activity for **24 hours**.\n\nPlease respond or close the ticket if the issue has been resolved.`)
                    .setColor(0xF39C12)
                    .addFields(
                        { name: '🔖 Case ID', value: `#${ticket.caseId}`, inline: true },
                        { name: '📂 Category', value: ticket.category, inline: true },
                        { name: '👤 Opened By', value: `<@${ticket.userId}>`, inline: true }
                    )
                    .setFooter({ text: 'Kavià Café • Ticket System' })
                    .setTimestamp()
                ]
            });
            scheduleTicketInactivity(latestTicket, guild);
        } catch (err) { console.error('Error sending ticket inactivity warning:', err); }
    }, 24 * 60 * 60 * 1000);
    client.ticketInactivityTimeouts.set(ticket.caseId, timeout);
}

// ========== SESSION SCHEDULING ==========
async function scheduleSession(session) {
    const fireAt = new Date(session.sessionFireAt).getTime();
    const now = Date.now();
    const reminderDelay = fireAt - 10 * 60 * 1000 - now;
    const announcementDelay = fireAt - now;
    const finishCheckDelay = fireAt + 25 * 60 * 1000 - now;

    if (!session.preSessionReminderSent && reminderDelay > 0) {
        setTimeout(async () => {
            try {
                const latestSession = await Session.findById(session._id);
                if (!latestSession || latestSession.status !== 'approved') return;
                // Double-fire guard: if already sent (e.g. another instance beat us) skip
                if (latestSession.preSessionReminderSent) return;
                await Session.findByIdAndUpdate(session._id, { preSessionReminderSent: true });
                const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ses_stillhosting_${session._id}`).setLabel('✅ Yes, I am still hosting').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`ses_canthost_${session._id}`).setLabel('❌ No, I cannot make it').setStyle(ButtonStyle.Danger)
                );
                if (requestChannel?.isTextBased()) {
                    await requestChannel.send({
                        content: `<@${latestSession.hostId}>`,
                        embeds: [new EmbedBuilder().setTitle('⏰ Session Starting Soon!').setDescription(`<@${latestSession.hostId}>, your **${latestSession.shiftType}** is starting in **10 minutes** at ${latestSession.time}!\n\nAre you still able to host? You have **8 minutes** to respond or your session will be automatically cancelled.\n\n*Only you can click these buttons.*`).setColor(0xF39C12).setTimestamp()],
                        components: [row]
                    });
                }
                setTimeout(async () => {
                    try {
                        const checkSession = await Session.findById(session._id);
                        if (!checkSession || checkSession.status !== 'approved' || checkSession.hostConfirmed) return;
                        await Session.findByIdAndUpdate(session._id, { status: 'cancelled' });
                        try {
                            const host = await client.users.fetch(latestSession.hostId);
                            await host.send({ embeds: [new EmbedBuilder().setTitle('❌ Session Auto Cancelled').setDescription(`Your **${latestSession.shiftType}** session at **${latestSession.time}** has been automatically cancelled as we did not receive a response.\n\n***Sincerely,***\n**Kavià Café Staff Team**`).setColor(0xE74C3C).setTimestamp()] });
                        } catch {}
                        if (requestChannel?.isTextBased()) await requestChannel.send({ embeds: [new EmbedBuilder().setTitle('❌ Session Auto Cancelled').setColor(0xE74C3C).setDescription(`<@${latestSession.hostId}>'s **${latestSession.shiftType}** at **${latestSession.time}** has been **automatically cancelled** due to no response.`).setTimestamp()] });
                    } catch (err) { console.error('Error auto cancelling session:', err); }
                }, 8 * 60 * 1000);
            } catch (err) { console.error('Error sending pre-session reminder:', err); }
        }, reminderDelay);
    }

    if (announcementDelay > 0) {
        setTimeout(async () => {
            try {
                const latestSession = await Session.findById(session._id);
                if (!latestSession || latestSession.status !== 'approved' || !latestSession.hostConfirmed) return;
                await postAnnouncement(latestSession);
            } catch (err) { console.error('Error posting on-time announcement:', err); }
        }, announcementDelay);
    }

    if (finishCheckDelay > 0) {
        setTimeout(async () => {
            try {
                const latestSession = await Session.findById(session._id);
                if (!latestSession || latestSession.status === 'finished' || latestSession.status === 'cancelled') return;
                if (!latestSession.announcementMessageId) return;
                await sendFinishCheck(session._id);
            } catch (err) { console.error('Error scheduling finish check:', err); }
        }, finishCheckDelay);
    }
}

async function postAnnouncement(session) {
    try {
        const announcementGuild = await client.guilds.fetch(ANNOUNCEMENT_GUILD_ID);
        const announcementChannel = await announcementGuild.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
        const cohost = session.coHostId ? await client.users.fetch(session.coHostId) : null;
        const cohostText = cohost ? `<@${cohost.id}>` : 'None';
        const announcementContent = session.shiftType === 'Training'
            ? `Hello <@&${TRAINING_PING_ROLE_ID}> !\n‼️ Get ready! I'm excited to announce that I'll be hosting a training at ${session.time} alongside my co-host, ${cohostText}!\n📈 If you're an LR aiming for promotion, this is your moment to step up and shine.\nDon't miss your chance!\n🔗 | [Roblox Group](https://www.roblox.com/communities/13827902/Kavi-Cafe#!/about)\n🔗 | [Training Center](https://www.roblox.com/games/85441213175174/Kavi-Training-Center)`
           : `## 🚀 | Shift Commencement\n\n<@&${SHIFT_PING_ROLE_ID}>\n\n**‼️ | We are excited to announce that a shift is now being hosted at our lovely café!**\n\n💼 | Hosted by: <@${session.hostId}>\n\n🔗 | [Roblox Group](https://www.roblox.com/communities/13827902/Kavi-Cafe#!/about)\n🔗 | [Game Link](https://www.roblox.com/games/109860649571330/Kavi-Cafe)`;
        const sessionButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ses_checkin_${session._id}`).setLabel('✅ Check In').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`ses_requestcohost_${session._id}`).setLabel('🤝 Request Co-Host').setStyle(ButtonStyle.Primary)
        );
        const msg = await announcementChannel.send({ content: announcementContent, components: [sessionButtons] });
        const autoDeleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await Session.findByIdAndUpdate(session._id, { announcementMessageId: msg.id, announcementChannelId: ANNOUNCEMENT_CHANNEL_ID, sessionStarted: true, status: 'active', autoDeleteAt });
        scheduleAutoDelete(session._id, msg.id, 24 * 60 * 60 * 1000);
    } catch (err) { console.error('Error posting announcement:', err); }
}

async function sendFinishCheck(sessionId) {
    try {
        const latestSession = await Session.findById(sessionId);
        if (!latestSession || latestSession.status === 'finished' || latestSession.status === 'cancelled') return;
        const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ses_finished_${sessionId}`).setLabel('✅ Yes, session is finished').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`ses_notfinished_${sessionId}`).setLabel('❌ No, still going').setStyle(ButtonStyle.Danger)
        );
        if (requestChannel?.isTextBased()) {
            await requestChannel.send({
                content: `<@${latestSession.hostId}>`,
                embeds: [new EmbedBuilder().setTitle('🏁 Is your session finished?').setDescription(`<@${latestSession.hostId}>, it's been 25 minutes since your **${latestSession.shiftType}** started. Is it finished?\n\n*Only you can click these buttons.*`).setColor(0x3498DB).setTimestamp()],
                components: [row]
            });
        }
    } catch (err) { console.error('Error sending finish check:', err); }
}

function scheduleAutoDelete(sessionId, messageId, delay) {
    const MAX_TIMEOUT = 2147483647;
    if (delay > MAX_TIMEOUT) { setTimeout(() => scheduleAutoDelete(sessionId, messageId, delay - MAX_TIMEOUT), MAX_TIMEOUT); return; }
    setTimeout(async () => {
        try {
            const latestSession = await Session.findById(sessionId);
            if (!latestSession || latestSession.status === 'finished' || latestSession.status === 'cancelled') return;
            const announcementGuild = await client.guilds.fetch(ANNOUNCEMENT_GUILD_ID);
            const announcementChannel = await announcementGuild.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
            const msg = await announcementChannel.messages.fetch(messageId).catch(() => null);
            if (msg) await msg.delete().catch(() => {});
            await Session.findByIdAndUpdate(sessionId, { status: 'finished' });
        } catch (err) { console.error('Error auto deleting announcement:', err); }
    }, delay);
}

async function restoreSessions() {
    try {
        const sessions = await Session.find({ status: { $in: ['approved', 'active'] } });
        for (const session of sessions) {
            if (session.status === 'approved') {
                const fireAt = new Date(session.sessionFireAt).getTime();
                if (fireAt > Date.now()) await scheduleSession(session);
            }
            if (session.status === 'active' && session.announcementMessageId) {
                const timeLeft = new Date(session.autoDeleteAt).getTime() - Date.now();
                if (timeLeft > 0) scheduleAutoDelete(session._id, session.announcementMessageId, timeLeft);
                const finishCheckDelay = new Date(session.sessionFireAt).getTime() + 25 * 60 * 1000 - Date.now();
                if (finishCheckDelay > 0) setTimeout(async () => { await sendFinishCheck(session._id); }, finishCheckDelay);
            }
        }
        console.log(`✅ Restored ${sessions.length} active sessions`);
    } catch (err) { console.error('Error restoring sessions:', err); }
}

async function cleanupStaleSessions() {
    try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const staleSessions = await Session.find({ status: { $in: ['pending', 'approved', 'active'] }, createdAt: { $lt: cutoff } });
        for (const session of staleSessions) {
            if (session.announcementMessageId) {
                try {
                    const announcementGuild = await client.guilds.fetch(ANNOUNCEMENT_GUILD_ID);
                    const announcementChannel = await announcementGuild.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
                    const msg = await announcementChannel.messages.fetch(session.announcementMessageId).catch(() => null);
                    if (msg) await msg.delete().catch(() => {});
                } catch {}
            }
            await Session.findByIdAndUpdate(session._id, { status: 'finished' });
        }
        if (staleSessions.length > 0) console.log(`✅ Cleaned up ${staleSessions.length} stale sessions`);
    } catch (err) { console.error('Error cleaning up stale sessions:', err); }
}

async function restoreLOAs() {
    try {
        const activeLOAs = await LOA.find({ status: 'approved', returnReminderSent: false });
        for (const loa of activeLOAs) scheduleLOAReturnReminder(loa, client);
        console.log(`✅ Restored ${activeLOAs.length} active LOAs`);
    } catch (err) { console.error('Error restoring LOAs:', err); }
}

async function restoreTicketInactivity() {
    try {
        const activeTickets = await Ticket.find({ status: { $in: ['open', 'claimed'] } });
        for (const ticket of activeTickets) {
            try {
                const guild = await client.guilds.fetch(ticket.serverId).catch(() => null);
                if (!guild) continue;
                scheduleTicketInactivity(ticket, guild);
            } catch {}
        }
        console.log(`✅ Restored inactivity timers for ${activeTickets.length} tickets`);
    } catch (err) { console.error('Error restoring ticket inactivity timers:', err); }
}
async function checkBirthdays() {
    try {
        const { BIRTHDAY_CHANNEL_ID, BIRTHDAY_GUILD_ID } = require('./commands/birthday');
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentDay = now.getDate();
        const currentYear = now.getFullYear();

        const matches = await Birthday.find({ month: currentMonth, day: currentDay });
        if (matches.length === 0) return;

        const guild = await client.guilds.fetch(BIRTHDAY_GUILD_ID).catch(() => null);
        if (!guild) return;
        const channel = await guild.channels.fetch(BIRTHDAY_CHANNEL_ID).catch(() => null);
        if (!channel?.isTextBased()) return;

        for (const record of matches) {
            if (record.lastAnnouncedYear === currentYear) continue;
            try {
                await channel.send({
                    content: `🎉 <@${record._id}>`,
                    embeds: [new EmbedBuilder()
                        .setTitle('🎂 Happy Birthday!')
                        .setDescription(`Everyone wish <@${record._id}> a very **Happy Birthday**! 🎉🎈\n\nWe hope you have an amazing day!`)
                        .setColor(0xF39C12)
                        .setTimestamp()
                    ]
                });
                await Birthday.findByIdAndUpdate(record._id, { lastAnnouncedYear: currentYear });
            } catch (err) { console.error(`Error announcing birthday for ${record._id}:`, err); }
        }
    } catch (err) { console.error('Error checking birthdays:', err); }
}


// ========== ROBLOX GROUP TRACKER ==========
async function getRobloxGroupCount() {
    try {
        const res = await fetch(`https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}`);
        const data = await res.json();
        return data.memberCount || null;
    } catch (err) { console.error('Error fetching Roblox group count:', err); return null; }
}

async function checkRobloxGroupCount(client) {
    try {
        const currentCount = await getRobloxGroupCount();
        if (!currentCount || currentCount === lastRobloxMemberCount) return;
        const gained = currentCount > lastRobloxMemberCount;
        const diff = Math.abs(currentCount - lastRobloxMemberCount);
        const awayFromGoal = Math.abs(robloxMemberGoal - currentCount);
        const channel = await client.channels.fetch(ROBLOX_COUNT_CHANNEL_ID).catch(() => null);
        if (!channel?.isTextBased()) return;
        if (currentCount >= robloxMemberGoal) {
            await channel.send({ content: `🎉 **We hit ${robloxMemberGoal.toLocaleString()} members in the Roblox group!** Thank you all so much — the new goal is **${(robloxMemberGoal + 1000).toLocaleString()}**! 🎊` });
            robloxMemberGoal += 1000;
        } else {
            const emoji = gained ? '🌟' : '😢';
            const action = gained ? `Kavià Cafe has gained **${diff} new member${diff !== 1 ? 's' : ''}**!` : `Kavià Cafe has lost **${diff} member${diff !== 1 ? 's' : ''}**!`;
            const goalText = `We are now at **${currentCount.toLocaleString()} members**, only **${awayFromGoal.toLocaleString()}** away from our goal of **${robloxMemberGoal.toLocaleString()} members**.`;
            await channel.send({ content: `${emoji} ${action} ${goalText}` });
        }
        lastRobloxMemberCount = currentCount;
    } catch (err) { console.error('Error checking Roblox group count:', err); }
}

// ========== MOD REPORT ==========
function getWeekStart() {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = now.getUTCDate() - day;
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff, 0, 0, 0, 0));
}

async function postWeeklyStats(client) {
    try {
        const channel = await client.channels.fetch(WEEKLY_STATS_CHANNEL_ID).catch(() => null);
        if (!channel?.isTextBased()) return;

        const guild = await client.guilds.fetch(MOD_REPORT_GUILD_ID).catch(() => null);
        if (!guild) return;
        await guild.members.fetch();

        const weekStart = getWeekStart();
        const lastWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Get current Roblox group count
        const currentRobloxCount = await getRobloxGroupCount() || lastRobloxMemberCount;
        const robloxGainedThisWeek = currentRobloxCount - weekStartRobloxCount;
        const robloxGainedLastWeek = weekStartRobloxCount - lastWeekRobloxCount;
        const robloxDiff = robloxGainedThisWeek - robloxGainedLastWeek;

        // Discord stats
        const discordNetThisWeek = weeklyDiscordJoins - weeklyDiscordLeaves;
        const discordNetLastWeek = lastWeekDiscordJoins - lastWeekDiscordLeaves;
        const discordNetDiff = discordNetThisWeek - discordNetLastWeek;
        const msgDiff = weeklyTotalMessages - lastWeekTotalMessages;

        // Ticket stats
        const { Ticket, Session } = require('./db');
        const ticketsOpened = await Ticket.countDocuments({ serverId: MOD_REPORT_GUILD_ID, createdAt: { $gte: lastWeekStart, $lt: weekStart } });
        const ticketsClosed = await Ticket.countDocuments({ serverId: MOD_REPORT_GUILD_ID, closedAt: { $gte: lastWeekStart, $lt: weekStart } });
        const sessionsHosted = await Session.countDocuments({ status: { $in: ['finished', 'active'] }, createdAt: { $gte: lastWeekStart, $lt: weekStart } });

        // Active LOAs
        const { LOA } = require('./db');
        const activeLOAs = await LOA.countDocuments({ status: 'approved' });

        // Most active staff member
        const { MessageLog } = require('./db');
        const topLog = await MessageLog.findOne({ guildId: MOD_REPORT_GUILD_ID }).sort({ weeklyCount: -1 });
        const topStaff = topLog && topLog.weeklyCount > 0 ? `<@${topLog.userId}> (${topLog.weeklyCount} messages)` : 'No activity recorded';

        // Staff message total
        const allLogs = await MessageLog.find({ guildId: MOD_REPORT_GUILD_ID });
        const totalStaffMessages = allLogs.reduce((sum, l) => sum + (l.weeklyCount || 0), 0);
        const totalStaffLastWeek = allLogs.reduce((sum, l) => sum + (l.lastWeekCount || 0), 0);
        const staffMsgDiff = totalStaffMessages - totalStaffLastWeek;

        function arrow(val) { return val > 0 ? '📈' : val < 0 ? '📉' : '➡️'; }
        function sign(val) { return val > 0 ? `+${val}` : `${val}`; }

        const statsEmbed = new EmbedBuilder()
            .setTitle('📊 Weekly Stats Report')
            .setDescription(`Week of **<t:${Math.floor(lastWeekStart.getTime() / 1000)}:D>** — **<t:${Math.floor(weekStart.getTime() / 1000)}:D>**`)
            .setColor(0x5865F2)
            .addFields(
                { name: '🎮 Roblox Group', value:
                    `Members This Week: **${robloxGainedThisWeek >= 0 ? '+' : ''}${robloxGainedThisWeek}** ${arrow(robloxGainedThisWeek)}
` +
                    `Last Week: **${robloxGainedLastWeek >= 0 ? '+' : ''}${robloxGainedLastWeek}**
` +
                    `Change vs Last Week: **${sign(robloxDiff)}** ${arrow(robloxDiff)}
` +
                    `Total Members: **${currentRobloxCount.toLocaleString()}** / Goal: **${robloxMemberGoal.toLocaleString()}**`,
                    inline: false },
                { name: '💬 Discord Server', value:
                    `Joins This Week: **${weeklyDiscordJoins}** | Leaves: **${weeklyDiscordLeaves}** | Net: **${sign(discordNetThisWeek)}** ${arrow(discordNetThisWeek)}
` +
                    `Last Week Net: **${sign(discordNetLastWeek)}**
` +
                    `Change vs Last Week: **${sign(discordNetDiff)}** ${arrow(discordNetDiff)}
` +
                    `Total Server Messages: **${weeklyTotalMessages.toLocaleString()}** (Last week: **${lastWeekTotalMessages.toLocaleString()}**, **${sign(msgDiff)}** ${arrow(msgDiff)})`,
                    inline: false },
                { name: '👮 Staff Activity', value:
                    `Total Staff Messages: **${totalStaffMessages}** (Last week: **${totalStaffLastWeek}**, **${sign(staffMsgDiff)}** ${arrow(staffMsgDiff)})
` +
                    `🏆 Most Active: ${topStaff}
` +
                    `Sessions Hosted: **${sessionsHosted}**
` +
                    `Active LOAs: **${activeLOAs}**`,
                    inline: false },
                { name: '🎫 Tickets', value:
                    `Opened This Week: **${ticketsOpened}**
` +
                    `Closed This Week: **${ticketsClosed}**`,
                    inline: false }
            )
            .setFooter({ text: 'Kavià Café • Weekly Stats Report' })
            .setTimestamp();

        await channel.send({ embeds: [statsEmbed] });

        // Reset weekly counters
        lastWeekDiscordJoins = weeklyDiscordJoins;
        lastWeekDiscordLeaves = weeklyDiscordLeaves;
        lastWeekTotalMessages = weeklyTotalMessages;
        lastWeekRobloxCount = weekStartRobloxCount;
        weekStartRobloxCount = currentRobloxCount;
        weeklyDiscordJoins = 0;
        weeklyDiscordLeaves = 0;
        weeklyTotalMessages = 0;

        console.log('✅ Weekly stats posted');
    } catch (err) { console.error('Error posting weekly stats:', err); }
}

async function postModReport(client) {
    try {
        const guild = await client.guilds.fetch(MOD_REPORT_GUILD_ID).catch(() => null);
        if (!guild) return;
        await guild.members.fetch();
        const staffMembers = guild.members.cache.filter(m => m.roles.cache.has(STAFF_ROLE_ID));
        const channel = await client.channels.fetch(MOD_REPORT_CHANNEL_ID).catch(() => null);
        if (!channel?.isTextBased()) return;
        const weekStart = getWeekStart();
        const lastWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

        await channel.send({ embeds: [new EmbedBuilder()
            .setTitle('📋 SHR Weekly Report')
            .setDescription(`Week of **<t:${Math.floor(lastWeekStart.getTime() / 1000)}:D>** — **<t:${Math.floor(weekStart.getTime() / 1000)}:D>**`)
            .setColor(0x9B59B6)
            .setTimestamp()
            .setFooter({ text: 'Kavià Café • SHR Weekly Report' })
        ]});

        const { MessageLog } = require('./db');
        const sorted = [...staffMembers.values()].sort((a, b) => a.user.username.localeCompare(b.user.username));
        for (const member of sorted) {
            const log = await MessageLog.findOne({ userId: member.id, guildId: MOD_REPORT_GUILD_ID });
            const weekly = log?.weeklyCount || 0;
            const lastWeek = log?.lastWeekCount || 0;
            const allTime = log?.allTimeCount || 0;
            const lastActive = log?.lastActiveAt;
            const isActive = weekly > 0;
            const embed = new EmbedBuilder()
                .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
                .setColor(isActive ? 0x2ECC71 : 0xE74C3C)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: isActive ? '✅ Active this week' : '❌ Inactive this week', value: '\u200B', inline: false },
                    { name: '💬 Messages', value: `This Week: **${weekly}**\nLast Week: **${lastWeek}**\nAll Time: **${allTime}**`, inline: true },
                    { name: '🕐 Activity', value: lastActive ? `Last Active: <t:${Math.floor(new Date(lastActive).getTime() / 1000)}:R>` : 'No activity recorded', inline: true }
                ).setTimestamp();
            await channel.send({ embeds: [embed] });
            await new Promise(r => setTimeout(r, 500));
        }

        await MessageLog.updateMany({ guildId: MOD_REPORT_GUILD_ID }, [{ $set: { lastWeekCount: '$weeklyCount', weeklyCount: 0, weekStartDate: weekStart } }]);
        console.log('✅ SHR report posted');
    } catch (err) { console.error('Error posting SHR report:', err); }
}

function scheduleWeeklyReport(client) {
    const now = new Date();
    const nextSunday = new Date();
    nextSunday.setUTCDate(now.getUTCDate() + ((7 - now.getUTCDay()) % 7 || 7));
    nextSunday.setUTCHours(14, 0, 0, 0); // 9AM EST = 2PM UTC
    const delay = nextSunday.getTime() - now.getTime();
    setTimeout(async () => {
        await postWeeklyStats(client);
        await postModReport(client);
        setInterval(async () => {
            await postWeeklyStats(client);
            await postModReport(client);
        }, 7 * 24 * 60 * 60 * 1000);
    }, delay);
    console.log(`✅ Weekly reports scheduled for ${nextSunday.toISOString()}`);
}

// ========== ALLIANCE SYNC ==========
async function syncAllianceRole(client) {
    try {
        const mainGuild = await client.guilds.fetch(MOD_REPORT_GUILD_ID).catch(() => null);
        const allianceGuild = await client.guilds.fetch(ALLIANCE_SERVER_ID).catch(() => null);
        if (!mainGuild || !allianceGuild) return;
        await mainGuild.members.fetch();
        await allianceGuild.members.fetch();
        const allianceMembers = new Set(allianceGuild.members.cache.keys());
        for (const member of mainGuild.members.cache.values()) {
            if (member.user.bot) continue;
            const hasRole = member.roles.cache.has(ALLIANCE_ROLE_ID);
            const inAlliance = allianceMembers.has(member.id);
            if (inAlliance && !hasRole) await member.roles.add(ALLIANCE_ROLE_ID).catch(() => {});
            else if (!inAlliance && hasRole) await member.roles.remove(ALLIANCE_ROLE_ID).catch(() => {});
        }
        console.log('✅ Alliance role sync complete');
    } catch (err) { console.error('Error syncing alliance roles:', err); }
}


// ========== STAFF SERVER LOA LOG CHANNEL MAP ==========
const STAFF_SERVER_ID = '1372680943592280217';
const STAFF_SERVER_LOA_LOG_MAP = {
    'SHR': '1547717995282038784',
    'MR Member': '1547718152035631164',
    'HR Member': '1547718152035631164',
    'Human Resources': '1547718174777024524',
    'Ownership': '1547394717116010566',
    'Presidential Team': '1547394717116010566',
};

function getLoaLogChannelId(department, deptConfig, guildId) {
    // For the staff server, use the specific per-dept log channels
    if (guildId === STAFF_SERVER_ID && STAFF_SERVER_LOA_LOG_MAP[department]) {
        return STAFF_SERVER_LOA_LOG_MAP[department];
    }
    // For all other servers, use the dept config loaLogChannelId
    return deptConfig?.loaLogChannelId || null;
}


// ========== WEEKLY STATS PERSISTENCE ==========
async function restoreWeeklyStats() {
    try {
        const saved = await WeeklyStats.findById('singleton');
        if (saved) {
            weeklyDiscordJoins = saved.weeklyDiscordJoins || 0;
            weeklyDiscordLeaves = saved.weeklyDiscordLeaves || 0;
            lastWeekDiscordJoins = saved.lastWeekDiscordJoins || 0;
            lastWeekDiscordLeaves = saved.lastWeekDiscordLeaves || 0;
            weeklyTotalMessages = saved.weeklyTotalMessages || 0;
            lastWeekTotalMessages = saved.lastWeekTotalMessages || 0;
            lastWeekRobloxCount = saved.lastWeekRobloxCount || 3947;
            weekStartRobloxCount = saved.weekStartRobloxCount || 3947;
            console.log('✅ Restored weekly stats from DB');
        } else {
            console.log('✅ No saved weekly stats, starting fresh');
        }
    } catch (err) { console.error('Error restoring weekly stats:', err); }
}

async function saveWeeklyStats() {
    try {
        await WeeklyStats.findByIdAndUpdate('singleton', {
            weeklyDiscordJoins, weeklyDiscordLeaves,
            lastWeekDiscordJoins, lastWeekDiscordLeaves,
            weeklyTotalMessages, lastWeekTotalMessages,
            lastWeekRobloxCount, weekStartRobloxCount,
            updatedAt: new Date()
        }, { upsert: true });
    } catch (err) { console.error('Error saving weekly stats:', err); }
}

// ========== TRAINING HELPERS ==========
async function sendNextSection(userId, session) {
    const { trainingConfig, section, department, training } = session;
    const sections = trainingConfig.sections;
    const isAgeVerif = training === 'Intro to Mentorship' && section === 1;
    const embed = getSectionEmbed(sections[section], section, sections.length, department, training);
    const user = await client.users.fetch(userId);
    if (isAgeVerif) {
        await user.send({ embeds: [embed] });
        session.awaitingAgeVerif = true;
        scheduleAgeVerifReping(userId, session);
    } else {
        const buttons = getSectionButtons(userId, section);
        await user.send({ embeds: [embed], components: [buttons] });
    }
}

function scheduleAgeVerifReping(userId, session) {
    if (session.ageVerifRepingTimeout) clearTimeout(session.ageVerifRepingTimeout);
    session.ageVerifRepingTimeout = setTimeout(async () => {
        try {
            const currentSession = activeSessions.get(userId);
            if (!currentSession || !currentSession.awaitingAgeVerif) return;
            const logChannel = await client.channels.fetch(session.deptConfig.logChannelId);
            if (logChannel?.isTextBased()) {
                await logChannel.send({
                    content: `<@&${session.deptConfig.pingRoleId}> ⚠️ Reminder: Age verification for **${userId}** has not been reviewed in 12 hours!`,
                    embeds: [new EmbedBuilder().setTitle('⏰ Age Verification Reminder').setColor(0xF39C12).addFields(
                        { name: '👤 Trainee', value: `<@${userId}> (${userId})` },
                        { name: '🏢 Department', value: session.department },
                        { name: '📖 Training', value: session.training },
                        { name: '📝 Last Submission', value: session.lastAgeVerifContent || 'No submission yet' }
                    ).setTimestamp()]
                });
            }
            scheduleAgeVerifReping(userId, session);
        } catch (err) { console.error('Error sending age verif reping:', err); }
    }, 12 * 60 * 60 * 1000);
}

async function startQuiz(userId, session) {
    const user = await client.users.fetch(userId);
    session.phase = 'quiz';
    session.quizIndex = 0;
    session.score = 0;
    await user.send({ embeds: [new EmbedBuilder().setTitle('📝 Quiz Time!').setDescription(`You've completed all sections! Now it's time for your quiz.\n\nYou need **${session.trainingConfig.passScore}/${session.trainingConfig.quiz.length}** to pass.\n\n**Good luck!**`).setColor(0x9B59B6).setTimestamp()] });
    setTimeout(async () => {
        const q = session.trainingConfig.quiz[0];
        const embed = getQuizEmbed(q, 0, 0, session.trainingConfig.quiz.length, session.department, session.training);
        const buttons = getQuizButtons(userId, 0, q);
        await user.send({ embeds: [embed], components: [buttons] });
    }, 2000);
}

async function sendQuizResults(userId, session) {
    const passed = session.score >= session.trainingConfig.passScore;
    const logChannel = await client.channels.fetch(session.deptConfig.logChannelId);
    if (logChannel?.isTextBased()) {
        const resultRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`st_pass_${userId}`).setLabel('✅ Pass').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`st_fail_${userId}`).setLabel('❌ Fail').setStyle(ButtonStyle.Danger)
        );
        await logChannel.send({
            content: `<@&${session.deptConfig.pingRoleId}>`,
            embeds: [new EmbedBuilder().setTitle('📝 Training Quiz Results').setColor(passed ? 0x2ECC71 : 0xE74C3C).addFields(
                { name: '👤 Trainee', value: `<@${userId}> (${userId})` },
                { name: '🏢 Department', value: session.department },
                { name: '📖 Training', value: session.training },
                { name: '👮 Trained By', value: `<@${session.staffId}> (${session.staffTag})` },
                { name: '📊 Score', value: `${session.score}/${session.trainingConfig.quiz.length}` },
                { name: '🎯 Pass Requirement', value: `${session.trainingConfig.passScore}/${session.trainingConfig.quiz.length}` },
                { name: '🏆 Suggested Result', value: passed ? '✅ Pass' : '❌ Fail' }
            ).setTimestamp()],
            components: [resultRow]
        });
    }
}

// ========== INTERACTION HANDLER ==========
client.on('interactionCreate', async interaction => {

    if (interaction.isChatInputCommand()) {
        // Built-in commands
        if (interaction.commandName === 'weeklystats') {
            if (!await hasBotPermsRole(interaction.guildId, interaction.user.id)) {
                return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
            }
            await interaction.reply({ content: '📊 Posting weekly stats...', flags: 64 });
            await postWeeklyStats(client);
            await postModReport(client);
            return;
        }

        if (interaction.commandName === 'loalist') {
            await interaction.deferReply({ flags: 64 });
            try {
                const activeLOAs = await LOA.find({ status: { $in: ['approved', 'extended'] } }).sort({ returnDateParsed: 1 });
                if (activeLOAs.length === 0) return interaction.editReply({ content: '✅ No active LOAs right now!' });
                const lines = activeLOAs.map(l => `• <@${l.userId}> — **${l.department}** — Returns: **${l.returnDate}**`);
                const chunks = [];
                let current = '';
                for (const line of lines) {
                    if ((current + line).length > 3800) { chunks.push(current); current = ''; }
                    current += line + '\n';
                }
                if (current) chunks.push(current);
                for (let i = 0; i < chunks.length; i++) {
                    const embed = new EmbedBuilder()
                        .setTitle(i === 0 ? `📋 Active LOAs (${activeLOAs.length})` : '📋 Active LOAs (continued)')
                        .setDescription(chunks[i])
                        .setColor(0x3498DB)
                        .setFooter({ text: 'Kavià Café • LOA System' })
                        .setTimestamp();
                    if (i === 0) await interaction.editReply({ embeds: [embed] });
                    else await interaction.followUp({ embeds: [embed], flags: 64 });
                }
            } catch (err) { console.error('Error in /loalist:', err); try { await interaction.editReply({ content: '❌ Error fetching LOAs.' }); } catch {} }
            return;
        }

        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        try {
            // Pre-emptively defer for slash commands that do DB work,
            // so Discord's 3-second window is met before any async work starts.
            // Commands that reply/update themselves (setup, open) are excluded.
            if (interaction.isChatInputCommand()) {
                const DEFER_COMMANDS = {
                    application: ['list', 'close', 'delete', 'statusboard'],
                    giveaway: ['reroll'],
                };
                const sub = interaction.options.getSubcommand(false);
                const deferSubs = DEFER_COMMANDS[interaction.commandName];
                if (deferSubs && sub && deferSubs.includes(sub) && !interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ flags: 64 });
                }
            }
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`❌ Command error [/${interaction.commandName}]`, error);
            if (!interaction.replied && !interaction.deferred) {
                try { await interaction.reply({ content: `❌ Error running command.`, flags: 64 }); } catch {}
            }
        }
        return;
    }

    if (interaction.isUserSelectMenu()) {
        if (interaction.customId.startsWith('ticket_adduser_select_')) {
            const caseId = interaction.customId.replace('ticket_adduser_select_', '');
            await interaction.deferUpdate().catch(() => {});
            try {
                const userId = interaction.values[0];
                const user = await client.users.fetch(userId).catch(() => null);
                if (!user) return interaction.editReply({ content: '❌ User not found.', components: [] });
                const ticket = await Ticket.findOne({ caseId });
                if (!ticket) return interaction.editReply({ content: '❌ Ticket not found.', components: [] });
                const guild = await client.guilds.fetch(ticket.serverId);
                const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
                if (!channel) return interaction.editReply({ content: '❌ Ticket channel not found.', components: [] });
                await channel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
await channel.send({ embeds: [new EmbedBuilder().setDescription(`➕ **${interaction.user.tag}** added **${user.tag}** to the ticket.`).setColor(0x5865F2).setImage('https://cdn.discordapp.com/attachments/620024668673409069/1521631074411741345/1l8kJYAAAAGSURBVAMAhvT074z4gtUAAAAASUVORK5CYII.png?ex=6a4588de&is=6a44375e&hm=787ab7932789b4dd0c002c6764fa5a0f5a11b9fa172472b73ffd3149ae3d5e12&').setTimestamp()] });
                await interaction.editReply({ content: `✅ **${user.tag}** has been added to the ticket!`, components: [] });
            } catch (err) {
                console.error('Error adding user to ticket:', err);
                try { await interaction.editReply({ content: '❌ Error adding user.', components: [] }); } catch {}
            }
            return;
        }
        return;
    }

    if (interaction.isStringSelectMenu()) {
        // ========== APPLICATION SETUP DROPDOWNS ==========
        if (interaction.customId.startsWith('appsetup_')) {
            await require('./commands/application').handleSetupSelect(interaction);
            return;
        }

        // ========== APPLICATION OPEN DROPDOWNS ==========
        if (interaction.customId.startsWith('appopen_')) {
            await require('./commands/application').handleOpenSelect(interaction);
            return;
        }

        // ========== APPLICATION CLOSE DROPDOWN ==========
        if (interaction.customId.startsWith('appclose_form_')) {
            await require('./commands/application').handleCloseSelect(interaction);
            return;
        }

        // ========== APPLICATION SEND — form picker dropdown ==========
        if (interaction.customId.startsWith('appsend_pick_')) {
            await require('./commands/application').handleSendPick(interaction);
            return;
        }

        if (interaction.customId.startsWith('loa_selectdept_')) {
            const logChannelId = interaction.customId.replace('loa_selectdept_', '');
            const department = interaction.values[0];
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
            const modal = new ModalBuilder()
                .setCustomId(`loa_formmodal_${department}_${logChannelId}`)
                .setTitle('Leave of Absence Request');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('Reason for your LOA')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('e.g. Family vacation, medical leave, school exams...')
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('timegone')
                        .setLabel('How long will you be gone?')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g. 1 week, 2 weeks, 10 days')
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('startdate')
                        .setLabel('Start date (DD/MM/YY)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g. 20/04/26')
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('returndate')
                        .setLabel('End / Return date (DD/MM/YY)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g. 25/04/26')
                        .setRequired(true)
                )
            );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('ticket_open_')) {
            const category = interaction.values[0];
            const guildId = interaction.customId.replace('ticket_open_', '');
            const modal = new ModalBuilder()
                .setCustomId(`ticket_reason_${category}_${guildId}`)
                .setTitle('Open a Ticket');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('What do you need help with?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Please describe your issue as accurately as possible...')
                    .setRequired(true)
            ));
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('ts_selecteditcat_')) {
            const panelId = interaction.customId.replace('ts_selecteditcat_', '');
            const panel = await TicketPanel.findById(panelId);
            if (!panel) return interaction.reply({ content: '❌ Panel not found.', flags: 64 });
            const index = parseInt(interaction.values[0]);
            const cat = panel.categories[index];
            const currentRoleIds = cat.pingRoleIds?.length > 0 ? cat.pingRoleIds.join(', ') : cat.pingRoleId || '';
            const modal = new ModalBuilder().setCustomId(`ts_editcatmodal_${panelId}_${index}`).setTitle('Edit Category');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Category Name').setStyle(TextInputStyle.Short).setRequired(true).setValue(cat.name)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(cat.emoji || '')),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(cat.description || '')),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pingroles').setLabel('Ping Role IDs (comma separated)').setStyle(TextInputStyle.Short).setRequired(true).setValue(currentRoleIds).setPlaceholder('e.g. 123456789, 987654321'))
            );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('ts_selectremovecat_')) {
            const panelId = interaction.customId.replace('ts_selectremovecat_', '');
            const panel = await TicketPanel.findById(panelId);
            if (!panel) return interaction.reply({ content: '❌ Panel not found.', flags: 64 });
            const index = parseInt(interaction.values[0]);
            const removed = panel.categories[index];
            panel.categories.splice(index, 1);
            await TicketPanel.findByIdAndUpdate(panelId, { categories: panel.categories });
            const guild = await client.guilds.fetch(panel.serverId);
            const { rebuildAndUpdatePanel } = require('./commands/ticketsetup');
            await rebuildAndUpdatePanel(panel, guild, client);
            await interaction.update({ content: `✅ Removed category **${removed.name}** and updated the panel!`, components: [], embeds: [] });
            return;
        }

        if (interaction.customId.startsWith('changerank_select_')) {
            const parts = interaction.customId.replace('changerank_select_', '').split('_');
            const robloxId = parts[0];
            const groupId = parts.slice(1).join('_');
            const context = client.rankChangeContext?.get(`${robloxId}_${groupId}`);
            if (!context) return interaction.reply({ content: '❌ This selection has expired.', flags: 64 });
            await interaction.deferUpdate().catch(() => {});
            const selectedRoleId = interaction.values[0];
            const { setRank, getGroupRanks } = require('./commands/roblox');
            const allRanks = await getGroupRanks(groupId);
            const selectedRole = allRanks.find(r => String(r.id) === selectedRoleId);
            if (!selectedRole) return interaction.editReply({ content: '❌ Could not find that rank.', components: [], embeds: [] });
            const success = await setRank(groupId, context.robloxId, selectedRoleId);
            if (!success) return interaction.editReply({ content: '❌ Failed to change rank.', components: [], embeds: [] });
            if (context.discordUser) {
                try { await context.discordUser.send({ content: `# <:kaviacafe:1387492814916685845> **Rank Change Notice**\nHello, ${context.discordUser},\nYour rank in the **Kavià Café** Roblox group has been updated.\n> <:pink_pin:1166850035611353148> **Old Rank →** *${context.currentRole?.name || 'Unknown'}*\n> <:pink_pin:1166850035611353148> **New Rank →** *${selectedRole.name}*\n> <:pink_pin:1166850035611353148> **Reason →** *${context.reason}*\n***Signed,***\n**${context.staffUser.username} || ${context.department}**` }); } catch {}
            }
            const logEmbed = new EmbedBuilder().setTitle('🔄 Rank Changed').setColor(0x3498DB).setThumbnail(context.avatarUrl).addFields(
                { name: '🎮 Roblox Username', value: context.robloxUsername, inline: true },
                { name: '👤 Discord User', value: context.discordUser ? `${context.discordUser.tag}` : 'Not provided', inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '⬅️ Old Rank', value: context.currentRole?.name || 'Unknown', inline: true },
                { name: '➡️ New Rank', value: selectedRole.name, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '📝 Reason', value: context.reason },
                { name: '🏢 Department', value: context.department, inline: true },
                { name: '👮 Actioned By', value: context.staffUser.tag, inline: true },
                { name: '💬 DM Sent', value: context.discordUser ? 'Yes' : 'No', inline: true }
            ).setFooter({ text: 'Kavià Café • Ranking System' }).setTimestamp();
            const logChannel = await client.channels.fetch(process.env.RANKING_LOG_CHANNEL);
            if (logChannel?.isTextBased()) await logChannel.send({ embeds: [logEmbed] });
            client.rankChangeContext?.delete(`${robloxId}_${groupId}`);
            const replyEmbed = new EmbedBuilder().setTitle('✅ Rank Changed Successfully').setColor(0x3498DB).setThumbnail(context.avatarUrl).addFields(
                { name: '🎮 Roblox User', value: context.robloxUsername, inline: true },
                { name: '⬅️ Old Rank', value: context.currentRole?.name || 'Unknown', inline: true },
                { name: '➡️ New Rank', value: selectedRole.name, inline: true }
            ).setFooter({ text: 'Kavià Café • Ranking System' }).setTimestamp();
            await interaction.editReply({ embeds: [replyEmbed], components: [] });
            return;
        }
        return;
    }

    if (interaction.isButton()) { try {

        const handled = await handleRankButton(interaction, client);
        if (handled) return;

        // ========== APPLICATION SETUP — manual channel ID buttons ==========
        if (interaction.customId.startsWith('appsetup_logchannel_manual_') ||
            interaction.customId.startsWith('appsetup_ticketchannel_manual_') ||
            interaction.customId.startsWith('appsetup_notifyrole_manual_') ||
            interaction.customId.startsWith('appsetup_notifyrole_skip_')) {
            await require('./commands/application').handleSetupSelect(interaction);
            return;
        }

        // ========== APPLICATION SETUP — "Add Questions" button after details modal ==========
        if (interaction.customId.startsWith('appsetup_startquestions_')) {
            await require('./commands/application').handleSetupSelect(interaction);
            return;
        }

        // ========== APPLICATION SETUP — add more questions / done / save-link buttons ==========
        if (interaction.customId.startsWith('appsetup_addmore_') ||
            interaction.customId.startsWith('appsetup_savequestions_') ||
            interaction.customId.startsWith('appsetup_savelink_')) {
            await require('./commands/application').handleSetupQuestionsButton(interaction);
            return;
        }

        // ========== APPLICATION OPEN — manual channel ID button / attach button ==========
        if (interaction.customId.startsWith('appopen_channel_manual_') ||
            interaction.customId.startsWith('appopen_attach_')) {
            await require('./commands/application').handleOpenSelect(interaction);
            return;
        }

        // ========== APPLICATION SETUP — "Continue Form Details" button (after notify role modal) ==========
        if (interaction.customId.startsWith('appsetup_opendetails_')) {
            await require('./commands/application').handleSetupSelect(interaction);
            return;
        }

        // ========== PR TICKET — alliance Yes/No (initial) ==========
        if (interaction.customId.startsWith('ticket_pr_alliance_yes_')) {
            const caseId = interaction.customId.replace('ticket_pr_alliance_yes_', '');
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('🤝 Alliance Requirements')
                    .setDescription(
                        `To apply for an alliance with **Kavià Café**, your group must meet the following requirements:\n\n` +
                        `> **Discord Members:** 200+ (non-botted)\n` +
                        `> **Roblox Community Members:** 150+ (non-botted)\n` +
                        `> **Announcements:** Must be able to post announcements\n\n` +
                        `*Exceptions may be made at staff discretion.*\n\n` +
                        `Do you meet these requirements?`
                    )
                ],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_pr_alliance_meets_${caseId}`)
                        .setLabel('✅ I meet the requirements')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`ticket_pr_alliance_nomeet_${caseId}`)
                        .setLabel('❌ I don\'t meet the requirements')
                        .setStyle(ButtonStyle.Danger)
                )]
            });
            return;
        }

        if (interaction.customId.startsWith('ticket_pr_alliance_no_')) {
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('📋 Public Relations Ticket')
                    .setDescription('No problem! Someone from our team will be with you shortly.')
                ],
                components: []
            });
            return;
        }

        // ── Alliance: meets requirements → post the application form directly ──
        if (interaction.customId.startsWith('ticket_pr_alliance_meets_')) {
            await interaction.deferUpdate().catch(() => {});
            try {
                const { AppForm } = require('./db');
                const form = await AppForm.findOne({ name: /kavià cafe alliance requests/i }).catch(() => null);

                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle('✅ Great! Here\'s the application form')
                        .setDescription('Click the button below to start your alliance application. Make sure your DMs are open!')
                    ],
                    components: form ? [new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`app_apply_${String(form._id)}`)
                            .setLabel('Apply Now 📝')
                            .setStyle(ButtonStyle.Primary)
                    )] : []
                });

                if (!form) {
                    await interaction.channel.send({ content: '⚠️ Staff: the alliance application form hasn\'t been set up yet. Use `/application send` to drop it in manually.' });
                }
            } catch (err) {
                console.error('[alliance meets handler error]', err);
            }
            return;
        }

        // ── Alliance: doesn't meet requirements → exemption or close ──
        if (interaction.customId.startsWith('ticket_pr_alliance_nomeet_')) {
            const caseId = interaction.customId.replace('ticket_pr_alliance_nomeet_', '');
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0xE67E22)
                    .setTitle('⚠️ Requirements Not Met')
                    .setDescription(
                        `No worries! You have two options:\n\n` +
                        `**Apply for an Exemption** — Staff will review your group and may make an exception.\n\n` +
                        `**Close this ticket** — If you\'d like to come back when your group meets the requirements.`
                    )
                ],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_pr_alliance_exempt_${caseId}`)
                        .setLabel('📝 Apply for Exemption')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`ticket_pr_alliance_cancel_${caseId}`)
                        .setLabel('🚪 Never mind, close ticket')
                        .setStyle(ButtonStyle.Secondary)
                )]
            });
            return;
        }

        // ── Alliance: apply for exemption → open info modal flagged ──
        if (interaction.customId.startsWith('ticket_pr_alliance_exempt_')) {
            const caseId = interaction.customId.replace('ticket_pr_alliance_exempt_', '');
            const modal = new ModalBuilder()
                .setCustomId(`ticket_pr_alliance_form_${caseId}_exemption`)
                .setTitle('Alliance Exemption Request');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('discord_invite')
                        .setLabel('Discord Server Invite Link')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('https://discord.gg/...')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('discord_members')
                        .setLabel('Discord Member Count')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('e.g. 80')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('roblox_members')
                        .setLabel('Roblox Community Member Count')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('e.g. 60')
                )
            );
            await interaction.showModal(modal);
            return;
        }

        // ── Alliance: close ticket (user cancelled) ──
        if (interaction.customId.startsWith('ticket_pr_alliance_cancel_')) {
            const caseId = interaction.customId.replace('ticket_pr_alliance_cancel_', '');
            await interaction.update({ embeds: [], components: [], content: '🔒 Closing ticket…' });
            const ticket = await Ticket.findOne({ caseId }).catch(() => null);
            if (ticket) {
                await closeTicket(ticket, interaction.channel, { tag: 'System' }, 'User did not meet alliance requirements');
            }
            return;
        }

        // ========== TICKET SETUP BUTTONS ==========
        if (interaction.customId.startsWith('ts_editpanel_')) {
            const panelId = interaction.customId.replace('ts_editpanel_', '');
            const panel = await TicketPanel.findById(panelId);
            if (!panel) return interaction.reply({ content: '❌ Panel not found.', flags: 64 });
            const modal = new ModalBuilder().setCustomId(`ts_editpanelmodal_${panelId}`).setTitle('Edit Panel');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Panel Title').setStyle(TextInputStyle.Short).setRequired(true).setValue(panel.title)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Panel Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(panel.description))
            );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('ts_addcat_')) {
            const panelId = interaction.customId.replace('ts_addcat_', '');
            const modal = new ModalBuilder().setCustomId(`ts_addcatmodal_${panelId}`).setTitle('Add Category');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Category Name').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. General Support')),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('e.g. 🎫')),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('e.g. For general questions')),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pingroles').setLabel('Ping Role IDs (comma separated)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 123456789, 987654321'))
            );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('ts_editcat_')) {
            const panelId = interaction.customId.replace('ts_editcat_', '');
            const panel = await TicketPanel.findById(panelId);
            if (!panel) return interaction.reply({ content: '❌ Panel not found.', flags: 64 });
            if (panel.categories.length === 0) return interaction.reply({ content: '❌ No categories to edit.', flags: 64 });
            const select = new StringSelectMenuBuilder()
                .setCustomId(`ts_selecteditcat_${panelId}`)
                .setPlaceholder('Select a category to edit...')
                .addOptions(panel.categories.map((c, i) => ({ label: `${i + 1}. ${c.name}`, value: String(i) })));
            await interaction.reply({ content: 'Select which category to edit:', components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
            return;
        }

        if (interaction.customId.startsWith('ts_removecat_')) {
            const panelId = interaction.customId.replace('ts_removecat_', '');
            const panel = await TicketPanel.findById(panelId);
            if (!panel) return interaction.reply({ content: '❌ Panel not found.', flags: 64 });
            if (panel.categories.length === 0) return interaction.reply({ content: '❌ No categories to remove.', flags: 64 });
            const select = new StringSelectMenuBuilder()
                .setCustomId(`ts_selectremovecat_${panelId}`)
                .setPlaceholder('Select a category to remove...')
                .addOptions(panel.categories.map((c, i) => ({ label: `${i + 1}. ${c.name}`, value: String(i) })));
            await interaction.reply({ content: 'Select which category to remove:', components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
            return;
        }

        if (interaction.customId.startsWith('ticket_rate_')) {
            const parts = interaction.customId.split('_');
            const rating = parseInt(parts[2]);
            const caseId = parts[3];
            const staffId = parts[4];
            await interaction.update({ components: [] });
            try {
                const staffUser = await client.users.fetch(staffId);
                const ticket = await Ticket.findOne({ caseId });
                await Review.create({
                    staffId, staffTag: staffUser.tag, reviewerId: interaction.user.id,
                    reviewerTag: interaction.user.tag, rating, ticketCaseId: caseId,
                    serverId: ticket?.serverId || 'dm', createdAt: new Date()
                });
                await interaction.user.send({
                    embeds: [new EmbedBuilder().setTitle('✅ Review Submitted').setDescription(`Thank you for your feedback!\n\nYou rated **${staffUser.tag}** ${'⭐'.repeat(rating)}\n\nYour review has been recorded.`).setColor(0x2ECC71).setFooter({ text: 'Kavià Café • Ticket System' }).setTimestamp()]
                }).catch(() => {});
                if (ticket?.logChannelId) {
                    const logChannel = await client.channels.fetch(ticket.logChannelId).catch(() => null);
                    if (logChannel?.isTextBased()) {
                        await logChannel.send({ embeds: [new EmbedBuilder().setTitle('⭐ Ticket Review Received').setColor(rating >= 4 ? 0x2ECC71 : rating >= 3 ? 0xF39C12 : 0xE74C3C).addFields(
                            { name: '🔖 Case ID', value: `#${caseId}`, inline: true },
                            { name: '⭐ Rating', value: `${'⭐'.repeat(rating)} (${rating}/5)`, inline: true },
                            { name: '👤 Reviewer', value: interaction.user.tag, inline: true },
                            { name: '👮 Staff Rated', value: staffUser.tag, inline: true }
                        ).setFooter({ text: 'Kavià Café • Ticket System' }).setTimestamp()] });
                    }
                }
            } catch (err) { console.error('Error saving review:', err); }
            return;
        }

        if (interaction.customId.startsWith('ticket_claim_')) {
            const caseId = interaction.customId.replace('ticket_claim_', '');
            const ticket = await Ticket.findOne({ caseId });
            if (!ticket) return interaction.reply({ content: '❌ Ticket not found.', flags: 64 });
            if (ticket.claimedBy) return interaction.reply({ content: '❌ This ticket has already been claimed.', flags: 64 });
            if (!await hasTicketStaffRole(interaction.user.id, ticket.serverId, ticket.pingRoleId, ticket.pingRoleIds)) return interaction.reply({ content: '❌ You do not have permission to claim tickets.', flags: 64 });
           await Ticket.findByIdAndUpdate(ticket._id, { claimedBy: interaction.user.id, claimedByTag: interaction.user.tag, status: 'claimed', claimedAt: new Date() });
            if (client.ticketRepingTimeouts.has(caseId)) { clearTimeout(client.ticketRepingTimeouts.get(caseId)); client.ticketRepingTimeouts.delete(caseId); }
            try { await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }); } catch {}
            try { await interaction.channel.setName(`claimed-${interaction.channel.name.replace(/^(claimed-|unclaimed-)/, '')}`); } catch {}
          await interaction.update({
                embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xF39C12).spliceFields(2, 1, { name: '👮 Status', value: `✋ Claimed by ${interaction.user.tag}`, inline: true })],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ticket_close_${caseId}`).setLabel('🔒 Close').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`ticket_unclaim_${caseId}`).setLabel('↩️ Unclaim').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`ticket_adduser_${caseId}`).setLabel('➕ Add User').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`ticket_closerequest_${caseId}`).setLabel('❓ Closure Request').setStyle(ButtonStyle.Secondary)
                )]
            });
await interaction.channel.send({ embeds: [new EmbedBuilder().setDescription(`**${interaction.user.tag}** has claimed this ticket.\n\nYour matters will now be taken care of. However, be patient if you do not always receive an answer immediately.`).setColor(0xF39C12).setImage('https://cdn.discordapp.com/attachments/620024668673409069/1521630860535660637/HUFV2gAAAAZJREFUAwCEeRnGZn7XQAAAAABJRU5ErkJggg.png?ex=6a4588ab&is=6a44372b&hm=0579e25fa42b0aea856d6f235fed5c322a8960c3583cf5bf48e307ce86196b6b&').setTimestamp()] });
            const logChannel = await client.channels.fetch(ticket.logChannelId).catch(() => null);
            if (logChannel?.isTextBased()) await logChannel.send({ embeds: [new EmbedBuilder().setTitle('✅ Ticket Claimed').setColor(0x2ECC71).setDescription(`**Case #${caseId}** has been claimed.`).addFields({ name: '👮 Claimed By', value: interaction.user.tag, inline: true }, { name: '📂 Category', value: ticket.category, inline: true }, { name: '👤 Opened By', value: `<@${ticket.userId}>`, inline: true }, { name: '📅 When', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }).setFooter({ text: `Kavià Café • Ticket System • Case #${caseId}` }).setTimestamp()] });
            return;
        }

        if (interaction.customId.startsWith('ticket_unclaim_')) {
            const caseId = interaction.customId.replace('ticket_unclaim_', '');
            const ticket = await Ticket.findOne({ caseId });
            if (!ticket) return interaction.reply({ content: '❌ Ticket not found.', flags: 64 });
            if (ticket.claimedBy !== interaction.user.id && !await hasTicketStaffRole(interaction.user.id, ticket.serverId, ticket.pingRoleId, ticket.pingRoleIds)) return interaction.reply({ content: '❌ You do not have permission to unclaim this ticket.', flags: 64 });
            await Ticket.findByIdAndUpdate(ticket._id, { claimedBy: null, claimedByTag: null, status: 'open' });
            try { await interaction.channel.permissionOverwrites.delete(interaction.user.id); } catch {}
            try { await interaction.channel.setName(`unclaimed-${interaction.channel.name.replace(/^(claimed-|unclaimed-)/, '')}`); } catch {}
            await interaction.update({
                embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x378ADD).spliceFields(2, 1, { name: '👮 Status', value: '⏳ Unclaimed', inline: true })],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ticket_claim_${caseId}`).setLabel('✋ Claim').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`ticket_close_${caseId}`).setLabel('🔒 Close').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`ticket_adduser_${caseId}`).setLabel('➕ Add User').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`ticket_closerequest_${caseId}`).setLabel('❓ Closure Request').setStyle(ButtonStyle.Secondary)
                )]
            });
await interaction.channel.send({ embeds: [new EmbedBuilder().setDescription(`↩️ **${interaction.user.tag}** has unclaimed this ticket.`).setColor(0x378ADD).setImage('https://cdn.discordapp.com/attachments/620024668673409069/1521630968291790949/tdHrBAAAABklEQVQDAFXb9U9ExQfWAAAAAElFTkSuQmCC.png?ex=6a4588c5&is=6a443745&hm=3ca9f06818ecaa7f948a7cd5fa77e33698a41733ac69785fc5dd0818fb6df659&').setTimestamp()] });
            const panel = await TicketPanel.findOne({ serverId: ticket.serverId });
            if (panel) scheduleTicketReping(ticket, panel, interaction.guild);
            return;
        }

        if (interaction.customId.startsWith('ticket_close_') && !interaction.customId.startsWith('ticket_closerequest_') && !interaction.customId.startsWith('ticket_closeconfirm_') && !interaction.customId.startsWith('ticket_closecancel_') && !interaction.customId.startsWith('ticket_closeleft_')) {
            const caseId = interaction.customId.replace('ticket_close_', '');
            const ticket = await Ticket.findOne({ caseId });
            if (!ticket) return interaction.reply({ content: '❌ Ticket not found.', flags: 64 });
            if (!await hasTicketStaffRole(interaction.user.id, ticket.serverId, ticket.pingRoleId, ticket.pingRoleIds) && interaction.user.id !== ticket.userId) return interaction.reply({ content: '❌ You do not have permission to close this ticket.', flags: 64 });
            const modal = new ModalBuilder().setCustomId(`ticket_closemodal_${caseId}`).setTitle('Close Ticket');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('closereason').setLabel('Reason for closing').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the reason for closing this ticket...').setRequired(true)));
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('ticket_closeconfirm_')) {
            const caseId = interaction.customId.replace('ticket_closeconfirm_', '');
            const ticket = await Ticket.findOne({ caseId });
            if (!ticket) return interaction.reply({ content: '❌ Ticket not found.', flags: 64 });
            await interaction.update({ components: [] });
            await closeTicket(ticket, interaction.channel, interaction.user, 'Resolved');
            return;
        }

        if (interaction.customId.startsWith('ticket_closecancel_')) {
            await interaction.update({ content: '✅ Close cancelled.', components: [], embeds: [] });
            return;
        }

        // ========== TICKET CREATOR LEFT - CLOSE BUTTON ==========
        if (interaction.customId.startsWith('ticket_closeleft_')) {
            const caseId = interaction.customId.replace('ticket_closeleft_', '');
            const ticket = await Ticket.findOne({ caseId });
            if (!ticket) return interaction.reply({ content: '❌ Ticket not found.', flags: 64 });
            if (!await hasTicketStaffRole(interaction.user.id, ticket.serverId, ticket.pingRoleId, ticket.pingRoleIds)) return interaction.reply({ content: '❌ You do not have permission to close this ticket.', flags: 64 });
            await interaction.update({ components: [] });
            await closeTicket(ticket, interaction.channel, interaction.user, 'Ticket creator left the server');
            return;
        }

        if (interaction.customId.startsWith('ticket_closerequest_')) {
            const caseId = interaction.customId.replace('ticket_closerequest_', '');
            const ticket = await Ticket.findOne({ caseId });
            if (!ticket) return interaction.reply({ content: '❌ Ticket not found.', flags: 64 });
            if (!await hasTicketStaffRole(interaction.user.id, ticket.serverId, ticket.pingRoleId, ticket.pingRoleIds)) return interaction.reply({ content: '❌ You do not have permission to do this.', flags: 64 });
            await interaction.reply({ content: '✅ Closure request sent to the ticket opener.', flags: 64 });
            await interaction.channel.send({
                content: `<@${ticket.userId}>`,
embeds: [new EmbedBuilder().setTitle('❓ Closure Request').setDescription(`**${interaction.user.tag}** has requested to close your ticket.\n\nHas your issue been resolved? If so, click **Yes** below to close the ticket.`).setColor(0xF39C12).setImage('https://cdn.discordapp.com/attachments/620024668673409069/1521630625990312058/avatar-removebg-preview__7_-removebg-preview.png?ex=6a458873&is=6a4436f3&hm=13097ba5884157460dad416471432ea6e311d8b943e0c7bda7b1dac51b517454&').setFooter({ text: 'Kavià Café • Ticket System' }).setTimestamp()],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ticket_closeconfirm_${caseId}`).setLabel('✅ Yes, close my ticket').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`ticket_closecancel_${caseId}`).setLabel('❌ No, keep it open').setStyle(ButtonStyle.Danger)
                )]
            });
            return;
        }
if (interaction.customId.startsWith('dmreply_')) {
            const targetUserId = interaction.customId.replace('dmreply_', '');
            const modal = new ModalBuilder().setCustomId(`dmreplymodal_${targetUserId}`).setTitle('Reply to User');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('replymessage')
                    .setLabel('Your reply')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Type your reply here...')
                    .setRequired(true)
            ));
            await interaction.showModal(modal);
            return;
        }

       if (interaction.customId.startsWith('ticket_adduser_')) {
            const caseId = interaction.customId.replace('ticket_adduser_', '');
            const ticket = await Ticket.findOne({ caseId });
            if (!ticket) return interaction.reply({ content: '❌ Ticket not found.', flags: 64 });
            if (!await hasTicketStaffRole(interaction.user.id, ticket.serverId, ticket.pingRoleId, ticket.pingRoleIds)) return interaction.reply({ content: '❌ You do not have permission to add users.', flags: 64 });
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId(`ticket_adduser_select_${caseId}`)
                .setPlaceholder('Select user to add...')
                .setMinValues(1)
                .setMaxValues(1);
            await interaction.reply({
                content: '👤 Select a user to add to this ticket:',
                components: [new ActionRowBuilder().addComponents(userSelect)],
                flags: 64
            });
            return;
        }

        if (interaction.customId.startsWith('st_done_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const sectionIndex = parseInt(parts[3]);
            if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This is not your training session.', flags: 64 });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active training session found.', flags: 64 });
            if (session.locked) return interaction.reply({ content: '🔒 Your session is locked. Please wait for a staff member to resolve your help request.', flags: 64 });
            await interaction.update({ components: [] });
            const nextSection = sectionIndex + 1;
            if (nextSection < session.trainingConfig.sections.length) { session.section = nextSection; await sendNextSection(userId, session); }
            else { await startQuiz(userId, session); }
            return;
        }

        if (interaction.customId.startsWith('st_help_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const sectionIndex = parseInt(parts[3]);
            if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This is not your training session.', flags: 64 });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active training session found.', flags: 64 });
            session.locked = true;
            await interaction.update({ components: [] });
            await interaction.user.send({ embeds: [new EmbedBuilder().setTitle('🆘 Help Request Sent').setDescription('Your help request has been sent to a staff member. Your session has been paused until the issue is resolved.').setColor(0xE74C3C).setTimestamp()] });
            const logChannel = await client.channels.fetch(session.deptConfig.logChannelId);
            if (logChannel?.isTextBased()) {
                const resolveRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`st_resolve_${userId}_${sectionIndex}`).setLabel('✅ Mark as Resolved').setStyle(ButtonStyle.Success));
                await logChannel.send({
                    content: `<@&${session.deptConfig.pingRoleId}>`,
                    embeds: [new EmbedBuilder().setTitle('🆘 Training Help Request').setColor(0xE74C3C).addFields(
                        { name: '👤 Trainee', value: `<@${userId}> (${userId})` },
                        { name: '🏢 Department', value: session.department },
                        { name: '📖 Training', value: session.training },
                        { name: '📖 Section', value: `Section ${sectionIndex + 1} — ${session.trainingConfig.sections[sectionIndex].title}` }
                    ).setTimestamp()],
                    components: [resolveRow]
                });
            }
            return;
        }

        if (interaction.customId.startsWith('st_resolve_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            if (!await hasTrainingRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to resolve training sessions.', flags: 64 });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', flags: 64 });
            session.locked = false;
            await interaction.update({ components: [] });
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [new EmbedBuilder().setTitle('✅ Help Request Resolved').setDescription('A staff member has resolved your help request. You may now continue your training by clicking **Done** below.').setColor(0x2ECC71).setTimestamp()] });
            await sendNextSection(userId, session);
            return;
        }

        if (interaction.customId.startsWith('st_ageverif_accept_')) {
            const userId = interaction.customId.replace('st_ageverif_accept_', '');
            if (!await hasTrainingRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', flags: 64 });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', flags: 64 });
            if (session.ageVerifRepingTimeout) clearTimeout(session.ageVerifRepingTimeout);
            session.awaitingAgeVerif = false;
            await interaction.update({ components: [] });
            try {
                const logChannel = await client.channels.fetch(session.ageVerifLogChannelId);
                const logMsg = await logChannel.messages.fetch(session.ageVerifLogMessageId).catch(() => null);
                if (logMsg) {
                    const acceptedEmbed = EmbedBuilder.from(logMsg.embeds[0]).setTitle('✅ Age Verification Accepted').setColor(0x2ECC71).addFields({ name: '👮 Accepted By', value: interaction.user.tag });
                    await logMsg.edit({ embeds: [acceptedEmbed], components: [] });
                }
            } catch {}
            session.ageVerifLogMessageId = null;
            session.ageVerifLogChannelId = null;
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [new EmbedBuilder().setTitle('✅ Age Verification Approved').setDescription('Your age has been successfully verified! You may now continue with your training.').setColor(0x2ECC71).setTimestamp()] });
            session.section += 1;
            await sendNextSection(userId, session);
            return;
        }

        if (interaction.customId.startsWith('st_ageverif_deny_')) {
            const userId = interaction.customId.replace('st_ageverif_deny_', '');
            if (!await hasTrainingRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', flags: 64 });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', flags: 64 });
            const modal = new ModalBuilder().setCustomId(`st_ageverif_denymodal_${userId}`).setTitle('Deny Age Verification');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('denyreason').setLabel('Reason for denial').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the reason for denying age verification...').setRequired(true)));
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('st_quiz_')) {
            const parts = interaction.customId.split('_');
            const answer = parts[2];
            const userId = parts[3];
            const questionIndex = parseInt(parts[4]);
            if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This is not your training session.', flags: 64 });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active training session found.', flags: 64 });
            const q = session.trainingConfig.quiz[questionIndex];
            const correct = answer === q.answer;
            if (correct) session.score++;
            await interaction.update({ components: [] });
            await interaction.user.send({ embeds: [new EmbedBuilder().setDescription(correct ? '✅ Correct!' : `❌ Incorrect. The correct answer was **${q.answer}) ${q.options[q.answer]}**`).setColor(correct ? 0x2ECC71 : 0xE74C3C)] });
            const nextQuestion = questionIndex + 1;
            if (nextQuestion < session.trainingConfig.quiz.length) {
                session.quizIndex = nextQuestion;
                setTimeout(async () => {
                    const nextQ = session.trainingConfig.quiz[nextQuestion];
                    const embed = getQuizEmbed(nextQ, nextQuestion, session.score, session.trainingConfig.quiz.length, session.department, session.training);
                    const buttons = getQuizButtons(userId, nextQuestion, nextQ);
                    await interaction.user.send({ embeds: [embed], components: [buttons] });
                }, 1500);
            } else {
                await sendQuizResults(userId, session);
            }
            return;
        }

        if (interaction.customId.startsWith('st_pass_')) {
            const userId = interaction.customId.replace('st_pass_', '');
            if (!await hasTrainingRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', flags: 64 });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', flags: 64 });
            await interaction.update({ components: [] });
            try {
                const trainingKey = `${session.training} — ${session.department}`;
                await CompletedTrainings.findByIdAndUpdate(userId, { $addToSet: { completedTrainings: trainingKey } }, { upsert: true });
            } catch (err) { console.error('Error saving completed training:', err); }
            const user = await client.users.fetch(userId);
            activeSessions.delete(userId);
            await user.send({ embeds: [new EmbedBuilder().setTitle('🎉 Congratulations!').setDescription(`Congratulations, ${user}! 🎉\n\nYou have successfully **passed** your **${session.training}** for the **${session.department}** department at **Kavià Café**!\n\nYour hard work and dedication have not gone unnoticed. Your permissions will be updated shortly.\n\n***Sincerely,***\n**Kavià Café Staff Team**`).setColor(0x2ECC71).setTimestamp()] });
            const logChannel = await client.channels.fetch(session.deptConfig.logChannelId);
            if (logChannel?.isTextBased()) {
                await logChannel.send({ embeds: [new EmbedBuilder().setTitle('✅ Training Passed').setColor(0x2ECC71).addFields(
                    { name: '👤 Trainee', value: `${user.tag} (${user.id})` },
                    { name: '🏢 Department', value: session.department },
                    { name: '📖 Training', value: session.training },
                    { name: '📊 Final Score', value: `${session.score}/${session.trainingConfig.quiz.length}` },
                    { name: '👮 Trained By', value: `<@${session.staffId}> (${session.staffTag})` },
                    { name: '👮 Passed By', value: interaction.user.tag },
                    { name: '💬 DM Sent', value: '✅ Yes' }
                ).setTimestamp()] });
            }
            return;
        }

        if (interaction.customId.startsWith('st_fail_')) {
            const userId = interaction.customId.replace('st_fail_', '');
            if (!await hasTrainingRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', flags: 64 });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', flags: 64 });
            await interaction.update({ components: [] });
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [new EmbedBuilder().setTitle('❌ Training Result').setDescription(`Hello, ${user}.\n\nUnfortunately, you have **not passed** your **${session.training}** for the **${session.department}** department at this time.\n\nPlease don't be discouraged — this is a learning experience. Your training will now restart from the beginning.\n\n***Sincerely,***\n**Kavià Café Staff Team**`).setColor(0xE74C3C).setTimestamp()] });
            const logChannel = await client.channels.fetch(session.deptConfig.logChannelId);
            if (logChannel?.isTextBased()) {
                await logChannel.send({ embeds: [new EmbedBuilder().setTitle('❌ Training Failed — Restarting').setColor(0xE74C3C).addFields(
                    { name: '👤 Trainee', value: `${user.tag} (${user.id})` },
                    { name: '🏢 Department', value: session.department },
                    { name: '📖 Training', value: session.training },
                    { name: '📊 Final Score', value: `${session.score}/${session.trainingConfig.quiz.length}` },
                    { name: '👮 Trained By', value: `<@${session.staffId}> (${session.staffTag})` },
                    { name: '👮 Failed By', value: interaction.user.tag },
                    { name: '💬 DM Sent', value: '✅ Yes' },
                    { name: '🔄 Status', value: 'Training restarted from section 1' }
                ).setTimestamp()] });
            }
            session.section = 0; session.phase = 'sections'; session.score = 0; session.quizIndex = 0; session.locked = false; session.awaitingAgeVerif = false;
            setTimeout(async () => { await sendNextSection(userId, session); }, 2000);
            return;
        }

        if (interaction.customId.startsWith('sesaccept_')) {
            if (!await hasRequiredRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to use this button.', flags: 64 });
            const sessionId = interaction.customId.replace('sesaccept_', '');
            try {
                const session = await Session.findById(sessionId);
                if (!session) return interaction.reply({ content: '❌ Session not found.', flags: 64 });
                await Session.findByIdAndUpdate(sessionId, { status: 'approved', approvedAt: new Date() });
                const user = await client.users.fetch(session.hostId);
                let linkText = '';
                if (session.shiftType === 'Training') linkText = `\n\nPlease review the training guide before your session:\n${TRAINING_LINK}`;
                else if (session.shiftType === 'Regular Shift') linkText = `\n\nPlease review the shift guide before your session:\n${SHIFT_LINK}`;
                await user.send({ content: `# <:kaviacafe:1387492814916685845> **Session Request Accepted**\nHello, ${user},\nWe are delighted to inform you that your **${session.shiftType}** request has been **accepted** at **Kavià Café**!\n> <:pink_pin:1166850035611353148> **Shift Type →** *${session.shiftType}*\n> <:pink_pin:1166850035611353148> **Time →** *${session.time}*\n> <:pink_pin:1166850035611353148> **Status →** *Accepted ✅*\nShould you have any questions or concerns prior to your session, please do not hesitate to reach out.${linkText}\n***Signed,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**` });
                await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x2ECC71).setTitle('📋 Session Request — ✅ Accepted').setFooter({ text: `Accepted by ${interaction.user.username} • Session ID: ${sessionId}` })], components: [] });
                session.status = 'approved';
                await scheduleSession(session);
            } catch (err) { console.error('Error accepting session:', err); await interaction.reply({ content: '❌ Error accepting request.', flags: 64 }); }
            return;
        }

        if (interaction.customId.startsWith('sesdecline_') && !interaction.customId.startsWith('sesdeclinemodal_')) {
            if (!await hasRequiredRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to use this button.', flags: 64 });
            const sessionId = interaction.customId.replace('sesdecline_', '');
            const session = await Session.findById(sessionId);
            if (!session) return interaction.reply({ content: '❌ Session not found.', flags: 64 });
            const modal = new ModalBuilder().setCustomId(`sesdeclinemodal_${sessionId}`).setTitle('Decline Session Request');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('declinereason').setLabel('Reason for declining').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the reason for declining this request...').setRequired(true)));
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('ses_stillhosting_')) {
            const sessionId = interaction.customId.replace('ses_stillhosting_', '');
            const session = await Session.findById(sessionId);
            if (!session || interaction.user.id !== session.hostId) return interaction.reply({ content: '❌ Only the host can click this button.', flags: 64 });
            await interaction.update({ components: [] });
            await Session.findByIdAndUpdate(sessionId, { hostConfirmed: true });
            const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
            if (requestChannel?.isTextBased()) await requestChannel.send({ embeds: [new EmbedBuilder().setTitle('✅ Host Confirmed').setDescription(`<@${session.hostId}> has confirmed they are still hosting their **${session.shiftType}** at **${session.time}**. The announcement will be posted at the scheduled time!`).setColor(0x2ECC71).setTimestamp()] });
            return;
        }

        if (interaction.customId.startsWith('ses_canthost_')) {
            const sessionId = interaction.customId.replace('ses_canthost_', '');
            const session = await Session.findById(sessionId);
            if (!session || interaction.user.id !== session.hostId) return interaction.reply({ content: '❌ Only the host can click this button.', flags: 64 });
            await interaction.update({ components: [] });
            await Session.findByIdAndUpdate(sessionId, { status: 'cancelled' });
            try { const host = await client.users.fetch(session.hostId); await host.send({ embeds: [new EmbedBuilder().setTitle('❌ Session Cancelled').setDescription('Your session has been cancelled. Please let a staff member know if you need to reschedule.').setColor(0xE74C3C).setTimestamp()] }); } catch {}
            const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
            if (requestChannel?.isTextBased()) await requestChannel.send({ embeds: [new EmbedBuilder().setTitle('❌ Session Cancelled').setColor(0xE74C3C).setDescription(`<@${session.hostId}> is no longer able to host their **${session.shiftType}** at ${session.time}.`).setTimestamp()] });
            return;
        }

        if (interaction.customId.startsWith('ses_checkin_')) {
            const sessionId = interaction.customId.replace('ses_checkin_', '');
            const session = await Session.findById(sessionId);
            if (!session || session.status !== 'active') return interaction.reply({ content: '❌ This session is no longer active.', flags: 64 });
            if (session.attendees && session.attendees.includes(interaction.user.id)) return interaction.reply({ content: '✅ You are already checked in!', flags: 64 });
            await Session.findByIdAndUpdate(sessionId, { $addToSet: { attendees: interaction.user.id } });
            return interaction.reply({ content: `✅ You've been checked in to **${session.shiftType}**!`, flags: 64 });
        }

        if (interaction.customId.startsWith('ses_requestcohost_')) {
            const sessionId = interaction.customId.replace('ses_requestcohost_', '');
            const session = await Session.findById(sessionId);
            if (!session || session.status !== 'active') return interaction.reply({ content: '❌ This session is no longer active.', flags: 64 });
            if (interaction.user.id === session.hostId) return interaction.reply({ content: '❌ You are the host — you cannot request to co-host your own session.', flags: 64 });
            if (session.coHostId) return interaction.reply({ content: '❌ This session already has a co-host.', flags: 64 });
            if (session.coHostRequesterId) return interaction.reply({ content: '❌ A co-host request is already pending for this session.', flags: 64 });
            await Session.findByIdAndUpdate(sessionId, { coHostRequesterId: interaction.user.id });
            // DM the host with accept/decline buttons
            try {
                const host = await client.users.fetch(session.hostId);
                const coHostRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ses_cohostaccept_${sessionId}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`ses_cohostdecline_${sessionId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger)
                );
                await host.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('🤝 Co-Host Request')
                        .setDescription(`**${interaction.user.tag}** (<@${interaction.user.id}>) wants to co-host your **${session.shiftType}** session!\n\nDo you accept?`)
                        .setColor(0x3498DB)
                        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                        .setTimestamp()
                    ],
                    components: [coHostRow]
                });
                return interaction.reply({ content: `✅ Co-host request sent to the host! You'll receive a DM with the result.`, flags: 64 });
            } catch {
                // Host DMs closed — post in request channel instead
                const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
                if (requestChannel?.isTextBased()) {
                    const coHostRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`ses_cohostaccept_${sessionId}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`ses_cohostdecline_${sessionId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger)
                    );
                    await requestChannel.send({
                        content: `<@${session.hostId}>`,
                        embeds: [new EmbedBuilder()
                            .setTitle('🤝 Co-Host Request')
                            .setDescription(`**${interaction.user.tag}** (<@${interaction.user.id}>) wants to co-host your **${session.shiftType}**. Accept or decline?`)
                            .setColor(0x3498DB)
                            .setTimestamp()
                        ],
                        components: [coHostRow]
                    });
                }
                return interaction.reply({ content: `✅ Co-host request sent!`, flags: 64 });
            }
        }

        if (interaction.customId.startsWith('ses_cohostaccept_')) {
            const sessionId = interaction.customId.replace('ses_cohostaccept_', '');
            const session = await Session.findById(sessionId);
            if (!session || interaction.user.id !== session.hostId) return interaction.reply({ content: '❌ Only the host can accept co-host requests.', flags: 64 });
            if (!session.coHostRequesterId) return interaction.reply({ content: '❌ No pending co-host request.', flags: 64 });
            await interaction.update({ components: [] });
            const requesterId = session.coHostRequesterId;
            await Session.findByIdAndUpdate(sessionId, { coHostId: requesterId, coHostRequesterId: null });
            // Notify the requester
            try {
                const requester = await client.users.fetch(requesterId);
                await requester.send({ embeds: [new EmbedBuilder().setTitle('✅ Co-Host Request Accepted').setDescription(`Your request to co-host **${session.shiftType}** has been **accepted** by the host! Welcome aboard.`).setColor(0x2ECC71).setTimestamp()] });
            } catch {}
            const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
            if (requestChannel?.isTextBased()) await requestChannel.send({ embeds: [new EmbedBuilder().setTitle('🤝 Co-Host Added').setDescription(`<@${requesterId}> has been accepted as co-host for <@${session.hostId}>'s **${session.shiftType}**.`).setColor(0x2ECC71).setTimestamp()] });
            return;
        }

        if (interaction.customId.startsWith('ses_cohostdecline_')) {
            const sessionId = interaction.customId.replace('ses_cohostdecline_', '');
            const session = await Session.findById(sessionId);
            if (!session || interaction.user.id !== session.hostId) return interaction.reply({ content: '❌ Only the host can decline co-host requests.', flags: 64 });
            if (!session.coHostRequesterId) return interaction.reply({ content: '❌ No pending co-host request.', flags: 64 });
            await interaction.update({ components: [] });
            const requesterId = session.coHostRequesterId;
            await Session.findByIdAndUpdate(sessionId, { coHostRequesterId: null });
            try {
                const requester = await client.users.fetch(requesterId);
                await requester.send({ embeds: [new EmbedBuilder().setTitle('❌ Co-Host Request Declined').setDescription(`Your request to co-host **${session.shiftType}** has been **declined** by the host.`).setColor(0xE74C3C).setTimestamp()] });
            } catch {}
            return;
        }

        if (interaction.customId.startsWith('ses_finished_')) {
            const sessionId = interaction.customId.replace('ses_finished_', '');
            const session = await Session.findById(sessionId);
            if (!session || interaction.user.id !== session.hostId) return interaction.reply({ content: '❌ Only the host can click this button.', flags: 64 });
            await interaction.update({ components: [] });
            await Session.findByIdAndUpdate(sessionId, { status: 'finished' });
            try { const announcementGuild = await client.guilds.fetch(ANNOUNCEMENT_GUILD_ID); const announcementChannel = await announcementGuild.channels.fetch(ANNOUNCEMENT_CHANNEL_ID); const msg = await announcementChannel.messages.fetch(session.announcementMessageId).catch(() => null); if (msg) await msg.delete().catch(() => {}); } catch (err) { console.error('Error deleting announcement:', err); }
            const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
            // Build attendance summary
            const attendees = session.attendees || [];
            let attendanceLine = 'No check-ins recorded.';
            if (attendees.length > 0) {
                attendanceLine = attendees.map(id => `<@${id}>`).join(', ') + ` (${attendees.length} total)`;
            }
            const coHostLine = session.coHostId ? `<@${session.coHostId}>` : 'None';
            if (requestChannel?.isTextBased()) await requestChannel.send({ embeds: [new EmbedBuilder()
                .setTitle('✅ Session Finished')
                .setDescription(`<@${session.hostId}>'s **${session.shiftType}** has been marked as finished. Great job!`)
                .addFields(
                    { name: '🤝 Co-Host', value: coHostLine, inline: true },
                    { name: `👥 Attendance (${attendees.length})`, value: attendanceLine, inline: false }
                )
                .setColor(0x2ECC71).setTimestamp()] });
            return;
        }

        if (interaction.customId.startsWith('ses_notfinished_')) {
            const sessionId = interaction.customId.replace('ses_notfinished_', '');
            const session = await Session.findById(sessionId);
            if (!session || interaction.user.id !== session.hostId) return interaction.reply({ content: '❌ Only the host can click this button.', flags: 64 });
            await interaction.update({ components: [] });
            const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
            if (requestChannel?.isTextBased()) await requestChannel.send({ embeds: [new EmbedBuilder().setTitle('⏳ Session Still Going').setDescription(`<@${session.hostId}>'s **${session.shiftType}** is still in progress. We'll check back in another 25 minutes.`).setColor(0xF39C12).setTimestamp()] });
            setTimeout(async () => { await sendFinishCheck(sessionId); }, 25 * 60 * 1000);
            return;
        }

        // ========== LOA PANEL BUTTON ==========
        if (interaction.customId.startsWith('loa_request_')) {
            const logChannelId = interaction.customId.replace('loa_request_', '');
            const { DEPT_CHOICES } = require('./commands/departments');
            const select = new StringSelectMenuBuilder()
                .setCustomId(`loa_selectdept_${logChannelId}`)
                .setPlaceholder('Select your department...')
                .addOptions(DEPT_CHOICES.map(d => ({ label: d.name, value: d.value })));
            await interaction.reply({
                content: '**Step 1:** Select your department below.',
                components: [new ActionRowBuilder().addComponents(select)],
                flags: 64
            });
            return;
        }

        if (interaction.customId.startsWith('loa_accept_')) {
            const loaId = interaction.customId.replace('loa_accept_', '');
            try {
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.reply({ content: '❌ LOA not found.', flags: 64 });
                if (!await hasStaffRole(interaction.user.id, loa.department)) return interaction.reply({ content: '❌ You do not have permission to do this.', flags: 64 });
                await LOA.findByIdAndUpdate(loaId, { status: 'approved', approvedAt: new Date() });
                const user = await client.users.fetch(loa.userId);
                await user.send({ embeds: [new EmbedBuilder().setTitle('✅ Leave of Absence Approved').setDescription(`Hello, <@${loa.userId}>!\n\nWe are pleased to inform you that your **Leave of Absence** request has been **approved** at **Kavià Café**.\n\n> <:pink_pin:1166850035611353148> **Department →** *${loa.department || 'Unknown'}*\n> <:pink_pin:1166850035611353148> **Time Gone →** *${loa.timeGone}*\n> <:pink_pin:1166850035611353148> **Return Date →** *${loa.returnDate}*\n> <:pink_pin:1166850035611353148> **Status →** *Approved ✅*\n\n***Sincerely,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**`).setColor(0x2ECC71).setTimestamp()] });
                // Create LOA roles in dept server and main server
                try {
                    const { DEPARTMENTS } = require('./commands/departments');
                    const deptCfg = DEPARTMENTS[loa.department];
                    const roleName = `LOA - ${loa.startDate || loa.timeGone} → ${loa.returnDate}`;
                    const roleColor = 0xF39C12;

                    let loaRoleIdDept = null;
                    let loaRoleIdMain = null;

                    // Create role in dept server and assign to user
                    if (deptCfg) {
                        const deptGuild = await client.guilds.fetch(deptCfg.serverId).catch(() => null);
                        if (deptGuild) {
                            const deptRole = await deptGuild.roles.create({ name: roleName, color: roleColor, reason: 'LOA approved' }).catch(() => null);
                            if (deptRole) {
                                loaRoleIdDept = deptRole.id;
                                const deptMember = await deptGuild.members.fetch(loa.userId).catch(() => null);
                                if (deptMember) await deptMember.roles.add(deptRole).catch(() => {});
                            }
                        }
                    }

                    // Create role in main server and assign to user
                    const mainGuild = await client.guilds.fetch('1370892833182974035').catch(() => null);
                    if (mainGuild) {
                        const mainRole = await mainGuild.roles.create({ name: roleName, color: roleColor, reason: 'LOA approved' }).catch(() => null);
                        if (mainRole) {
                            loaRoleIdMain = mainRole.id;
                            const mainMember = await mainGuild.members.fetch(loa.userId).catch(() => null);
                            if (mainMember) await mainMember.roles.add(mainRole).catch(() => {});
                        }
                    }

                    if (loaRoleIdDept || loaRoleIdMain) {
                        await LOA.findByIdAndUpdate(loaId, { loaRoleIdDept, loaRoleIdMain });
                    }
                } catch (err) { console.error('Error creating LOA roles:', err); }

                // Delete the request message and post clean approval log
                try { await interaction.message.delete(); } catch {}
                try {
                    const logChannel = await client.channels.fetch(loa.logChannelId || interaction.channel.id).catch(() => null);
                    if (logChannel?.isTextBased()) {
                        await logChannel.send({ embeds: [new EmbedBuilder()
                            .setTitle('✅ LOA Approved')
                            .setColor(0x2ECC71)
                            .addFields(
                                { name: '👤 User', value: `${user.tag} (${user.id})`, inline: true },
                                { name: '🏢 Department', value: loa.department || 'Unknown', inline: true },
                                { name: '👮 Approved By', value: interaction.user.tag, inline: true },
                                { name: '⏳ Time Gone', value: loa.timeGone, inline: true },
                                { name: '📅 Return Date', value: loa.returnDate, inline: true }
                            )
                            .setFooter({ text: `LOA ID: ${loaId}` })
                            .setTimestamp()
                        ]});
                    }
                } catch (err) { console.error('Error posting LOA approval log:', err); }
                scheduleLOAReturnReminder(loa, client);
            } catch (err) { console.error('Error approving LOA:', err); await interaction.reply({ content: '❌ Error approving LOA.', flags: 64 }); }
            return;
        }

        if (interaction.customId.startsWith('loa_deny_')) {
            const loaId = interaction.customId.replace('loa_deny_', '');
            try {
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.reply({ content: '❌ LOA not found.', flags: 64 });
                if (!await hasStaffRole(interaction.user.id, loa.department)) return interaction.reply({ content: '❌ You do not have permission to do this.', flags: 64 });
                const modal = new ModalBuilder().setCustomId(`loa_denymodal_${loaId}`).setTitle('Deny LOA Request');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('denyreason').setLabel('Reason for denial').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the reason for denying this LOA...').setRequired(true)));
                await interaction.showModal(modal);
            } catch (err) { console.error('Error denying LOA:', err); }
            return;
        }

        if (interaction.customId.startsWith('loa_moreinfo_')) {
            const loaId = interaction.customId.replace('loa_moreinfo_', '');
            try {
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.reply({ content: '❌ LOA not found.', flags: 64 });
                if (!await hasStaffRole(interaction.user.id, loa.department)) return interaction.reply({ content: '❌ You do not have permission to do this.', flags: 64 });
                const modal = new ModalBuilder().setCustomId(`loa_moreinfomodal_${loaId}`).setTitle('Request More Info');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('moreinfo').setLabel('What info is needed?').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter what additional information is needed...').setRequired(true)));
                await interaction.showModal(modal);
            } catch (err) { console.error('Error requesting more info:', err); }
            return;
        }

        if (interaction.customId.startsWith('loa_returned_')) {
            const loaId = interaction.customId.replace('loa_returned_', '');
            const loa = await LOA.findById(loaId);
            if (!loa || interaction.user.id !== loa.userId) return interaction.reply({ content: '❌ This is not your LOA.', flags: 64 });
            await interaction.update({ components: [] });
            await LOA.findByIdAndUpdate(loaId, { status: 'returned' });
            try { const deptConfig = DEPARTMENTS[loa.department]; if (deptConfig) { const loaGuild = await client.guilds.fetch(deptConfig.serverId); const loaChannel = await loaGuild.channels.fetch(deptConfig.loaChannelId); const msg = await loaChannel.messages.fetch(loa.messageId).catch(() => null); if (msg) await msg.delete().catch(() => {}); } } catch {}
            await interaction.user.send({ embeds: [new EmbedBuilder().setTitle('👋 Welcome Back!').setDescription(`Welcome back, <@${loa.userId}>! 🎉\n\nWe're thrilled to have you back at **Kavià Café**. Your LOA has been officially closed.\n\n***Sincerely,***\n**Kavià Café Staff Team**`).setColor(0x2ECC71).setTimestamp()] });
            await sendLOALog(await client.users.fetch(loa.userId), '👋 LOA Returned', 0x2ECC71, loaId, [{ name: '📅 Return Date', value: loa.returnDate }]);

            // Delete LOA roles from both servers
            try {
                const { DEPARTMENTS } = require('./commands/departments');
                const deptCfg = DEPARTMENTS[loa.department];
                if (loa.loaRoleIdDept && deptCfg) {
                    const deptGuild = await client.guilds.fetch(deptCfg.serverId).catch(() => null);
                    if (deptGuild) await deptGuild.roles.delete(loa.loaRoleIdDept, 'LOA ended').catch(() => {});
                }
                if (loa.loaRoleIdMain) {
                    const mainGuild = await client.guilds.fetch('1370892833182974035').catch(() => null);
                    if (mainGuild) await mainGuild.roles.delete(loa.loaRoleIdMain, 'LOA ended').catch(() => {});
                }
            } catch (err) { console.error('Error deleting LOA roles on return:', err); }
            return;
        }

        // ========== PAYMENT SYSTEM ==========
        if (interaction.customId.startsWith('pay_accept_')) {
            const paymentId = interaction.customId.replace('pay_accept_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.targetId !== interaction.user.id) return interaction.reply({ content: '❌ This offer is not for you.', flags: 64 });
            if (payment.status !== 'pending' && payment.status !== 'countered') return interaction.reply({ content: '❌ This offer has already been responded to.', flags: 64 });

            await Payment.findByIdAndUpdate(paymentId, {
                status: 'accepted',
                $push: { history: { action: 'Accepted', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } }
            });
            const updated = await Payment.findById(paymentId);

            await interaction.update({ components: [] });
            await interaction.user.send({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Offer Accepted!')
                    .setDescription(`You have accepted the payment offer.\n\nBefore payment is sent, you will need to sign a brief usage agreement. Please wait for the agreement to be sent.`)
                    .setColor(0x2ECC71)
                    .setTimestamp()
                ]
            }).catch(() => {});

            // Post updated receipt to log with agreement button
            try {
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) {
                    const { buildReceiptEmbed } = require('./commands/payment');
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`pay_sendagreement_${paymentId}`)
                            .setLabel('📝 Send Agreement')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`pay_staffdecline_${paymentId}`)
                            .setLabel('❌ Cancel Payment')
                            .setStyle(ButtonStyle.Danger)
                    );
                    await logChannel.send({
                        embeds: [buildReceiptEmbed(updated, 'accepted')],
                        components: [row]
                    });
                }
            } catch (err) { console.error('Error posting payment accept log:', err); }
            return;
        }

        if (interaction.customId.startsWith('pay_decline_')) {
            const paymentId = interaction.customId.replace('pay_decline_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.targetId !== interaction.user.id) return interaction.reply({ content: '❌ This offer is not for you.', flags: 64 });
            if (payment.status !== 'pending' && payment.status !== 'countered') return interaction.reply({ content: '❌ This offer has already been responded to.', flags: 64 });

            await Payment.findByIdAndUpdate(paymentId, {
                status: 'declined',
                $push: { history: { action: 'Declined', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } }
            });
            const updated = await Payment.findById(paymentId);

            await interaction.update({ components: [] });
            await interaction.user.send({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Offer Declined')
                    .setDescription('You have declined this payment offer. If this was a mistake, please contact the team directly.')
                    .setColor(0xE74C3C)
                    .setTimestamp()
                ]
            }).catch(() => {});

            try {
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) {
                    const { buildReceiptEmbed } = require('./commands/payment');
                    await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'declined')] });
                }
            } catch (err) { console.error('Error posting payment decline log:', err); }
            return;
        }

        if (interaction.customId.startsWith('pay_counter_')) {
            const paymentId = interaction.customId.replace('pay_counter_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.targetId !== interaction.user.id) return interaction.reply({ content: '❌ This offer is not for you.', flags: 64 });
            if (payment.status !== 'pending' && payment.status !== 'countered') return interaction.reply({ content: '❌ This offer has already been responded to.', flags: 64 });

            const modal = new ModalBuilder()
                .setCustomId(`pay_countermodal_${paymentId}`)
                .setTitle('Request Different Amount');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('counteramount')
                        .setLabel('Your requested amount')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g. 500')
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('counternote')
                        .setLabel('Reason (optional)')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Why are you requesting a different amount?')
                        .setRequired(false)
                )
            );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('pay_staffaccept_')) {
            const paymentId = interaction.customId.replace('pay_staffaccept_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            const hasPerms = await hasBotPermsRole(interaction.guildId || payment.serverId, interaction.user.id);
            if (!hasPerms) return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
            if (payment.status !== 'counter_pending') return interaction.reply({ content: '❌ No counter offer to accept.', flags: 64 });

            const newAmount = payment.counterAmount;
            await Payment.findByIdAndUpdate(paymentId, {
                amount: newAmount,
                counterAmount: null,
                status: 'countered',
                $push: { history: { action: 'Counter Accepted by Staff', by: interaction.user.id, byTag: interaction.user.tag, amount: newAmount, at: new Date() } }
            });
            const updated = await Payment.findById(paymentId);

            await interaction.update({ components: [] });

            // DM the freelancer the updated offer
            try {
                const target = await client.users.fetch(payment.targetId);
                const currencySymbol = payment.currency === 'robux' ? 'R$' : '$';
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`pay_accept_${paymentId}`).setLabel('✅ Yes, I accept').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`pay_decline_${paymentId}`).setLabel('❌ No, decline').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`pay_counter_${paymentId}`).setLabel('🔄 Request Different Amount').setStyle(ButtonStyle.Secondary)
                );
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('✅ Counter Offer Accepted!')
                        .setDescription(`Your counter offer has been accepted!\n\nThe new payment amount is **${currencySymbol}${newAmount} ${payment.currency === 'robux' ? 'Robux' : 'USD'}**.\n\nPlease confirm you accept this updated amount.`)
                        .setColor(0x2ECC71)
                        .addFields({ name: '📝 Description', value: payment.description })
                        .setTimestamp()
                    ],
                    components: [row]
                });
            } catch {}

            try {
                const { buildReceiptEmbed } = require('./commands/payment');
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'countered')] });
            } catch {}
            return;
        }

        if (interaction.customId.startsWith('pay_staffdeclinecounter_')) {
            const paymentId = interaction.customId.replace('pay_staffdeclinecounter_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });

            await Payment.findByIdAndUpdate(paymentId, {
                status: 'declined',
                $push: { history: { action: 'Counter Declined by Staff', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } }
            });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });

            try {
                const target = await client.users.fetch(payment.targetId);
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('❌ Counter Offer Declined')
                       .setDescription('Unfortunately your counter offer was not accepted. The payment offer has been cancelled. Please reach out to the team if you have questions.')
.setColor(0xE74C3C)
.setTimestamp()
                    ]
                });
            } catch {}

            try {
                const { buildReceiptEmbed } = require('./commands/payment');
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'declined')] });
            } catch {}
            return;
        }

        if (interaction.customId.startsWith('pay_staffdecline_')) {
            const paymentId = interaction.customId.replace('pay_staffdecline_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });

            await Payment.findByIdAndUpdate(paymentId, {
                status: 'declined',
                $push: { history: { action: 'Cancelled by Staff', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } }
            });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });

            try {
                const target = await client.users.fetch(payment.targetId);
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('❌ Payment Cancelled')
                        .setDescription('This payment offer has been cancelled by the team. Please reach out if you have questions.')
                        .setColor(0xE74C3C)
                        .setTimestamp()
                    ]
                });
            } catch {}

            try {
                const { buildReceiptEmbed } = require('./commands/payment');
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'declined')] });
            } catch {}
            return;
        }

        if (interaction.customId.startsWith('pay_sendagreement_')) {
            const paymentId = interaction.customId.replace('pay_sendagreement_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.status !== 'accepted') return interaction.reply({ content: '❌ Payment must be accepted before sending agreement.', flags: 64 });

            await interaction.update({ components: [] });

            const currencySymbol = payment.currency === 'robux' ? 'R$' : '$';
            const currentAmount = payment.counterAmount || payment.amount;

            try {
                const target = await client.users.fetch(payment.targetId);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`pay_agree_${paymentId}`).setLabel('✅ I Agree').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`pay_disagree_${paymentId}`).setLabel('❌ I Disagree').setStyle(ButtonStyle.Danger)
                );
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('📝 Payment Agreement — Kavià Café')
                        .setColor(0x9B59B6)
                        .setDescription(`Please read and agree to the following terms before your payment of **${currencySymbol}${currentAmount} ${payment.currency === 'robux' ? 'Robux' : 'USD'}** is sent.`)
                        .addFields(
                            { name: '📋 Agreement Terms', value: require('./commands/payment').AGREEMENT_TEXT },
                            { name: '💰 Payment Amount', value: `${currencySymbol}${currentAmount} ${payment.currency === 'robux' ? 'Robux' : 'USD'}`, inline: true },
                            { name: '📝 For', value: payment.description, inline: true },
                            { name: '🆔 Your Discord ID', value: `\`${payment.targetId}\``, inline: true },
                            { name: '📛 Your Username', value: `${payment.targetTag}`, inline: true }
                        )
                        .setFooter({ text: `Ref: ${payment._id} • Your Discord account serves as your digital signature` })
                        .setTimestamp()
                    ],
                    components: [row]
                });
                await interaction.followUp({ content: `✅ Agreement sent to **${target.tag}**.`, flags: 64 });
            } catch {
                await interaction.followUp({ content: '❌ Could not send agreement — user may have DMs closed.', flags: 64 });
            }
            return;
        }

        if (interaction.customId.startsWith('pay_agree_')) {
            const paymentId = interaction.customId.replace('pay_agree_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.targetId !== interaction.user.id) return interaction.reply({ content: '❌ This agreement is not for you.', flags: 64 });

            await Payment.findByIdAndUpdate(paymentId, {
                status: 'agreed',
                agreementSigned: true,
                agreementSignedAt: new Date(),
                $push: { history: { action: 'Agreement Signed', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } }
            });
            const updated = await Payment.findById(paymentId);

            await interaction.update({ components: [] });
            const robloxRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`pay_robloxmodal_${paymentId}`).setLabel('🎮 Enter Roblox Username').setStyle(ButtonStyle.Primary)
            );
            await interaction.user.send({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Agreement Signed!')
                    .setDescription('Thank you for signing the agreement! Your payment will be sent shortly.\n\nPlease also provide your **exact Roblox username** so we can send the payment to the correct account.')
                    .setColor(0x2ECC71)
                    .addFields({ name: '🆔 Reference', value: `\`${paymentId}\`` })
                    .setTimestamp()
                ],
                components: [robloxRow]
            }).catch(() => {});

            try {
                const { buildReceiptEmbed } = require('./commands/payment');
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) {
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`pay_paid_${paymentId}`).setLabel('💸 Mark as Paid').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`pay_groupwait_${paymentId}`).setLabel('⏳ Not in Group Long Enough').setStyle(ButtonStyle.Secondary)
                    );
                    await logChannel.send({
                        embeds: [buildReceiptEmbed(updated, 'agreed')],
                        components: [row]
                    });
                }
            } catch (err) { console.error('Error posting agreement log:', err); }
            return;
        }

        if (interaction.customId.startsWith('pay_disagree_')) {
            const paymentId = interaction.customId.replace('pay_disagree_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.targetId !== interaction.user.id) return interaction.reply({ content: '❌ This agreement is not for you.', flags: 64 });

            await Payment.findByIdAndUpdate(paymentId, {
                status: 'declined',
                $push: { history: { action: 'Agreement Refused', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } }
            });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });
            await interaction.user.send({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Agreement Declined')
                    .setDescription('You have declined the agreement. The payment has been cancelled. Please contact the team if you have questions.')
                    .setColor(0xE74C3C)
                    .setTimestamp()
                ]
            }).catch(() => {});

            try {
                const { buildReceiptEmbed } = require('./commands/payment');
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'declined')] });
            } catch {}
            return;
        }

        if (interaction.customId.startsWith('pay_paid_')) {
            const paymentId = interaction.customId.replace('pay_paid_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.status !== 'agreed') return interaction.reply({ content: '❌ Agreement must be signed before marking as paid.', flags: 64 });

            await Payment.findByIdAndUpdate(paymentId, {
                status: 'paid',
                paid: true,
                paidAt: new Date(),
                paidBy: interaction.user.id,
                paidByTag: interaction.user.tag,
                $push: { history: { action: 'Marked as Paid', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } }
            });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });

            const currencySymbol = payment.currency === 'robux' ? 'R$' : '$';
            const finalAmount = payment.counterAmount || payment.amount;

            try {
                const target = await client.users.fetch(payment.targetId);
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('💸 Payment Sent!')
                        .setDescription(`Your payment of **${currencySymbol}${finalAmount} ${payment.currency === 'robux' ? 'Robux' : 'USD'}** has been marked as sent by **${interaction.user.tag}**!\n\nThank you for your work with Kavià Café. We appreciate you! 🎉`)
                        .setColor(0x2ECC71)
                        .addFields(
                            { name: '💰 Amount', value: `${currencySymbol}${finalAmount}`, inline: true },
                            { name: '📝 For', value: payment.description, inline: true },
                            { name: '🆔 Reference', value: `\`${paymentId}\``, inline: false }
                        )
                        .setTimestamp()
                    ]
                });
            } catch {}

            try {
                const { buildReceiptEmbed } = require('./commands/payment');
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'paid')] });
            } catch {}
            return;
        }

     // ========== PAYMENT SYSTEM ==========
        if (interaction.customId.startsWith('pay_accept_')) {
            const paymentId = interaction.customId.replace('pay_accept_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.targetId !== interaction.user.id) return interaction.reply({ content: '❌ This offer is not for you.', flags: 64 });
            if (payment.status !== 'pending' && payment.status !== 'countered') return interaction.reply({ content: '❌ This offer has already been responded to.', flags: 64 });
            await Payment.findByIdAndUpdate(paymentId, { status: 'accepted', $push: { history: { action: 'Accepted', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } } });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });
            await interaction.user.send({ embeds: [new EmbedBuilder().setTitle('✅ Offer Accepted!').setDescription('You have accepted the payment offer.\n\nBefore payment is sent, you will need to sign a brief usage agreement. Please wait for the agreement to be sent.').setColor(0x2ECC71).setTimestamp()] }).catch(() => {});
            try {
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) {
                    const { buildReceiptEmbed } = require('./commands/payment');
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('pay_sendagreement_' + paymentId).setLabel('📝 Send Agreement').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('pay_staffdecline_' + paymentId).setLabel('❌ Cancel Payment').setStyle(ButtonStyle.Danger)
                    );
                    await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'accepted')], components: [row] });
                }
            } catch (err) { console.error('Error posting payment accept log:', err); }
            return;
        }

        if (interaction.customId.startsWith('pay_decline_')) {
            const paymentId = interaction.customId.replace('pay_decline_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.targetId !== interaction.user.id) return interaction.reply({ content: '❌ This offer is not for you.', flags: 64 });
            if (payment.status !== 'pending' && payment.status !== 'countered') return interaction.reply({ content: '❌ This offer has already been responded to.', flags: 64 });
            await Payment.findByIdAndUpdate(paymentId, { status: 'declined', $push: { history: { action: 'Declined', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } } });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });
            await interaction.user.send({ embeds: [new EmbedBuilder().setTitle('❌ Offer Declined').setDescription('You have declined this payment offer. If this was a mistake, please contact the team directly.').setColor(0xE74C3C).setTimestamp()] }).catch(() => {});
            try { const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null); if (logChannel?.isTextBased()) { const { buildReceiptEmbed } = require('./commands/payment'); await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'declined')] }); } } catch {}
            return;
        }

        if (interaction.customId.startsWith('pay_counter_')) {
            const paymentId = interaction.customId.replace('pay_counter_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.targetId !== interaction.user.id) return interaction.reply({ content: '❌ This offer is not for you.', flags: 64 });
            if (payment.status !== 'pending' && payment.status !== 'countered') return interaction.reply({ content: '❌ This offer has already been responded to.', flags: 64 });
            const modal = new ModalBuilder().setCustomId('pay_countermodal_' + paymentId).setTitle('Request Different Amount');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('counteramount').setLabel('Your requested amount').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 500').setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('counternote').setLabel('Reason (optional)').setStyle(TextInputStyle.Paragraph).setPlaceholder('Why are you requesting a different amount?').setRequired(false))
            );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('pay_staffaccept_')) {
            const paymentId = interaction.customId.replace('pay_staffaccept_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            const hasPerms = await hasBotPermsRole(interaction.guildId || payment.serverId, interaction.user.id);
            if (!hasPerms) return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
            const newAmount = payment.counterAmount;
            await Payment.findByIdAndUpdate(paymentId, { amount: newAmount, counterAmount: null, status: 'countered', $push: { history: { action: 'Counter Accepted by Staff', by: interaction.user.id, byTag: interaction.user.tag, amount: newAmount, at: new Date() } } });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });
            try {
                const target = await client.users.fetch(payment.targetId);
                const cs = payment.currency === 'robux' ? 'R$' : '$';
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('pay_accept_' + paymentId).setLabel('✅ Yes, I accept').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('pay_decline_' + paymentId).setLabel('❌ No, decline').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('pay_counter_' + paymentId).setLabel('🔄 Request Different Amount').setStyle(ButtonStyle.Secondary)
                );
                await target.send({ embeds: [new EmbedBuilder().setTitle('✅ Counter Offer Accepted!').setDescription('Your counter offer has been accepted!\n\nThe new payment amount is **' + cs + newAmount + ' ' + (payment.currency === 'robux' ? 'Robux' : 'USD') + '**.\n\nPlease confirm you accept this updated amount.').setColor(0x2ECC71).addFields({ name: '📝 Description', value: payment.description }).setTimestamp()], components: [row] });
            } catch {}
            try { const { buildReceiptEmbed } = require('./commands/payment'); const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null); if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'countered')] }); } catch {}
            return;
        }

        if (interaction.customId.startsWith('pay_staffdeclinecounter_')) {
            const paymentId = interaction.customId.replace('pay_staffdeclinecounter_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            await Payment.findByIdAndUpdate(paymentId, { status: 'declined', $push: { history: { action: 'Counter Declined by Staff', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } } });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });
            try { const target = await client.users.fetch(payment.targetId); await target.send({ embeds: [new EmbedBuilder().setTitle('❌ Counter Offer Declined').setDescription('Unfortunately your counter offer was not accepted. The payment offer has been cancelled.').setColor(0xE74C3C).setTimestamp()] }); } catch {}
            try { const { buildReceiptEmbed } = require('./commands/payment'); const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null); if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'declined')] }); } catch {}
            return;
        }

        if (interaction.customId.startsWith('pay_staffdecline_')) {
            const paymentId = interaction.customId.replace('pay_staffdecline_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            await Payment.findByIdAndUpdate(paymentId, { status: 'declined', $push: { history: { action: 'Cancelled by Staff', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } } });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });
            try { const target = await client.users.fetch(payment.targetId); await target.send({ embeds: [new EmbedBuilder().setTitle('❌ Payment Cancelled').setDescription('This payment offer has been cancelled by the team.').setColor(0xE74C3C).setTimestamp()] }); } catch {}
            try { const { buildReceiptEmbed } = require('./commands/payment'); const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null); if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'declined')] }); } catch {}
            return;
        }

        if (interaction.customId.startsWith('pay_sendagreement_')) {
            const paymentId = interaction.customId.replace('pay_sendagreement_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            await interaction.update({ components: [] });
            const cs = payment.currency === 'robux' ? 'R$' : '$';
            const currentAmount = payment.counterAmount || payment.amount;
            try {
                const target = await client.users.fetch(payment.targetId);
                const { AGREEMENT_TEXT } = require('./commands/payment');
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('pay_agree_' + paymentId).setLabel('✅ I Agree').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('pay_disagree_' + paymentId).setLabel('❌ I Disagree').setStyle(ButtonStyle.Danger)
                );
                await target.send({ embeds: [new EmbedBuilder().setTitle('📝 Payment Agreement — Kavià Café').setColor(0x9B59B6).setDescription('Please read and agree to the following terms before your payment of **' + cs + currentAmount + ' ' + (payment.currency === 'robux' ? 'Robux' : 'USD') + '** is sent.').addFields({ name: '📋 Agreement Terms', value: AGREEMENT_TEXT }, { name: '💰 Payment Amount', value: cs + currentAmount + ' ' + (payment.currency === 'robux' ? 'Robux' : 'USD'), inline: true }, { name: '📝 For', value: payment.description, inline: true }, { name: '🆔 Your Discord ID', value: '`' + payment.targetId + '`', inline: true }, { name: '📛 Your Username', value: payment.targetTag, inline: true }).setFooter({ text: 'Ref: ' + payment._id + ' • Your Discord account serves as your digital signature' }).setTimestamp()], components: [row] });
                await interaction.followUp({ content: '✅ Agreement sent to **' + target.tag + '**.', flags: 64 });
            } catch { await interaction.followUp({ content: '❌ Could not send agreement — user may have DMs closed.', flags: 64 }); }
            return;
        }

        if (interaction.customId.startsWith('pay_agree_')) {
            const paymentId = interaction.customId.replace('pay_agree_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.targetId !== interaction.user.id) return interaction.reply({ content: '❌ This agreement is not for you.', flags: 64 });
            await Payment.findByIdAndUpdate(paymentId, { status: 'agreed', agreementSigned: true, agreementSignedAt: new Date(), $push: { history: { action: 'Agreement Signed', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } } });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });
            await interaction.user.send({ embeds: [new EmbedBuilder().setTitle('✅ Agreement Signed!').setDescription('Thank you for signing the agreement! Your payment will be sent shortly.').setColor(0x2ECC71).addFields({ name: '🆔 Reference', value: '`' + paymentId + '`' }).setTimestamp()] }).catch(() => {});
            try {
                const { buildReceiptEmbed } = require('./commands/payment');
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) {
                    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('pay_paid_' + paymentId).setLabel('💸 Mark as Paid').setStyle(ButtonStyle.Success));
                    await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'agreed')], components: [row] });
                }
            } catch (err) { console.error('Error posting agreement log:', err); }
            return;
        }

        if (interaction.customId.startsWith('pay_disagree_')) {
            const paymentId = interaction.customId.replace('pay_disagree_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.targetId !== interaction.user.id) return interaction.reply({ content: '❌ This agreement is not for you.', flags: 64 });
            await Payment.findByIdAndUpdate(paymentId, { status: 'declined', $push: { history: { action: 'Agreement Refused', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } } });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });
            await interaction.user.send({ embeds: [new EmbedBuilder().setTitle('❌ Agreement Declined').setDescription('You have declined the agreement. The payment has been cancelled.').setColor(0xE74C3C).setTimestamp()] }).catch(() => {});
            try { const { buildReceiptEmbed } = require('./commands/payment'); const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null); if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'declined')] }); } catch {}
            return;
        }

        if (interaction.customId.startsWith('pay_groupwait_')) {
            const paymentId = interaction.customId.replace('pay_groupwait_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            await Payment.findByIdAndUpdate(paymentId, {
                status: 'group_wait',
                $push: { history: { action: 'Group Wait Applied', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } }
            });
            await interaction.update({ components: [] });
            const cs = payment.currency === 'robux' ? 'R$' : '$';
            const finalAmount = payment.counterAmount || payment.amount;
            try {
                const target = await client.users.fetch(payment.targetId);
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('⏳ Payment On Hold — Group Membership')
                        .setDescription(`Hello!\n\nThank you for your work with **Kavià Café**! Unfortunately, due to Roblox's rules, you must be a member of the Kavià Café Roblox group for at least **14 days** before we are able to send your payment.\n\nYour payment of **${cs}${finalAmount} ${payment.currency === 'robux' ? 'Robux' : 'USD'}** is confirmed and will be sent automatically once the 14-day period has passed.\n\nWe appreciate your patience! 🎉`)
                        .setColor(0xF39C12)
                        .addFields(
                            { name: '💰 Amount', value: `${cs}${finalAmount}`, inline: true },
                            { name: '📝 For', value: payment.description, inline: true },
                            { name: '⏳ Wait Period', value: '14 days from today', inline: true }
                        )
                        .setTimestamp()
                    ]
                });
            } catch {}
            // Schedule reminder in log channel in 15 days
            const fireAt = Date.now() + 15 * 24 * 60 * 60 * 1000;
            setTimeout(async () => {
                try {
                    const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                    if (logChannel?.isTextBased()) {
                        const updated = await Payment.findById(paymentId);
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`pay_paid_${paymentId}`).setLabel('💸 Mark as Paid').setStyle(ButtonStyle.Success)
                        );
                        await logChannel.send({
                            content: `⏰ **14-day group wait is up!** Time to pay <@${payment.targetId}> their **${cs}${finalAmount}** for *${payment.description}*.`,
                            embeds: [buildReceiptEmbed(updated, 'group_wait')],
                            components: [row]
                        });
                    }
                } catch (err) { console.error('Error sending group wait reminder:', err); }
            }, fireAt - Date.now());
            try {
                const { buildReceiptEmbed } = require('./commands/payment');
                const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) {
                    await logChannel.send({ embeds: [buildReceiptEmbed(await Payment.findById(paymentId), 'group_wait')] });
                }
            } catch {}
            return;
        }

        if (interaction.customId.startsWith('pay_robloxmodal_')) {
            const paymentId = interaction.customId.replace('pay_robloxmodal_', '');
            const modal = new ModalBuilder().setCustomId(`pay_robloxusername_${paymentId}`).setTitle('Your Roblox Username');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('robloxusername')
                    .setLabel('Enter your exact Roblox username')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. Kaviacafe123')
                    .setRequired(true)
            ));
            await interaction.showModal(modal);
            return;
        }

       
        
     
        
        if (interaction.customId.startsWith('pay_paid_')) {
            const paymentId = interaction.customId.replace('pay_paid_', '');
            const payment = await Payment.findById(paymentId).catch(() => null);
            if (!payment) return interaction.reply({ content: '❌ Payment not found.', flags: 64 });
            if (payment.status !== 'agreed') return interaction.reply({ content: '❌ Agreement must be signed before marking as paid.', flags: 64 });
            await Payment.findByIdAndUpdate(paymentId, { status: 'paid', paid: true, paidAt: new Date(), paidBy: interaction.user.id, paidByTag: interaction.user.tag, $push: { history: { action: 'Marked as Paid', by: interaction.user.id, byTag: interaction.user.tag, at: new Date() } } });
            const updated = await Payment.findById(paymentId);
            await interaction.update({ components: [] });
            const cs = payment.currency === 'robux' ? 'R$' : '$';
            const finalAmount = payment.counterAmount || payment.amount;
            try { const target = await client.users.fetch(payment.targetId); await target.send({ embeds: [new EmbedBuilder().setTitle('💸 Payment Sent!').setDescription('Your payment of **' + cs + finalAmount + ' ' + (payment.currency === 'robux' ? 'Robux' : 'USD') + '** has been marked as sent by **' + interaction.user.tag + '**!\n\nThank you for your work with Kavià Café. We appreciate you! 🎉').setColor(0x2ECC71).addFields({ name: '💰 Amount', value: cs + finalAmount, inline: true }, { name: '📝 For', value: payment.description, inline: true }, { name: '🆔 Reference', value: '`' + paymentId + '`' }).setTimestamp()] }); } catch {}
            try { const { buildReceiptEmbed } = require('./commands/payment'); const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null); if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(updated, 'paid')] }); } catch {}
            return;
        }

        if (interaction.customId.startsWith('loa_extend_')) {
            const loaId = interaction.customId.replace('loa_extend_', '');
            const loa = await LOA.findById(loaId);
            if (!loa || interaction.user.id !== loa.userId) return interaction.reply({ content: '❌ This is not your LOA.', flags: 64 });
            const modal = new ModalBuilder().setCustomId(`loa_extendmodal_${loaId}`).setTitle('Request LOA Extension');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('extendtime').setLabel('How much more time do you need?').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 1 week, 2 weeks, 1 month').setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('newreturndate').setLabel('New return date (DD/MM/YY)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 25/04/26').setRequired(true))
            );
            await interaction.showModal(modal);
            return;
        }

        // ========== APPLICATION DM — scale / choice button answers ==========
        if (interaction.customId.startsWith('app_dmscale_') || interaction.customId.startsWith('app_dmchoice_')) {
            const { pendingDMs, parseQuestion } = require('./commands/application');
            const appSession = pendingDMs.get(interaction.user.id);
            if (!appSession) return interaction.reply({ content: '❌ No active application session.', flags: 64 });

            // Derive the answer label
            let answerLabel;
            if (interaction.customId.startsWith('app_dmscale_')) {
                answerLabel = interaction.customId.split('_').pop(); // the number
            } else {
                // app_dmchoice_<userId>_<index>
                const idx = parseInt(interaction.customId.split('_').pop());
                const currentQ = parseQuestion(appSession.questions[appSession.questionIndex]);
                answerLabel = currentQ.choices[idx] ?? `Option ${idx + 1}`;
            }

            // Disable the buttons on the answered message
            await interaction.update({ components: [] });

            appSession.answers.push(answerLabel);
            const nextIndex = appSession.questionIndex + 1;

            if (nextIndex < appSession.questions.length) {
                appSession.questionIndex = nextIndex;
                pendingDMs.set(interaction.user.id, appSession);
                const nextQ = parseQuestion(appSession.questions[nextIndex]);
                let components = [];
                if (nextQ.type === 'scale') {
                    components = [
                        new ActionRowBuilder().addComponents(...[1,2,3,4,5].map(n => new ButtonBuilder().setCustomId(`app_dmscale_${interaction.user.id}_${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary))),
                        new ActionRowBuilder().addComponents(...[6,7,8,9,10].map(n => new ButtonBuilder().setCustomId(`app_dmscale_${interaction.user.id}_${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary)))
                    ];
                } else if (nextQ.type === 'choice') {
                    components = [new ActionRowBuilder().addComponents(
                        ...nextQ.choices.map((c, i) => new ButtonBuilder().setCustomId(`app_dmchoice_${interaction.user.id}_${i}`).setLabel(c).setStyle(ButtonStyle.Primary))
                    )];
                }
                const embed = new EmbedBuilder()
                    .setTitle(`📝 ${appSession.formName}${appSession.isResubmit ? ' (Resubmission)' : ''}`)
                    .setColor(appSession.isResubmit ? 0xe67e22 : 0x5865f2)
                    .setDescription(`**Question ${nextIndex + 1} of ${appSession.questions.length}:**\n${nextQ.display}`)
                    .setFooter({ text: nextQ.type === 'text' ? 'Type your answer below. Type "cancel" to cancel.' : 'Click a button to answer. Type "cancel" to cancel.' });
                await interaction.followUp({ embeds: [embed], components });
            } else {
                // All questions answered — show review/confirm prompt
                appSession.state = 'review';
                pendingDMs.set(interaction.user.id, appSession);

                const reviewLines = appSession.questions.map((q, i) => {
                    const { display } = parseQuestion(q);
                    return `**Q${i + 1}:** ${display.slice(0, 80)}\n> ${appSession.answers[i] || '*(no answer)*'}`;
                });
                const reviewEmbed = new EmbedBuilder()
                    .setTitle(`📋 Review Your Answers — ${appSession.formName}`)
                    .setColor(0xf1c40f)
                    .setDescription(reviewLines.join('\n\n'))
                    .setFooter({ text: 'Submit when you\'re happy, Start Over to redo, or Never Mind to cancel.' });

                const reviewRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`app_dmsubmit_${interaction.user.id}`).setLabel('✅ Submit Application').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`app_dmrestart_${interaction.user.id}`).setLabel('🔄 Start Over').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`app_dmnvm_${interaction.user.id}`).setLabel('✖️ Never Mind').setStyle(ButtonStyle.Danger)
                );

                await interaction.followUp({ embeds: [reviewEmbed], components: [reviewRow] });
            }
            return;
        }

        // ========== APPLICATION BUTTONS ==========
        if (interaction.customId.startsWith('app_apply_')) {
            // Defer immediately — DB queries below would exceed the 3-second window
            await interaction.deferReply({ flags: 64 });

            const formId = interaction.customId.replace('app_apply_', '');
            const { AppForm, AppSubmission } = require('./db');
            const form = await AppForm.findById(formId).catch(() => null);
            if (!form) return interaction.editReply({ content: '❌ This application form no longer exists.' });
            if (!form.open) return interaction.editReply({ content: '❌ Applications are currently closed.' });

            const existing = await AppSubmission.findOne({ formId, userId: interaction.user.id, status: 'pending' });
            if (existing) return interaction.editReply({ content: '⏳ You already have a pending application for this form.' });

            const { pendingDMs } = require('./commands/application');
            const isResubmit = !!(await AppSubmission.findOne({ formId, userId: interaction.user.id, status: 'declined' }));

            try {
                const dm = await interaction.user.createDM();

                // Show intro/description first — let them decide to start or back out
                const introEmbed = new EmbedBuilder()
                    .setTitle(`📝 ${form.name}${isResubmit ? ' (Resubmission)' : ''}`)
                    .setColor(isResubmit ? 0xe67e22 : 0x5865f2)
                    .setDescription(
                        (isResubmit ? '> ⚠️ **This is a resubmission.** Please ensure your answers address any previous feedback.\n\n' : '') +
                        (form.description ? form.description + '\n\n' : '') +
                        `This application has **${form.questions.length} question${form.questions.length !== 1 ? 's' : ''}**.\n\nWhen you're ready, click **Start Application** below.`
                    )
                    .setFooter({ text: 'You can cancel at any time by clicking Never Mind.' });

                const introRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`app_dmstart_${interaction.user.id}_${formId}`)
                        .setLabel('▶️ Start Application')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`app_dmnvm_${interaction.user.id}`)
                        .setLabel('✖️ Never Mind')
                        .setStyle(ButtonStyle.Secondary)
                );

                await dm.send({ embeds: [introEmbed], components: [introRow] });

                // Store session in "intro" state — no questions started yet
                pendingDMs.set(interaction.user.id, {
                    formId,
                    formName: form.name,
                    answers: [],
                    questionIndex: 0,
                    isResubmit,
                    questions: form.questions,
                    state: 'intro'   // 'intro' | 'active' | 'review'
                });

                return interaction.editReply({ content: '📬 Check your DMs! I\'ve sent you the application details.' });
            } catch (err) {
                if (err.code === 40060) return;
                console.error('[app_apply DM error]', err);
                return interaction.editReply({ content: '❌ I couldn\'t DM you. Please enable DMs from server members and try again.' }).catch(() => {});
            }
        }

        // ===== APPLICATION DM — Start button =====
        if (interaction.customId.startsWith('app_dmstart_')) {
            const { pendingDMs, parseQuestion } = require('./commands/application');
            const appSession = pendingDMs.get(interaction.user.id);
            if (!appSession) return interaction.update({ content: '❌ Session expired. Please click Apply Now again.', components: [], embeds: [] });

            appSession.state = 'active';
            appSession.answers = [];
            appSession.questionIndex = 0;
            pendingDMs.set(interaction.user.id, appSession);

            const q0 = parseQuestion(appSession.questions[0]);
            let components = [];
            if (q0.type === 'scale') {
                components = [
                    new ActionRowBuilder().addComponents(...[1,2,3,4,5].map(n => new ButtonBuilder().setCustomId(`app_dmscale_${interaction.user.id}_${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary))),
                    new ActionRowBuilder().addComponents(...[6,7,8,9,10].map(n => new ButtonBuilder().setCustomId(`app_dmscale_${interaction.user.id}_${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary)))
                ];
            } else if (q0.type === 'choice') {
                components = [new ActionRowBuilder().addComponents(
                    ...q0.choices.map((c, i) => new ButtonBuilder().setCustomId(`app_dmchoice_${interaction.user.id}_${i}`).setLabel(c).setStyle(ButtonStyle.Primary))
                )];
            }
            const qEmbed = new EmbedBuilder()
                .setTitle(`📝 ${appSession.formName}${appSession.isResubmit ? ' (Resubmission)' : ''}`)
                .setColor(appSession.isResubmit ? 0xe67e22 : 0x5865f2)
                .setDescription(`**Question 1 of ${appSession.questions.length}:**\n${q0.display}`)
                .setFooter({ text: q0.type === 'text' ? 'Type your answer below. Type "cancel" to cancel.' : 'Click a button to answer. Type "cancel" to cancel.' });

            await interaction.update({ components: [] }); // disable Start/Never Mind buttons
            await interaction.followUp({ embeds: [qEmbed], components });
            return;
        }

        // ===== APPLICATION DM — Never Mind (intro stage or review stage) =====
        if (interaction.customId.startsWith('app_dmnvm_')) {
            const { pendingDMs } = require('./commands/application');
            pendingDMs.delete(interaction.user.id);
            return interaction.update({ content: '❌ Application cancelled. You can always apply again later!', components: [], embeds: [] });
        }

        // ===== APPLICATION DM — Submit (review stage) =====
        if (interaction.customId.startsWith('app_dmsubmit_')) {
            const { pendingDMs, parseQuestion } = require('./commands/application');
            const appSession = pendingDMs.get(interaction.user.id);
            if (!appSession) return interaction.update({ content: '❌ Session expired.', components: [], embeds: [] });

            pendingDMs.delete(interaction.user.id);
            await interaction.update({ components: [] }); // disable the review buttons

            try {
                const { AppForm, AppSubmission } = require('./db');
                const form = await AppForm.findById(appSession.formId);
                if (!form) { await interaction.followUp('❌ The application form no longer exists.'); return; }

                const submission = await AppSubmission.create({
                    formId: appSession.formId,
                    formName: appSession.formName,
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    answers: appSession.answers,
                    status: 'pending',
                    isResubmit: appSession.isResubmit,
                    submittedAt: new Date()
                });

                await interaction.followUp({ embeds: [new EmbedBuilder()
                    .setTitle('✅ Application Submitted!')
                    .setDescription(`Your application for **${form.name}** has been submitted. You'll receive a DM when it's been reviewed.`)
                    .setColor(0x57f287).setTimestamp()] });

                // Post to log channel
                const logChannel = await client.channels.fetch(form.logChannelId).catch(() => null);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle(`📋 New Application${appSession.isResubmit ? ' (Resubmission ⚠️)' : ''} — ${form.name}`)
                        .setColor(appSession.isResubmit ? 0xe67e22 : 0x5865f2)
                        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤 Applicant', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
                            { name: '🆔 User ID', value: interaction.user.id, inline: true },
                            { name: '📅 Submitted', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                            ...form.questions.map((q, i) => ({
                                name: `Q${i + 1}: ${q.length > 80 ? q.slice(0, 77) + '...' : q}`,
                                value: appSession.answers[i] || '*No answer*'
                            }))
                        )
                        .setFooter({ text: `Submission ID: ${submission._id}` })
                        .setTimestamp();
                    const logRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`app_pass_${submission._id}`).setLabel('✅ Pass').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`app_ticket_${submission._id}`).setLabel('🎫 Send to Ticket').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId(`app_decline_${submission._id}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`app_remind_${submission._id}`).setLabel('🔔 Remind Me').setStyle(ButtonStyle.Secondary)
                    );
                    const logMsg = await logChannel.send({ embeds: [logEmbed], components: [logRow] });
                    await AppSubmission.findByIdAndUpdate(submission._id, { logMessageId: logMsg.id, logChannelId: form.logChannelId });
                    const notifyRoleId = form.notifyRoleId || '1480839573390233702';
                    await logChannel.send({ content: `<@&${notifyRoleId}> — new application from <@${interaction.user.id}>` }).catch(() => {});
                }
            } catch (err) {
                console.error('[app_dmsubmit error]', err);
                await interaction.followUp('❌ Failed to submit your application. Please try again.').catch(() => {});
            }
            return;
        }

        // ===== APPLICATION DM — Restart (review stage → back to Q1) =====
        if (interaction.customId.startsWith('app_dmrestart_')) {
            const { pendingDMs, parseQuestion } = require('./commands/application');
            const appSession = pendingDMs.get(interaction.user.id);
            if (!appSession) return interaction.update({ content: '❌ Session expired. Please click Apply Now again.', components: [], embeds: [] });

            appSession.answers = [];
            appSession.questionIndex = 0;
            appSession.state = 'active';
            pendingDMs.set(interaction.user.id, appSession);

            const q0 = parseQuestion(appSession.questions[0]);
            let components = [];
            if (q0.type === 'scale') {
                components = [
                    new ActionRowBuilder().addComponents(...[1,2,3,4,5].map(n => new ButtonBuilder().setCustomId(`app_dmscale_${interaction.user.id}_${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary))),
                    new ActionRowBuilder().addComponents(...[6,7,8,9,10].map(n => new ButtonBuilder().setCustomId(`app_dmscale_${interaction.user.id}_${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary)))
                ];
            } else if (q0.type === 'choice') {
                components = [new ActionRowBuilder().addComponents(
                    ...q0.choices.map((c, i) => new ButtonBuilder().setCustomId(`app_dmchoice_${interaction.user.id}_${i}`).setLabel(c).setStyle(ButtonStyle.Primary))
                )];
            }
            const qEmbed = new EmbedBuilder()
                .setTitle(`📝 ${appSession.formName}${appSession.isResubmit ? ' (Resubmission)' : ''}`)
                .setColor(appSession.isResubmit ? 0xe67e22 : 0x5865f2)
                .setDescription(`🔄 Restarted!\n\n**Question 1 of ${appSession.questions.length}:**\n${q0.display}`)
                .setFooter({ text: q0.type === 'text' ? 'Type your answer below. Type "cancel" to cancel.' : 'Click a button to answer. Type "cancel" to cancel.' });

            await interaction.update({ components: [] });
            await interaction.followUp({ embeds: [qEmbed], components });
            return;
        }

        if (interaction.customId.startsWith('app_pass_')) {
            const subId = interaction.customId.replace('app_pass_', '');
            const { AppSubmission, AppForm } = require('./db');
            const sub = await AppSubmission.findById(subId);
            if (!sub) return interaction.reply({ content: '❌ Submission not found.', flags: 64 });
            if (sub.status !== 'pending') return interaction.reply({ content: `❌ Already ${sub.status}.`, flags: 64 });

            await AppSubmission.findByIdAndUpdate(subId, { status: 'passed', passedBy: interaction.user.id, passedAt: new Date() });

            // Edit the log message
            const embed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x57f287)
                .setFooter({ text: `✅ Passed by ${interaction.user.tag}` });
            await interaction.message.edit({ embeds: [embed], components: [] }).catch(() => {});

            // DM applicant
            const user = await interaction.client.users.fetch(sub.userId).catch(() => null);
            if (user) {
                await user.send({
                    embeds: [new EmbedBuilder()
                        .setTitle(`✅ Application Update — ${sub.formName}`)
                        .setDescription(`Your application has been **passed**! A staff member will follow up with next steps.`)
                        .setColor(0x57f287)
                        .setTimestamp()]
                }).catch(() => {});
            }

            return interaction.reply({ content: '✅ Application passed. Applicant has been notified.', flags: 64 });
        }

        if (interaction.customId.startsWith('app_ticket_')) {
            const subId = interaction.customId.replace('app_ticket_', '');
            const { AppSubmission, AppForm, AppTicketWatch } = require('./db');
            const sub = await AppSubmission.findById(subId);
            if (!sub) return interaction.reply({ content: '❌ Submission not found.', flags: 64 });

            const form = await AppForm.findById(sub.formId);
            if (!form) return interaction.reply({ content: '❌ Form not found.', flags: 64 });

            // DM applicant with ticket channel link
            const user = await interaction.client.users.fetch(sub.userId).catch(() => null);
            if (user) {
                await user.send({
                    embeds: [new EmbedBuilder()
                        .setTitle(`📋 Application Update — ${sub.formName}`)
                        .setDescription(
                            `A staff member has reviewed your application and would like you to **open a support ticket**.\n\n` +
                            `Please open a ticket in: <#${form.ticketChannelId}>\n` +
                            `Server: **${form.ticketServerName}**`
                        )
                        .setColor(0xf1c40f)
                        .setTimestamp()]
                }).catch(() => {});
            }

            // Update submission status to reflect ticket was requested
            await AppSubmission.findByIdAndUpdate(subId, { status: 'ticket_sent' }).catch(() => {});

            // Save a 48-hour watch so we can detect if they open a ticket
            await AppTicketWatch.create({
                userId:       sub.userId,
                submissionId: String(sub._id),
                formId:       sub.formId,
                formName:     sub.formName,
                logChannelId: sub.logChannelId || form.logChannelId,
                logMessageId: sub.logMessageId || null,
                staffId:      interaction.user.id,
                expiresAt:    new Date(Date.now() + 48 * 60 * 60 * 1000),
                triggered:    false
            }).catch(() => {});

            await interaction.reply({ content: `✅ Applicant has been directed to open a ticket in **${form.ticketServerName}** → #${form.ticketChannelName}.\n📋 I'll watch for their ticket over the next **48 hours** and let you know when they open one.`, flags: 64 });
        }

        if (interaction.customId.startsWith('app_remind_')) {
            const subId = interaction.customId.replace('app_remind_', '');
            const { AppSubmission } = require('./db');
            const sub = await AppSubmission.findById(subId);
            if (!sub) return interaction.reply({ content: '❌ Submission not found.', flags: 64 });

            // DM the reviewer a reminder after 1 hour
            const reviewer = interaction.user;
            setTimeout(async () => {
                try {
                    await reviewer.send({
                        embeds: [new EmbedBuilder()
                            .setTitle('🔔 Application Reminder')
                            .setDescription(`You asked to be reminded about an application from **${sub.userTag}** for **${sub.formName}**.\n\nHead back to the log channel to review it.`)
                            .setColor(0x3498db)
                            .setTimestamp()]
                    });
                } catch {}
            }, 60 * 60 * 1000); // 1 hour

            return interaction.reply({ content: '🔔 I\'ll remind you about this application in **1 hour**.', flags: 64 });
        }

        // ========== APPLICATION WATCH — ticket link confirm ==========
        if (interaction.customId.startsWith('appwatch_yes_') || interaction.customId.startsWith('appwatch_no_')) {
            const isYes   = interaction.customId.startsWith('appwatch_yes_');
            const watchId = interaction.customId.replace(isYes ? 'appwatch_yes_' : 'appwatch_no_', '');
            const { AppTicketWatch, AppSubmission } = require('./db');
            const watch = await AppTicketWatch.findById(watchId).catch(() => null);

            if (!watch) return interaction.update({ content: '❌ Watch record not found or already handled.', components: [], embeds: [] });

            if (isYes) {
                // Post in the submission log channel that the ticket was opened
                try {
                    const logCh = await client.channels.fetch(watch.logChannelId).catch(() => null);
                    if (logCh) {
                        // Build jump link to this ticket channel
                        const ticketJumpUrl = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}`;
                        const updateEmbed = new EmbedBuilder()
                            .setTitle('🎫 Ticket Opened')
                            .setDescription(`<@${watch.userId}> has opened a ticket for their **${watch.formName}** application.\n\n[**Click to go to their ticket**](${ticketJumpUrl})`)
                            .setColor(0x57f287)
                            .setTimestamp();

                        if (watch.logMessageId) {
                            // Reply to the original submission log message
                            const logMsg = await logCh.messages.fetch(watch.logMessageId).catch(() => null);
                            if (logMsg) await logMsg.reply({ embeds: [updateEmbed] }).catch(() => logCh.send({ embeds: [updateEmbed] }));
                            else await logCh.send({ embeds: [updateEmbed] });
                        } else {
                            await logCh.send({ embeds: [updateEmbed] });
                        }
                    }
                    await AppSubmission.findByIdAndUpdate(watch.submissionId, { status: 'ticket_opened' }).catch(() => {});
                } catch (err) { console.error('[appwatch yes]', err); }

                await interaction.update({ content: `✅ Noted — the submission log has been updated with a link to this ticket.`, components: [], embeds: [] });
            } else {
                // No — unrelated ticket, untrigger so it can still match a future ticket
                await AppTicketWatch.findByIdAndUpdate(watchId, { triggered: false }).catch(() => {});
                return interaction.update({ content: `Got it — marked as unrelated. Still watching for their application ticket.`, components: [], embeds: [] });
            }

            // Only reached on Yes — clean up the watch
            await AppTicketWatch.findByIdAndDelete(watchId).catch(() => {});
            return;
        }

        if (interaction.customId.startsWith('app_decline_')) {
            const subId = interaction.customId.replace('app_decline_', '');
            const modal = new ModalBuilder()
                .setCustomId(`app_declinemodal_${subId}`)
                .setTitle('Decline Application');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('Reason for declining')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Be clear and constructive — this will be sent to the applicant.')
                        .setRequired(true)
                        .setMaxLength(1000)
                )
            );
            await interaction.showModal(modal);
            return;
        }

        // ========== GIVEAWAY BUTTONS ==========
        if (interaction.customId.startsWith('giveaway_enter_')) {
            const gwId = interaction.customId.replace('giveaway_enter_', '');
            const { activeGiveaways } = require('./commands/giveaway');
            const gw = activeGiveaways.get(gwId);
            if (!gw || gw.ended) return interaction.reply({ content: '❌ This giveaway has ended.', flags: 64 });
            if (gw.participants.has(interaction.user.id)) return interaction.reply({ content: '✅ You\'re already entered! Good luck!', flags: 64 });
            gw.participants.set(interaction.user.id, 0);
            // Persist new participant to DB
            try {
                const { Giveaway } = require('./db');
                await Giveaway.findOneAndUpdate(
                    { giveawayId: gwId },
                    { $push: { participants: { userId: interaction.user.id, msgCount: 0 } } }
                );
            } catch (err) { console.error('[giveaway] DB enter error:', err); }
            const msgReq = gw.config.requiredMessages > 0
                ? ` Send **${gw.config.requiredMessages} message${gw.config.requiredMessages !== 1 ? 's' : ''}** in <#${gw.config.channelId}> to qualify for the draw.`
                : ' Good luck!';
            return interaction.reply({ content: `🎉 You've entered the giveaway!${msgReq}`, flags: 64 });
        }

        if (interaction.customId.startsWith('giveaway_leave_')) {
            const gwId = interaction.customId.replace('giveaway_leave_', '');
            const { activeGiveaways } = require('./commands/giveaway');
            const gw = activeGiveaways.get(gwId);
            if (!gw || gw.ended) return interaction.reply({ content: '❌ This giveaway has ended.', flags: 64 });
            if (!gw.participants.has(interaction.user.id)) return interaction.reply({ content: "❌ You're not entered in this giveaway.", flags: 64 });
            gw.participants.delete(interaction.user.id);
            try {
                const { Giveaway } = require('./db');
                await Giveaway.findOneAndUpdate(
                    { giveawayId: gwId },
                    { $pull: { participants: { userId: interaction.user.id } } }
                );
            } catch (err) { console.error('[giveaway] DB leave error:', err); }
            return interaction.reply({ content: '👋 You\'ve left the giveaway.', flags: 64 });
        }

        if (interaction.customId.startsWith('giveaway_end_')) {
            const gwId = interaction.customId.replace('giveaway_end_', '');
            const { activeGiveaways, endGiveaway } = require('./commands/giveaway');
            const gw = activeGiveaways.get(gwId);
            if (!gw || gw.ended) return interaction.reply({ content: '❌ Giveaway not found or already ended.', flags: 64 });
            if (interaction.user.id !== gw.config.hostId && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: '❌ Only the host or staff can end this early.', flags: 64 });
            }
            await interaction.reply({ content: '⏹️ Ending giveaway...', flags: 64 });
            await endGiveaway(interaction.client, gwId);
            return;
        }

        return;
    } catch (err) {
        // Silently ignore double-ack (40060) — usually a double-click; all other errors are logged
        if (err.code !== 40060) console.error('[button handler error]', err);
    } }

    if (interaction.isModalSubmit()) {

        // ========== PR TICKET — alliance application form modal ==========
        if (interaction.customId.startsWith('ticket_pr_alliance_form_')) {
            await interaction.deferUpdate().catch(() => {});
            try {
                // customId format: ticket_pr_alliance_form_{caseId}_{type}
                const parts    = interaction.customId.replace('ticket_pr_alliance_form_', '').split('_');
                // customId format: ticket_pr_alliance_form_{caseId}_exemption
                parts.pop(); // remove 'exemption'
                const caseId = parts.join('_');

                const discordInvite  = interaction.fields.getTextInputValue('discord_invite').trim();
                const discordMembers = interaction.fields.getTextInputValue('discord_members').trim();
                const robloxMembers  = interaction.fields.getTextInputValue('roblox_members').trim();

                const ALLIANCE_LOG_CHANNEL_ID = '1485715416490836089';
                const ALLIANCE_PING_ROLE_ID   = '1449021407282593937';
                const ALLIANCE_GUILD_ID       = '1385081586285940796';

                // ── Log to alliance channel ──
                try {
                    const allianceGuild = await client.guilds.fetch(ALLIANCE_GUILD_ID);
                    const logChannel    = await allianceGuild.channels.fetch(ALLIANCE_LOG_CHANNEL_ID);
                    if (logChannel?.isTextBased()) {
                        const logEmbed = new EmbedBuilder()
                            .setColor(0xE67E22)
                            .setTitle('⚠️ Alliance Exemption Request')
                            .addFields(
                                { name: 'Applicant', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
                                { name: 'Ticket', value: `#${caseId}`, inline: true },
                                { name: 'Discord Invite', value: discordInvite },
                                { name: 'Discord Members', value: discordMembers, inline: true },
                                { name: 'Roblox Members', value: robloxMembers, inline: true },
                                { name: 'Note', value: '⚠️ Does not meet standard requirements — requesting exemption', inline: false }
                            )
                            .setFooter({ text: 'Kavià Café • Alliance System' })
                            .setTimestamp();
                        await logChannel.send({
                            content: `<@&${ALLIANCE_PING_ROLE_ID}>`,
                            embeds: [logEmbed]
                        });
                    }
                } catch (logErr) {
                    console.error('[alliance log error]', logErr);
                }

                // ── Confirm in the ticket channel ──
                await interaction.channel.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0xE67E22)
                        .setTitle('📝 Exemption Request Submitted')
                        .setDescription(
                            `Your exemption request has been submitted to our staff team! They will review your group and get back to you shortly.\n\n**Please be patient** — we'll update you right here in this ticket.`
                        )
                    ]
                });

            } catch (err) {
                console.error('[alliance form modal error]', err);
                await interaction.channel.send({ content: '❌ Something went wrong processing your application. Please let staff know.' }).catch(() => {});
            }
            return;
        }

if (interaction.customId.startsWith('dmreplymodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const targetUserId = interaction.customId.replace('dmreplymodal_', '');
                const replyMessage = interaction.fields.getTextInputValue('replymessage');
                const targetUser = await client.users.fetch(targetUserId).catch(() => null);
                if (!targetUser) return interaction.editReply({ content: '❌ Could not find that user.' });

                const logChannelId = client.dmLogChannels?.get(targetUserId) || '1462580398935642144';
                const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;

                const userEmbed = new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('📩 **Staff Direct Message**')
                    .setDescription(`**${replyMessage}**`)
                    .addFields({ name: '🕒 Time & Date', value: timestamp })
                    .setFooter({ text: 'Kavià Café Staff Team' });

                await targetUser.send({ embeds: [userEmbed] });
                await interaction.editReply({ content: `✅ Reply sent to **${targetUser.tag}**` });

                const logEmbed = new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('💬 **DM Sent (Reply)**')
                    .addFields(
                        { name: '📤 From (Staff)', value: `${interaction.user.tag} (${interaction.user.id})` },
                        { name: '📥 To (User)', value: `${targetUser.tag} (${targetUser.id})` },
                        { name: '📝 Message', value: replyMessage },
                        { name: '🕒 Date & Time', value: timestamp }
                    )
                    .setFooter({ text: 'Kavià Café • DM Logs' });

                const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) await logChannel.send({ embeds: [logEmbed] });

            } catch (err) {
                console.error('Error sending DM reply:', err);
                try { await interaction.editReply({ content: '❌ Could not send reply. They may have DMs closed.' }); } catch {}
            }
            return;
        }

        if (interaction.customId.startsWith('pay_robloxusername_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const paymentId = interaction.customId.replace('pay_robloxusername_', '');
                const robloxUsername = interaction.fields.getTextInputValue('robloxusername').trim();
                await Payment.findByIdAndUpdate(paymentId, { robloxUsername });
                await interaction.editReply({ content: `✅ Roblox username **${robloxUsername}** saved! Thank you.` });
                const payment = await Payment.findById(paymentId);
                try {
                    const { buildReceiptEmbed } = require('./commands/payment');
                    const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                    if (logChannel?.isTextBased()) await logChannel.send({ embeds: [buildReceiptEmbed(payment, payment.status)] });
                } catch {}
            } catch (err) {
                console.error('Error saving roblox username:', err);
                try { await interaction.editReply({ content: '❌ Error saving username.' }); } catch {}
            }
            return;
        }

        if (interaction.customId.startsWith('pay_countermodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const paymentId = interaction.customId.replace('pay_countermodal_', '');
                const payment = await Payment.findById(paymentId).catch(() => null);
                if (!payment) return interaction.editReply({ content: '❌ Payment not found.' });
                if (payment.targetId !== interaction.user.id) return interaction.editReply({ content: '❌ This offer is not for you.' });

                const counterAmountRaw = interaction.fields.getTextInputValue('counteramount');
                const counterNote = interaction.fields.getTextInputValue('counternote') || 'No reason provided';
                const counterAmount = parseFloat(counterAmountRaw.replace(/[^0-9.]/g, ''));

                if (isNaN(counterAmount) || counterAmount <= 0) {
                    return interaction.editReply({ content: '❌ Please enter a valid amount.' });
                }

                await Payment.findByIdAndUpdate(paymentId, {
                    counterAmount,
                    status: 'counter_pending',
                    $push: { history: { action: 'Counter Offer Submitted', by: interaction.user.id, byTag: interaction.user.tag, amount: counterAmount, at: new Date(), note: counterNote } }
                });
                const updated = await Payment.findById(paymentId);

                await interaction.editReply({ content: `✅ Counter offer of **${payment.currency === 'robux' ? 'R$' : '$'}${counterAmount}** submitted! Please wait for the team to review.` });

                // Notify in log channel
                try {
                    const { buildReceiptEmbed } = require('./commands/payment');
                    const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                    if (logChannel?.isTextBased()) {
                        const currencySymbol = payment.currency === 'robux' ? 'R$' : '$';
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`pay_staffaccept_${paymentId}`)
                                .setLabel(`✅ Accept ${currencySymbol}${counterAmount}`)
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`pay_staffdeclinecounter_${paymentId}`)
                                .setLabel('❌ Decline Counter')
                                .setStyle(ButtonStyle.Danger)
                        );
                        await logChannel.send({
                            content: `⚠️ **${interaction.user.tag}** has submitted a counter offer of **${currencySymbol}${counterAmount}**${counterNote !== 'No reason provided' ? ` — *"${counterNote}"*` : ''}`,
                            embeds: [buildReceiptEmbed(updated, 'counter_pending')],
                            components: [row]
                        });
                    }
                } catch (err) { console.error('Error posting counter offer log:', err); }
            } catch (err) {
                console.error('Error handling counter offer:', err);
                try { await interaction.editReply({ content: '❌ Error submitting counter offer.' }); } catch {}
            }
            return;
        }

       if (interaction.customId.startsWith('pay_countermodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const paymentId = interaction.customId.replace('pay_countermodal_', '');
                const payment = await Payment.findById(paymentId).catch(() => null);
                if (!payment) return interaction.editReply({ content: '❌ Payment not found.' });
                if (payment.targetId !== interaction.user.id) return interaction.editReply({ content: '❌ This offer is not for you.' });
                const counterAmountRaw = interaction.fields.getTextInputValue('counteramount');
                const counterNote = interaction.fields.getTextInputValue('counternote') || 'No reason provided';
                const counterAmount = parseFloat(counterAmountRaw.replace(/[^0-9.]/g, ''));
                if (isNaN(counterAmount) || counterAmount <= 0) return interaction.editReply({ content: '❌ Please enter a valid amount.' });
                await Payment.findByIdAndUpdate(paymentId, { counterAmount, status: 'counter_pending', $push: { history: { action: 'Counter Offer Submitted', by: interaction.user.id, byTag: interaction.user.tag, amount: counterAmount, at: new Date(), note: counterNote } } });
                const updated = await Payment.findById(paymentId);
                await interaction.editReply({ content: '✅ Counter offer of **' + (payment.currency === 'robux' ? 'R$' : '$') + counterAmount + '** submitted! Please wait for the team to review.' });
                try {
                    const { buildReceiptEmbed } = require('./commands/payment');
                    const logChannel = await client.channels.fetch(payment.logChannelId).catch(() => null);
                    if (logChannel?.isTextBased()) {
                        const cs = payment.currency === 'robux' ? 'R$' : '$';
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('pay_staffaccept_' + paymentId).setLabel('✅ Accept ' + cs + counterAmount).setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId('pay_staffdeclinecounter_' + paymentId).setLabel('❌ Decline Counter').setStyle(ButtonStyle.Danger)
                        );
                        await logChannel.send({ content: '⚠️ **' + interaction.user.tag + '** submitted a counter offer of **' + cs + counterAmount + '**' + (counterNote !== 'No reason provided' ? ' — *"' + counterNote + '"*' : ''), embeds: [buildReceiptEmbed(updated, 'counter_pending')], components: [row] });
                    }
                } catch (err) { console.error('Error posting counter offer log:', err); }
            } catch (err) { console.error('Error handling counter offer:', err); try { await interaction.editReply({ content: '❌ Error submitting counter offer.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('ts_newpanel_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const channelId = interaction.customId.replace('ts_newpanel_', '');
                const title = interaction.fields.getTextInputValue('title');
                const description = interaction.fields.getTextInputValue('description');
                const guild = interaction.guild;
                await guild.channels.fetch();
                const textChannel = await guild.channels.fetch(channelId);

                let ticketCategory = guild.channels.cache.find(c => c.name === '🎫 Tickets' && c.type === ChannelType.GuildCategory);
                if (!ticketCategory) ticketCategory = await guild.channels.create({ name: '🎫 Tickets', type: ChannelType.GuildCategory, position: 0 });

                const logChannel = await guild.channels.create({
                    name: 'ticket-logs', type: ChannelType.GuildText, parent: ticketCategory.id,
                    permissionOverwrites: [
                        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                    ]
                });

                const embed = new EmbedBuilder()
                    .setTitle(title).setDescription(description).setColor(0x5865F2)
                    .addFields({ name: '📊 Ticket Utilization', value: 'No categories yet. Use `/ticketsetup` to add categories!' })
                    .setImage(PANEL_IMAGE)
                    .setTimestamp();

                const msg = await textChannel.send({ embeds: [embed] });

                await TicketPanel.create({
                    serverId: guild.id, channelId: textChannel.id, logChannelId: logChannel.id,
                    messageId: msg.id, title, description, categories: [], ticketCategoryId: ticketCategory.id, createdAt: new Date()
                });

                await interaction.editReply({ content: `✅ Panel created in <#${textChannel.id}>! Now run \`/ticketsetup\` again in that channel to add categories.` });
            } catch (err) { console.error('Error creating new panel:', err); try { await interaction.editReply({ content: '❌ Error creating panel.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('ts_editpanelmodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const panelId = interaction.customId.replace('ts_editpanelmodal_', '');
                const title = interaction.fields.getTextInputValue('title');
                const description = interaction.fields.getTextInputValue('description');
                const panel = await TicketPanel.findByIdAndUpdate(panelId, { title, description }, { new: true });
                const guild = await client.guilds.fetch(panel.serverId);
                const { rebuildAndUpdatePanel } = require('./commands/ticketsetup');
                await rebuildAndUpdatePanel(panel, guild, client);
                await interaction.editReply({ content: '✅ Panel title and description updated!' });
            } catch (err) { console.error('Error editing panel:', err); try { await interaction.editReply({ content: '❌ Error updating panel.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('ts_addcatmodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const panelId = interaction.customId.replace('ts_addcatmodal_', '');
                const name = interaction.fields.getTextInputValue('name');
                const emoji = interaction.fields.getTextInputValue('emoji') || null;
                const description = interaction.fields.getTextInputValue('description') || null;
                const pingRolesRaw = interaction.fields.getTextInputValue('pingroles');
                const pingRoleIds = pingRolesRaw.split(',').map(r => r.trim()).filter(r => r.length > 0);
                const pingRoleId = pingRoleIds[0] || null;

                const panel = await TicketPanel.findById(panelId);
                if (!panel) return interaction.editReply({ content: '❌ Panel not found.' });
                if (panel.categories.find(c => c.name === name)) return interaction.editReply({ content: '❌ A category with that name already exists.' });

                panel.categories.push({ name, pingRoleId, pingRoleIds, emoji, description });
                await TicketPanel.findByIdAndUpdate(panelId, { categories: panel.categories });
                const guild = await client.guilds.fetch(panel.serverId);
                const { rebuildAndUpdatePanel } = require('./commands/ticketsetup');
                await rebuildAndUpdatePanel(panel, guild, client);
                await interaction.editReply({ content: `✅ Added category **${name}** and updated the panel!` });
            } catch (err) {
                console.error('Error adding category:', err);
                try { await interaction.editReply({ content: `❌ Error adding category: ${err.message}` }); } catch {}
            }
            return;
        }

        if (interaction.customId.startsWith('ts_editcatmodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const parts = interaction.customId.replace('ts_editcatmodal_', '').split('_');
                const index = parseInt(parts[parts.length - 1]);
                const panelId = parts.slice(0, -1).join('_');
                const name = interaction.fields.getTextInputValue('name');
                const emoji = interaction.fields.getTextInputValue('emoji') || null;
                const description = interaction.fields.getTextInputValue('description') || null;
                const pingRolesRaw = interaction.fields.getTextInputValue('pingroles');
                const pingRoleIds = pingRolesRaw.split(',').map(r => r.trim()).filter(r => r.length > 0);
                const pingRoleId = pingRoleIds[0] || null;

                const panel = await TicketPanel.findById(panelId);
                if (!panel) return interaction.editReply({ content: '❌ Panel not found.' });
                panel.categories[index] = { name, pingRoleId, pingRoleIds, emoji, description };
                await TicketPanel.findByIdAndUpdate(panelId, { categories: panel.categories });
                const guild = await client.guilds.fetch(panel.serverId);
                const { rebuildAndUpdatePanel } = require('./commands/ticketsetup');
                await rebuildAndUpdatePanel(panel, guild, client);
                await interaction.editReply({ content: `✅ Updated category **${name}** and rebuilt the panel!` });
            } catch (err) {
                console.error('Error editing category:', err);
                try { await interaction.editReply({ content: `❌ Error editing category: ${err.message}` }); } catch {}
            }
            return;
        }

        if (interaction.customId.startsWith('ticket_reason_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const withoutPrefix = interaction.customId.replace('ticket_reason_', '');
                const lastUnderscoreIndex = withoutPrefix.lastIndexOf('_');
                const category = withoutPrefix.substring(0, lastUnderscoreIndex);
                const guildId = withoutPrefix.substring(lastUnderscoreIndex + 1);
                const reason = interaction.fields.getTextInputValue('reason');

                const openCount = await Ticket.countDocuments({ userId: interaction.user.id, serverId: guildId, status: { $in: ['open', 'claimed'] } });
                if (openCount >= 2) return interaction.editReply({ content: '❌ You already have 2 open tickets. Please wait for them to be resolved before opening another.' });

                const panel = await TicketPanel.findOne({ serverId: guildId });
                if (!panel) return interaction.editReply({ content: '❌ Ticket panel not found.' });

                const categoryConfig = panel.categories.find(c => c.name === category);
                if (!categoryConfig) return interaction.editReply({ content: '❌ Category not found.' });

                const guild = await client.guilds.fetch(guildId);
                const caseId = generateCaseId();
                const channelName = `${category.toLowerCase().replace(/\s+/g, '-').substring(0, 15)}-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15)}`;

                await guild.channels.fetch();
                let ticketCategory = guild.channels.cache.find(c => c.name === '🎫 Tickets' && c.type === ChannelType.GuildCategory);
                if (!ticketCategory) ticketCategory = await guild.channels.create({ name: '🎫 Tickets', type: ChannelType.GuildCategory, position: 0 });

                const allRoleIds = categoryConfig.pingRoleIds?.length > 0 ? categoryConfig.pingRoleIds : (categoryConfig.pingRoleId ? [categoryConfig.pingRoleId] : []);
                const primaryPingRoleId = allRoleIds[0] || null;

                await guild.roles.fetch();
                const validRoleIds = allRoleIds.filter(id => guild.roles.cache.has(id));

                const permissionOverwrites = [
                    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
                ];
                for (const roleId of validRoleIds) {
                    permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
                }

                const ticketChannel = await guild.channels.create({
                    name: channelName, type: ChannelType.GuildText, parent: ticketCategory.id,
                    permissionOverwrites
                });

                const ticket = await Ticket.create({
                    caseId, userId: interaction.user.id, category, serverId: guildId,
                    channelId: ticketChannel.id, ticketCategoryId: ticketCategory.id,
                    claimedBy: null, status: 'open', openReason: reason,
                    pingRoleId: primaryPingRoleId, pingRoleIds: allRoleIds,
                    logChannelId: panel.logChannelId, createdAt: new Date()
                });

                const pingMentions = validRoleIds.map(id => `<@&${id}>`).join(' ');

                const welcomeEmbed = new EmbedBuilder()
                    .setTitle('🎫 Welcome to your ticket')
                    .setDescription('A team member will soon be taking care of you. Make sure that you describe your problems as accurately as possible so that you can be helped as best as possible.')
                    .setColor(0x378ADD)
                    .addFields(
                        { name: '🔖 Case', value: `\`#${caseId}\``, inline: true },
                        { name: '📂 Category', value: category, inline: true },
                        { name: '👮 Status', value: '⏳ Unclaimed', inline: true },
                        { name: '👤 Creator', value: `${interaction.user.tag}`, inline: false }
                    )
                    .setImage(TICKET_IMAGE)
                    .setTimestamp();

                const ticketButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ticket_claim_${caseId}`).setLabel('✋ Claim').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`ticket_close_${caseId}`).setLabel('🔒 Close').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`ticket_adduser_${caseId}`).setLabel('➕ Add User').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`ticket_closerequest_${caseId}`).setLabel('❓ Closure Request').setStyle(ButtonStyle.Secondary)
                );

                const welcomeMsg = await ticketChannel.send({ content: `${pingMentions} <@${interaction.user.id}>`, embeds: [welcomeEmbed], components: [ticketButtons] });
                await welcomeMsg.pin().catch(() => {});

                await ticketChannel.send({ embeds: [new EmbedBuilder().setTitle('📋 Creation Form').addFields({ name: 'Open reason', value: reason }).setColor(0x5865F2).setTimestamp()] });

                const logChannel = await client.channels.fetch(panel.logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) {
                    await logChannel.send({ embeds: [new EmbedBuilder().setTitle('🎫 New Ticket Created').setColor(0x2ECC71).setDescription(`**Case #${caseId}** has been opened.`).addFields(
                        { name: '👤 Created By', value: `${interaction.user.tag}`, inline: true },
                        { name: '📂 Category', value: category, inline: true },
                        { name: '💬 Channel', value: `<#${ticketChannel.id}>`, inline: true },
                        { name: '📅 When', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ).setFooter({ text: `Kavià Café • Ticket System • Case #${caseId}` }).setTimestamp()] });
                }

                await updatePanelWorkload(panel, guild);
                scheduleTicketReping(ticket, panel, guild);
                scheduleTicketInactivity(ticket, guild);
                await interaction.editReply({ content: `✅ Your ticket has been created! <#${ticketChannel.id}>` });

                // ── Public Relations: ask if this is an alliance application ──
                if (category === 'Public Relations') {
                    await ticketChannel.send({
                        embeds: [new EmbedBuilder()
                            .setColor(0x5865F2)
                            .setTitle('🤝 Alliance Application?')
                            .setDescription(
                                `Hey <@${interaction.user.id}>! Are you opening this ticket to **apply for an alliance** with Kavià Café?\n\n` +
                                `Please let us know below so we can get you to the right place.`
                            )
                        ],
                        components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`ticket_pr_alliance_yes_${caseId}`)
                                .setLabel('✅ Yes — Alliance Application')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`ticket_pr_alliance_no_${caseId}`)
                                .setLabel('❌ No — Other Reason')
                                .setStyle(ButtonStyle.Secondary)
                        )]
                    });
                }

                // ── Application ticket watch: if this user was sent to ticket, alert staff ──
                try {
                    const { AppTicketWatch } = require('./db');
                    const watch = await AppTicketWatch.findOne({ userId: interaction.user.id, triggered: false, expiresAt: { $gt: new Date() } });
                    if (watch) {
                        await AppTicketWatch.findByIdAndUpdate(watch._id, { triggered: true });
                        // Post in the ticket channel asking staff to confirm
                        const confirmRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`appwatch_yes_${watch._id}`)
                                .setLabel('✅ Yes — this ticket is about their application')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`appwatch_no_${watch._id}`)
                                .setLabel('❌ No — unrelated ticket')
                                .setStyle(ButtonStyle.Danger)
                        );
                        await ticketChannel.send({
                            content: `<@${watch.staffId}>`,
                            embeds: [new EmbedBuilder()
                                .setTitle('📋 Application Ticket?')
                                .setDescription(`<@${interaction.user.id}> applied for **${watch.formName}** and was sent to open a ticket.\n\nIs this ticket about that application?`)
                                .setColor(0xf1c40f)
                                .setTimestamp()],
                            components: [confirmRow]
                        });
                    }
                } catch (watchErr) { console.error('[appwatch] Error checking ticket watch:', watchErr); }

            } catch (err) { console.error('Error creating ticket:', err); try { await interaction.editReply({ content: '❌ Error creating ticket.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('ticket_closemodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const caseId = interaction.customId.replace('ticket_closemodal_', '');
                const reason = interaction.fields.getTextInputValue('closereason');
                const ticket = await Ticket.findOne({ caseId });
                if (!ticket) return interaction.editReply({ content: '❌ Ticket not found.' });
                await interaction.editReply({ content: '✅ Closing ticket...' });
                await closeTicket(ticket, interaction.channel, interaction.user, reason);
            } catch (err) { console.error('Error closing ticket:', err); try { await interaction.editReply({ content: '❌ Error closing ticket.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('st_ageverif_denymodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const userId = interaction.customId.replace('st_ageverif_denymodal_', '');
                const reason = interaction.fields.getTextInputValue('denyreason');
                const session = activeSessions.get(userId);
                if (!session) return interaction.editReply({ content: '❌ No active session found.' });
                const user = await client.users.fetch(userId);
                await user.send({ embeds: [new EmbedBuilder().setTitle('❌ Age Verification Denied').setDescription(`Hello, <@${userId}>,\n\nUnfortunately your age verification submission has been **denied**.\n\n> **Reason →** *${reason}*\n\nPlease send a new screenshot or image link as a DM reply and a staff member will review it.\n\n***Sincerely,***\n**Kavià Café Staff Team**`).setColor(0xE74C3C).setTimestamp()] });
                try {
                    if (session.ageVerifLogChannelId && session.ageVerifLogMessageId) {
                        const logChannel = await client.channels.fetch(session.ageVerifLogChannelId);
                        const logMsg = await logChannel.messages.fetch(session.ageVerifLogMessageId).catch(() => null);
                        if (logMsg) {
                            const deniedEmbed = EmbedBuilder.from(logMsg.embeds[0]).setTitle('❌ Age Verification Denied').setColor(0xE74C3C).addFields({ name: '👮 Denied By', value: interaction.user.tag }, { name: '📝 Reason', value: reason });
                            await logMsg.edit({ embeds: [deniedEmbed], components: [] });
                        }
                    }
                } catch {}
                session.ageVerifLogMessageId = null;
                session.ageVerifLogChannelId = null;
                await interaction.editReply({ content: '✅ Age verification denied and user notified.' });
            } catch (err) { console.error('Error denying age verif:', err); try { await interaction.editReply({ content: '❌ Error denying age verification.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('sesdeclinemodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const sessionId = interaction.customId.replace('sesdeclinemodal_', '');
                const reason = interaction.fields.getTextInputValue('declinereason');
                const session = await Session.findById(sessionId);
                if (!session) return interaction.editReply({ content: '❌ Session not found.' });
                await Session.findByIdAndUpdate(sessionId, { status: 'cancelled' });
                const user = await client.users.fetch(session.hostId);
                await user.send({ content: `# <:kaviacafe:1387492814916685845> **Session Request Declined**\nHello, ${user},\nWe regret to inform you that your **${session.shiftType}** request has been **declined** at **Kavià Café**.\n> <:pink_pin:1166850035611353148> **Shift Type →** *${session.shiftType}*\n> <:pink_pin:1166850035611353148> **Status →** *Declined ❌*\n> <:pink_pin:1166850035611353148> **Reason →** *${reason}*\n***Signed,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**` });
                await interaction.message.edit({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xE74C3C).setTitle('📋 Session Request — ❌ Declined').setFooter({ text: `Declined by ${interaction.user.username} — Reason: ${reason}` })], components: [] });
                await interaction.editReply({ content: '✅ Request declined and user notified.' });
            } catch (err) { console.error('Error declining session:', err); try { await interaction.editReply({ content: '❌ Error declining request.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('loa_formmodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const parts = interaction.customId.replace('loa_formmodal_', '').split('_');
                const logChannelId = parts[parts.length - 1];
                const department = parts.slice(0, -1).join('_');

                const reason = interaction.fields.getTextInputValue('reason');
                const timeGone = interaction.fields.getTextInputValue('timegone');
                const startDateStr = interaction.fields.getTextInputValue('startdate');
                const returnDateStr = interaction.fields.getTextInputValue('returndate');

                function parseReturnDate(dateStr) {
                    const p = dateStr.split('/');
                    if (p.length !== 3) return null;
                    const [day, month, year] = p.map(Number);
                    const fullYear = year < 100 ? 2000 + year : year;
                    const date = new Date(Date.UTC(fullYear, month - 1, day));
                    return isNaN(date.getTime()) ? null : date;
                }

                const returnDateParsed = parseReturnDate(returnDateStr);
                if (!returnDateParsed) return interaction.editReply({ content: '❌ Invalid return date format. Please use DD/MM/YY (e.g. 25/04/26).' });
                if (returnDateParsed < new Date()) return interaction.editReply({ content: '❌ Return date must be in the future.' });

                const { DEPARTMENTS } = require('./commands/departments');
                const { LOA } = require('./db');
                const { scheduleLOAReturnReminder } = require('./commands/loa');

                const deptConfig = DEPARTMENTS[department];
                if (!deptConfig) return interaction.editReply({ content: '❌ Invalid department.' });

                const existingLOA = await LOA.findOne({ userId: interaction.user.id, department, status: { $in: ['pending', 'approved', 'more_info'] } });
                if (existingLOA) return interaction.editReply({ content: `❌ You already have an active LOA request for **${department}**.` });

                const loa = new LOA({
                    userId: interaction.user.id,
                    username: interaction.user.username,
                    department,
                    reason,
                    timeGone,
                    startDate: startDateStr,
                    returnDate: returnDateStr,
                    returnDateParsed,
                    status: 'pending',
                    channelId: deptConfig.loaChannelId,
                    logChannelId,
                    createdAt: new Date(),
                    returnReminderSent: false,
                    autoDeleteAt: new Date(returnDateParsed.getTime() + 24 * 60 * 60 * 1000)
                });

                await loa.save();

                const embed = new EmbedBuilder()
                    .setTitle('📋 Leave of Absence Request')
                    .setColor(0x3498DB)
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        { name: '👤 Discord Username', value: interaction.user.tag },
                        { name: '🏢 Department', value: department },
                        { name: '📝 Reason', value: reason },
                        { name: '⏳ Time Gone', value: timeGone },
                        { name: '📅 Start Date', value: startDateStr, inline: true },
                        { name: '📅 End / Return Date', value: returnDateStr, inline: true }
                    )
                    .setFooter({ text: `LOA ID: ${loa._id} • Kavià Café` })
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`loa_accept_${loa._id}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`loa_deny_${loa._id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`loa_moreinfo_${loa._id}`).setLabel('❓ Request More Info').setStyle(ButtonStyle.Secondary)
                );

                // Post request to shared LOA channel AND log to dept log channel
                try {
                    // Post to the shared panel channel (logChannelId from button)
                    const requestChannel = await client.channels.fetch(logChannelId).catch(() => null);
                    if (requestChannel?.isTextBased()) {
                        const msg = await requestChannel.send({
                            content: `<@&${deptConfig.roleId}>`,
                            embeds: [embed],
                            components: [row]
                        });
                        const resolvedLogChannelId = getLoaLogChannelId(department, deptConfig, interaction.guildId);
                        await LOA.findByIdAndUpdate(loa._id, { messageId: msg.id, channelId: logChannelId, logChannelId: resolvedLogChannelId || logChannelId });
                    }
                } catch (err) { console.error('Error posting LOA request:', err); }

                scheduleLOAReturnReminder(loa, client);
                await interaction.editReply({ content: "✅ Your LOA request has been submitted! You will be DM'd when it has been reviewed." });

            } catch (err) {
                console.error('Error in LOA form modal:', err);
                try { await interaction.editReply({ content: '❌ Error submitting LOA.' }); } catch {}
            }
            return;
        }

        if (interaction.customId.startsWith('loa_denymodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const loaId = interaction.customId.replace('loa_denymodal_', '');
                const reason = interaction.fields.getTextInputValue('denyreason');
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.editReply({ content: '❌ LOA not found.' });
                await LOA.findByIdAndUpdate(loaId, { status: 'denied' });
                const user = await client.users.fetch(loa.userId);
                await user.send({ embeds: [new EmbedBuilder().setTitle('❌ Leave of Absence Denied').setDescription(`Hello, <@${loa.userId}>,\n\nWe regret to inform you that your **Leave of Absence** request has been **denied** at **Kavià Café**.\n\n> <:pink_pin:1166850035611353148> **Department →** *${loa.department || 'Unknown'}*\n> <:pink_pin:1166850035611353148> **Status →** *Denied ❌*\n> <:pink_pin:1166850035611353148> **Reason →** *${reason}*\n\n***Sincerely,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**`).setColor(0xE74C3C).setTimestamp()] });
                try { await interaction.message.delete(); } catch {}
                try {
                    const loa2 = await LOA.findById(loaId);
                    const logChannel = await client.channels.fetch(loa2?.logChannelId || interaction.channel.id).catch(() => null);
                    if (logChannel?.isTextBased()) {
                        await logChannel.send({ embeds: [new EmbedBuilder()
                            .setTitle('❌ LOA Denied')
                            .setColor(0xE74C3C)
                            .addFields(
                                { name: '👤 User', value: `${user.tag} (${user.id})`, inline: true },
                                { name: '🏢 Department', value: loa.department || 'Unknown', inline: true },
                                { name: '👮 Denied By', value: interaction.user.tag, inline: true },
                                { name: '📝 Reason', value: reason }
                            )
                            .setFooter({ text: `LOA ID: ${loaId}` })
                            .setTimestamp()
                        ]});
                    }
                } catch (err) { console.error('Error posting LOA denial log:', err); }
                await interaction.editReply({ content: '✅ LOA denied and user notified.' });
            } catch (err) { console.error('Error denying LOA:', err); try { await interaction.editReply({ content: '❌ Error denying LOA.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('loa_moreinfomodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const loaId = interaction.customId.replace('loa_moreinfomodal_', '');
                const moreInfo = interaction.fields.getTextInputValue('moreinfo');
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.editReply({ content: '❌ LOA not found.' });
                await LOA.findByIdAndUpdate(loaId, { status: 'denied' });
                const user = await client.users.fetch(loa.userId);
                await user.send({ embeds: [new EmbedBuilder().setTitle('❓ More Information Required').setDescription(`Hello, <@${loa.userId}>,\n\nThank you for submitting your **Leave of Absence** request. Before we can process it, we require some additional information.\n\n> <:pink_pin:1166850035611353148> **Department →** *${loa.department || 'Unknown'}*\n> <:pink_pin:1166850035611353148> **Information Needed →** *${moreInfo}*\n\nPlease resubmit your LOA using \`/loa\` with the additional information.\n\n***Sincerely,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**`).setColor(0xF39C12).setTimestamp()] });
                try { await interaction.message.delete(); } catch {}
                try {
                    const loa3 = await LOA.findById(loaId);
                    const logChannel = await client.channels.fetch(loa3?.logChannelId || interaction.channel.id).catch(() => null);
                    if (logChannel?.isTextBased()) {
                        await logChannel.send({ embeds: [new EmbedBuilder()
                            .setTitle('❓ LOA More Info Requested')
                            .setColor(0xF39C12)
                            .addFields(
                                { name: '👤 User', value: `${user.tag} (${user.id})`, inline: true },
                                { name: '🏢 Department', value: loa.department || 'Unknown', inline: true },
                                { name: '👮 Requested By', value: interaction.user.tag, inline: true },
                                { name: '📝 Info Needed', value: moreInfo }
                            )
                            .setFooter({ text: `LOA ID: ${loaId}` })
                            .setTimestamp()
                        ]});
                    }
                } catch (err) { console.error('Error posting LOA more info log:', err); }
                await interaction.editReply({ content: '✅ More info requested and user notified.' });
            } catch (err) { console.error('Error requesting more info:', err); try { await interaction.editReply({ content: '❌ Error requesting more info.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('loa_extendmodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const loaId = interaction.customId.replace('loa_extendmodal_', '');
                const extendTime = interaction.fields.getTextInputValue('extendtime');
                const newReturnDate = interaction.fields.getTextInputValue('newreturndate');
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.editReply({ content: '❌ LOA not found.' });
                const newDateParsed = new Date(newReturnDate.split('/').reverse().join('-'));
                if (isNaN(newDateParsed.getTime())) return interaction.editReply({ content: '❌ Invalid date format. Please use DD/MM/YY.' });

                // DM user that extension is pending review
                const user = await client.users.fetch(loa.userId);
                await user.send({ embeds: [new EmbedBuilder()
                    .setTitle('⏳ LOA Extension Requested')
                    .setDescription(`Hello, <@${loa.userId}>,\n\nYour **LOA Extension** request has been submitted and is pending approval from leadership.\n\n> <:pink_pin:1166850035611353148> **Extra Time Requested →** *${extendTime}*\n> <:pink_pin:1166850035611353148> **New Return Date →** *${newReturnDate}*\n\nYou will receive a DM once it has been reviewed.\n\n***Sincerely,***\n**Kavià Café Staff Team**`)
                    .setColor(0xF39C12).setTimestamp()
                ] });

                // Post to log channel for approval
                const { DEPARTMENTS } = require('./commands/departments');
                const deptConfig = loa.department ? DEPARTMENTS[loa.department] : null;
                const logChannelId = loa.logChannelId || deptConfig?.loaLogChannelId;
                if (logChannelId) {
                    const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel?.isTextBased()) {
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`loa_extaccept_${loaId}_${newReturnDate.replace(/\//g, '-')}`).setLabel('✅ Approve Extension').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`loa_extdeny_${loaId}`).setLabel('❌ Deny Extension').setStyle(ButtonStyle.Danger)
                        );
                        await logChannel.send({
                            embeds: [new EmbedBuilder()
                                .setTitle('⏳ LOA Extension Request')
                                .setColor(0xF39C12)
                                .addFields(
                                    { name: '👤 User', value: `${user.tag} (${user.id})`, inline: true },
                                    { name: '🏢 Department', value: loa.department || 'Unknown', inline: true },
                                    { name: '📅 Current Return Date', value: loa.returnDate || 'Unknown', inline: true },
                                    { name: '⏳ Extra Time Requested', value: extendTime, inline: true },
                                    { name: '📅 New Return Date', value: newReturnDate, inline: true }
                                )
                                .setFooter({ text: `LOA ID: ${loaId}` })
                                .setTimestamp()
                            ],
                            components: [row]
                        });
                    }
                }

                await interaction.editReply({ content: '✅ Extension request submitted! Leadership will review it shortly.' });
            } catch (err) { console.error('Error extending LOA:', err); try { await interaction.editReply({ content: '❌ Error submitting extension.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('loa_extaccept_')) {
            const parts = interaction.customId.replace('loa_extaccept_', '').split('_');
            const newReturnDate = parts[parts.length - 1].replace(/-/g, '/');
            const loaId = parts.slice(0, -1).join('_');
            try {
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.reply({ content: '❌ LOA not found.', flags: 64 });
                if (!await hasStaffRole(interaction.user.id, loa.department)) return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
                const newDateParsed = new Date(newReturnDate.split('/').reverse().join('-'));
                await LOA.findByIdAndUpdate(loaId, { status: 'approved', returnDate: newReturnDate, returnDateParsed: newDateParsed, returnReminderSent: false });
                const updatedLoa = await LOA.findById(loaId);
                scheduleLOAReturnReminder(updatedLoa, client);
                const user = await client.users.fetch(loa.userId);
                await user.send({ embeds: [new EmbedBuilder()
                    .setTitle('✅ LOA Extension Approved')
                    .setDescription(`Hello, <@${loa.userId}>,\n\nYour **LOA Extension** has been **approved**!\n\n> <:pink_pin:1166850035611353148> **New Return Date →** *${newReturnDate}*\n\n***Sincerely,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**`)
                    .setColor(0x2ECC71).setTimestamp()
                ] });
                try { await interaction.message.delete(); } catch {}
                const logChannel = await client.channels.fetch(loa.logChannelId || interaction.channel.id).catch(() => null);
                if (logChannel?.isTextBased()) {
                    await logChannel.send({ embeds: [new EmbedBuilder()
                        .setTitle('✅ LOA Extension Approved')
                        .setColor(0x2ECC71)
                        .addFields(
                            { name: '👤 User', value: `${user.tag} (${user.id})`, inline: true },
                            { name: '🏢 Department', value: loa.department || 'Unknown', inline: true },
                            { name: '👮 Approved By', value: interaction.user.tag, inline: true },
                            { name: '📅 New Return Date', value: newReturnDate, inline: true }
                        )
                        .setFooter({ text: `LOA ID: ${loaId}` })
                        .setTimestamp()
                    ]});
                }
            } catch (err) { console.error('Error approving LOA extension:', err); try { await interaction.reply({ content: '❌ Error approving extension.', flags: 64 }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('loa_extdeny_')) {
            const loaId = interaction.customId.replace('loa_extdeny_', '');
            try {
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.reply({ content: '❌ LOA not found.', flags: 64 });
                if (!await hasStaffRole(interaction.user.id, loa.department)) return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
                try { await interaction.message.delete(); } catch {}
                const user = await client.users.fetch(loa.userId);
                await user.send({ embeds: [new EmbedBuilder()
                    .setTitle('❌ LOA Extension Denied')
                    .setDescription(`Hello, <@${loa.userId}>,\n\nUnfortunately your **LOA Extension** request has been **denied**.\n\nYour original return date of **${loa.returnDate}** remains unchanged.\n\n***Sincerely,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**`)
                    .setColor(0xE74C3C).setTimestamp()
                ] });
                const logChannel = await client.channels.fetch(loa.logChannelId || interaction.channel.id).catch(() => null);
                if (logChannel?.isTextBased()) {
                    await logChannel.send({ embeds: [new EmbedBuilder()
                        .setTitle('❌ LOA Extension Denied')
                        .setColor(0xE74C3C)
                        .addFields(
                            { name: '👤 User', value: `${user.tag} (${user.id})`, inline: true },
                            { name: '🏢 Department', value: loa.department || 'Unknown', inline: true },
                            { name: '👮 Denied By', value: interaction.user.tag, inline: true },
                            { name: '📅 Original Return Date', value: loa.returnDate || 'Unknown', inline: true }
                        )
                        .setFooter({ text: `LOA ID: ${loaId}` })
                        .setTimestamp()
                    ]});
                }
                await interaction.reply({ content: '✅ Extension denied and user notified.', flags: 64 });
            } catch (err) { console.error('Error denying LOA extension:', err); try { await interaction.reply({ content: '❌ Error denying extension.', flags: 64 }); } catch {} }
            return;
        }

        // ========== APPLICATION SETUP DETAILS MODAL (name + description) ==========
        if (interaction.customId === 'app_setup_details') {
            await require('./commands/application').handleSetupDetails(interaction);
            return;
        }

        // ========== APPLICATION SETUP QUESTIONS MODAL (rounds 1-3) ==========
        if (interaction.customId.startsWith('app_setup_questions_')) {
            await require('./commands/application').handleSetupModal(interaction);
            return;
        }

        // ========== APPLICATION SETUP — manual channel ID modals ==========
        if (interaction.customId.startsWith('appsetup_manualch_')) {
            await require('./commands/application').handleSetupManualChannel(interaction);
            return;
        }

        // ========== APPLICATION SETUP — notify role ID modal ==========
        if (interaction.customId.startsWith('appsetup_notifyrole_id_')) {
            await require('./commands/application').handleNotifyRoleModal(interaction);
            return;
        }

        // ========== APPLICATION OPEN — manual channel ID modal ==========
        if (interaction.customId.startsWith('appopen_manualch_')) {
            await require('./commands/application').handleOpenManualChannel(interaction);
            return;
        }

        // ========== APPLICATION OPEN — attach to existing message modal ==========
        if (interaction.customId.startsWith('appopen_attachmsg_')) {
            await require('./commands/application').handleOpenAttachMessage(interaction);
            return;
        }

        // ========== APPLICATION DECLINE MODAL ==========
        if (interaction.customId.startsWith('app_declinemodal_')) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            try {
                const subId = interaction.customId.replace('app_declinemodal_', '');
                const reason = interaction.fields.getTextInputValue('reason');
                const { AppSubmission } = require('./db');

                const sub = await AppSubmission.findById(subId);
                if (!sub) return interaction.editReply({ content: '❌ Submission not found.' });
                if (sub.status !== 'pending') return interaction.editReply({ content: `❌ Already ${sub.status}.` });

                await AppSubmission.findByIdAndUpdate(subId, {
                    status: 'declined',
                    declineReason: reason,
                    declinedBy: interaction.user.id,
                    declinedAt: new Date()
                });

                // Edit log message to show declined
                const embed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xe74c3c)
                    .setFooter({ text: `❌ Declined by ${interaction.user.tag} · Reason: ${reason.slice(0, 80)}${reason.length > 80 ? '...' : ''}` });
                await interaction.message.edit({ embeds: [embed], components: [] }).catch(() => {});

                // DM applicant — they get one more chance notice
                const user = await interaction.client.users.fetch(sub.userId).catch(() => null);
                if (user) {
                    await user.send({
                        embeds: [new EmbedBuilder()
                            .setTitle(`❌ Application Update — ${sub.formName}`)
                            .setDescription(
                                `Your application has been **declined** at this time.\n\n` +
                                `**Reason:**\n${reason}\n\n` +
                                `You may reapply **one more time**. When you reapply, your submission will be marked as a resubmission. Please take the feedback above into account.`
                            )
                            .setColor(0xe74c3c)
                            .setTimestamp()]
                    }).catch(() => {});
                }

                await interaction.editReply({ content: '✅ Application declined. Applicant has been notified and given a resubmission chance.' });
            } catch (err) {
                console.error('Error declining application:', err);
                try { await interaction.editReply({ content: '❌ Error declining application.' }); } catch {}
            }
            return;
        }

        return;
    }
});

client.on('guildMemberRemove', async member => {
    try {
        const openTickets = await Ticket.find({
            userId: member.id,
            serverId: member.guild.id,
            status: { $in: ['open', 'claimed'] }
        });

        for (const ticket of openTickets) {
            try {
                const channel = await member.guild.channels.fetch(ticket.channelId).catch(() => null);
                if (!channel) continue;

               await channel.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('🚪 Ticket Creator Left the Server')
                        .setDescription(`**${member.user.tag}** has left the server.\n\nThis ticket was opened by them. A staff member can close it below if it is no longer needed.`)
                        .setColor(0xE74C3C)
.setImage('https://cdn.discordapp.com/attachments/620024668673409069/1521631185749676152/w2jpc0AAAAGSURBVAMAewXVEO1vryYAAAAASUVORK5CYII.png?ex=6a4588f9&is=6a443779&hm=bfb9a11c7f931f578c72ebf81c51e1729549c85803af6ff9e384ea18fc909295&')
                        .addFields(
                            { name: '🔖 Case ID', value: `#${ticket.caseId}`, inline: true },
                            { name: '📂 Category', value: ticket.category, inline: true },
                            { name: '👤 Creator', value: `${member.user.tag} (${member.id})`, inline: true }
                        )
                        .setFooter({ text: 'Kavià Café • Ticket System' })
                        .setTimestamp()
                    ],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`ticket_closeleft_${ticket.caseId}`)
                            .setLabel('🔒 Close Ticket — Creator Left')
                            .setStyle(ButtonStyle.Danger)
                    )]
                });
            } catch (err) { console.error(`Error notifying ticket ${ticket.caseId} of member leave:`, err); }
        }
    } catch (err) { console.error('Error handling guildMemberRemove for tickets:', err); }

    // Track Discord leaves for weekly stats
    if (member.guild.id === MOD_REPORT_GUILD_ID) {
        weeklyDiscordLeaves++;
    }

    // Alliance role - if they left alliance server remove role in main
    try {
        if (member.guild.id === ALLIANCE_SERVER_ID) {
            const mainGuild = await client.guilds.fetch(MOD_REPORT_GUILD_ID).catch(() => null);
            if (mainGuild) {
                const mainMember = await mainGuild.members.fetch(member.id).catch(() => null);
                if (mainMember && mainMember.roles.cache.has(ALLIANCE_ROLE_ID)) {
                    await mainMember.roles.remove(ALLIANCE_ROLE_ID).catch(() => {});
                }
            }
        }
    } catch (err) { console.error('Error handling alliance role on member leave:', err); }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Giveaway message tracking
    try {
        const { activeGiveaways } = require('./commands/giveaway');
        for (const [gwId, gw] of activeGiveaways.entries()) {
            if (!gw.ended && gw.participants.has(message.author.id) &&
                message.channelId === gw.config.channelId) {
                const newCount = (gw.participants.get(message.author.id) || 0) + 1;
                gw.participants.set(message.author.id, newCount);
                // Throttle DB writes: only persist every 5 messages to reduce load
                if (newCount % 5 === 0 || newCount === gw.config.requiredMessages) {
                    try {
                        const { Giveaway } = require('./db');
                        await Giveaway.findOneAndUpdate(
                            { giveawayId: gwId, 'participants.userId': message.author.id },
                            { $set: { 'participants.$.msgCount': newCount } }
                        );
                    } catch (dbErr) { console.error('[giveaway] DB msgCount update error:', dbErr); }
                }
            }
        }
    } catch (err) { /* giveaway command not loaded yet */ }

    // Track total messages in main server for weekly stats
    if (message.guild && message.guild.id === MOD_REPORT_GUILD_ID) {
        weeklyTotalMessages++;
    }

    // Staff message tracking for mod report
    if (message.guild && message.guild.id === MOD_REPORT_GUILD_ID) {
        try {
            const member = message.guild.members.cache.get(message.author.id) ||
                           await message.guild.members.fetch(message.author.id).catch(() => null);
            if (member && member.roles.cache.has(STAFF_ROLE_ID)) {
                const { MessageLog } = require('./db');
                const weekStart = getWeekStart();
                await MessageLog.findOneAndUpdate(
                    { userId: message.author.id, guildId: MOD_REPORT_GUILD_ID },
                    { $inc: { weeklyCount: 1, allTimeCount: 1 }, $set: { userTag: message.author.tag, lastActiveAt: new Date(), weekStartDate: weekStart } },
                    { upsert: true }
                );
            }
        } catch (err) { console.error('Error tracking message:', err); }
    }

    if (message.channel.type === 1) {
        // ── Application DM flow ──
        const { pendingDMs, parseQuestion } = require('./commands/application');
        const appSession = pendingDMs.get(message.author.id);
        if (appSession) {
            if (message.content.toLowerCase() === 'cancel') {
                pendingDMs.delete(message.author.id);
                await message.reply('❌ Application cancelled.');
                return;
            }

            // Ignore typed messages when the session is waiting for a button click
            if (appSession.state === 'intro' || appSession.state === 'review') {
                await message.reply({ content: '👆 Please use the buttons above to continue.', allowedMentions: { repliedUser: false } });
                return;
            }

            // If current question is a button type, ignore typed messages
            const currentQ = parseQuestion(appSession.questions[appSession.questionIndex]);
            if (currentQ.type !== 'text') {
                await message.reply({ content: '👆 Please use the buttons above to answer this question.', allowedMentions: { repliedUser: false } });
                return;
            }

            appSession.answers.push(message.content);
            const nextIndex = appSession.questionIndex + 1;

            if (nextIndex < appSession.questions.length) {
                // More questions
                appSession.questionIndex = nextIndex;
                pendingDMs.set(message.author.id, appSession);
                const nextQ = parseQuestion(appSession.questions[nextIndex]);
                let components = [];
                if (nextQ.type === 'scale') {
                    components = [
                        new ActionRowBuilder().addComponents(...[1,2,3,4,5].map(n => new ButtonBuilder().setCustomId(`app_dmscale_${message.author.id}_${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary))),
                        new ActionRowBuilder().addComponents(...[6,7,8,9,10].map(n => new ButtonBuilder().setCustomId(`app_dmscale_${message.author.id}_${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary)))
                    ];
                } else if (nextQ.type === 'choice') {
                    components = [new ActionRowBuilder().addComponents(
                        ...nextQ.choices.map((c, i) => new ButtonBuilder().setCustomId(`app_dmchoice_${message.author.id}_${i}`).setLabel(c).setStyle(ButtonStyle.Primary))
                    )];
                }
                const embed = new EmbedBuilder()
                    .setTitle(`📝 ${appSession.formName}${appSession.isResubmit ? ' (Resubmission)' : ''}`)
                    .setColor(appSession.isResubmit ? 0xe67e22 : 0x5865f2)
                    .setDescription(`**Question ${nextIndex + 1} of ${appSession.questions.length}:**\n${nextQ.display}`)
                    .setFooter({ text: nextQ.type === 'text' ? 'Type your answer below. Type "cancel" to cancel.' : 'Click a button to answer. Type "cancel" to cancel.' });
                await message.reply({ embeds: [embed], components });
            } else {
                // All answered — show review/confirm prompt
                appSession.state = 'review';
                pendingDMs.set(message.author.id, appSession);

                const reviewLines = appSession.questions.map((q, i) => {
                    const { display } = parseQuestion(q);
                    return `**Q${i + 1}:** ${display.slice(0, 80)}\n> ${appSession.answers[i] || '*(no answer)*'}`;
                });
                const reviewEmbed = new EmbedBuilder()
                    .setTitle(`📋 Review Your Answers — ${appSession.formName}`)
                    .setColor(0xf1c40f)
                    .setDescription(reviewLines.join('\n\n'))
                    .setFooter({ text: 'Submit when you\'re happy, Start Over to redo, or Never Mind to cancel.' });

                const reviewRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`app_dmsubmit_${message.author.id}`).setLabel('✅ Submit Application').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`app_dmrestart_${message.author.id}`).setLabel('🔄 Start Over').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`app_dmnvm_${message.author.id}`).setLabel('✖️ Never Mind').setStyle(ButtonStyle.Danger)
                );

                await message.reply({ embeds: [reviewEmbed], components: [reviewRow] });
            }
            return;
        }

        const trainingSession = activeSessions.get(message.author.id);
        if (trainingSession && trainingSession.awaitingAgeVerif) {
            trainingSession.lastAgeVerifContent = message.content || '[Attachment]';
            if (trainingSession.ageVerifLogMessageId) {
                try { await message.react('⏳'); } catch {}
                return;
            }
            try {
                const logChannel = await client.channels.fetch(trainingSession.deptConfig.logChannelId);
                if (logChannel?.isTextBased()) {
                    const verifyRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`st_ageverif_accept_${message.author.id}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`st_ageverif_deny_${message.author.id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger)
                    );
                    const logEmbed = new EmbedBuilder()
                        .setTitle('🪪 Age Verification Submission')
                        .setColor(0x3498DB)
                        .addFields(
                            { name: '👤 Trainee', value: `<@${message.author.id}> (${message.author.id})` },
                            { name: '🏢 Department', value: trainingSession.department },
                            { name: '📖 Training', value: trainingSession.training || 'Unknown' },
                            { name: '📝 Message', value: message.content || '*No text*' }
                        )
                        .setTimestamp();
                    if (message.attachments.size > 0) {
                        const attachment = message.attachments.first();
                        logEmbed.setImage(attachment.url);
                        logEmbed.addFields({ name: '🖼️ Attachment', value: attachment.url });
                        trainingSession.lastAgeVerifContent = attachment.url;
                    }
                    const logMsg = await logChannel.send({ content: `<@&${trainingSession.deptConfig.pingRoleId}>`, embeds: [logEmbed], components: [verifyRow] });
                    trainingSession.ageVerifLogMessageId = logMsg.id;
                    trainingSession.ageVerifLogChannelId = logChannel.id;
                }
            } catch (err) { console.error('Error logging age verif submission:', err); }
            return;
        }
     const logChannelId = client.dmLogChannels?.get(message.author.id) || '1462580398935642144';
        const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;
        try { await message.react('✅'); } catch (err) { console.error('Failed to react to user DM:', err); }
        const userReplyEmbed = new EmbedBuilder()
            .setColor(0x3498DB).setTitle('💬 **DM Received**')
            .addFields(
                { name: '📤 From (User)', value: `${message.author.tag} (${message.author.id})` },
                { name: '📥 To (Bot)', value: `${client.user.tag}` },
                { name: '📝 Message', value: message.content || '*No text content*' },
                { name: '🕒 Date & Time', value: timestamp }
            )
            .setFooter({ text: 'Kavia Cafe • DM Logs' });
        const replyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`dmreply_${message.author.id}`)
                .setLabel('💬 Reply')
                .setStyle(ButtonStyle.Primary)
        );
        try {
            const logChannel = await client.channels.fetch(logChannelId);
            if (logChannel) await logChannel.send({ embeds: [userReplyEmbed], components: [replyRow] });
        } catch (err) { console.error('Error logging user DM:', err); }
    }
});

client.once('ready', async () => {
    console.log(`✅ Ready event fired!`);

    client.user.setPresence({
        activities: [{ name: 'Watching over the Kavià Café Staff Team', type: 3 }],
        status: 'online'
    });
    console.log('✅ Default status set');

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        console.log('✅ Cleared global commands');
    } catch (err) {
        console.error('❌ Failed to clear global commands:', err.message);
    }

    console.log(`✅ Guild cache size: ${client.guilds.cache.size}`);
    console.log(`✅ Starting guild registration loop...`);

    for (const guild of client.guilds.cache.values()) {
        if (guild.id === '1229426371592327250') continue;
        try {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: cmds });
            console.log(`✅ Commands registered in guild: ${guild.name}`);
        } catch (err) {
            console.error(`❌ Failed in guild ${guild.name}:`, err.message);
        }
    }

  console.log(`✅ Guild registration complete`);

    // Leave any unauthorized guilds
    for (const guild of client.guilds.cache.values()) {
        if (!ALLOWED_GUILD_IDS.has(guild.id)) {
            console.log(`⚠️ Leaving unauthorized guild: ${guild.name} (${guild.id})`);
            await guild.leave().catch(() => {});
        }
    }

   client.user.setPresence({
        activities: [{ name: 'Watching over the Kavià Café Staff Team', type: 3 }],
        status: 'online'
    });

    const { scheduleReminder } = require('./commands/remind');
    const pendingReminders = await Reminder.find({ fireAt: { $gt: new Date() } });
    for (const reminder of pendingReminders) scheduleReminder(reminder, client);
    console.log(`✅ Reloaded ${pendingReminders.length} pending reminders`);
    await restoreSessions();
    await cleanupStaleSessions();
    setInterval(cleanupStaleSessions, 60 * 60 * 1000);
  await restoreLOAs();
    await restoreTicketInactivity();
    await checkBirthdays();
    setInterval(checkBirthdays, 60 * 60 * 1000);

    // Restore weekly stats
    await restoreWeeklyStats();

    // Roblox group tracker
    setInterval(() => checkRobloxGroupCount(client), 5 * 60 * 1000);

    // Weekly mod report
    scheduleWeeklyReport(client);

    // Alliance role sync
    await syncAllianceRole(client);
    setInterval(() => syncAllianceRole(client), 6 * 60 * 60 * 1000);

    // Restore giveaways (re-schedule timers, end any that expired during downtime)
    const { restoreGiveaways } = require('./commands/giveaway');
    await restoreGiveaways(client);

    // ========== APP TICKET WATCH — 48h expiry check ==========
    // Runs every 30 minutes; alerts staff if an applicant never opened a ticket
    async function checkExpiredTicketWatches() {
        try {
            const { AppTicketWatch } = require('./db');
            const expired = await AppTicketWatch.find({
                triggered: false,
                expiresAt: { $lt: new Date() }
            });
            for (const watch of expired) {
                try {
                    const logCh = await client.channels.fetch(watch.logChannelId).catch(() => null);
                    if (logCh) {
                        const alertEmbed = new EmbedBuilder()
                            .setTitle('⚠️ Application Ticket — No Ticket Opened')
                            .setDescription(
                                `<@${watch.userId}> was sent to open a ticket for their **${watch.formName}** application **48 hours ago** but never opened one.\n\n` +
                                `**Recommendation:** Consider declining this application.\n\n` +
                                `Sent to ticket by: <@${watch.staffId}>`
                            )
                            .setColor(0xe74c3c)
                            .setTimestamp();

                        if (watch.logMessageId) {
                            const logMsg = await logCh.messages.fetch(watch.logMessageId).catch(() => null);
                            if (logMsg) await logMsg.reply({ embeds: [alertEmbed] }).catch(() => logCh.send({ embeds: [alertEmbed] }));
                            else await logCh.send({ embeds: [alertEmbed] });
                        } else {
                            await logCh.send({ embeds: [alertEmbed] });
                        }
                    }
                } catch (err) { console.error('[appwatch expiry] Error alerting for watch', watch._id, err); }
                // Delete the watch so it doesn't fire again
                await AppTicketWatch.findByIdAndDelete(watch._id).catch(() => {});
            }
            if (expired.length > 0) console.log(`[appwatch] Processed ${expired.length} expired ticket watch(es).`);
        } catch (err) { console.error('[appwatch expiry check]', err); }
    }
    // Run immediately on startup, then every 30 minutes
    checkExpiredTicketWatches();
    setInterval(checkExpiredTicketWatches, 30 * 60 * 1000);
});


// ========== WELCOME MESSAGE ==========
client.on('guildMemberAdd', async member => {
    // Track Discord joins for weekly stats
    if (member.guild.id === MOD_REPORT_GUILD_ID) {
        weeklyDiscordJoins++;
    }

    // Welcome message
    if (member.guild.id === WELCOME_GUILD_ID) {
        try {
            const channel = await client.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
            if (channel?.isTextBased()) {
                const embed = new EmbedBuilder()
                    .setColor(0xF4A83A)
                    .setTitle('Welcome to Kavià Cafe!')
                    .setDescription(
                        `🎉 Welcome to Kavià Café, <@${member.id}>! 🎉\n\n` +
                        `We're thrilled to have you join our Roblox community! 🍵\n\n` +
                        `🍵 Be sure to check out:\n` +
                        `📋 <#1370946530894413824> – to stay out of trouble\n` +
                        `👥 <#1370947213689098280> – to view information\n` +
                        `📣 <#1370946554587906189> – for important updates\n\n` +
                        `🧡 Need help? Just ask our friendly staff team!\n\n` +
                        `Enjoy your stay and grab a virtual latte with us!`
                    )
                    .setThumbnail(WELCOME_THUMBNAIL)
                    .setImage(WELCOME_BANNER)
                    .setFooter({ text: `Member joined • ${new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })} ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}` });
                await channel.send({ content: `<@${member.id}>`, embeds: [embed] });
            }
        } catch (err) { console.error('Error sending welcome message:', err); }
    }

    // Alliance role sync - if joining main server check if in alliance server
    if (member.guild.id === MOD_REPORT_GUILD_ID) {
        try {
            const allianceGuild = await client.guilds.fetch(ALLIANCE_SERVER_ID).catch(() => null);
            if (allianceGuild) {
                const allianceMember = await allianceGuild.members.fetch(member.id).catch(() => null);
                if (allianceMember) await member.roles.add(ALLIANCE_ROLE_ID).catch(() => {});
            }
        } catch (err) { console.error('Error handling alliance role on join:', err); }
    }

    // Alliance role sync - if joining alliance server give role in main
    if (member.guild.id === ALLIANCE_SERVER_ID) {
        try {
            const mainGuild = await client.guilds.fetch(MOD_REPORT_GUILD_ID).catch(() => null);
            if (mainGuild) {
                const mainMember = await mainGuild.members.fetch(member.id).catch(() => null);
                if (mainMember && !mainMember.roles.cache.has(ALLIANCE_ROLE_ID)) {
                    await mainMember.roles.add(ALLIANCE_ROLE_ID).catch(() => {});
                }
            }
        } catch (err) { console.error('Error handling alliance role on alliance join:', err); }
    }
});

client.on('guildCreate', async guild => {
    if (!ALLOWED_GUILD_IDS.has(guild.id)) {
        console.log(`⚠️ Joined unauthorized guild: ${guild.name} (${guild.id}) — leaving.`);
        await guild.leave().catch(() => {});
        return;
    }
    console.log(`✅ Joined new guild: ${guild.name} (${guild.id})`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: cmds });
        console.log(`✅ Commands registered in new guild: ${guild.name}`);
    } catch (err) {
        console.error(`❌ Failed in ${guild.name} (${guild.id}): ${err.message}`);
        console.error(err.rawError || err);
    }
});

connectDB().then(() => {
    createServer(client);
    client.login(process.env.TOKEN);
    console.log('✅ Bot started successfully!');
}).catch(err => {
    console.error('❌ Failed to connect to MongoDB:', err);
    process.exit(1);
});