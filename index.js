require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, EmbedBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { connectDB, Reminder, Session, LOA, CompletedTrainings } = require('./db');

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

// ========== HELPERS ==========
async function hasRequiredRole(userId) {
    try {
        const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
        const member = await mainGuild.members.fetch(userId).catch(() => null);
        return member && member.roles.cache.has(REQUIRED_BUTTON_ROLE_ID);
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

async function hasStaffRole(userId) {
    for (const guild of client.guilds.cache.values()) {
        const m = await guild.members.fetch(userId).catch(() => null);
        if (m && m.roles.cache.has(LOA_STAFF_ROLE_ID)) return true;
    }
    return false;
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
            .addFields({ name: '👤 User', value: `${user.tag} (${user.id})` }, { name: '🏢 Department', value: loa.department || 'Unknown' }, ...extraFields)
            .setTimestamp().setFooter({ text: `LOA ID: ${loaId}` });
        await logChannel.send({ embeds: [embed] });
    } catch (err) { console.error('Error sending LOA log:', err); }
}

// ========== SESSION SCHEDULING ==========
async function scheduleSession(session) {
    const fireAt = new Date(session.sessionFireAt).getTime();
    const now = Date.now();
    const reminderDelay = fireAt - 10 * 60 * 1000 - now;
    const announcementDelay = fireAt - now;
    const finishCheckDelay = fireAt + 25 * 60 * 1000 - now;

    if (!session.preSessionReminderSent && reminderDelay > 0) {
        await Session.findByIdAndUpdate(session._id, { preSessionReminderSent: true });
        setTimeout(async () => {
            try {
                const latestSession = await Session.findById(session._id);
                if (!latestSession || latestSession.status !== 'approved') return;
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
                        try { const host = await client.users.fetch(latestSession.hostId); await host.send({ embeds: [new EmbedBuilder().setTitle('❌ Session Auto Cancelled').setDescription(`Your **${latestSession.shiftType}** session at **${latestSession.time}** has been automatically cancelled as we did not receive a response.\n\n***Sincerely,***\n**Kavià Café Staff Team**`).setColor(0xE74C3C).setTimestamp()] }); } catch {}
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
        let announcementContent = session.shiftType === 'Training'
            ? `Hello <@&${TRAINING_PING_ROLE_ID}> !\n‼️ Get ready! I'm excited to announce that I'll be hosting a training at ${session.time} alongside my co-host, ${cohostText}!\n📈 If you're an LR aiming for promotion, this is your moment to step up and shine.\nDon't miss your chance!\n🔗 | [Roblox Group](https://www.roblox.com/communities/13827902/Kavi-Cafe#!/about)\n🔗 | [Training Center](https://www.roblox.com/games/85441213175174/Kavi-Training-Center)`
            : `## 🚀 | Shift Commencement\n\n<@&${SHIFT_PING_ROLE_ID}>\n\n**‼️ | We are excited to announce that a shift is now being hosted at our lovely café!**\n\n💼 | Hosted by: <@${session.hostId}>\n\n🔗 | [Roblox Group](https://www.roblox.com/communities/13827902/Kavi-Cafe#!/about)`;
        const msg = await announcementChannel.send({ content: announcementContent });
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
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('⏰ Age Verification Reminder')
                            .setColor(0xF39C12)
                            .addFields(
                                { name: '👤 Trainee', value: `<@${userId}> (${userId})` },
                                { name: '🏢 Department', value: session.department },
                                { name: '📖 Training', value: session.training },
                                { name: '📝 Last Submission', value: session.lastAgeVerifContent || 'No submission yet' }
                            )
                            .setTimestamp()
                    ]
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
    await user.send({
        embeds: [
            new EmbedBuilder()
                .setTitle('📝 Quiz Time!')
                .setDescription(`You've completed all sections! Now it's time for your quiz.\n\nYou need **${session.trainingConfig.passScore}/${session.trainingConfig.quiz.length}** to pass.\n\n**Good luck!**`)
                .setColor(0x9B59B6)
                .setTimestamp()
        ]
    });
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
            embeds: [
                new EmbedBuilder()
                    .setTitle('📝 Training Quiz Results')
                    .setColor(passed ? 0x2ECC71 : 0xE74C3C)
                    .addFields(
                        { name: '👤 Trainee', value: `<@${userId}> (${userId})` },
                        { name: '🏢 Department', value: session.department },
                        { name: '📖 Training', value: session.training },
                        { name: '👮 Trained By', value: `<@${session.staffId}> (${session.staffTag})` },
                        { name: '📊 Score', value: `${session.score}/${session.trainingConfig.quiz.length}` },
                        { name: '🎯 Pass Requirement', value: `${session.trainingConfig.passScore}/${session.trainingConfig.quiz.length}` },
                        { name: '🏆 Suggested Result', value: passed ? '✅ Pass' : '❌ Fail' }
                    )
                    .setTimestamp()
            ],
            components: [resultRow]
        });
    }
}

// ========== INTERACTION HANDLER ==========
client.on('interactionCreate', async interaction => {

    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`❌ Command error [/${interaction.commandName}]`, error);
            if (!interaction.replied && !interaction.deferred) {
                try { await interaction.reply({ content: `❌ Error running command.`, ephemeral: true }); } catch {}
            }
        }
        return;
    }

    // ========== SELECT MENU HANDLER ==========
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('changerank_select_')) {
            const parts = interaction.customId.replace('changerank_select_', '').split('_');
            const robloxId = parts[0];
            const groupId = parts.slice(1).join('_');
            const context = client.rankChangeContext?.get(`${robloxId}_${groupId}`);
            if (!context) return interaction.reply({ content: '❌ This selection has expired.', ephemeral: true });
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

    if (interaction.isButton()) {

        // ========== NEW TRAINING BUTTONS (st_) ==========
        if (interaction.customId.startsWith('st_done_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const sectionIndex = parseInt(parts[3]);
            if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This is not your training session.', ephemeral: true });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active training session found.', ephemeral: true });
            if (session.locked) return interaction.reply({ content: '🔒 Your session is locked. Please wait for a staff member to resolve your help request.', ephemeral: true });
            await interaction.update({ components: [] });
            const nextSection = sectionIndex + 1;
            if (nextSection < session.trainingConfig.sections.length) {
                session.section = nextSection;
                await sendNextSection(userId, session);
            } else {
                await startQuiz(userId, session);
            }
            return;
        }

        if (interaction.customId.startsWith('st_help_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const sectionIndex = parseInt(parts[3]);
            if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This is not your training session.', ephemeral: true });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active training session found.', ephemeral: true });
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
            const sectionIndex = parseInt(parts[3]);
            if (!await hasTrainingRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to resolve training sessions.', ephemeral: true });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', ephemeral: true });
            session.locked = false;
            await interaction.update({ components: [] });
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [new EmbedBuilder().setTitle('✅ Help Request Resolved').setDescription('A staff member has resolved your help request. You may now continue your training by clicking **Done** below.').setColor(0x2ECC71).setTimestamp()] });
            await sendNextSection(userId, session);
            return;
        }

        if (interaction.customId.startsWith('st_ageverif_accept_')) {
            const userId = interaction.customId.replace('st_ageverif_accept_', '');
            if (!await hasTrainingRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', ephemeral: true });
            if (session.ageVerifRepingTimeout) clearTimeout(session.ageVerifRepingTimeout);
            session.awaitingAgeVerif = false;

            // Update the log message to show accepted
            await interaction.update({ components: [] });
            try {
                const logChannel = await client.channels.fetch(session.ageVerifLogChannelId);
                const logMsg = await logChannel.messages.fetch(session.ageVerifLogMessageId).catch(() => null);
                if (logMsg) {
                    const acceptedEmbed = EmbedBuilder.from(logMsg.embeds[0])
                        .setTitle('✅ Age Verification Accepted')
                        .setColor(0x2ECC71)
                        .addFields({ name: '👮 Accepted By', value: interaction.user.tag });
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
            if (!await hasTrainingRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', ephemeral: true });
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
            if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This is not your training session.', ephemeral: true });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active training session found.', ephemeral: true });
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
            if (!await hasTrainingRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', ephemeral: true });
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
            if (!await hasTrainingRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', ephemeral: true });
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
            session.section = 0;
            session.phase = 'sections';
            session.score = 0;
            session.quizIndex = 0;
            session.locked = false;
            session.awaitingAgeVerif = false;
            setTimeout(async () => { await sendNextSection(userId, session); }, 2000);
            return;
        }

        // ========== SESSION REQUEST BUTTONS ==========
        if (interaction.customId.startsWith('sesaccept_')) {
            if (!await hasRequiredRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to use this button.', ephemeral: true });
            const sessionId = interaction.customId.replace('sesaccept_', '');
            try {
                const session = await Session.findById(sessionId);
                if (!session) return interaction.reply({ content: '❌ Session not found.', ephemeral: true });
                await Session.findByIdAndUpdate(sessionId, { status: 'approved', approvedAt: new Date() });
                const user = await client.users.fetch(session.hostId);
                let linkText = '';
                if (session.shiftType === 'Training') linkText = `\n\nPlease review the training guide before your session:\n${TRAINING_LINK}`;
                else if (session.shiftType === 'Regular Shift') linkText = `\n\nPlease review the shift guide before your session:\n${SHIFT_LINK}`;
                await user.send({ content: `# <:kaviacafe:1387492814916685845> **Session Request Accepted**\nHello, ${user},\nWe are delighted to inform you that your **${session.shiftType}** request has been **accepted** at **Kavià Café**!\n> <:pink_pin:1166850035611353148> **Shift Type →** *${session.shiftType}*\n> <:pink_pin:1166850035611353148> **Time →** *${session.time}*\n> <:pink_pin:1166850035611353148> **Status →** *Accepted ✅*\nShould you have any questions or concerns prior to your session, please do not hesitate to reach out.${linkText}\n***Signed,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**` });
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed).setColor(0x2ECC71).setTitle('📋 Session Request — ✅ Accepted').setFooter({ text: `Accepted by ${interaction.user.username} • Session ID: ${sessionId}` });
                await interaction.update({ embeds: [newEmbed], components: [] });
                session.status = 'approved';
                await scheduleSession(session);
            } catch (err) { console.error('Error accepting session:', err); await interaction.reply({ content: '❌ Error accepting request.', ephemeral: true }); }
            return;
        }

        if (interaction.customId.startsWith('sesdecline_') && !interaction.customId.startsWith('sesdeclinemodal_')) {
            if (!await hasRequiredRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to use this button.', ephemeral: true });
            const sessionId = interaction.customId.replace('sesdecline_', '');
            const session = await Session.findById(sessionId);
            if (!session) return interaction.reply({ content: '❌ Session not found.', ephemeral: true });
            const modal = new ModalBuilder().setCustomId(`sesdeclinemodal_${sessionId}`).setTitle('Decline Session Request');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('declinereason').setLabel('Reason for declining').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the reason for declining this request...').setRequired(true)));
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('ses_stillhosting_')) {
            const sessionId = interaction.customId.replace('ses_stillhosting_', '');
            const session = await Session.findById(sessionId);
            if (!session || interaction.user.id !== session.hostId) return interaction.reply({ content: '❌ Only the host can click this button.', ephemeral: true });
            await interaction.update({ components: [] });
            await Session.findByIdAndUpdate(sessionId, { hostConfirmed: true });
            const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
            if (requestChannel?.isTextBased()) await requestChannel.send({ embeds: [new EmbedBuilder().setTitle('✅ Host Confirmed').setDescription(`<@${session.hostId}> has confirmed they are still hosting their **${session.shiftType}** at **${session.time}**. The announcement will be posted at the scheduled time!`).setColor(0x2ECC71).setTimestamp()] });
            return;
        }

        if (interaction.customId.startsWith('ses_canthost_')) {
            const sessionId = interaction.customId.replace('ses_canthost_', '');
            const session = await Session.findById(sessionId);
            if (!session || interaction.user.id !== session.hostId) return interaction.reply({ content: '❌ Only the host can click this button.', ephemeral: true });
            await interaction.update({ components: [] });
            await Session.findByIdAndUpdate(sessionId, { status: 'cancelled' });
            try { const host = await client.users.fetch(session.hostId); await host.send({ embeds: [new EmbedBuilder().setTitle('❌ Session Cancelled').setDescription('Your session has been cancelled. Please let a staff member know if you need to reschedule.').setColor(0xE74C3C).setTimestamp()] }); } catch {}
            const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
            if (requestChannel?.isTextBased()) await requestChannel.send({ embeds: [new EmbedBuilder().setTitle('❌ Session Cancelled').setColor(0xE74C3C).setDescription(`<@${session.hostId}> is no longer able to host their **${session.shiftType}** at ${session.time}.`).setTimestamp()] });
            return;
        }

        if (interaction.customId.startsWith('ses_finished_')) {
            const sessionId = interaction.customId.replace('ses_finished_', '');
            const session = await Session.findById(sessionId);
            if (!session || interaction.user.id !== session.hostId) return interaction.reply({ content: '❌ Only the host can click this button.', ephemeral: true });
            await interaction.update({ components: [] });
            await Session.findByIdAndUpdate(sessionId, { status: 'finished' });
            try { const announcementGuild = await client.guilds.fetch(ANNOUNCEMENT_GUILD_ID); const announcementChannel = await announcementGuild.channels.fetch(ANNOUNCEMENT_CHANNEL_ID); const msg = await announcementChannel.messages.fetch(session.announcementMessageId).catch(() => null); if (msg) await msg.delete().catch(() => {}); } catch (err) { console.error('Error deleting announcement:', err); }
            const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
            if (requestChannel?.isTextBased()) await requestChannel.send({ embeds: [new EmbedBuilder().setTitle('✅ Session Finished').setDescription(`<@${session.hostId}>'s **${session.shiftType}** has been marked as finished. Great job!`).setColor(0x2ECC71).setTimestamp()] });
            return;
        }

        if (interaction.customId.startsWith('ses_notfinished_')) {
            const sessionId = interaction.customId.replace('ses_notfinished_', '');
            const session = await Session.findById(sessionId);
            if (!session || interaction.user.id !== session.hostId) return interaction.reply({ content: '❌ Only the host can click this button.', ephemeral: true });
            await interaction.update({ components: [] });
            const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
            if (requestChannel?.isTextBased()) await requestChannel.send({ embeds: [new EmbedBuilder().setTitle('⏳ Session Still Going').setDescription(`<@${session.hostId}>'s **${session.shiftType}** is still in progress. We'll check back in another 25 minutes.`).setColor(0xF39C12).setTimestamp()] });
            setTimeout(async () => { await sendFinishCheck(sessionId); }, 25 * 60 * 1000);
            return;
        }

        // ========== LOA BUTTONS ==========
        if (interaction.customId.startsWith('loa_accept_')) {
            const loaId = interaction.customId.replace('loa_accept_', '');
            if (!await hasStaffRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
            try {
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.reply({ content: '❌ LOA not found.', ephemeral: true });
                await LOA.findByIdAndUpdate(loaId, { status: 'approved', approvedAt: new Date() });
                const user = await client.users.fetch(loa.userId);
                await user.send({ embeds: [new EmbedBuilder().setTitle('✅ Leave of Absence Approved').setDescription(`Hello, <@${loa.userId}>!\n\nWe are pleased to inform you that your **Leave of Absence** request has been **approved** at **Kavià Café**.\n\n> <:pink_pin:1166850035611353148> **Department →** *${loa.department || 'Unknown'}*\n> <:pink_pin:1166850035611353148> **Time Gone →** *${loa.timeGone}*\n> <:pink_pin:1166850035611353148> **Return Date →** *${loa.returnDate}*\n> <:pink_pin:1166850035611353148> **Status →** *Approved ✅*\n\n***Sincerely,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**`).setColor(0x2ECC71).setTimestamp()] });
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed).setColor(0x2ECC71).setTitle('📋 LOA Request — ✅ Approved').setFooter({ text: `Approved by ${interaction.user.username} • LOA ID: ${loaId}` });
                await interaction.update({ embeds: [newEmbed], components: [] });
                await sendLOALog(user, '✅ LOA Approved', 0x2ECC71, loaId, [{ name: '👮 Approved By', value: interaction.user.tag }, { name: '📅 Return Date', value: loa.returnDate }]);
                scheduleLOAReturnReminder(loa, client);
            } catch (err) { console.error('Error approving LOA:', err); await interaction.reply({ content: '❌ Error approving LOA.', ephemeral: true }); }
            return;
        }

        if (interaction.customId.startsWith('loa_deny_')) {
            const loaId = interaction.customId.replace('loa_deny_', '');
            if (!await hasStaffRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
            const modal = new ModalBuilder().setCustomId(`loa_denymodal_${loaId}`).setTitle('Deny LOA Request');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('denyreason').setLabel('Reason for denial').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the reason for denying this LOA...').setRequired(true)));
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('loa_moreinfo_')) {
            const loaId = interaction.customId.replace('loa_moreinfo_', '');
            if (!await hasStaffRole(interaction.user.id)) return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
            const modal = new ModalBuilder().setCustomId(`loa_moreinfomodal_${loaId}`).setTitle('Request More Info');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('moreinfo').setLabel('What info is needed?').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter what additional information is needed...').setRequired(true)));
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId.startsWith('loa_returned_')) {
            const loaId = interaction.customId.replace('loa_returned_', '');
            const loa = await LOA.findById(loaId);
            if (!loa || interaction.user.id !== loa.userId) return interaction.reply({ content: '❌ This is not your LOA.', ephemeral: true });
            await interaction.update({ components: [] });
            await LOA.findByIdAndUpdate(loaId, { status: 'returned' });
            try { const deptConfig = DEPARTMENTS[loa.department]; if (deptConfig) { const loaGuild = await client.guilds.fetch(deptConfig.serverId); const loaChannel = await loaGuild.channels.fetch(deptConfig.loaChannelId); const msg = await loaChannel.messages.fetch(loa.messageId).catch(() => null); if (msg) await msg.delete().catch(() => {}); } } catch {}
            await interaction.user.send({ embeds: [new EmbedBuilder().setTitle('👋 Welcome Back!').setDescription(`Welcome back, <@${loa.userId}>! 🎉\n\nWe're thrilled to have you back at **Kavià Café**. Your LOA has been officially closed.\n\n***Sincerely,***\n**Kavià Café Staff Team**`).setColor(0x2ECC71).setTimestamp()] });
            await sendLOALog(await client.users.fetch(loa.userId), '👋 LOA Returned', 0x2ECC71, loaId, [{ name: '📅 Return Date', value: loa.returnDate }]);
            return;
        }

        if (interaction.customId.startsWith('loa_extend_')) {
            const loaId = interaction.customId.replace('loa_extend_', '');
            const loa = await LOA.findById(loaId);
            if (!loa || interaction.user.id !== loa.userId) return interaction.reply({ content: '❌ This is not your LOA.', ephemeral: true });
            const modal = new ModalBuilder().setCustomId(`loa_extendmodal_${loaId}`).setTitle('Request LOA Extension');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('extendtime').setLabel('How much more time do you need?').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 1 week, 2 weeks, 1 month').setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('newreturndate').setLabel('New return date (DD/MM/YY)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 25/04/26').setRequired(true))
            );
            await interaction.showModal(modal);
            return;
        }

        return;
    }

    // ========== MODAL SUBMISSIONS ==========
    if (interaction.isModalSubmit()) {

        if (interaction.customId.startsWith('st_ageverif_denymodal_')) {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});
            try {
                const userId = interaction.customId.replace('st_ageverif_denymodal_', '');
                const reason = interaction.fields.getTextInputValue('denyreason');
                const session = activeSessions.get(userId);
                if (!session) return interaction.editReply({ content: '❌ No active session found.' });

                const user = await client.users.fetch(userId);
                await user.send({ embeds: [new EmbedBuilder().setTitle('❌ Age Verification Denied').setDescription(`Hello, <@${userId}>,\n\nUnfortunately your age verification submission has been **denied**.\n\n> **Reason →** *${reason}*\n\nPlease send a new screenshot or image link as a DM reply and a staff member will review it.\n\n***Sincerely,***\n**Kavià Café Staff Team**`).setColor(0xE74C3C).setTimestamp()] });

                // Update log message to show denied
                try {
                    if (session.ageVerifLogChannelId && session.ageVerifLogMessageId) {
                        const logChannel = await client.channels.fetch(session.ageVerifLogChannelId);
                        const logMsg = await logChannel.messages.fetch(session.ageVerifLogMessageId).catch(() => null);
                        if (logMsg) {
                            const deniedEmbed = EmbedBuilder.from(logMsg.embeds[0])
                                .setTitle('❌ Age Verification Denied')
                                .setColor(0xE74C3C)
                                .addFields(
                                    { name: '👮 Denied By', value: interaction.user.tag },
                                    { name: '📝 Reason', value: reason }
                                );
                            await logMsg.edit({ embeds: [deniedEmbed], components: [] });
                        }
                    }
                } catch {}

                // Reset so next DM creates a new log message
                session.ageVerifLogMessageId = null;
                session.ageVerifLogChannelId = null;

                await interaction.editReply({ content: '✅ Age verification denied and user notified. Waiting for their next submission.' });

            } catch (err) {
                console.error('Error denying age verif:', err);
                try { await interaction.editReply({ content: '❌ Error denying age verification.' }); } catch {}
            }
            return;
        }

        if (interaction.customId.startsWith('sesdeclinemodal_')) {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});
            try {
                const sessionId = interaction.customId.replace('sesdeclinemodal_', '');
                const reason = interaction.fields.getTextInputValue('declinereason');
                const session = await Session.findById(sessionId);
                if (!session) return interaction.editReply({ content: '❌ Session not found.' });
                await Session.findByIdAndUpdate(sessionId, { status: 'cancelled' });
                const user = await client.users.fetch(session.hostId);
                await user.send({ content: `# <:kaviacafe:1387492814916685845> **Session Request Declined**\nHello, ${user},\nWe regret to inform you that your **${session.shiftType}** request has been **declined** at **Kavià Café**.\n> <:pink_pin:1166850035611353148> **Shift Type →** *${session.shiftType}*\n> <:pink_pin:1166850035611353148> **Status →** *Declined ❌*\n> <:pink_pin:1166850035611353148> **Reason →** *${reason}*\n***Signed,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**` });
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed).setColor(0xE74C3C).setTitle('📋 Session Request — ❌ Declined').setFooter({ text: `Declined by ${interaction.user.username} — Reason: ${reason}` });
                await interaction.message.edit({ embeds: [newEmbed], components: [] });
                await interaction.editReply({ content: '✅ Request declined and user notified.' });
            } catch (err) { console.error('Error declining session:', err); try { await interaction.editReply({ content: '❌ Error declining request.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('loa_denymodal_')) {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});
            try {
                const loaId = interaction.customId.replace('loa_denymodal_', '');
                const reason = interaction.fields.getTextInputValue('denyreason');
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.editReply({ content: '❌ LOA not found.' });
                await LOA.findByIdAndUpdate(loaId, { status: 'denied' });
                const user = await client.users.fetch(loa.userId);
                await user.send({ embeds: [new EmbedBuilder().setTitle('❌ Leave of Absence Denied').setDescription(`Hello, <@${loa.userId}>,\n\nWe regret to inform you that your **Leave of Absence** request has been **denied** at **Kavià Café**.\n\n> <:pink_pin:1166850035611353148> **Department →** *${loa.department || 'Unknown'}*\n> <:pink_pin:1166850035611353148> **Status →** *Denied ❌*\n> <:pink_pin:1166850035611353148> **Reason →** *${reason}*\n\n***Sincerely,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**`).setColor(0xE74C3C).setTimestamp()] });
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed).setColor(0xE74C3C).setTitle('📋 LOA Request — ❌ Denied').setFooter({ text: `Denied by ${interaction.user.username} — Reason: ${reason}` });
                await interaction.message.edit({ embeds: [newEmbed], components: [] });
                await sendLOALog(user, '❌ LOA Denied', 0xE74C3C, loaId, [{ name: '👮 Denied By', value: interaction.user.tag }, { name: '📝 Reason', value: reason }]);
                await interaction.editReply({ content: '✅ LOA denied and user notified.' });
            } catch (err) { console.error('Error denying LOA:', err); try { await interaction.editReply({ content: '❌ Error denying LOA.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('loa_moreinfomodal_')) {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});
            try {
                const loaId = interaction.customId.replace('loa_moreinfomodal_', '');
                const moreInfo = interaction.fields.getTextInputValue('moreinfo');
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.editReply({ content: '❌ LOA not found.' });
                await LOA.findByIdAndUpdate(loaId, { status: 'denied' });
                const user = await client.users.fetch(loa.userId);
                await user.send({ embeds: [new EmbedBuilder().setTitle('❓ More Information Required').setDescription(`Hello, <@${loa.userId}>,\n\nThank you for submitting your **Leave of Absence** request. Before we can process it, we require some additional information.\n\n> <:pink_pin:1166850035611353148> **Department →** *${loa.department || 'Unknown'}*\n> <:pink_pin:1166850035611353148> **Information Needed →** *${moreInfo}*\n\nPlease resubmit your LOA using \`/loa\` with the additional information.\n\n***Sincerely,***\n**${interaction.user.username}**\n**Kavià Café Staff Team**`).setColor(0xF39C12).setTimestamp()] });
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed).setColor(0xF39C12).setTitle('📋 LOA Request — ❓ More Info Requested').setFooter({ text: `More info requested by ${interaction.user.username}` });
                await interaction.message.edit({ embeds: [newEmbed], components: [] });
                await sendLOALog(user, '❓ LOA More Info Requested', 0xF39C12, loaId, [{ name: '👮 Requested By', value: interaction.user.tag }, { name: '📝 Info Needed', value: moreInfo }]);
                await interaction.editReply({ content: '✅ More info requested and user notified.' });
            } catch (err) { console.error('Error requesting more info:', err); try { await interaction.editReply({ content: '❌ Error requesting more info.' }); } catch {} }
            return;
        }

        if (interaction.customId.startsWith('loa_extendmodal_')) {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});
            try {
                const loaId = interaction.customId.replace('loa_extendmodal_', '');
                const extendTime = interaction.fields.getTextInputValue('extendtime');
                const newReturnDate = interaction.fields.getTextInputValue('newreturndate');
                const loa = await LOA.findById(loaId);
                if (!loa) return interaction.editReply({ content: '❌ LOA not found.' });
                const newDateParsed = new Date(newReturnDate.split('/').reverse().join('-'));
                if (isNaN(newDateParsed.getTime())) return interaction.editReply({ content: '❌ Invalid date format. Please use DD/MM/YY.' });
                await LOA.findByIdAndUpdate(loaId, { status: 'extended', returnDate: newReturnDate, returnDateParsed: newDateParsed, returnReminderSent: false });
                const user = await client.users.fetch(loa.userId);
                await user.send({ embeds: [new EmbedBuilder().setTitle('⏳ LOA Extension Requested').setDescription(`Hello, <@${loa.userId}>,\n\nYour **LOA Extension** request has been noted.\n\n> <:pink_pin:1166850035611353148> **Extra Time Requested →** *${extendTime}*\n> <:pink_pin:1166850035611353148> **New Return Date →** *${newReturnDate}*\n\nThank you for keeping us informed!\n\n***Sincerely,***\n**Kavià Café Staff Team**`).setColor(0xF39C12).setTimestamp()] });
                const updatedLoa = await LOA.findById(loaId);
                scheduleLOAReturnReminder(updatedLoa, client);
                await sendLOALog(user, '⏳ LOA Extension Requested', 0xF39C12, loaId, [{ name: '⏳ Extra Time', value: extendTime }, { name: '📅 New Return Date', value: newReturnDate }]);
                await interaction.editReply({ content: '✅ Extension request submitted!' });
            } catch (err) { console.error('Error extending LOA:', err); try { await interaction.editReply({ content: '❌ Error submitting extension.' }); } catch {} }
            return;
        }

        return;
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.type === 1) {
        // Check if user is awaiting age verification
        const trainingSession = activeSessions.get(message.author.id);
        if (trainingSession && trainingSession.awaitingAgeVerif) {
            trainingSession.lastAgeVerifContent = message.content || '[Attachment]';

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
                            { name: '📖 Training', value: trainingSession.training },
                            { name: '📝 Message', value: message.content || '*No text*' }
                        )
                        .setTimestamp();

                    if (message.attachments.size > 0) {
                        const attachment = message.attachments.first();
                        logEmbed.setImage(attachment.url);
                        logEmbed.addFields({ name: '🖼️ Attachment', value: attachment.url });
                        trainingSession.lastAgeVerifContent = attachment.url;
                    }

                    const logMsg = await logChannel.send({
                        content: `<@&${trainingSession.deptConfig.pingRoleId}>`,
                        embeds: [logEmbed],
                        components: [verifyRow]
                    });

                    // Store for editing on accept/deny
                    trainingSession.ageVerifLogMessageId = logMsg.id;
                    trainingSession.ageVerifLogChannelId = logChannel.id;
                }
            } catch (err) { console.error('Error logging age verif submission:', err); }
            return;
        }

        // Regular DM logging
        const logChannelId = client.dmLogChannels?.get(message.author.id) || '1462580398935642144';

        console.log(`📨 DM received from: ${message.author.id}`);
        console.log(`📨 Map size: ${client.dmLogChannels?.size}`);
        console.log(`📨 Mapped channel: ${client.dmLogChannels?.get(message.author.id)}`);
        console.log(`📨 Using channel: ${logChannelId}`);

        const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;
        try { await message.react('✅'); } catch (err) { console.error('Failed to react to user DM:', err); }

        const userReplyEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('💬 **DM Received**')
            .addFields(
                { name: '📤 From (User)', value: `${message.author.tag} (${message.author.id})` },
                { name: '📥 To (Bot)', value: `${client.user.tag}` },
                { name: '📝 Message', value: message.content || '*No text content*' },
                { name: '🕒 Date & Time', value: timestamp }
            )
            .setFooter({ text: 'Kavia Cafe • DM Logs' });

        try {
            const logChannel = await client.channels.fetch(logChannelId);
            if (logChannel) await logChannel.send({ embeds: [userReplyEmbed] });
        } catch (err) { console.error('Error logging user DM:', err); }
    }
});

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
    console.log('✅ Cleared global commands');
    for (const guild of client.guilds.cache.values()) {
        try {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: [] });
            await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: cmds });
            console.log(`✅ Commands registered in guild: ${guild.name}`);
        } catch (err) { console.error(`❌ Failed to register commands in guild ${guild.name}:`, err); }
    }
    const { scheduleReminder } = require('./commands/remind');
    const pendingReminders = await Reminder.find({ fireAt: { $gt: new Date() } });
    for (const reminder of pendingReminders) scheduleReminder(reminder, client);
    console.log(`✅ Reloaded ${pendingReminders.length} pending reminders`);
    await restoreSessions();
    await cleanupStaleSessions();
    setInterval(cleanupStaleSessions, 60 * 60 * 1000);
    await restoreLOAs();
});

client.on('guildCreate', async guild => {
    console.log(`✅ Joined new guild: ${guild.name}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: cmds });
        console.log(`✅ Commands registered in new guild: ${guild.name}`);
    } catch (err) { console.error(`❌ Failed to register commands in new guild ${guild.name}:`, err); }
});

connectDB().then(() => {
    client.login(process.env.TOKEN);
    console.log('✅ Bot started successfully!');
}).catch(err => {
    console.error('❌ Failed to connect to MongoDB:', err);
    process.exit(1);
});