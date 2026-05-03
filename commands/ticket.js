const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const { Ticket, TicketPanel } = require('../db');
const { DEPARTMENTS, hasMainRole } = require('./departments');

const PANEL_IMAGE = 'https://images-ext-1.discordapp.net/external/BRbAFEkp6sgftr5ZZdkP1qB0t_VrQJxkENCKXh76XG4/https/media.galaxybot.app/server/1370892833182974035/d00d856a-6931-405b-a916-b875c51eeee3.jpeg?format=webp';
const TICKET_IMAGE = 'https://media.galaxybot.app/server/1370892833182974035/001854df-a22e-4f51-aa3a-784de10a309f.png';

function generateCaseId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return `KC-${result}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticketsetup')
        .setDescription('Set up the ticket panel in a channel')
        .addChannelOption(option =>
            option.setName('channel').setDescription('Channel to post the ticket panel in').setRequired(true)
                .addChannelTypes(ChannelType.GuildText))
        .addStringOption(option =>
            option.setName('title').setDescription('Title of the ticket panel').setRequired(true))
        .addStringOption(option =>
            option.setName('description').setDescription('Description of the ticket panel').setRequired(true))
        .addStringOption(option =>
            option.setName('category_1').setDescription('First ticket category name').setRequired(true))
        .addRoleOption(option =>
            option.setName('ping_role_1').setDescription('Role to ping for category 1').setRequired(true))
        .addStringOption(option =>
            option.setName('category_2').setDescription('Second ticket category name').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role_2').setDescription('Role to ping for category 2').setRequired(false))
        .addStringOption(option =>
            option.setName('category_3').setDescription('Third ticket category name').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role_3').setDescription('Role to ping for category 3').setRequired(false))
        .addStringOption(option =>
            option.setName('category_4').setDescription('Fourth ticket category name').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role_4').setDescription('Role to ping for category 4').setRequired(false))
        .addStringOption(option =>
            option.setName('category_5').setDescription('Fifth ticket category name').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role_5').setDescription('Role to ping for category 5').setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            // Check permissions — dept role for this server OR main role
            let hasPerms = false;
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

            for (const dept of Object.values(DEPARTMENTS)) {
                if (dept.serverId === interaction.guildId && member?.roles.cache.has(dept.roleId)) {
                    hasPerms = true;
                    break;
                }
            }

            if (!hasPerms) {
                hasPerms = await hasMainRole(client, interaction.user.id);
            }

            if (!hasPerms) return interaction.editReply({ content: '❌ You do not have permission to set up the ticket system.' });

            const channel = interaction.options.getChannel('channel');
            const title = interaction.options.getString('title');
            const description = interaction.options.getString('description');

            const categories = [];
            for (let i = 1; i <= 5; i++) {
                const name = interaction.options.getString(`category_${i}`);
                const role = interaction.options.getRole(`ping_role_${i}`);
                if (name && role) categories.push({ name, pingRoleId: role.id });
            }

            if (categories.length === 0) return interaction.editReply({ content: '❌ You must provide at least one category.' });

            // Fetch text channel properly
            const textChannel = await interaction.guild.channels.fetch(channel.id);
            if (!textChannel?.isTextBased()) return interaction.editReply({ content: '❌ Please select a text channel.' });

            // Create or find 🎫 Tickets category at top of server
            let ticketCategory = interaction.guild.channels.cache.find(c => c.name === '🎫 Tickets' && c.type === ChannelType.GuildCategory);
            if (!ticketCategory) {
                ticketCategory = await interaction.guild.channels.create({
                    name: '🎫 Tickets',
                    type: ChannelType.GuildCategory,
                    position: 0
                });
            }

            // Create log channel
            const logChannel = await interaction.guild.channels.create({
                name: 'ticket-logs',
                type: ChannelType.GuildText,
                parent: ticketCategory.id,
                permissionOverwrites: [
                    { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });

            // Give each ping role access to log channel
            for (const cat of categories) {
                await logChannel.permissionOverwrites.edit(cat.pingRoleId, {
                    ViewChannel: true,
                    SendMessages: false,
                    ReadMessageHistory: true
                });
            }

            // Build workload display
            const workloadLines = categories.map(c => `• **${c.name}:** Available \`0/5\` (0%)`).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(0x5865F2)
                .addFields({ name: '📊 Ticket Utilization', value: `Here you can see the current workload of our tickets.\n\n${workloadLines}` })
                .setImage(PANEL_IMAGE)
                .setTimestamp();

            // Build dropdown
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`ticket_open_${interaction.guildId}`)
                .setPlaceholder('Choose a category...')
                .addOptions(categories.map(c => ({ label: c.name, value: c.name })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const msg = await textChannel.send({ embeds: [embed], components: [row] });

            // Save panel to DB
            await TicketPanel.create({
                serverId: interaction.guildId,
                channelId: textChannel.id,
                logChannelId: logChannel.id,
                messageId: msg.id,
                title,
                description,
                categories,
                ticketCategoryId: ticketCategory.id,
                createdAt: new Date()
            });

            await interaction.editReply({ content: `✅ Ticket panel posted in <#${textChannel.id}>! Logs will go to <#${logChannel.id}>.` });

        } catch (err) {
            console.error('Error in /ticketsetup:', err);
            try { await interaction.editReply({ content: '❌ Error setting up ticket system.' }); } catch {}
        }
    }
};