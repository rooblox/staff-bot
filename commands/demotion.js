const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { DEPT_CHOICES, checkDeptPermission, getDeptLogChannel } = require('./departments');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('demotion')
        .setDescription('Demote a staff member')
        .addUserOption(option =>
            option.setName('user').setDescription('Staff member to demote').setRequired(true))
        .addStringOption(option =>
            option.setName('old_rank').setDescription('Old rank of the user').setRequired(true))
        .addStringOption(option =>
            option.setName('new_rank').setDescription('New rank of the user').setRequired(true))
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for demotion').setRequired(true))
        .addStringOption(option =>
            option.setName('appealable').setDescription('Is this demotion appealable?').setRequired(true)
                .addChoices({ name: 'Yes', value: 'Yes' }, { name: 'No', value: 'No' }))
        .addStringOption(option =>
            option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPT_CHOICES)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const department = interaction.options.getString('department');
            const hasPerms = await checkDeptPermission(client, interaction.user.id, department);
            if (!hasPerms) {
                return interaction.editReply({ content: `❌ You do not have permission to use this command for the **${department}** department.` });
            }

            const user = interaction.options.getUser('user');
            const oldRank = interaction.options.getString('old_rank');
            const newRank = interaction.options.getString('new_rank');
            const reason = interaction.options.getString('reason');
            const appealable = interaction.options.getString('appealable');

            const today = new Date();
            const date = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getFullYear()).slice(-2)}`;

            const dmMessage = `# <:kaviacafe:1387492814916685845> | Demotion Notice
-# ${date}
Hello ${user},
Following review, you have been **demoted** effective immediately.
> **Reason →** *${reason}*
> **Appealable →** *${appealable}*
If this demotion is appealable, please open a ticket in the appeals server.
<:reply:1467007523981627392> This action was discussed and approved by members of the SHR+ team.
***Sincerely,***
**${interaction.user.username} || ${department}**`;

            try { await user.send({ content: dmMessage }); } catch {}

            const embed = new EmbedBuilder()
                .setTitle('📉 Staff Demoted')
                .setDescription('A staff member has been demoted.')
                .setColor(0xE67E22)
                .addFields(
                    { name: '👮 Demoted By', value: interaction.user.username },
                    { name: '⚡ Demoted Member', value: user.username },
                    { name: '⬅️ Old Rank', value: oldRank },
                    { name: '➡️ New Rank', value: newRank },
                    { name: '🏢 Department', value: department },
                    { name: '📝 Reason', value: reason },
                    { name: '⚖️ Appealable', value: appealable }
                )
                .setFooter({ text: `${department} Department` })
                .setTimestamp();

            const logChannel = await getDeptLogChannel(client, department);
            if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

            await interaction.editReply({ content: `✅ ${user.tag} has been demoted.` });

        } catch (err) {
            console.error('Error in /demotion command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};