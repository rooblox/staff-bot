const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

// In-memory store: giveawayId -> { config, participants: Map<userId, msgCount>, endAt, ended, timeoutId }
const activeGiveaways = new Map();

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function pickWinners(participants, count, weighted) {
    const entries = [...participants.entries()].filter(([, msgs]) => msgs >= 0);
    if (entries.length === 0) return [];

    const winners = [];
    const pool = [...entries];

    for (let i = 0; i < count && pool.length > 0; i++) {
        let chosen;
        if (weighted) {
            // Weight by message count (minimum 1 ticket each so everyone has a chance)
            const totalTickets = pool.reduce((sum, [, msgs]) => sum + Math.max(1, msgs), 0);
            let rand = Math.random() * totalTickets;
            chosen = pool[pool.length - 1][0]; // fallback
            for (const [uid, msgs] of pool) {
                rand -= Math.max(1, msgs);
                if (rand <= 0) { chosen = uid; break; }
            }
        } else {
            chosen = pool[Math.floor(Math.random() * pool.length)][0];
        }
        winners.push(chosen);
        const idx = pool.findIndex(([uid]) => uid === chosen);
        if (idx !== -1) pool.splice(idx, 1);
    }
    return winners;
}

async function endGiveaway(client, giveawayId) {
    const gw = activeGiveaways.get(giveawayId);
    if (!gw || gw.ended) return;
    gw.ended = true;
    if (gw.timeoutId) clearTimeout(gw.timeoutId);

    const { config, participants } = gw;

    // Filter out participants who didn't meet the message requirement
    const qualified = new Map([...participants.entries()].filter(([, msgs]) => msgs >= config.requiredMessages));

    const winners = pickWinners(qualified, config.winnersCount, config.weighted);

    const channel = await client.channels.fetch(config.channelId).catch(() => null);

    let resultEmbed;
    if (winners.length === 0) {
        resultEmbed = new EmbedBuilder()
            .setTitle('🎉 Giveaway Ended')
            .setDescription(`**Prize:** ${config.prize}\n\nNo one qualified for this giveaway.${config.requiredMessages > 0 ? ` (Required ${config.requiredMessages} messages)` : ''}`)
            .setColor(0xff0000)
            .setTimestamp();
    } else {
        const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
        resultEmbed = new EmbedBuilder()
            .setTitle('🎉 Giveaway Ended!')
            .setDescription(`**Prize:** ${config.prize}\n\n🏆 **Winner${winners.length > 1 ? 's' : ''}:** ${winnerMentions}`)
            .addFields(
                { name: 'Total Participants', value: `${participants.size}`, inline: true },
                { name: 'Qualified', value: `${qualified.size}`, inline: true },
                { name: 'Selection', value: config.weighted ? 'Weighted (by messages)' : 'Random', inline: true }
            )
            .setColor(0x57f287)
            .setTimestamp();
        if (config.description) resultEmbed.addFields({ name: 'Description', value: config.description });
    }

    // Edit original message to show ended state
    if (channel) {
        const msg = await channel.messages.fetch(config.messageId).catch(() => null);
        if (msg) {
            const endedRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`giveaway_ended_${giveawayId}`)
                    .setLabel('Giveaway Ended')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );
            await msg.edit({ embeds: [resultEmbed], components: [endedRow] }).catch(() => {});
        }
        await channel.send({ embeds: [resultEmbed] }).catch(() => {});
    }

    // DM winners
    for (const winnerId of winners) {
        const user = await client.users.fetch(winnerId).catch(() => null);
        if (user) {
            await user.send({
                embeds: [new EmbedBuilder()
                    .setTitle('🎉 You Won!')
                    .setDescription(`You won the **${config.prize}** giveaway in **${config.guildName}**!`)
                    .setColor(0x57f287)
                    .setTimestamp()]
            }).catch(() => {});
        }
    }

    activeGiveaways.delete(giveawayId);
}

module.exports = {
    activeGiveaways,
    endGiveaway,
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Start a giveaway')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(opt => opt.setName('prize').setDescription('What are you giving away?').setRequired(true))
        .addIntegerOption(opt => opt.setName('duration').setDescription('How long should the giveaway run?').setRequired(true).setMinValue(1))
        .addStringOption(opt => opt.setName('duration_unit').setDescription('Unit for duration').setRequired(true)
            .addChoices(
                { name: 'Minutes', value: 'minutes' },
                { name: 'Hours', value: 'hours' },
                { name: 'Days', value: 'days' }
            ))
        .addIntegerOption(opt => opt.setName('winners').setDescription('How many winners? (default: 1)').setMinValue(1).setMaxValue(20))
        .addIntegerOption(opt => opt.setName('required_messages').setDescription('Min messages to enter (default: 0 = any)').setMinValue(0))
        .addStringOption(opt => opt.setName('selection').setDescription('How winners are picked (default: random)').addChoices(
            { name: 'Random (equal chance)', value: 'random' },
            { name: 'Weighted (more messages = higher chance)', value: 'weighted' }
        ))
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel to post giveaway in (defaults to current)'))
        .addStringOption(opt => opt.setName('description').setDescription('Optional extra details about the giveaway')),

    async execute(interaction) {
        const prize = interaction.options.getString('prize');
        const duration = interaction.options.getInteger('duration');
        const unit = interaction.options.getString('duration_unit');
        const winnersCount = interaction.options.getInteger('winners') ?? 1;
        const requiredMessages = interaction.options.getInteger('required_messages') ?? 0;
        const selection = interaction.options.getString('selection') ?? 'random';
        const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;
        const description = interaction.options.getString('description');

        const msMap = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
        const durationMs = duration * msMap[unit];
        const endAt = new Date(Date.now() + durationMs);

        const giveawayId = generateId();

        const embed = new EmbedBuilder()
            .setTitle('🎉 Giveaway!')
            .setDescription([
                `**Prize:** ${prize}`,
                description ? `**Details:** ${description}` : null,
                ``,
                `**Ends:** <t:${Math.floor(endAt.getTime() / 1000)}:R>`,
                `**Winners:** ${winnersCount}`,
                `**Required messages:** ${requiredMessages === 0 ? 'None (just click Enter)' : `${requiredMessages} after entering`}`,
                `**Selection:** ${selection === 'weighted' ? 'Weighted by message count' : 'Random'}`,
                ``,
                `Click **Enter Giveaway** to participate!`
            ].filter(Boolean).join('\n'))
            .setColor(0xf1c40f)
            .setFooter({ text: `Giveaway ID: ${giveawayId}` })
            .setTimestamp(endAt);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`giveaway_enter_${giveawayId}`)
                .setLabel('Enter Giveaway 🎉')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`giveaway_end_${giveawayId}`)
                .setLabel('End Early')
                .setStyle(ButtonStyle.Danger)
        );

        const msg = await targetChannel.send({ embeds: [embed], components: [row] });

        const config = {
            prize,
            description,
            winnersCount,
            requiredMessages,
            weighted: selection === 'weighted',
            channelId: targetChannel.id,
            messageId: msg.id,
            guildName: interaction.guild.name,
            hostId: interaction.user.id,
            endAt
        };

        const timeoutId = setTimeout(() => {
            endGiveaway(interaction.client, giveawayId);
        }, durationMs);

        activeGiveaways.set(giveawayId, {
            config,
            participants: new Map(),
            endAt,
            ended: false,
            timeoutId
        });

        await interaction.reply({
            content: `✅ Giveaway started in ${targetChannel}! Ends <t:${Math.floor(endAt.getTime() / 1000)}:R>.`,
            ephemeral: true
        });
    }
};