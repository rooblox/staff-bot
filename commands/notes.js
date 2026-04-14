const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');
const { DEPT_CHOICES, checkDeptPermission, getDeptLogChannel } = require('./departments');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('notes')
        .setDescription('Add, view or remove private internal notes on a staff member')
        .addStringOption(option =>
            option.setName('action').setDescription('Add, view or remove notes').setRequired(true)
                .addChoices(
                    { name: 'Add Note', value: 'add' },
                    { name: 'View Notes', value: 'view' },
                    { name: 'Remove Note', value: 'remove' }
                ))
        .addUserOption(option =>
            option.setName('user').setDescription('Staff member').setRequired(true))
        .addStringOption(option =>
            option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPT_CHOICES))
        .addStringOption(option =>
            option.setName('note').setDescription('The note to add (only required when adding)').setRequired(false))
        .addIntegerOption(option =>
            option.setName('number').setDescription('Note number to remove (only required when removing)').setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const department = interaction.options.getString('department');
            const hasPerms = await checkDeptPermission(client, interaction.user.id, department);
            if (!hasPerms) {
                return interaction.editReply({ content: `❌ You do not have permission to use this command for the **${department}** department.` });
            }

            const action = interaction.options.getString('action');
            const user = interaction.options.getUser('user');
            const noteText = interaction.options.getString('note');
            const number = interaction.options.getInteger('number');

            let record = await StaffRecord.findById(user.id);

            if (action === 'add') {
                if (!noteText) return interaction.editReply({ content: '❌ You must provide a note to add.' });

                if (!record) {
                    record = new StaffRecord({ _id: user.id, strikes: [], terminations: [], blacklists: [], notes: [] });
                }

                if (!record.notes) record.notes = [];

                record.notes.push({
                    note: noteText,
                    date: new Date().toISOString(),
                    department,
                    addedBy: { id: interaction.user.id, username: interaction.user.username }
                });

                await record.save();

                const embed = new EmbedBuilder()
                    .setTitle('📝 Note Added')
                    .setColor(0x3498DB)
                    .addFields(
                        { name: '👮 Added By', value: interaction.user.username },
                        { name: '⚡ About', value: user.username },
                        { name: '🏢 Department', value: department },
                        { name: '📝 Note', value: noteText }
                    )
                    .setFooter({ text: `${department} Department` })
                    .setTimestamp();

                const logChannel = await getDeptLogChannel(client, department);
                if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

                await interaction.editReply({ content: `✅ Note added to ${user.tag}'s record.` });

            } else if (action === 'view') {
                const deptNotes = record?.notes?.filter(n => n.department === department) || [];
                if (deptNotes.length === 0) {
                    return interaction.editReply({ content: `❌ No notes found for this user in the **${department}** department.` });
                }

                const embed = new EmbedBuilder()
                    .setTitle(`📝 Notes for ${user.tag} — ${department}`)
                    .setColor(0x3498DB)
                    .setTimestamp();

                for (const [index, n] of deptNotes.entries()) {
                    embed.addFields({
                        name: `Note #${index + 1} — ${n.addedBy?.username || 'Unknown'} — ${n.date.slice(0, 10)}`,
                        value: n.note
                    });
                }

                await interaction.editReply({ embeds: [embed] });

            } else if (action === 'remove') {
                const deptNotes = record?.notes?.filter(n => n.department === department) || [];
                if (deptNotes.length === 0) {
                    return interaction.editReply({ content: `❌ No notes found for this user in the **${department}** department.` });
                }

                if (!number || number < 1 || number > deptNotes.length) {
                    return interaction.editReply({ content: `❌ Invalid note number. This user has ${deptNotes.length} note(s) in this department.` });
                }

                const noteToRemove = deptNotes[number - 1];
                const noteIndex = record.notes.findIndex(n =>
                    n.note === noteToRemove.note &&
                    n.date === noteToRemove.date &&
                    n.department === department
                );
                if (noteIndex !== -1) record.notes.splice(noteIndex, 1);
                await record.save();

                const embed = new EmbedBuilder()
                    .setTitle('🗑️ Note Removed')
                    .setColor(0xE74C3C)
                    .addFields(
                        { name: '👮 Removed By', value: interaction.user.username },
                        { name: '⚡ About', value: user.username },
                        { name: '🏢 Department', value: department },
                        { name: '📝 Removed Note', value: noteToRemove.note }
                    )
                    .setFooter({ text: `${department} Department` })
                    .setTimestamp();

                const logChannel = await getDeptLogChannel(client, department);
                if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

                await interaction.editReply({ content: `✅ Note #${number} removed from ${user.tag}'s record.` });
            }

        } catch (err) {
            console.error('Error in /notes command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};