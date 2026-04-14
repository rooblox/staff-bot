const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');
const { DEPT_CHOICES, checkDeptPermission, getDeptLogChannel } = require('./departments');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('terminate')
        .setDescription('Terminate a staff member')
        .addUserOption(option =>
            option.setName('user').setDescription('Staff member to terminate').setRequired(true))
        .addStringOption(option =>
            option.setName('rank').setDescription('User rank').setRequired(true))
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for termination').setRequired(true))
        .addStringOption(option =>
            option.setName('appealable').setDescription('Is this termination appealable?').setRequired(true)
                .addChoices({ name: 'Yes', value: 'Yes' }, { name: 'No', value: 'No' }))
        .addStringOption(option =>
            option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPT_CHOICES))
        .addStringOption(option =>
            option.setName('proof').setDescription('Proof (optional)').setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const department = interaction.options.getString('department');
            const hasPerms = await checkDeptPermission(client, interaction.user.id, department);
            if (!hasPerms) {
                return interaction.editReply({ content: `❌ You do not have permission to use this command for the **${department}** department.` });
            }

            const user = interaction.options.getUser('user');
            const rank = interaction.options.getString('rank');
            const reason = interaction.options.getString('reason');
            const appealable = interaction.options.getString('appealable');
            const proof = interaction.options.getString('proof') || 'Not provided';

            const today = new Date();
            const date = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getFullYear()).slice(-2)}`;

            let record = await StaffRecord.findById(user.id);
            if (!record) {
                record = new StaffRecord({ _id: user.id, rank, strikes: [], terminations: [], blacklists: [] });
            }

            record.rank = rank;
            record.terminations.push({
                reason,
                date: new Date().toISOString(),
                addedBy: { id: interaction.user.id, username: interaction.user.username },
                department,
                proof,
                removed: false
            });

            await record.save();

            const dmMessage = `# <:kaviacafe:1387492814916685845> | Termination Notice
-# ${date}
Hello ${user},
Following review, you have been **Terminated** effective immediately.
> **Reason →** *${reason}*
> **Appealable →** *${appealable}*
If this termination is appealable, please open a ticket in the appeals server.
<:reply:1467007523981627392> This action was discussed and approved by members of the SHR+ team.
***Sincerely,***
**${interaction.user.username} || ${department}**`;

            try { await user.send({ content: dmMessage }); } catch {}

            const embed = new EmbedBuilder()
                .setTitle('⚡ Staff Terminated')
                .setDescription('A staff member has been terminated.')
                .setColor(0xE74C3C)
                .addFields(
                    { name: '👮 Staff User', value: interaction.user.username },
                    { name: '⚡ Staff Member Terminated', value: user.username },
                    { name: '🏷️ Rank', value: rank },
                    { name: '🏢 Department', value: department },
                    { name: '📝 Reason', value: reason },
                    { name: '⚖️ Appealable', value: appealable },
                    { name: '📎 Proof', value: proof }
                )
                .setFooter({ text: `${department} Department` })
                .setTimestamp();

            const logChannel = await getDeptLogChannel(client, department);
            if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

            await interaction.editReply({ content: `✅ ${user.tag} has been terminated.` });

        } catch (err) {
            console.error('Error in /terminate command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};