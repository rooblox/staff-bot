const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { Payment } = require('../db');
const { DEPARTMENTS } = require('./loa');
const MAIN_GUILD_ID = '1370892833182974035';
const MAIN_REQUIRED_ROLE_ID = '1493354187109433434';

const AGREEMENT_TEXT = `By clicking "I Agree", you confirm the following:

1. You have agreed to receive the stated payment from Kavià Café in exchange for the described work/content.
2. All content, assets, recordings, or work produced as part of this agreement may be used by Kavià Café across all platforms including but not limited to Roblox, TikTok, YouTube, Discord, and any other media at their full discretion.
3. You grant Kavià Café a non-exclusive, perpetual, royalty-free license to use, modify, and distribute the content produced.
4. This agreement is binding and your Discord account, username, and ID serve as your digital signature.
5. Failure to deliver agreed work after payment may result in removal from Kavià Café partnerships.`;

async function hasBotPermsRole(client, guildId, userId) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;
        for (const dept of Object.values(DEPARTMENTS)) {
            if (dept.serverId === guildId && member.roles.cache.has(dept.roleId)) return true;
        }
        if (guildId === MAIN_GUILD_ID && member.roles.cache.has(MAIN_REQUIRED_ROLE_ID)) return true;
        return false;
    } catch { return false; }
}

function getDeptName(guildId) {
    for (const [name, dept] of Object.entries(DEPARTMENTS)) {
        if (dept.serverId === guildId) return name;
    }
    return 'Kavià Café';
}

function getDeptLogChannel(guildId) {
    for (const dept of Object.values(DEPARTMENTS)) {
        if (dept.serverId === guildId) return dept.logChannelId;
    }
    return null;
}

function buildReceiptEmbed(payment, status) {
    const colorMap = {
        pending: 0xF39C12,
        accepted: 0x2ECC71,
        declined: 0xE74C3C,
        countered: 0x3498DB,
        agreed: 0x9B59B6,
        paid: 0x2ECC71,
        counter_pending: 0x3498DB
    };

    const statusMap = {
        pending: '⏳ Awaiting Response',
        accepted: '✅ Accepted',
        declined: '❌ Declined',
        countered: '🔄 Counter Offer Sent',
        agreed: '📝 Agreement Signed',
        paid: '💸 Paid',
        counter_pending: '⏳ Counter Offer — Awaiting Staff Review'
    };

    const currencySymbol = payment.currency === 'robux' ? 'R$' : '$';
    const currentAmount = payment.counterAmount || payment.amount;

    const embed = new EmbedBuilder()
        .setTitle('💸 Payment Receipt')
        .setColor(colorMap[status] || 0xF39C12)
        .addFields(
            { name: '👤 Recipient', value: `${payment.targetTag} (${payment.targetId})`, inline: true },
            { name: '📅 Account Created', value: payment.targetCreatedAt ? `<t:${Math.floor(new Date(payment.targetCreatedAt).getTime() / 1000)}:D>` : 'Unknown', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '💰 Original Offer', value: `${currencySymbol}${payment.amount} ${payment.currency === 'robux' ? 'Robux' : 'USD'}`, inline: true },
            { name: '💰 Agreed Amount', value: payment.counterAmount ? `${currencySymbol}${payment.counterAmount} ${payment.currency === 'robux' ? 'Robux' : 'USD'}` : `${currencySymbol}${payment.amount} ${payment.currency === 'robux' ? 'Robux' : 'USD'}`, inline: true },
            { name: '📋 Status', value: statusMap[status] || status, inline: true },
            { name: '📝 Description', value: payment.description, inline: false },
            { name: '🏢 Department', value: payment.department, inline: true },
            { name: '👮 Offered By', value: `${payment.offeredByTag} (${payment.offeredBy})`, inline: true },
            { name: '📅 Offer Date', value: `<t:${Math.floor(new Date(payment.createdAt).getTime() / 1000)}:F>`, inline: true }
        )
        .setFooter({ text: `Kavià Café • Payment System • ID: ${payment._id}` })
        .setTimestamp();

    if (payment.agreementSigned && payment.agreementSignedAt) {
        embed.addFields({ name: '📝 Agreement Signed', value: `<t:${Math.floor(new Date(payment.agreementSignedAt).getTime() / 1000)}:F>`, inline: true });
    }
    if (payment.paid && payment.paidAt) {
        embed.addFields(
            { name: '✅ Paid At', value: `<t:${Math.floor(new Date(payment.paidAt).getTime() / 1000)}:F>`, inline: true },
            { name: '💸 Paid By', value: `${payment.paidByTag}`, inline: true }
        );
    }

    if (payment.history && payment.history.length > 0) {
        const historyText = payment.history.map(h => {
            const time = `<t:${Math.floor(new Date(h.at).getTime() / 1000)}:R>`;
            if (h.amount) return `${time} — **${h.action}** by ${h.byTag}: ${payment.currency === 'robux' ? 'R$' : '$'}${h.amount}`;
            return `${time} — **${h.action}** by ${h.byTag}`;
        }).join('\n');
        embed.addFields({ name: '📜 History', value: historyText.substring(0, 1024), inline: false });
    }

    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('payment')
        .setDescription('Send a payment offer to a freelancer')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to pay')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('amount')
                .setDescription('Amount to pay')
                .setRequired(true)
                .setMinValue(1))
        .addStringOption(option =>
            option.setName('currency')
                .setDescription('Currency type')
                .setRequired(true)
                .addChoices(
                    { name: 'Robux (R$)', value: 'robux' },
                    { name: 'USD ($)', value: 'usd' }
                ))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('What this payment is for')
                .setRequired(true)),

    async execute(interaction, client) {
        const hasPerms = await hasBotPermsRole(client, interaction.guildId, interaction.user.id);
        if (!hasPerms) {
            return interaction.reply({ content: '❌ You do not have permission to use this command in this server.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const target = interaction.options.getUser('user');
            const amount = interaction.options.getNumber('amount');
            const currency = interaction.options.getString('currency');
            const description = interaction.options.getString('description');
            const department = getDeptName(interaction.guildId);
            const logChannelId = getDeptLogChannel(interaction.guildId);
            const currencySymbol = currency === 'robux' ? 'R$' : '$';

            const payment = await Payment.create({
                offeredBy: interaction.user.id,
                offeredByTag: interaction.user.tag,
                targetId: target.id,
                targetTag: target.tag,
                targetDiscriminator: target.discriminator || '0',
                targetCreatedAt: target.createdAt,
                amount,
                currency,
                description,
                serverId: interaction.guildId,
                serverName: interaction.guild.name,
                department,
                logChannelId,
                status: 'pending',
                counterAmount: null,
                agreementSigned: false,
                paid: false,
                createdAt: new Date(),
                history: [{ action: 'Offer Sent', by: interaction.user.id, byTag: interaction.user.tag, amount, at: new Date() }]
            });

            const dmEmbed = new EmbedBuilder()
                .setTitle('💸 Payment Offer — Kavià Café')
                .setColor(0xF39C12)
                .setDescription(`You have received a payment offer from **${interaction.guild.name}**!`)
                .addFields(
                    { name: '💰 Amount', value: `**${currencySymbol}${amount} ${currency === 'robux' ? 'Robux' : 'USD'}**`, inline: true },
                    { name: '🏢 Department', value: department, inline: true },
                    { name: '👮 Offered By', value: interaction.user.tag, inline: true },
                    { name: '📝 Description', value: description, inline: false },
                    { name: '📋 Instructions', value: 'Please review this offer and respond below. If you want a different amount, click **Request Different Amount** and enter your counter-offer.' }
                )
                .setFooter({ text: `Kavià Café • Payment System • Ref: ${payment._id}` })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`pay_accept_${payment._id}`)
                    .setLabel('✅ Yes, I accept')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`pay_decline_${payment._id}`)
                    .setLabel('❌ No, decline')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`pay_counter_${payment._id}`)
                    .setLabel('🔄 Request Different Amount')
                    .setStyle(ButtonStyle.Secondary)
            );

            try {
                await target.send({ embeds: [dmEmbed], components: [row] });
            } catch {
                await Payment.findByIdAndDelete(payment._id);
                return interaction.editReply({ content: `❌ Could not DM **${target.tag}**. They may have DMs closed.` });
            }

            // Post to log channel
            if (logChannelId) {
                const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
                if (logChannel?.isTextBased()) {
                    await logChannel.send({
                        embeds: [buildReceiptEmbed(payment, 'pending')],
                    });
                }
            }

            await interaction.editReply({ content: `✅ Payment offer of **${currencySymbol}${amount}** sent to **${target.tag}**!` });

        } catch (err) {
            console.error('Error in /payment:', err);
            try { await interaction.editReply({ content: '❌ Error sending payment offer.' }); } catch {}
        }
    },

    buildReceiptEmbed,
    getDeptLogChannel,
    AGREEMENT_TEXT
};