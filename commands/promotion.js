const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { DEPT_CHOICES, checkDeptPermission, getDeptLogChannel } = require('./departments');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('promotion')
        .setDescription('Promote a staff member')
        .addUserOption(option =>
            option.setName('user').setDescription('Staff member to promote').setRequired(true))
        .addStringOption(option =>
            option.setName('old_rank').setDescription('Old rank of the user').setRequired(true))
        .addStringOption(option =>
            option.setName('new_rank').setDescription('New rank of the user').setRequired(true))
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for promotion').setRequired(true))
        .addStringOption(option =>
            option.setName('your_rank').setDescription('Your rank').setRequired(true))
        .addStringOption(option =>
            option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPT_CHOICES)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

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
            const yourRank = interaction.options.getString('your_rank');

            const dmMessage = `# <:kaviacafe:1387492814916685845> **Promotion Notice**
Hello, ${user},
We are delighted to inform you that you have been **promoted** at **Kavià Café**!
> <:pink_pin:1166850035611353148> **Old Rank →** *${oldRank}*
> <:pink_pin:1166850035611353148> **New Rank →** *${newRank}*
You will be ranked in our main server and Roblox group shortly.
***Signed,***
**${interaction.user.username}**
**${yourRank} || ${department}**`;

            try { await user.send({ content: dmMessage }); } catch {}

            const embed = new EmbedBuilder()
                .setTitle('🎉 Staff Promotion')
                .setDescription('A staff member has been promoted.')
                .setColor(0x2ECC71)
                .addFields(
                    { name: '👮 Promoted By', value: interaction.user.username },
                    { name: '⚡ Promoted Member', value: user.username },
                    { name: '⬅️ Old Rank', value: oldRank },
                    { name: '➡️ New Rank', value: newRank },
                    { name: '🏢 Department', value: department },
                    { name: '📝 Reason', value: reason }
                )
                .setFooter({ text: `${department} Department` })
                .setTimestamp();

            const logChannel = await getDeptLogChannel(client, department);
            if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

            await interaction.editReply({ content: `✅ ${user.tag} has been promoted.` });

        } catch (err) {
            console.error('Error in /promotion command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};