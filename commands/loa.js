const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { LOA } = require('../db');

const LOA_CHANNEL_ID = '1462104324917166174';
const LOA_GUILD_ID = '1372680943592280217';
const LOG_CHANNEL_ID = '1464070445698650316';
const LOG_GUILD_ID = '1434556801096876034';
const PING_ROLE_ID = '1434623628078743584';
const STAFF_ROLE_ID = '1484973859513045224';

function parseReturnDate(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const [day, month, year] = parts.map(Number);
    const fullYear = year < 100 ? 2000 + year : year;
    const date = new Date(Date.UTC(fullYear, month - 1, day));
    if (isNaN(date.getTime())) return null;
    return date;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loa')
        .setDescription('Submit a Leave of Absence request')
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for your LOA')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('time_gone')
                .setDescription('How long will you be gone? (e.g. 2 weeks, 1 month)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('return_date')
                .setDescription('Expected return date (DD/MM/YY)')
                .setRequired(true)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const reason = interaction.options.getString('reason');
            const timeGone = interaction.options.getString('time_gone');
            const returnDateStr = interaction.options.getString('return_date');
            const returnDateParsed = parseReturnDate(returnDateStr);

            if (!returnDateParsed) {
                return interaction.editReply({ content: '❌ Invalid return date format. Please use DD/MM/YY (e.g. 25/04/26).' });
            }

            if (returnDateParsed < new Date()) {
                return interaction.editReply({ content: '❌ Return date must be in the future.' });
            }

            // Check if user already has an active LOA
            const existingLOA = await LOA.findOne({
                userId: interaction.user.id,
                status: { $in: ['pending', 'approved', 'more_info'] }
            });

            if (existingLOA) {
                return interaction.editReply({ content: '❌ You already have an active LOA request. Please wait for it to be resolved before submitting a new one.' });
            }

            const loa = new LOA({
                userId: interaction.user.id,
                username: interaction.user.username,
                reason,
                timeGone,
                returnDate: returnDateStr,
                returnDateParsed,
                status: 'pending',
                channelId: LOA_CHANNEL_ID,
                logChannelId: LOG_CHANNEL_ID,
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
                    { name: '📝 Reason', value: reason },
                    { name: '⏳ Time Gone', value: timeGone },
                    { name: '📅 Return Date', value: returnDateStr }
                )
                .setFooter({ text: `LOA ID: ${loa._id} • Kavià Café` })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`loa_accept_${loa._id}`)
                    .setLabel('✅ Accept')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`loa_deny_${loa._id}`)
                    .setLabel('❌ Deny')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`loa_moreinfo_${loa._id}`)
                    .setLabel('❓ Request More Info')
                    .setStyle(ButtonStyle.Secondary)
            );

            // Post in LOA channel
            const loaGuild = await client.guilds.fetch(LOA_GUILD_ID);
            const loaChannel = await loaGuild.channels.fetch(LOA_CHANNEL_ID);

            const msg = await loaChannel.send({
                content: `<@&${PING_ROLE_ID}>`,
                embeds: [embed],
                components: [row]
            });

            await LOA.findByIdAndUpdate(loa._id, { messageId: msg.id });

            // Log submission
            await sendLog(client, `📋 LOA Submitted`, interaction.user, reason, timeGone, returnDateStr, 0x3498DB, loa._id);

            // Schedule return reminder
            scheduleLOAReturnReminder(loa, client);

            await interaction.editReply({ content: '✅ Your LOA request has been submitted! You will be DM\'d when it has been reviewed.' });

        } catch (err) {
            console.error('Error in /loa command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};

async function sendLog(client, title, user, reason, timeGone, returnDate, color, loaId) {
    try {
        const logGuild = await client.guilds.fetch(LOG_GUILD_ID);
        const logChannel = await logGuild.channels.fetch(LOG_CHANNEL_ID);

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(color)
            .addFields(
                { name: '👤 User', value: `${user.tag} (${user.id})` },
                { name: '📝 Reason', value: reason || 'N/A' },
                { name: '⏳ Time Gone', value: timeGone || 'N/A' },
                { name: '📅 Return Date', value: returnDate || 'N/A' }
            )
            .setFooter({ text: `LOA ID: ${loaId}` })
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error sending LOA log:', err);
    }
}

function scheduleLOAReturnReminder(loa, client) {
    const MAX_TIMEOUT = 2147483647;
    const delay = new Date(loa.returnDateParsed).getTime() - Date.now();

    if (delay < 0) return;

    if (delay > MAX_TIMEOUT) {
        setTimeout(() => scheduleLOAReturnReminder(loa, client), MAX_TIMEOUT);
        return;
    }

    setTimeout(async () => {
        try {
            const latestLOA = await LOA.findById(loa._id);
            if (!latestLOA || latestLOA.status !== 'approved') return;

            const user = await client.users.fetch(latestLOA.userId);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`loa_returned_${loa._id}`)
                    .setLabel('✅ I am ready to return')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`loa_extend_${loa._id}`)
                    .setLabel('⏳ Request More Time')
                    .setStyle(ButtonStyle.Secondary)
            );

            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('👋 Welcome Back!')
                        .setDescription(`Hello, <@${latestLOA.userId}>!\n\nYour Leave of Absence at **Kavià Café** has come to an end as of today (**${latestLOA.returnDate}**). We hope you had a restful time away!\n\nPlease let us know whether you are ready to return or if you need a little more time.`)
                        .setColor(0x2ECC71)
                        .setTimestamp()
                ],
                components: [row]
            });

            await LOA.findByIdAndUpdate(loa._id, { returnReminderSent: true });

            // Schedule auto delete after 24 hours if no response
            scheduleLoaAutoDelete(loa._id, client, 24 * 60 * 60 * 1000);

        } catch (err) {
            console.error('Error sending LOA return reminder:', err);
        }
    }, delay);
}

async function scheduleLoaAutoDelete(loaId, client, delay) {
    const MAX_TIMEOUT = 2147483647;

    if (delay > MAX_TIMEOUT) {
        setTimeout(() => scheduleLoaAutoDelete(loaId, client, delay - MAX_TIMEOUT), MAX_TIMEOUT);
        return;
    }

    setTimeout(async () => {
        try {
            const loa = await LOA.findById(loaId);
            if (!loa || loa.status === 'returned' || loa.status === 'extended') return;

            // Delete message from LOA channel
            try {
                const loaGuild = await client.guilds.fetch(LOA_GUILD_ID);
                const loaChannel = await loaGuild.channels.fetch(LOA_CHANNEL_ID);
                const msg = await loaChannel.messages.fetch(loa.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            } catch {}

            await LOA.findByIdAndUpdate(loaId, { status: 'returned' });
            console.log(`✅ Auto deleted LOA message for ${loaId}`);
        } catch (err) {
            console.error('Error auto deleting LOA:', err);
        }
    }, delay);
}

module.exports.sendLog = sendLog;
module.exports.scheduleLOAReturnReminder = scheduleLOAReturnReminder;
module.exports.scheduleLoaAutoDelete = scheduleLoaAutoDelete;
module.exports.LOA_CHANNEL_ID = LOA_CHANNEL_ID;
module.exports.LOA_GUILD_ID = LOA_GUILD_ID;
module.exports.LOG_CHANNEL_ID = LOG_CHANNEL_ID;
module.exports.LOG_GUILD_ID = LOG_GUILD_ID;
module.exports.STAFF_ROLE_ID = STAFF_ROLE_ID;