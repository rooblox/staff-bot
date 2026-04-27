const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { LOA } = require('../db');
const { DEPARTMENTS, DEPT_CHOICES } = require('./departments');

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
            option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPT_CHOICES))
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for your LOA').setRequired(true))
        .addStringOption(option =>
            option.setName('time_gone').setDescription('How long will you be gone?').setRequired(true))
        .addStringOption(option =>
            option.setName('return_date').setDescription('Expected return date (DD/MM/YY)').setRequired(true)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const department = interaction.options.getString('department');
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

            const deptConfig = DEPARTMENTS[department];
            if (!deptConfig) {
                return interaction.editReply({ content: '❌ Invalid department selected.' });
            }

            const existingLOA = await LOA.findOne({
                userId: interaction.user.id,
                department,
                status: { $in: ['pending', 'approved', 'more_info'] }
            });

            if (existingLOA) {
                return interaction.editReply({ content: `❌ You already have an active LOA request for the **${department}** department.` });
            }

            const loa = new LOA({
                userId: interaction.user.id,
                username: interaction.user.username,
                department,
                reason,
                timeGone,
                returnDate: returnDateStr,
                returnDateParsed,
                status: 'pending',
                channelId: deptConfig.loaChannelId,
                logChannelId: deptConfig.loaLogChannelId,
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
                    { name: '📅 Return Date', value: returnDateStr }
                )
                .setFooter({ text: `LOA ID: ${loa._id} • Kavià Café` })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`loa_accept_${loa._id}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`loa_deny_${loa._id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`loa_moreinfo_${loa._id}`).setLabel('❓ Request More Info').setStyle(ButtonStyle.Secondary)
            );

            const loaGuild = await client.guilds.fetch(deptConfig.serverId);
            const loaChannel = await loaGuild.channels.fetch(deptConfig.loaChannelId);

            const msg = await loaChannel.send({
                content: `<@&${deptConfig.roleId}>`,
                embeds: [embed],
                components: [row]
            });

            await LOA.findByIdAndUpdate(loa._id, { messageId: msg.id });

            try {
                const logChannel = await loaGuild.channels.fetch(deptConfig.loaLogChannelId);
                await logChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('📋 LOA Submitted')
                            .setColor(0x3498DB)
                            .addFields(
                                { name: '👤 User', value: `${interaction.user.tag} (${interaction.user.id})` },
                                { name: '🏢 Department', value: department },
                                { name: '📝 Reason', value: reason },
                                { name: '⏳ Time Gone', value: timeGone },
                                { name: '📅 Return Date', value: returnDateStr }
                            )
                            .setFooter({ text: `LOA ID: ${loa._id}` })
                            .setTimestamp()
                    ]
                });
            } catch (err) {
                console.error('Error sending LOA submission log:', err);
            }

            scheduleLOAReturnReminder(loa, client);

            await interaction.editReply({ content: '✅ Your LOA request has been submitted! You will be DM\'d when it has been reviewed.' });

        } catch (err) {
            console.error('Error in /loa command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};

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
            const deptConfig = DEPARTMENTS[latestLOA.department];
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`loa_returned_${loa._id}`).setLabel('✅ I am ready to return').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`loa_extend_${loa._id}`).setLabel('⏳ Request More Time').setStyle(ButtonStyle.Secondary)
            );
            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('👋 Welcome Back!')
                        .setDescription(`Hello, <@${latestLOA.userId}>!\n\nYour Leave of Absence at **Kavià Café** (${latestLOA.department}) has come to an end as of today (**${latestLOA.returnDate}**). We hope you had a restful time away!\n\nPlease let us know whether you are ready to return or if you need a little more time.`)
                        .setColor(0x2ECC71)
                        .setTimestamp()
                ],
                components: [row]
            });
            await LOA.findByIdAndUpdate(loa._id, { returnReminderSent: true });
            scheduleLoaAutoDelete(loa._id, client, deptConfig, 24 * 60 * 60 * 1000);
        } catch (err) {
            console.error('Error sending LOA return reminder:', err);
        }
    }, delay);
}

async function scheduleLoaAutoDelete(loaId, client, deptConfig, delay) {
    const MAX_TIMEOUT = 2147483647;
    if (delay > MAX_TIMEOUT) {
        setTimeout(() => scheduleLoaAutoDelete(loaId, client, deptConfig, delay - MAX_TIMEOUT), MAX_TIMEOUT);
        return;
    }
    setTimeout(async () => {
        try {
            const loa = await LOA.findById(loaId);
            if (!loa || loa.status === 'returned' || loa.status === 'extended') return;
            const config = deptConfig || DEPARTMENTS[loa.department];
            if (!config) return;
            try {
                const loaGuild = await client.guilds.fetch(config.serverId);
                const loaChannel = await loaGuild.channels.fetch(config.loaChannelId);
                const msg = await loaChannel.messages.fetch(loa.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            } catch {}
            await LOA.findByIdAndUpdate(loaId, { status: 'returned' });
        } catch (err) {
            console.error('Error auto deleting LOA:', err);
        }
    }, delay);
}

module.exports.scheduleLOAReturnReminder = scheduleLOAReturnReminder;
module.exports.scheduleLoaAutoDelete = scheduleLoaAutoDelete;
module.exports.DEPARTMENTS = DEPARTMENTS;