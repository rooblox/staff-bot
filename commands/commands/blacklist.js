const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');
const { DEPT_CHOICES, checkDeptPermission, getDeptLogChannel } = require('./departments');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Blacklist a staff member')
        .addUserOption(option =>
            option.setName('user').setDescription('Staff member to blacklist').setRequired(true))
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for blacklist').setRequired(true))
        .addStringOption(option =>
            option.setName('your_rank').setDescription('Your rank').setRequired(true))
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
            const reason = interaction.options.getString('reason');
            const yourRank = interaction.options.getString('your_rank');
            const proof = interaction.options.getString('proof') || 'Not provided';

            let record = await StaffRecord.findById(user.id);
            if (!record) {
                record = new StaffRecord({ _id: user.id, strikes: [], terminations: [], blacklists: [] });
            }

            record.blacklists.push({
                reason,
                date: new Date().toISOString(),
                addedBy: { id: interaction.user.id, username: interaction.user.username },
                department,
                removed: false
            });

            await record.save();

            const dmMessage = `# <:kaviacafe:1387492814916685845> **Blacklist Notice**
Hello, ${user},
We regret to inform you that due to your recent actions and behavior, you have been **blacklisted** from **Kavià Café**.
> <:pink_pin:1166850035611353148> **Status →** *Blacklisted*
> <:pink_pin:1166850035611353148> **Reason →** *${reason}*
If you wish to appeal this decision, you may do so using the link below:
[Appeals](https://discord.gg/tXxeJUxd9D)
***Signed,***
**${interaction.user.username}**
**${yourRank} || ${department}**`;

            try { await user.send({ content: dmMessage }); } catch {}

            const embed = new EmbedBuilder()
                .setTitle('⛔ Staff Blacklisted')
                .setDescription('A staff member has been blacklisted.')
                .setColor(0xE74C3C)
                .addFields(
                    { name: '👮 Staff User', value: interaction.user.username },
                    { name: '⚡ Blacklisted Member', value: user.username },
                    { name: '🏢 Department', value: department },
                    { name: '📝 Reason', value: reason },
                    { name: '📎 Proof', value: proof }
                )
                .setFooter({ text: `${department} Department` })
                .setTimestamp();

            const logChannel = await getDeptLogChannel(client, department);
            if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

            await interaction.editReply({ content: `✅ ${user.tag} has been blacklisted.` });

        } catch (err) {
            console.error('Error in /blacklist command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};