const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { DeptConfigCache, Resignation } = require('../db');
const { DEPARTMENTS, DEPT_CHOICES } = require('./departments');

// ─────────────────────────────────────────────────────────────────────────────
// Ensure a resign-log channel exists for the given department.
// Checks DB first; if the channel is missing or deleted, creates it in the
// same category as the dept's LOA log channel and persists the ID.
// ─────────────────────────────────────────────────────────────────────────────
async function ensureResignLogChannel(client, department) {
    const deptConfig = DEPARTMENTS[department];
    if (!deptConfig) return null;

    // Check DB cache
    let cache = await DeptConfigCache.findById(department);
    if (cache?.resignLogChannelId) {
        // Verify channel still exists
        try {
            const ch = await client.channels.fetch(cache.resignLogChannelId);
            if (ch) return ch;
        } catch {
            // Channel was deleted — fall through and recreate
        }
    }

    // Find category from LOA log channel
    let categoryId = null;
    try {
        const loaLogChannel = await client.channels.fetch(deptConfig.loaLogChannelId);
        categoryId = loaLogChannel?.parentId || null;
    } catch {
        // Can't find LOA log channel — we'll create in no category
    }

    // Create the channel
    const guild = await client.guilds.fetch(deptConfig.serverId);
    const channelName = `resign-log`;

    const newChannel = await guild.channels.create({
        name: channelName,
        type: 0, // GUILD_TEXT
        parent: categoryId || undefined,
        topic: `Resignation logs for ${department}`,
        reason: 'Auto-created by Kavià Café Staff Bot for resignation logging'
    });

    // Persist to DB
    await DeptConfigCache.findByIdAndUpdate(
        department,
        { resignLogChannelId: newChannel.id },
        { upsert: true }
    );

    console.log(`✅ Created resign-log channel for ${department}: ${newChannel.id}`);
    return newChannel;
}

// ─────────────────────────────────────────────────────────────────────────────
// On bot startup: provision resign-log channels for all departments
// Call this from client.once('ready')
// ─────────────────────────────────────────────────────────────────────────────
async function provisionResignChannels(client) {
    for (const [deptKey, deptConfig] of Object.entries(DEPARTMENTS)) {
        try {
            await ensureResignLogChannel(client, deptKey);
        } catch (err) {
            console.error(`[resign] Failed to provision channel for ${deptKey}:`, err.message);
        }
    }
    console.log('✅ Resign log channels provisioned');
}

// ─────────────────────────────────────────────────────────────────────────────
// /resign command
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName('resign')
        .setDescription('Log a staff resignation')
        .addStringOption(opt =>
            opt.setName('department')
                .setDescription('Department the staff member is resigning from')
                .setRequired(true)
                .addChoices(...DEPT_CHOICES))
        .addUserOption(opt =>
            opt.setName('staff_member')
                .setDescription('The staff member who is resigning')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('reason')
                .setDescription('Reason for resignation')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('last_day')
                .setDescription('Last day of service (DD/MM/YY or "today")')
                .setRequired(true)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const department = interaction.options.getString('department');
            const targetUser = interaction.options.getUser('staff_member');
            const reason = interaction.options.getString('reason');
            const lastDay = interaction.options.getString('last_day');

            const deptConfig = DEPARTMENTS[department];
            if (!deptConfig) {
                return interaction.editReply({ content: '❌ Invalid department selected.' });
            }

            // Get or create the resign log channel
            let resignChannel;
            try {
                resignChannel = await ensureResignLogChannel(client, department);
            } catch (err) {
                console.error('[resign] ensureResignLogChannel error:', err);
                return interaction.editReply({ content: '❌ Could not find or create the resign log channel. Check bot permissions.' });
            }

            if (!resignChannel) {
                return interaction.editReply({ content: '❌ Could not locate the resign log channel.' });
            }

            // Save to DB
            const resignation = new Resignation({
                userId: targetUser.id,
                userTag: targetUser.tag,
                department,
                resignedBy: interaction.user.id,
                resignedByTag: interaction.user.tag,
                reason,
                lastDay,
                logChannelId: resignChannel.id,
                createdAt: new Date()
            });
            await resignation.save();

            // Build embed
            const embed = new EmbedBuilder()
                .setTitle('📤 Staff Resignation')
                .setColor(0xE74C3C)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 Staff Member', value: `<@${targetUser.id}> (${targetUser.tag})`, inline: false },
                    { name: '🏢 Department', value: department, inline: true },
                    { name: '📅 Last Day', value: lastDay, inline: true },
                    { name: '📝 Reason', value: reason, inline: false },
                    { name: '🔖 Logged By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '🕐 Logged At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                )
                .setFooter({ text: `Resignation ID: ${resignation._id} • Kavià Café` })
                .setTimestamp();

            const msg = await resignChannel.send({ embeds: [embed] });

            // Save message ID back
            await Resignation.findByIdAndUpdate(resignation._id, { logMessageId: msg.id });

            await interaction.editReply({
                content: `✅ Resignation logged successfully for **${targetUser.tag}** in ${resignChannel}.\n\n📋 [Jump to log](https://discord.com/channels/${resignChannel.guild.id}/${resignChannel.id}/${msg.id})`
            });

        } catch (err) {
            console.error('Error in /resign command:', err);
            try { await interaction.editReply({ content: '❌ An error occurred while logging the resignation.' }); } catch {}
        }
    },

    // Export for use in index.js ready handler
    provisionResignChannels
};