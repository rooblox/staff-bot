/**
 * linkroblox.js — /linkroblox slash command
 *
 * Links a Discord user to their Roblox account for the in-game session system.
 * Verifies the username against the Roblox API and stores discordId → robloxUserId.
 *
 * SETUP IN index.js — add to your slash command handler:
 *   const { handleLinkRoblox, linkRobloxCommand } = require('./commands/linkroblox');
 *   // In your commands array: linkRobloxCommand
 *   // In interactionCreate: if (interaction.commandName === 'linkroblox') { await handleLinkRoblox(interaction); return; }
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { RobloxLink } = require('../db');

const linkRobloxCommand = new SlashCommandBuilder()
    .setName('linkroblox')
    .setDescription('Link your Roblox account to the session system')
    .addStringOption(opt =>
        opt.setName('username')
            .setDescription('Your exact Roblox username')
            .setRequired(false)
    )
    .addNumberOption(opt =>
        opt.setName('userid')
            .setDescription('Your Roblox User ID (alternative to username)')
            .setRequired(false)
    );

async function resolveRobloxUser(username, userId) {
    // If userId provided, verify it exists and get username
    if (userId) {
        const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
        if (!res.ok) return null;
        const data = await res.json();
        return { id: String(data.id), username: data.name };
    }

    // If username provided, resolve to ID
    if (username) {
        const res = await fetch('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const user = data?.data?.[0];
        if (!user) return null;
        return { id: String(user.id), username: user.name };
    }

    return null;
}

async function handleLinkRoblox(interaction) {
    const username = interaction.options.getString('username');
    const userId   = interaction.options.getNumber('userid');

    if (!username && !userId) {
        return interaction.reply({
            embeds: [{
                color: 0xED4245,
                description: '❌ Please provide either your Roblox **username** or **User ID**.\n\nExample: `/linkroblox username:Connor_iRBLX`',
            }],
            ephemeral: true,
        });
    }

    await interaction.deferReply({ ephemeral: true });

    let robloxUser;
    try {
        robloxUser = await resolveRobloxUser(username, userId);
    } catch (err) {
        console.error('[linkroblox] Roblox API error:', err);
        return interaction.editReply({
            embeds: [{ color: 0xED4245, description: '❌ Could not reach the Roblox API. Try again in a moment.' }]
        });
    }

    if (!robloxUser) {
        return interaction.editReply({
            embeds: [{ color: 0xED4245, description: `❌ No Roblox account found for **${username || userId}**. Make sure the username/ID is exact.` }]
        });
    }

    // Check if this Roblox account is already linked to someone else
    const existing = await RobloxLink.findOne({ robloxUserId: robloxUser.id });
    if (existing && existing.discordId !== interaction.user.id) {
        return interaction.editReply({
            embeds: [{ color: 0xED4245, description: `❌ That Roblox account is already linked to a different Discord user.` }]
        });
    }

    // Upsert the link
    await RobloxLink.findOneAndUpdate(
        { discordId: interaction.user.id },
        {
            discordId:       interaction.user.id,
            robloxUserId:    robloxUser.id,
            robloxUsername:  robloxUser.username,
            linkedAt:        new Date(),
        },
        { upsert: true, new: true }
    );

    return interaction.editReply({
        embeds: [{
            color: 0x57F287,
            title: '✅ Roblox Account Linked',
            description: `Your Discord account is now linked to **${robloxUser.username}** (ID: \`${robloxUser.id}\`).\n\nYou'll receive in-game session prompts 10 minutes before your scheduled sessions!`,
            footer: { text: 'Use /linkroblox again to update your linked account.' },
        }]
    });
}

module.exports = { linkRobloxCommand, handleLinkRoblox };