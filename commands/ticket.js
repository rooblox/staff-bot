const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { Ticket, TicketPanel } = require('../db');
const { DEPARTMENTS, hasMainRole } = require('./departments');

const PANEL_IMAGE = 'https://images-ext-1.discordapp.net/external/BRbAFEkp6sgftr5ZZdkP1qB0t_VrQJxkENCKXh76XG4/https/media.galaxybot.app/server/1370892833182974035/d00d856a-6931-405b-a916-b875c51eeee3.jpeg?format=webp';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticketsetup')
        .setDescription('Set up or update the ticket panel in a channel')
        .addChannelOption(option =>
            option.setName('channel').setDescription('Channel to post the ticket panel in').setRequired(true)
                .addChannelTypes(ChannelType.GuildText))
        .addStringOption(option =>
            option.setName('title').setDescription('Title of the ticket panel').setRequired(false))
        .addStringOption(option =>
            option.setName('description').setDescription('Description of the ticket panel').setRequired(false))
        .addStringOption(option =>
            option.setName('category_1').setDescription('First ticket category name').setRequired(false))
        .addStringOption(option =>
            option.setName('category_1_emoji').setDescription('Emoji for category 1').setRequired(false))
        .addStringOption(option =>
            option.setName('category_1_description').setDescription('Description for category 1').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role_1').setDescription('Role to ping for category 1').setRequired(false))
        .addStringOption(option =>
            option.setName('category_2').setDescription('Second ticket category name').setRequired(false))
        .addStringOption(option =>
            option.setName('category_2_emoji').setDescription('Emoji for category 2').setRequired(false))
        .addStringOption(option =>
            option.setName('category_2_description').setDescription('Description for category 2').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role_2').setDescription('Role to ping for category 2').setRequired(false))
        .addStringOption(option =>
            option.setName('category_3').setDescription('Third ticket category name').setRequired(false))
        .addStringOption(option =>
            option.setName('category_3_emoji').setDescription('Emoji for category 3').setRequired(false))
        .addStringOption(option =>
            option.setName('category_3_description').setDescription('Description for category 3').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role_3').setDescription('Role to ping for category 3').setRequired(false))
        .addStringOption(option =>
            option.setName('category_4').setDescription('Fourth ticket category name').setRequired(false))
        .addStringOption(option =>
            option.setName('category_4_emoji').setDescription('Emoji for category 4').setRequired(false))
        .addStringOption(option =>
            option.setName('category_4_description').setDescription('Description for category 4').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role_4').setDescription('Role to ping for category 4').setRequired(false))
        .addStringOption(option =>
            option.setName('category_5').setDescription('Fifth ticket category name').setRequired(false))
        .addStringOption(option =>
            option.setName('category_5_emoji').setDescription('Emoji for category 5').setRequired(false))
        .addStringOption(option =>
            option.setName('category_5_description').setDescription('Description for category 5').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role_5').setDescription('Role to ping for category 5').setRequired(false))
        .addStringOption(option =>
            option.setName('category_6').setDescription('Sixth ticket category name').setRequired(false))
        .addStringOption(option =>
            option.setName('category_6_emoji').setDescription('Emoji for category 6').setRequired(false))
        .addStringOption(option =>
            option.setName('category_6_description').setDescription('Description for category 6').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role_6').setDescription('Role to ping for category 6').setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            let hasPerms = false;
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            for (const dept of Object.values(DEPARTMENTS)) {
                if (dept.serverId === interaction.guildId && member?.roles.cache.has(dept.roleId)) {
                    hasPerms = true;
                    break;
                }
            }
            if (!hasPerms) hasPerms = await hasMainRole(client, interaction.user.id);
            if (!hasPerms) return interaction.editReply({ content: '❌ You do not have permission to set up the ticket system.' });

            const channel = interaction.options.getChannel('channel');
            const textChannel = await interaction.guild.channels.fetch(channel.id);
            if (!textChannel?.isTextBased()) return interaction.editReply({ content: '❌ Please select a text channel.' });

            const existingPanel = await TicketPanel.findOne({ serverId: interaction.guildId, channelId: textChannel.id });

            if (existingPanel) {
                // ========== UPDATE EXISTING PANEL ==========
                const title = interaction.options.getString('title') || existingPanel.title;
                const description = interaction.options.getString('description') || existingPanel.description;

                let categories = existingPanel.categories.map(c => ({ ...c.toObject() }));

                for (let i = 1; i <= 6; i++) {
                    const name = interaction.options.getString(`category_${i}`);
                    const role = interaction.options.getRole(`ping_role_${i}`);
                    const emoji = interaction.options.getString(`category_${i}_emoji`);
                    const desc = interaction.options.getString(`category_${i}_description`);
                    const index = i - 1;

                    if (name && role) {
                        categories[index] = {
                            name,
                            pingRoleId: role.id,
                            emoji: emoji || categories[index]?.emoji || null,
                            description: desc || categories[index]?.description || null
                        };
                    } else if (name && !role && categories[index]) {
                        categories[index] = {
                            ...categories[index],
                            name,
                            emoji: emoji !== null ? emoji : categories[index].emoji,
                            description: desc !== null ? desc : categories[index].description
                        };
                    } else if ((emoji || desc) && categories[index]) {
                        if (emoji) categories[index].emoji = emoji;
                        if (desc) categories[index].description = desc;
                    }
                }

                categories = categories.filter(Boolean);
                if (categories.length === 0) return interaction.editReply({ content: '❌ No categories found.' });

                const seen = new Set();
                categories = categories.filter(c => {
                    if (seen.has(c.name)) return false;
                    seen.add(c.name);
                    return true;
                });

                const workloadData = await Promise.all(categories.map(async (c) => {
                    const count = await Ticket.countDocuments({ serverId: interaction.guildId, category: c.name, status: { $in: ['open', 'claimed'] } });
                    const pct = Math.round((count / 5) * 100);
                    return `• **${c.emoji ? c.emoji + ' ' : ''}${c.name}:** Available \`${count}/5\` (${pct}%)`;
                }));

                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(description)
                    .setColor(0x5865F2)
                    .addFields({ name: '📊 Ticket Utilization', value: `Here you can see the current workload of our tickets.\n\n${workloadData.join('\n')}` })
                    .setImage(PANEL_IMAGE)
                    .setTimestamp();

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`ticket_open_${interaction.guildId}`)
                    .setPlaceholder('Choose a category...')
                    .addOptions(categories.map(c => {
                        const option = { label: c.name, value: c.name };
                        if (c.emoji) option.emoji = c.emoji;
                        if (c.description) option.description = c.description.substring(0, 100);
                        return option;
                    }));

                const row = new ActionRowBuilder().addComponents(selectMenu);

                let updatedMessageId = existingPanel.messageId;
                try {
                    const existingMsg = await textChannel.messages.fetch(existingPanel.messageId).catch(() => null);
                    if (existingMsg) {
                        await existingMsg.edit({ embeds: [embed], components: [row] });
                    } else {
                        const newMsg = await textChannel.send({ embeds: [embed], components: [row] });
                        updatedMessageId = newMsg.id;
                    }
                } catch {
                    const newMsg = await textChannel.send({ embeds: [embed], components: [row] });
                    updatedMessageId = newMsg.id;
                }

                await TicketPanel.findByIdAndUpdate(existingPanel._id, {
                    title,
                    description,
                    categories,
                    messageId: updatedMessageId
                });

                await interaction.editReply({ content: `✅ Ticket panel updated in <#${textChannel.id}>!` });

            } else {
                // ========== CREATE NEW PANEL ==========
                const title = interaction.options.getString('title');
                const description = interaction.options.getString('description');

                if (!title) return interaction.editReply({ content: '❌ Please provide a title for the new panel.' });
                if (!description) return interaction.editReply({ content: '❌ Please provide a description for the new panel.' });

                const categories = [];
                for (let i = 1; i <= 6; i++) {
                    const name = interaction.options.getString(`category_${i}`);
                    const role = interaction.options.getRole(`ping_role_${i}`);
                    const emoji = interaction.options.getString(`category_${i}_emoji`) || null;
                    const desc = interaction.options.getString(`category_${i}_description`) || null;
                    if (name && role) categories.push({ name, pingRoleId: role.id, emoji, description: desc });
                }
                if (categories.length === 0) return interaction.editReply({ content: '❌ Please provide at least one category and ping role.' });

                let ticketCategory = interaction.guild.channels.cache.find(c => c.name === '🎫 Tickets' && c.type === ChannelType.GuildCategory);
                if (!ticketCategory) {
                    ticketCategory = await interaction.guild.channels.create({
                        name: '🎫 Tickets',
                        type: ChannelType.GuildCategory,
                        position: 0
                    });
                }

                const logChannel = await interaction.guild.channels.create({
                    name: 'ticket-logs',
                    type: ChannelType.GuildText,
                    parent: ticketCategory.id,
                    permissionOverwrites: [
                        { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                    ]
                });

                for (const cat of categories) {
                    await logChannel.permissionOverwrites.edit(cat.pingRoleId, {
                        ViewChannel: true, SendMessages: false, ReadMessageHistory: true
                    });
                }

                const workloadLines = categories.map(c => `• **${c.emoji ? c.emoji + ' ' : ''}${c.name}:** Available \`0/5\` (0%)`).join('\n');

                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(description)
                    .setColor(0x5865F2)
                    .addFields({ name: '📊 Ticket Utilization', value: `Here you can see the current workload of our tickets.\n\n${workloadLines}` })
                    .setImage(PANEL_IMAGE)
                    .setTimestamp();

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`ticket_open_${interaction.guildId}`)
                    .setPlaceholder('Choose a category...')
                    .addOptions(categories.map(c => {
                        const option = { label: c.name, value: c.name };
                        if (c.emoji) option.emoji = c.emoji;
                        if (c.description) option.description = c.description.substring(0, 100);
                        return option;
                    }));

                const row = new ActionRowBuilder().addComponents(selectMenu);

                const msg = await textChannel.send({ embeds: [embed], components: [row] });

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
            }

        } catch (err) {
            console.error('Error in /ticketsetup:', err);
            try { await interaction.editReply({ content: '❌ Error setting up ticket system.' }); } catch {}
        }
    }
};