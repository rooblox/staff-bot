const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { StaffRecord } = require('../db');
const { DEPT_CHOICES, checkDeptPermission, hasMainRole } = require('./departments');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('viewdiscipline')
        .setDescription('View the discipline record of a user')
        .addUserOption(option =>
            option.setName('user').setDescription('The user to view discipline for').setRequired(true))
        .addStringOption(option =>
            option.setName('department').setDescription('Department to view or All').setRequired(true)
                .addChoices(
                    ...DEPT_CHOICES,
                    { name: 'All Departments', value: 'all' }
                )),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const department = interaction.options.getString('department');

            if (department === 'all') {
                const mainRole = await hasMainRole(client, interaction.user.id);
                if (!mainRole) {
                    return interaction.editReply({ content: '❌ You need the main server role to view all departments.' });
                }
            } else {
                const hasPerms = await checkDeptPermission(client, interaction.user.id, department);
                if (!hasPerms) {
                    return interaction.editReply({ content: `❌ You do not have permission to view the **${department}** department.` });
                }
            }

            const targetUser = interaction.options.getUser('user');
            const record = await StaffRecord.findById(targetUser.id);

            if (!record) {
                return interaction.editReply({ content: '❌ No discipline record found for this user.' });
            }

            const filterDept = department === 'all' ? null : department;

            const buildFields = (array, type) => {
                const filtered = filterDept ? array.filter(e => e.department === filterDept) : array;
                return filtered.map((entry, index) => {
                    const status = entry.removed ? '✅ Past' : '⚠️ Active';
                    const addedBy = entry.addedBy?.username || 'Unknown';
                    const deptLabel = filterDept ? '' : ` *(${entry.department || 'Unknown'})*`;
                    return {
                        name: `${type} #${index + 1} ${status}${deptLabel}`,
                        value: `**Reason:** ${entry.reason}\n**Date:** ${entry.date}\n**Added By:** ${addedBy}${entry.removed ? `\n**Removed**` : ''}`
                    };
                });
            };

            const allEntries = [
                ...buildFields(record.strikes || [], 'Strike'),
                ...buildFields(record.terminations || [], 'Termination'),
                ...buildFields(record.blacklists || [], 'Blacklist')
            ];

            if (allEntries.length === 0) {
                return interaction.editReply({ content: `❌ No discipline records found for this user${filterDept ? ` in the **${filterDept}** department` : ''}.` });
            }

            const pageSize = 10;
            const pages = [];

            for (let i = 0; i < allEntries.length; i += pageSize) {
                const embed = new EmbedBuilder()
                    .setTitle(`Discipline Record — ${targetUser.tag}${filterDept ? ` (${filterDept})` : ' (All Departments)'}`)
                    .setColor('#ff0000')
                    .setTimestamp()
                    .addFields(allEntries.slice(i, i + pageSize));
                pages.push(embed);
            }

            let currentPage = 0;

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('prev').setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId('next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(pages.length <= 1)
            );

            const message = await interaction.editReply({ embeds: [pages[currentPage]], components: [row], fetchReply: true });

            if (pages.length <= 1) return;

            const collector = message.createMessageComponentCollector({ time: 600000 });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) return i.reply({ content: '❌ Only the command user can navigate pages.', ephemeral: true });
                if (i.customId === 'next') currentPage++;
                else if (i.customId === 'prev') currentPage--;

                const newRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('prev').setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0),
                    new ButtonBuilder().setCustomId('next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(currentPage === pages.length - 1)
                );

                await i.update({ embeds: [pages[currentPage]], components: [newRow] });
            });

            collector.on('end', async () => {
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('prev').setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(true),
                    new ButtonBuilder().setCustomId('next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(true)
                );
                message.edit({ components: [disabledRow] }).catch(() => {});
            });

        } catch (err) {
            console.error('Error in /viewdiscipline command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};