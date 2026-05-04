const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Ticket, TicketPanel } = require('../db');
const { DEPARTMENTS, hasMainRole } = require('./departments');

const PANEL_IMAGE = 'https://images-ext-1.discordapp.net/external/BRbAFEkp6sgftr5ZZdkP1qB0t_VrQJxkENCKXh76XG4/https/media.galaxybot.app/server/1370892833182974035/d00d856a-6931-405b-a916-b875c51eeee3.jpeg?format=webp';

async function rebuildAndUpdatePanel(panel, guild, client) {
    try {
        const textChannel = await guild.channels.fetch(panel.channelId).catch(() => null);
        if (!textChannel) return;

        const workloadData = await Promise.all(panel.categories.map(async (c) => {
            const count = await Ticket.countDocuments({ serverId: guild.id, category: c.name, status: { $in: ['open', 'claimed'] } });
            const pct = Math.round((count / 5) * 100);
            return `• **${c.emoji ? c.emoji + ' ' : ''}${c.name}:** Available \`${count}/5\` (${pct}%)`;
        }));

        const embed = new EmbedBuilder()
            .setTitle(panel.title)
            .setDescription(panel.description)
            .setColor(0x5865F2)
            .addFields({
                name: '📊 Ticket Utilization',
                value: panel.categories.length > 0
                    ? `Here you can see the current workload of our tickets.\n\n${workloadData.join('\n')}`
                    : 'No categories yet. Use `/ticketsetup` to add categories!'
            })
            .setImage(PANEL_IMAGE)
            .setTimestamp();

        const components = [];
        if (panel.categories.length > 0) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`ticket_open_${guild.id}`)
                .setPlaceholder('Choose a category...')
                .addOptions(panel.categories.map(c => {
                    const option = { label: c.name, value: c.name };
                    if (c.emoji) option.emoji = c.emoji;
                    if (c.description) option.description = c.description.substring(0, 100);
                    return option;
                }));
            components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        const existingMsg = await textChannel.messages.fetch(panel.messageId).catch(() => null);
        if (existingMsg) {
            await existingMsg.edit({ embeds: [embed], components });
        } else {
            const newMsg = await textChannel.send({ embeds: [embed], components });
            await TicketPanel.findByIdAndUpdate(panel._id, { messageId: newMsg.id });
        }
    } catch (err) {
        console.error('Error rebuilding panel:', err);
        throw err;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticketsetup')
        .setDescription('Set up or update the ticket panel in a channel')
        .addChannelOption(option =>
            option.setName('channel').setDescription('Channel for the ticket panel').setRequired(true)
                .addChannelTypes(ChannelType.GuildText)),

    async execute(interaction, client) {
        try {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            let hasPerms = false;
            for (const dept of Object.values(DEPARTMENTS)) {
                if (dept.serverId === interaction.guildId && member?.roles.cache.has(dept.roleId)) { hasPerms = true; break; }
            }
            if (!hasPerms) hasPerms = await hasMainRole(client, interaction.user.id);
            if (!hasPerms) return interaction.reply({ content: '❌ You do not have permission to set up the ticket system.', ephemeral: true });

            const channel = interaction.options.getChannel('channel');
            const textChannel = await interaction.guild.channels.fetch(channel.id);
            if (!textChannel?.isTextBased()) return interaction.reply({ content: '❌ Please select a text channel.', ephemeral: true });

            const existingPanel = await TicketPanel.findOne({ serverId: interaction.guildId, channelId: textChannel.id });

            if (existingPanel) {
                await interaction.deferReply({ ephemeral: true });

                const categoryList = existingPanel.categories.length > 0
                    ? existingPanel.categories.map((c, i) => `**${i + 1}.** ${c.emoji ? c.emoji + ' ' : ''}${c.name}`).join('\n')
                    : '*No categories yet*';

                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ts_editpanel_${existingPanel._id}`).setLabel('✏️ Edit Title/Description').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`ts_addcat_${existingPanel._id}`).setLabel('➕ Add Category').setStyle(ButtonStyle.Success)
                );
                const row2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ts_editcat_${existingPanel._id}`).setLabel('✏️ Edit Category').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`ts_removecat_${existingPanel._id}`).setLabel('🗑️ Remove Category').setStyle(ButtonStyle.Danger)
                );

                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setTitle('🎫 Ticket Panel Management')
                        .setDescription(`Managing panel in <#${textChannel.id}>\n\n**Current Categories:**\n${categoryList}`)
                        .setColor(0x5865F2)
                    ],
                    components: [row1, row2]
                });

            } else {
                const modal = new ModalBuilder()
                    .setCustomId(`ts_newpanel_${channel.id}`)
                    .setTitle('Create Ticket Panel');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('title').setLabel('Panel Title').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. Support Tickets')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('description').setLabel('Panel Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('e.g. Open a ticket for support...')
                    )
                );
                await interaction.showModal(modal);
            }

        } catch (err) {
            console.error('Error in /ticketsetup:', err);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Error setting up ticket system.', ephemeral: true });
                } else {
                    await interaction.editReply({ content: '❌ Error setting up ticket system.' });
                }
            } catch {}
        }
    },

    rebuildAndUpdatePanel
};