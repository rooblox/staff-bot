const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Checklist } = require('../db');

function buildChecklistEmbed(checklist, ownerLabel) {
    const lines = checklist.items.length > 0
        ? checklist.items.map((item, i) => `${item.done ? '✅' : '⬜'} **${i + 1}.** ${item.text}`).join('\n')
        : '_No items yet. Use `/checklist add` to add one!_';

    return new EmbedBuilder()
        .setTitle(`📋 ${checklist.scope === 'team' ? 'Team' : 'Personal'} Checklist`)
        .setDescription(lines)
        .setColor(0x5865F2)
        .setFooter({ text: ownerLabel })
        .setTimestamp();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('checklist')
        .setDescription('Manage a personal or team checklist')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('What to do')
                .setRequired(true)
                .addChoices(
                    { name: 'View', value: 'view' },
                    { name: 'Add Item', value: 'add' },
                    { name: 'Check Off Item', value: 'check' },
                    { name: 'Uncheck Item', value: 'uncheck' },
                    { name: 'Remove Item', value: 'remove' },
                    { name: 'Clear All', value: 'clear' }
                ))
        .addStringOption(option =>
            option.setName('scope')
                .setDescription('Personal or team checklist')
                .setRequired(true)
                .addChoices(
                    { name: 'Personal (just me)', value: 'personal' },
                    { name: 'Team (shared with server)', value: 'team' }
                ))
        .addStringOption(option =>
            option.setName('text')
                .setDescription('Item text (required for Add)')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('number')
                .setDescription('Item number (required for Check/Uncheck/Remove)')
                .setRequired(false)
                .setMinValue(1)),

    async execute(interaction, client) {
        const action = interaction.options.getString('action');
        const scope = interaction.options.getString('scope');
        const text = interaction.options.getString('text');
        const number = interaction.options.getInteger('number');

        const checklistId = scope === 'team'
            ? `team_${interaction.guildId}`
            : `personal_${interaction.user.id}`;

        const ownerLabel = scope === 'team'
            ? `Team Checklist • ${interaction.guild.name}`
            : `Personal Checklist • ${interaction.user.tag}`;

        try {
            let checklist = await Checklist.findById(checklistId);
            if (!checklist) {
                checklist = await Checklist.create({ _id: checklistId, scope, serverId: scope === 'team' ? interaction.guildId : null, ownerId: scope === 'personal' ? interaction.user.id : null, items: [] });
            }

            if (action === 'view') {
                return interaction.reply({ embeds: [buildChecklistEmbed(checklist, ownerLabel)], ephemeral: scope === 'personal' });
            }

            if (action === 'add') {
                if (!text) return interaction.reply({ content: '❌ You must provide text for the item.', ephemeral: true });
                checklist.items.push({ text, done: false, addedBy: interaction.user.id });
                await checklist.save();
                return interaction.reply({ content: `✅ Added item to the ${scope} checklist!`, embeds: [buildChecklistEmbed(checklist, ownerLabel)], ephemeral: scope === 'personal' });
            }

            if (action === 'check' || action === 'uncheck') {
                if (!number || number < 1 || number > checklist.items.length) return interaction.reply({ content: '❌ Invalid item number.', ephemeral: true });
                checklist.items[number - 1].done = action === 'check';
                await checklist.save();
                return interaction.reply({ content: `✅ Item ${action === 'check' ? 'checked off' : 'unchecked'}!`, embeds: [buildChecklistEmbed(checklist, ownerLabel)], ephemeral: scope === 'personal' });
            }

            if (action === 'remove') {
                if (!number || number < 1 || number > checklist.items.length) return interaction.reply({ content: '❌ Invalid item number.', ephemeral: true });
                checklist.items.splice(number - 1, 1);
                await checklist.save();
                return interaction.reply({ content: `✅ Item removed!`, embeds: [buildChecklistEmbed(checklist, ownerLabel)], ephemeral: scope === 'personal' });
            }

            if (action === 'clear') {
                checklist.items = [];
                await checklist.save();
                return interaction.reply({ content: `✅ Checklist cleared!`, embeds: [buildChecklistEmbed(checklist, ownerLabel)], ephemeral: scope === 'personal' });
            }

        } catch (err) {
            console.error('Error in /checklist:', err);
            try { await interaction.reply({ content: '❌ Error managing checklist.', ephemeral: true }); } catch {}
        }
    }
};